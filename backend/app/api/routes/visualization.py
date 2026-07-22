"""
Visualization API routes.

Plot data endpoints for results, QC, and GSEA.
"""

import asyncio
import json
import logging
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.api.deps import get_session_store
from app.api.routes.visualization_shared import (
    FileCache,
    create_response,
)
from app.api.routes.visualization_shared import (
    cache_key as _cache_key,
)
from app.api.routes.visualization_shared import (
    visualization_cache as viz_cache,
)
from app.core.config import settings
from app.db.session_store import SessionStore
from app.services.abundance_repository import AbundanceRepository
from app.services.differential_repository import DifferentialRepository
from app.services.gsea_service import gsea_service
from app.services.task_manager import (
    TaskCancelledError,
    TaskKind,
    TaskTimeoutError,
    task_manager,
)
from app.utils.json_io import read_json_file

VALID_GSEA_DATABASES = {"go_bp", "go_mf", "go_cc", "kegg", "reactome"}

# Map database names to GMT file names
_GMT_FILES = {
    "go_bp": "Enrichr.GO_Biological_Process_2021.gmt",
    "go_mf": "Enrichr.GO_Molecular_Function_2021.gmt",
    "go_cc": "Enrichr.GO_Cellular_Component_2021.gmt",
    "kegg": "Enrichr.KEGG_2021_Human.gmt",
    "reactome": "Enrichr.Reactome_2022.gmt",
}
_cache_gmt: dict[str, dict[str, set[str]]] = {}  # db -> {pathway_name -> set of genes}
_cache_lock = threading.Lock()  # protects _cache_gmt and _gsea_file_cache


def _get_pathway_genes(database: str, term: str) -> set[str]:
    """Get full gene set for a pathway from GMT cache file."""
    if database in _cache_gmt and term in _cache_gmt.get(database, {}):
        return _cache_gmt[database][term]

    gmt_filename = _GMT_FILES.get(database)
    if not gmt_filename:
        return set()

    gmt_path = Path.home() / ".cache" / "gseapy" / gmt_filename
    if not gmt_path.exists():
        return set()

    gene_sets: dict[str, set[str]] = {}
    with open(gmt_path) as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 3:
                name = parts[0]
                genes = set(parts[2:])
                gene_sets[name] = genes

    _cache_gmt[database] = gene_sets

    # Try exact match first
    if term in gene_sets:
        return gene_sets[term]

    # Fallback: partial match
    for name, genes in gene_sets.items():
        if name.startswith(term) or term.startswith(name):
            return genes

    return set()


router = APIRouter()
logger = logging.getLogger("proteomics")


def load_qc_results(results_dir: Path) -> dict[str, Any]:
    """Load QC results from JSON file.

    Args:
        results_dir: Path to session results directory

    Returns:
        QC results dictionary with summary statistics
    """
    qc_file = results_dir / "QC_Results.json"

    # Default empty structure with all required fields
    default_result = {
        "pca": {
            "samples": [],
            "pc1": [],
            "pc2": [],
            "conditions": [],
            "pc1_variance": 0,
            "pc2_variance": 0,
        },
        "pvalue_distribution": {"bins": [], "counts": []},
        "psm_cv": {},
        "protein_cv": {},
        "intensity_distributions": {"psm_boxplot": {}, "protein_boxplot": {}},
        "data_completeness": [],
        "psm_completeness": [],
        # Summary statistics - will be populated from data or set to None
        "total_psms": None,
        "avg_psms_per_sample": None,
        "total_proteins": None,
        "avg_proteins_per_sample": None,
        "average_cv": None,
        "completeness_rate": None,
    }

    if not qc_file.exists():
        return default_result

    try:
        with open(qc_file) as f:
            data = json.load(f)

        # Merge with defaults to ensure all fields exist
        result = {**default_result, **data}

        # MAJ-005: Correct total_psms if it was calculated as total rows instead of unique PSMs
        # The bug showed ~49,000 (total rows) instead of ~4,600 (unique PSMs)
        # If total_psms is unreasonably high (>20,000), flag it as potentially wrong
        if result.get("total_psms") and result.get("total_psms") > 20000:
            # This is likely the bug - total rows were counted instead of unique PSMs
            # We can't fix it without re-reading the PSM file, but we can add a note
            # or try to estimate from psm_completeness if available
            psm_completeness = result.get("psm_completeness", [])
            if psm_completeness and len(psm_completeness) > 0:
                # Estimate from first sample's present count
                first_sample = psm_completeness[0]
                if hasattr(first_sample, "get"):
                    estimated_unique = first_sample.get("present", 0)
                    if estimated_unique > 0 and estimated_unique < result["total_psms"]:
                        # Use the estimated unique count as a hint
                        result["total_psms_note"] = (
                            f"Estimated ~{estimated_unique:,} unique PSMs (cached value may include duplicates)"
                        )

        return result
    except Exception as e:
        logger.error(f"Error loading QC results: {e}")
        return default_result


# Global cache for loaded GSEA results (session_path -> dict of database -> list of results)
# Loaded once per session, then served from memory
# Size-limited cache for GSEA results — each entry can be hundreds of MB
_gsea_file_cache = FileCache(max_size=5)


def _load_gsea_json(filepath: Path) -> dict:
    """Load and parse a GSEA JSON file. Run via asyncio.to_thread to avoid blocking."""
    with open(filepath) as f:
        return json.load(f)


def load_gsea_results(
    results_dir: Path, database: str, session_id: str = ""
) -> dict[str, Any]:
    """Load GSEA results from JSON file with per-session memory caching.

    The GSEA results file can be hundreds of MB to multiple GB. We load it
    once per session and keep it in memory so subsequent database switches
    (go_bp, kegg, etc.) are instant.

    Args:
        results_dir: Path to session results directory
        database: Database name (go_bp, go_cc, go_mf, kegg, reactome)
        session_id: Session ID for cache keying

    Returns:
        GSEA results dictionary
    """
    gsea_file = results_dir / "GSEA_Results.json"

    if not gsea_file.exists():
        return {
            "results": [],
            "database": database,
            "total_pathways": 0,
            "significant_pathways": 0,
            "overrepresented": 0,
            "underrepresented": 0,
        }

    # Load entire file once per session, cache all databases in memory.
    # Double-checked locking: check under lock, load outside lock, store under lock.
    cache_key = str(gsea_file)

    with _cache_lock:
        cached = _gsea_file_cache.get(cache_key)

    if cached is None:
        try:
            logger.info(
                f"Loading GSEA results into memory: {gsea_file.name} ({gsea_file.stat().st_size / 1024 / 1024:.1f} MB)"
            )
            all_results = _load_gsea_json(gsea_file)
            # Pre-process all databases at once
            cached = {}
            for db_name, db_data in all_results.items():
                res_list = db_data.get("results", [])
                for r in res_list:
                    r["significant"] = (
                        abs(r.get("nes", 0)) >= 1.0 and r.get("fdr", 1) < 0.25
                    )
                cached[db_name] = res_list
            with _cache_lock:
                _gsea_file_cache.set(cache_key, cached)
            logger.info(f"GSEA results cached: {len(cached)} databases")
        except Exception as e:
            logger.error(f"Error loading GSEA results: {e}")
            return {
                "results": [],
                "database": database,
                "total_pathways": 0,
                "significant_pathways": 0,
                "overrepresented": 0,
                "underrepresented": 0,
            }

    db_results = cached.get(database, [])
    results = db_results

    # Calculate summary stats
    significant_count = sum(1 for p in results if p.get("significant", False))
    overrepresented = sum(
        1 for p in results if p.get("significant", False) and p.get("nes", 0) > 0
    )
    underrepresented = sum(
        1 for p in results if p.get("significant", False) and p.get("nes", 0) < 0
    )

    return {
        "results": results,
        "database": database,
        "total_pathways": len(results),
        "significant_pathways": significant_count,
        "overrepresented": overrepresented,
        "underrepresented": underrepresented,
    }


@router.get("/{session_id}/results")
async def get_results(
    session_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=20000),
    sort_by: str = Query("adj_pvalue"),
    sort_order: str = Query("asc"),
    significant_only: bool = Query(False),
    search: str = Query(""),
    comparison: str = Query(""),
    store: SessionStore = Depends(get_session_store),
):
    """Get differential expression results with pagination and filtering."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    try:
        repository = await asyncio.to_thread(DifferentialRepository, results_dir)
    except ValueError as error:
        raise HTTPException(
            status_code=409,
            detail="Visualization data must be reprocessed for this session",
        ) from error
    try:
        payload = await asyncio.to_thread(
            repository.list_results,
            comparison,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order,
            significant_only=significant_only,
            search=search,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    payload["pipeline"] = session.pipeline
    return create_response(payload)


@router.get("/{session_id}/qc/plots")
async def get_qc_plots(
    session_id: str,
    comparison: str = Query(
        "", description="Comparison label for per-comparison p-value distribution"
    ),
    store: SessionStore = Depends(get_session_store),
):
    """Get QC plot data."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    # Load QC results from file (off-thread to avoid blocking event loop)
    qc_data = await asyncio.to_thread(load_qc_results, results_dir)

    # Filter p-value distribution to requested comparison
    if comparison and qc_data.get("pvalue_distributions"):
        dist = qc_data["pvalue_distributions"].get(comparison)
        if dist:
            qc_data["pvalue_distribution"] = dist

    # MAJ-005: Recalculate total_psms from PSM file if cached value looks wrong
    # The bug showed total rows (~49k) instead of unique PSMs (~4k)
    if qc_data.get("total_psms") and qc_data.get("total_psms") > 20000:
        psm_file = results_dir / "PSM_Abundances.tsv"
        if psm_file.exists():
            try:
                psm_df = await asyncio.to_thread(pd.read_csv, psm_file, sep="\t")
                if "Unique_PSM" in psm_df.columns:
                    correct_total = psm_df["Unique_PSM"].nunique()
                    qc_data["total_psms"] = int(correct_total)
            except Exception as e:
                logger.error(f"Error recalculating total_psms: {e}")

    return create_response(qc_data)


@router.get("/{session_id}/gsea/{database}/plot")
async def get_gsea_plot_data(
    session_id: str,
    database: str,
    term: str = Query(..., description="Pathway term identifier"),
    comparison: str = Query("", description="Comparison name (for multi-condition)"),
    store: SessionStore = Depends(get_session_store),
):
    """Get GSEA plot data (running ES curve + rank metric positions) for a specific pathway."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Get results directory — for multi-condition, look in comparison subdir
    base_results_dir = settings.sessions_dir / session_id / "results"
    results_dir = base_results_dir
    if comparison:
        results_dir = results_dir / "gsea" / comparison

    # Validate database name to prevent path traversal
    if database not in VALID_GSEA_DATABASES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid GSEA database: {database}. Must be one of: {', '.join(sorted(VALID_GSEA_DATABASES))}",
        )

    # Load slim GSEA results to get lead_genes and pathway metadata.
    # When comparison is specified, try comparison-specific path first
    # (on-demand GSEA), then fall back to base results dir (pipeline GSEA).
    gsea_data = await asyncio.to_thread(
        load_gsea_results, results_dir, database, session_id
    )
    if not gsea_data.get("results") and comparison:
        gsea_data = await asyncio.to_thread(
            load_gsea_results, base_results_dir, database, session_id
        )
    results = gsea_data.get("results", [])

    # Find the specific pathway
    pathway = None
    for r in results:
        if r.get("term") == term:
            pathway = r
            break

    if pathway is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pathway '{term}' not found in {database}",
        )

    # Compute running ES curve on-demand from gseapy output files.
    # For pipeline GSEA: results/gsea/<db>/
    # For on-demand GSEA: results/gsea/<comparison>/<db>/ (results_dir already
    # includes gsea/<comparison> from above, so just append database)
    gsea_dir = (
        results_dir / "gsea" / database if not comparison else results_dir / database
    )

    ranked_genes = []
    ranked_metrics = []

    rnk_file = gsea_dir / "gseapy.gene_set.0.rnk"
    if rnk_file.exists():
        try:
            rnk_df = await asyncio.to_thread(
                pd.read_csv, rnk_file, sep="\t", header=None
            )
            ranked_genes = rnk_df.iloc[:, 0].tolist()
            ranked_metrics = rnk_df.iloc[:, 1].tolist()
        except Exception as e:
            logger.warning(f"Could not read .rnk file: {e}")
    else:
        # Try alternate naming: gseapy uses the gene set name in the .rnk filename
        alt_rnk = next((gsea_dir.glob("*.rnk")), None)
        if alt_rnk is not None:
            try:
                rnk_df = await asyncio.to_thread(
                    pd.read_csv, alt_rnk, sep="\t", header=None
                )
                ranked_genes = rnk_df.iloc[:, 0].tolist()
                ranked_metrics = rnk_df.iloc[:, 1].tolist()
            except Exception as e:
                logger.warning(f"Could not read alternate .rnk file: {e}")

    # Fallback: reconstruct ranked list from Diff_Expression*.tsv.
    # Use base_results_dir — DE files live in the session results dir,
    # not under gsea/<comparison>/.
    effective_comparison = comparison
    if not effective_comparison:
        try:
            abundance_repository = await asyncio.to_thread(
                AbundanceRepository, base_results_dir
            )
            effective_comparison = await asyncio.to_thread(
                abundance_repository.first_comparison_id
            )
        except ValueError:
            effective_comparison = ""

    if not ranked_genes:
        try:
            differential_repository = await asyncio.to_thread(
                DifferentialRepository, base_results_dir
            )
            ranking = await asyncio.to_thread(
                differential_repository.get_ranked_genes,
                effective_comparison,
            )
            ranked_genes = [row["gene"] for row in ranking]
            ranked_metrics = [row["metric"] for row in ranking]
        except ValueError as error:
            logger.warning("Could not load canonical GSEA ranking: %s", error)

    if not ranked_genes:
        return create_response(
            {
                "term": term,
                "es": pathway.get("es", 0),
                "nes": pathway.get("nes", 0),
                "running_es_curve": [],
                "rank_metric_positions": [],
            }
        )

    lead_genes = pathway.get("lead_genes", [])
    nes = pathway.get("nes", 0)

    # Check cache first
    cache_key = _cache_key(
        session_id, "gsea_plot", database, term, effective_comparison
    )
    cached = viz_cache.get(cache_key)
    if cached is not None and "pathway_gene_set_size" in cached:
        return create_response(cached)

    # Use full pathway gene set from GMT for curve generation (not just lead_genes)
    pathway_genes = _get_pathway_genes(database, term)
    if not pathway_genes:
        # Fallback to lead_genes if GMT not available
        pathway_genes = set(lead_genes)

    # Use existing method to compute curve
    running_es_curve = gsea_service.generate_running_es_curve(
        ranked_genes, list(pathway_genes), nes, ranked_metrics
    )

    # Compute rank metric positions for ALL pathway genes in the ranked list
    # (not just leading edge — includes post-peak genes too)
    pathway_genes_upper = {g.upper() for g in pathway_genes}
    rank_metric_positions = [
        [gene, i, float(metric)]
        for i, (gene, metric) in enumerate(
            zip(ranked_genes, ranked_metrics, strict=False)
        )
        if gene.upper() in pathway_genes_upper
    ]

    response_data = {
        "term": term,
        "es": pathway.get("es", 0),
        "nes": pathway.get("nes", 0),
        "running_es_curve": running_es_curve,
        "rank_metric_positions": rank_metric_positions,
        "pathway_gene_set_size": len(pathway_genes),
    }

    # Cache the result
    viz_cache.set(cache_key, response_data)

    return create_response(response_data)


@router.get("/{session_id}/gsea/{database}/heatmap")
async def get_gsea_heatmap_data(
    session_id: str,
    database: str,
    term: str = Query(..., description="Pathway term identifier"),
    comparison: str = Query("", description="Comparison name (for multi-condition)"),
    store: SessionStore = Depends(get_session_store),
):
    """Get GSEA heatmap data (z-scores for leading edge genes) for a specific pathway."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Get results directory — for multi-condition, look in comparison subdir
    base_results_dir = settings.sessions_dir / session_id / "results"
    results_dir = base_results_dir
    if comparison:
        results_dir = results_dir / "gsea" / comparison

    # Validate database name to prevent path traversal
    if database not in VALID_GSEA_DATABASES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid GSEA database: {database}. Must be one of: {', '.join(sorted(VALID_GSEA_DATABASES))}",
        )

    # Load slim GSEA results to get lead_genes.
    # When comparison is specified, try comparison-specific path first
    # (on-demand GSEA), then fall back to base results dir (pipeline GSEA).
    gsea_data = await asyncio.to_thread(
        load_gsea_results, results_dir, database, session_id
    )
    if not gsea_data.get("results") and comparison:
        gsea_data = await asyncio.to_thread(
            load_gsea_results, base_results_dir, database, session_id
        )
    results = gsea_data.get("results", [])

    # Find the specific pathway
    pathway = None
    for r in results:
        if r.get("term") == term:
            pathway = r
            break

    if pathway is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pathway '{term}' not found in {database}",
        )

    try:
        abundance_repository = await asyncio.to_thread(
            AbundanceRepository, base_results_dir
        )
        effective_comparison = comparison or await asyncio.to_thread(
            abundance_repository.first_comparison_id
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error

    # Heatmaps from different comparisons have different sample matrices.
    cache_key = _cache_key(
        session_id, "gsea_heatmap", database, term, effective_comparison
    )
    cached = viz_cache.get(cache_key)
    if cached is not None:
        return create_response(cached)

    lead_genes = pathway.get("lead_genes", [])
    if not lead_genes:
        return create_response(
            {
                "genes": [],
                "protein_accessions": [],
                "samples": [],
                "conditions": [],
                "replicates": [],
                "z_scores": [],
                "log2_abundances": [],
            }
        )

    try:
        heatmap_data = await asyncio.to_thread(
            abundance_repository.get_gene_heatmap,
            genes=lead_genes,
            comparison_id=effective_comparison,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error

    # Cache the result
    viz_cache.set(cache_key, heatmap_data)

    return create_response(heatmap_data)


# ---- On-demand GSEA endpoints for multi-condition comparisons ----


class GseaRunRequest(BaseModel):
    """Request body for on-demand GSEA run."""

    comparison: str
    databases: list[str]
    min_size: int = 15
    max_size: int = 500
    permutations: int = 1000


# --- BioNet Models ---


class BioNetRunRequest(BaseModel):
    comparison: str
    pvalue_cutoff: float = 0.05  # NOTE: filters on adj.pvalue (adjusted p-value)
    logfc_cutoff: float = 0.5
    statement_types: list[str] = ["IncreaseAmount", "DecreaseAmount"]
    paper_count_cutoff: int = 1
    evidence_count_cutoff: int = 1
    correlation_cutoff: float | None = None
    sources_filter: list[str] | None = None


# Keep strong references to prevent background task garbage collection.
_background_tasks: set[asyncio.Task] = set()
_on_demand_status_locks: dict[str, threading.Lock] = {}


def _on_demand_status_path(session_id: str, kind: str) -> Path:
    return settings.sessions_dir / session_id / f"{kind}_run_status.json"


async def _write_on_demand_status(session_id: str, kind: str, data: dict) -> None:
    """Write status file for on-demand analysis tasks (gsea, bionet).

    Uses a per-kind threading.Lock inside asyncio.to_thread so the lock
    acquisition happens in the executor thread, not across an await boundary.
    This correctly serializes writes from both the outer event loop and the
    inner event loop (created by asyncio.run() inside thread-pool work).
    """
    if kind not in _on_demand_status_locks:
        _on_demand_status_locks[kind] = threading.Lock()
    status_file = _on_demand_status_path(session_id, kind)
    status_file.parent.mkdir(parents=True, exist_ok=True)
    lock = _on_demand_status_locks[kind]
    payload = json.dumps(data, indent=2, default=str)

    def _write() -> None:
        with lock:
            status_file.write_text(payload, encoding="utf-8")

    await asyncio.to_thread(_write)


async def _read_on_demand_task_status(session_id: str) -> list[dict[str, Any]]:
    """Read on-disk status files for GSEA, BIONET, and compare tasks.

    Returns synthetic task entries for any on-demand task whose status file
    shows it is running (or queued).  This bridges the gap between when an
    on-demand route writes its status file and when the background coroutine
    calls task_manager.submit() — and also keeps the task visible after it
    completes and is removed from TaskManager._active_tasks.
    """
    tasks: list[dict[str, Any]] = []
    sessions_dir = settings.sessions_dir
    session_dir = sessions_dir / session_id

    # ── GSEA ──
    gsea_file = session_dir / "gsea_run_status.json"
    if gsea_file.exists():
        try:
            data = await read_json_file(gsea_file)
        except Exception:
            data = None
        if (
            data
            and isinstance(data, dict)
            and data.get("status") in ("running", "queued")
        ):
            tasks.append(
                {
                    "kind": "gsea",
                    "label": f"GSEA: {data.get('comparison', 'unknown')}",
                    "status": data["status"],
                    "started_at": data.get("started_at"),
                    "completed_at": data.get("completed_at"),
                    "error": data.get("error"),
                    "progress": data.get("progress"),
                    "queue_position": data.get("queue_position"),
                }
            )

    # ── BIONET ──
    bionet_file = session_dir / "bionet_run_status.json"
    if bionet_file.exists():
        try:
            data = await read_json_file(bionet_file)
        except Exception:
            data = None
        if (
            data
            and isinstance(data, dict)
            and data.get("status") in ("running", "queued")
        ):
            tasks.append(
                {
                    "kind": "bionet",
                    "label": f"BioNet: {data.get('comparison', 'unknown')}",
                    "status": data["status"],
                    "started_at": data.get("started_at"),
                    "completed_at": data.get("completed_at"),
                    "error": data.get("error"),
                    "progress": data.get("progress"),
                    "queue_position": data.get("queue_position"),
                }
            )

    # ── Compare (protein-correlation, comparison-correlation) ──
    compare_dir = session_dir / "results" / "compare"
    _compare_kinds = [
        ("protein-correlation", "Protein Correlation"),
        ("comparison-correlation", "Comparison Correlation"),
    ]
    for compute_type, label_prefix in _compare_kinds:
        status_file = compare_dir / f"{compute_type}_status.json"
        if not status_file.exists():
            continue
        try:
            data = await read_json_file(status_file)
        except Exception:
            continue
        if (
            data
            and isinstance(data, dict)
            and data.get("status") in ("running", "queued")
        ):
            tasks.append(
                {
                    "kind": "compute",
                    "label": label_prefix,
                    "status": data["status"],
                    "started_at": data.get("started_at"),
                    "completed_at": data.get("completed_at"),
                    "error": data.get("error"),
                    "progress": data.get("progress"),
                    "queue_position": data.get("queue_position"),
                }
            )

    return tasks


# --- BioNet helpers ---

_BIONET_OUTPUT_DIR_NAME = "bionet"


def _bionet_output_dir(session_id: str) -> Path:
    return settings.sessions_dir / session_id / _BIONET_OUTPUT_DIR_NAME


def _bionet_subnetwork_path(session_id: str) -> Path:
    return _bionet_output_dir(session_id) / "bionet_subnetwork.json"


def _write_json_file(path: Path, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)


@router.get("/{session_id}/gsea/status")
async def get_gsea_run_status(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    status_file = _on_demand_status_path(session_id, "gsea")

    # File is authoritative for terminal states (survives task removal from _active_tasks).
    if status_file.exists():
        try:
            data = await read_json_file(status_file)
        except Exception:
            data = None

        if data and data.get("status") in ("completed", "error"):
            return create_response(data)

        # File says "running" — verify TaskManager still has it.
        if data and data.get("status") == "running":
            tm_active = task_manager.has_active_task(session_id, TaskKind.GSEA)
            if tm_active:
                tm_tasks = [
                    t
                    for t in task_manager._active_tasks.values()
                    if t.session_id == session_id and t.kind == TaskKind.GSEA
                ]
                if tm_tasks:
                    data["queue_position"] = tm_tasks[0].queue_position
                return create_response(data)
            # Server restarted mid-run — mark as error
            data["status"] = "error"
            data["error"] = "server_restarted"
            await _write_on_demand_status(session_id, "gsea", data)
            return create_response(data)

    # No file → check TaskManager for queued/running
    tasks = [
        info
        for info in task_manager._active_tasks.values()
        if info.session_id == session_id and info.kind == TaskKind.GSEA
    ]
    if tasks:
        t = tasks[0]
        return create_response(
            {
                "status": t.status,
                "started_at": t.started_at,
                "error": t.error,
                "comparison": t.label.replace("GSEA: ", ""),
                "databases": {},
                "queue_position": t.queue_position,
            }
        )

    return create_response({"status": "idle"})


@router.get("/{session_id}/tasks")
async def get_session_tasks(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Return all task states for a session.

    Merges in-memory TaskManager state with on-disk status files so the
    TaskStatusBar sees on-demand tasks (GSEA, BIONET, compare) immediately
    after they are triggered — before the background coroutine calls
    task_manager.submit() — and after they complete and are removed from
    the in-memory _active_tasks dict.
    """
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    result = task_manager.get_status(session_id)

    # Augment with on-disk status for on-demand tasks that may not be in
    # _active_tasks yet (gap between trigger and submit()) or anymore
    # (completed tasks removed from _active_tasks by the finally block).
    disk_tasks = await _read_on_demand_task_status(session_id)
    tm_kinds = {t["kind"] for t in result["tasks"]}
    for dt in disk_tasks:
        if dt["kind"] not in tm_kinds:
            result["tasks"].append(dt)

    return create_response(result)


@router.post("/{session_id}/tasks/cancel")
async def cancel_session_tasks(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Cancel all running and queued tasks for a session."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    cancelled = task_manager.cancel(session_id)
    return create_response({"cancelled": cancelled, "status": "cancelled"})


async def _background_gsea_run(
    session_id: str,
    request: GseaRunRequest,
    results_dir: Path,
    de_file: Path,
    protein_file: Path | None,
    gsea_output_dir: Path,
) -> None:
    """Background GSEA run dispatched through TaskManager."""

    comparison = request.comparison
    gsea_output_dir.mkdir(parents=True, exist_ok=True)

    status_data = {
        "status": "running",
        "comparison": comparison,
        "databases": {
            db: "running" for db in request.databases if db in VALID_GSEA_DATABASES
        },
        "started_at": datetime.now(UTC).isoformat(),
        "error": None,
    }
    await _write_on_demand_status(session_id, "gsea", status_data)

    async def on_db_done(db_name: str, success: bool) -> None:
        if db_name in status_data["databases"]:
            status_data["databases"][db_name] = "completed" if success else "error"
        await _write_on_demand_status(session_id, "gsea", status_data)

    # Run the async gseapy work in a dedicated thread via TaskManager.
    # gseapy's prerank releases the GIL (compiled .pyd), so threads work well.
    def _run_gsea_sync():
        return asyncio.run(
            gsea_service.run_gsea_for_comparison(
                diff_expression_path=de_file,
                comparison_name=comparison,
                output_dir=gsea_output_dir,
                databases=request.databases,
                protein_abundance_path=protein_file,
                min_size=request.min_size,
                max_size=request.max_size,
                permutations=request.permutations,
                on_db_complete=on_db_done,
            )
        )

    label = f"GSEA: {comparison}"

    try:
        gsea_results = await task_manager.submit(
            session_id,
            TaskKind.GSEA,
            _run_gsea_sync,
            label=label,
            timeout_seconds=30 * 60,
        )

        results_file = gsea_output_dir / "GSEA_Results.json"
        await asyncio.to_thread(gsea_service.save_results, gsea_results, results_file)
        with _cache_lock:
            _gsea_file_cache.remove(str(results_file))

        status_data["status"] = "completed"
        status_data["completed_at"] = datetime.now(UTC).isoformat()
        await _write_on_demand_status(session_id, "gsea", status_data)

    except TaskCancelledError:
        logger.info(f"GSEA cancelled for {session_id}/{comparison}")
        status_data["status"] = "error"
        status_data["error"] = "Task cancelled"
        await _write_on_demand_status(session_id, "gsea", status_data)
    except TaskTimeoutError:
        logger.error(f"GSEA timed out for {session_id}/{comparison}")
        status_data["status"] = "error"
        status_data["error"] = "Task timed out after 30 minutes"
        await _write_on_demand_status(session_id, "gsea", status_data)
    except Exception as e:
        logger.error(f"Background GSEA failed: {e}")
        status_data["status"] = "error"
        status_data["error"] = str(e)
        await _write_on_demand_status(session_id, "gsea", status_data)
    finally:
        de_file.unlink(missing_ok=True)


@router.post("/{session_id}/gsea/run")
async def run_gsea_on_demand(
    session_id: str,
    request: GseaRunRequest,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Check if GSEA is already running for this session
    gsea_running = task_manager.has_active_task(session_id, TaskKind.GSEA)
    if gsea_running:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A GSEA run is already in progress for this session",
        )

    results_dir = settings.sessions_dir / session_id / "results"
    gsea_output_dir = results_dir / "gsea" / request.comparison
    try:
        differential_repository = await asyncio.to_thread(
            DifferentialRepository, results_dir
        )
        de_file = await asyncio.to_thread(
            differential_repository.export_comparison_tsv,
            request.comparison,
            gsea_output_dir / ".differential_input.tsv",
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error

    # Write initial "running" status before spawning background task so the
    # frontend sees it immediately on first poll (avoids a 2-second dead gap).
    await _write_on_demand_status(
        session_id,
        "gsea",
        {
            "status": "running",
            "comparison": request.comparison,
            "databases": {
                db: "running" for db in request.databases if db in VALID_GSEA_DATABASES
            },
            "started_at": datetime.now(UTC).isoformat(),
            "error": None,
        },
    )

    task = asyncio.create_task(
        _background_gsea_run(
            session_id=session_id,
            request=request,
            results_dir=results_dir,
            de_file=de_file,
            protein_file=None,
            gsea_output_dir=gsea_output_dir,
        )
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return create_response(
        {
            "status": "started",
            "comparison": request.comparison,
            "databases": request.databases,
        }
    )


@router.get("/{session_id}/gsea/{database}")
async def get_gsea_results(
    session_id: str,
    database: str,
    comparison: str = Query("", description="Comparison label for multi-condition"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    sort_by: str = Query("nes"),
    sort_order: str = Query("desc"),
    significant_only: bool = Query(False),
    search: str = Query(""),
    store: SessionStore = Depends(get_session_store),
):
    """Get GSEA results for a database with pagination and filtering."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Get results directory
    base_results_dir = settings.sessions_dir / session_id / "results"
    results_dir = base_results_dir

    # Route to per-comparison directory when comparison is specified
    if comparison:
        results_dir = results_dir / "gsea" / comparison

    # Validate database name to prevent path traversal
    if database not in VALID_GSEA_DATABASES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid GSEA database: {database}. Must be one of: {', '.join(sorted(VALID_GSEA_DATABASES))}",
        )

    # Load GSEA results (cached in memory after first load).
    # When comparison is specified, try comparison-specific path first
    # (on-demand GSEA), then fall back to base results dir (pipeline GSEA).
    gsea_data = await asyncio.to_thread(
        load_gsea_results, results_dir, database, session_id
    )
    if not gsea_data.get("results") and comparison:
        gsea_data = await asyncio.to_thread(
            load_gsea_results, base_results_dir, database, session_id
        )

    results = gsea_data.pop("results")

    # Apply filters
    if significant_only:
        results = [r for r in results if r.get("significant", False)]

    if search:
        search_lower = search.lower()
        results = [
            r
            for r in results
            if search_lower in r.get("name", "").lower()
            or search_lower in r.get("term", "").lower()
        ]

    # Sort results
    reverse = sort_order.lower() == "desc"
    sort_key = sort_by if sort_by in ("nes", "pval", "fdr", "matched_genes") else "nes"
    results.sort(key=lambda x: x.get(sort_key, 0), reverse=reverse)

    # Paginate
    total = len(results)
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    paginated_results = results[start_idx:end_idx]

    gsea_data["results"] = paginated_results
    gsea_data["page"] = page
    gsea_data["page_size"] = page_size
    gsea_data["total"] = total

    return create_response(gsea_data)


async def _background_bionet_run(
    session_id: str,
    request: BioNetRunRequest,
    results_dir: Path,
    de_file: Path,
) -> None:
    """Background BioNet run dispatched through TaskManager."""

    import pandas as pd

    from app.services.bionet_service import bionet_service

    comparison = request.comparison
    bionet_output_dir = _bionet_output_dir(session_id)
    bionet_output_dir.mkdir(parents=True, exist_ok=True)
    nodes_csv = bionet_output_dir / "nodes.csv"
    edges_csv = bionet_output_dir / "edges.csv"

    status_data = {
        "status": "running",
        "comparison": comparison,
        "started_at": datetime.now(UTC).isoformat(),
        "error": None,
    }
    await _write_on_demand_status(session_id, "bionet", status_data)

    def _run_bionet_sync():
        config_dict = request.model_dump()
        return bionet_service.run_bionet(
            de_file=de_file,
            config=config_dict,
            nodes_csv=nodes_csv,
            edges_csv=edges_csv,
        )

    label = f"BioNet: {comparison}"

    try:
        _node_count, _edge_count = await task_manager.submit(
            session_id,
            TaskKind.BIONET,
            _run_bionet_sync,
            label=label,
            timeout_seconds=30 * 60,
        )

        nodes_df = await asyncio.to_thread(pd.read_csv, nodes_csv)
        edges_df = await asyncio.to_thread(pd.read_csv, edges_csv)
        subnetwork = {
            "nodes": nodes_df.to_dict(orient="records"),
            "edges": edges_df.to_dict(orient="records"),
        }
        subnetwork_path = _bionet_subnetwork_path(session_id)
        await asyncio.to_thread(_write_json_file, subnetwork_path, subnetwork)

        status_data["status"] = "completed"
        status_data["completed_at"] = datetime.now(UTC).isoformat()
        await _write_on_demand_status(session_id, "bionet", status_data)

    except TaskCancelledError:
        logger.info(f"BioNet cancelled for {session_id}/{comparison}")
        status_data["status"] = "error"
        status_data["error"] = "Task cancelled"
        await _write_on_demand_status(session_id, "bionet", status_data)
    except TaskTimeoutError:
        logger.error(f"BioNet timed out for {session_id}/{comparison}")
        status_data["status"] = "error"
        status_data["error"] = "Task timed out after 30 minutes"
        await _write_on_demand_status(session_id, "bionet", status_data)
    except Exception as e:
        logger.error(f"Background BioNet failed: {e}")
        status_data["status"] = "error"
        status_data["error"] = str(e)
        await _write_on_demand_status(session_id, "bionet", status_data)
    finally:
        de_file.unlink(missing_ok=True)


@router.post("/{session_id}/bionet/run")
async def run_bionet_on_demand(
    session_id: str,
    request: BioNetRunRequest,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Check if BioNet already running for this session
    bionet_active = task_manager.has_active_task(session_id, TaskKind.BIONET)
    if bionet_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A BioNet run is already in progress for this session",
        )

    results_dir = settings.sessions_dir / session_id / "results"
    try:
        differential_repository = await asyncio.to_thread(
            DifferentialRepository, results_dir
        )
        de_file = await asyncio.to_thread(
            differential_repository.export_comparison_tsv,
            request.comparison,
            _bionet_output_dir(session_id) / ".differential_input.tsv",
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error

    # Write initial "running" status before spawning background task so the
    # frontend sees it immediately on first poll (avoids a 2-second dead gap).
    await _write_on_demand_status(
        session_id,
        "bionet",
        {
            "status": "running",
            "comparison": request.comparison,
            "started_at": datetime.now(UTC).isoformat(),
            "error": None,
        },
    )

    task = asyncio.create_task(
        _background_bionet_run(
            session_id=session_id,
            request=request,
            results_dir=results_dir,
            de_file=de_file,
        )
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return create_response({"status": "started", "comparison": request.comparison})


@router.get("/{session_id}/bionet/status")
async def get_bionet_run_status(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    status_file = _on_demand_status_path(session_id, "bionet")

    # File is authoritative for terminal states.
    if status_file.exists():
        try:
            data = await read_json_file(status_file)
        except Exception:
            data = None

        if data and data.get("status") in ("completed", "error"):
            return create_response(data)

        if data and data.get("status") == "running":
            tm_active = task_manager.has_active_task(session_id, TaskKind.BIONET)
            if tm_active:
                tm_tasks = [
                    t
                    for t in task_manager._active_tasks.values()
                    if t.session_id == session_id and t.kind == TaskKind.BIONET
                ]
                if tm_tasks:
                    data["queue_position"] = tm_tasks[0].queue_position
                return create_response(data)
            data["status"] = "error"
            data["error"] = "server_restarted"
            await _write_on_demand_status(session_id, "bionet", data)
            return create_response(data)

    # No file → check TaskManager
    tasks = [
        info
        for info in task_manager._active_tasks.values()
        if info.session_id == session_id and info.kind == TaskKind.BIONET
    ]
    if tasks:
        t = tasks[0]
        return create_response(
            {
                "status": t.status,
                "started_at": t.started_at,
                "completed_at": t.completed_at,
                "error": t.error,
                "comparison": t.label.replace("BioNet: ", ""),
                "queue_position": t.queue_position,
            }
        )

    return create_response({"status": "idle"})


@router.get("/{session_id}/bionet/subnetwork")
async def get_bionet_subnetwork(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    subnetwork_path = _bionet_subnetwork_path(session_id)
    if not subnetwork_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No BioNet subnetwork computed yet. Run the analysis first.",
        )

    subnetwork = await read_json_file(subnetwork_path)

    return create_response(subnetwork)
