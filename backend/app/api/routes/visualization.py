"""
Visualization API routes.

Plot data endpoints for results, QC, and GSEA.
"""

import asyncio
import json
import logging
import math
import re
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.api.deps import get_session_store
from app.core.config import settings
from app.db.session_store import SessionStore
from app.services.gsea_service import gsea_service
from app.services.task_manager import (
    TaskCancelledError,
    TaskKind,
    TaskTimeoutError,
    task_manager,
)

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


# In-memory LRU cache for visualization results
# Cache is keyed by session_id and file path, max 50 entries per type
# Results are cached per session since files are immutable once written
def _cache_key(session_id: str, *args) -> str:
    """Generate a cache key from session_id and additional args."""
    return f"{session_id}:{':'.join(str(a) for a in args)}"


def create_response(data: Any) -> dict[str, Any]:
    """Create standardized API response wrapper.

    Args:
        data: Response data

    Returns:
        Wrapped response with metadata
    """
    return {
        "data": data,
        "meta": {
            "timestamp": datetime.now(UTC).isoformat(),
            "request_id": str(uuid.uuid4()),
        },
    }


class FileCache:
    """Simple TTL-based file result cache for visualization endpoints."""

    def __init__(self, max_size: int = 50):
        self._max_size = max_size
        self._cache: dict[str, tuple] = {}  # key -> (timestamp, result)

    def get(self, key: str) -> Any:
        if key in self._cache:
            return self._cache[key][1]
        return None

    def set(self, key: str, value: Any) -> None:
        # Evict oldest entries if at capacity
        if len(self._cache) >= self._max_size:
            oldest_key = min(self._cache, key=lambda k: self._cache[k][0])
            del self._cache[oldest_key]
        self._cache[key] = (datetime.now(UTC), value)

    def invalidate(self, session_id: str) -> None:
        """Remove all cached entries for a session."""
        prefix = f"{session_id}:"
        self._cache = {k: v for k, v in self._cache.items() if not k.startswith(prefix)}

    def remove(self, key: str) -> None:
        """Remove a single cache entry by exact key."""
        self._cache.pop(key, None)

    def clear(self) -> None:
        self._cache.clear()


def _resolve_de_file(results_dir: Path) -> Path | None:
    """Resolve the differential expression results file.

    Checks for the default name first, then falls back to the first
    per-comparison file (used by multi-condition pipelines).
    """
    default = results_dir / "Diff_Expression.tsv"
    if default.exists():
        return default
    candidates = sorted(results_dir.glob("Diff_Expression_*.tsv"))
    return candidates[0] if candidates else None


def _build_sample_filter(session, comparison: str) -> list[str] | None:
    """Build a list of condition name prefixes to filter sample columns by.

    Parses the comparison name against session.config.comparisons to extract
    the condition names that define which samples belong to this comparison.

    Args:
        session: Session object with config.comparisons
        comparison: Comparison name (e.g. 'INCB224525_24h_vs_DMSO_24h')

    Returns:
        List of condition name prefixes, or None if no comparison specified
    """
    if not comparison:
        return None
    comparisons = session.config.comparisons if session.config else []
    for comp in comparisons:
        g1 = comp.get("group1", {})
        g2 = comp.get("group2", {})
        g1_str = "+".join(g1.values())
        g2_str = "+".join(g2.values())
        if f"{g1_str}_vs_{g2_str}" == comparison:
            return list(g1.values()) + list(g2.values())
    return None


# Global cache instance
viz_cache = FileCache(max_size=50)


async def load_diff_expression_results(
    results_dir: Path,
    session_id: str = "",
    comparison: str = "",
) -> list[dict[str, Any]]:
    """Load differential expression results from TSV file.

    Args:
        results_dir: Path to session results directory
        session_id: Session ID for cache keying
        comparison: Optional comparison name (e.g., 'A_vs_B').
                   If empty, loads default Diff_Expression.tsv.

    Returns:
        List of protein results dictionaries
    """
    cache_key = _cache_key(
        session_id, f"diff_expression_{comparison}" if comparison else "diff_expression"
    )
    cached = viz_cache.get(cache_key)
    if cached is not None:
        return cached

    if comparison:
        diff_file = results_dir / f"Diff_Expression_{comparison}.tsv"
        if not diff_file.exists():
            return []
    else:
        diff_file = _resolve_de_file(results_dir)
        if diff_file is None:
            return []

    try:
        df = await asyncio.to_thread(pd.read_csv, diff_file, sep="\t")

        # Convert to list of dictionaries
        # Field names must match frontend DEResult interface
        results = []
        any_psm_nonzero = False
        for _, row in df.iterrows():
            # Handle NaN values - convert to None for JSON serialization
            log_fc = row.get("logFC", 0)
            pval = row.get("pval", 1)
            adj_pval = row.get("adjPval", 1)
            psm_count = row.get("PSM_Count", row.get("psm_count", 0))

            # Convert NaN/Inf to None for JSON — include rows even with NA values
            # so the UI shows the full protein count (frontend displays "N/A" for None)
            if pd.isna(log_fc) or (isinstance(log_fc, float) and math.isinf(log_fc)):
                log_fc = None
            if pd.isna(pval) or (isinstance(pval, float) and math.isinf(pval)):
                pval = None
            if pd.isna(adj_pval) or (
                isinstance(adj_pval, float) and math.isinf(adj_pval)
            ):
                adj_pval = None
            if pd.isna(psm_count):
                psm_count = 0
            elif int(psm_count) > 0:
                any_psm_nonzero = True

            se = row.get("se", None)
            if pd.isna(se) if se is not None else True:
                se = None

            t_stat = row.get("t", None)
            if pd.isna(t_stat) if t_stat is not None else True:
                t_stat = None

            result = {
                "master_protein_accessions": str(
                    row.get("Master_Protein_Accessions", "")
                ),
                "gene_name": str(row.get("Gene_Name", "")),
                "log_fc": float(log_fc) if log_fc is not None else 0,
                "pval": float(pval) if pval is not None else 1,
                "adj_pval": float(adj_pval) if adj_pval is not None else 1,
                "se": float(se) if se is not None else None,
                "t_statistic": float(t_stat) if t_stat is not None else None,
                "significant": bool((adj_pval if adj_pval is not None else 1) < 0.05),
                "psm_count": int(psm_count) if psm_count is not None else 0,
            }
            results.append(result)

        # Fallback: if all PSM_Count values are 0 (MSstats pipeline doesn't populate them),
        # count unique PSMs per protein from the PSM abundance file
        if results and not any_psm_nonzero:
            psm_parquet = results_dir / "PSM_Abundances.parquet"
            psm_tsv = results_dir / "PSM_Abundances.tsv"
            try:
                if psm_parquet.exists():
                    psm_df = await asyncio.to_thread(
                        pd.read_parquet,
                        psm_parquet,
                        columns=["Master_Protein_Accessions", "Unique_PSM"],
                    )
                elif psm_tsv.exists():
                    psm_df = await asyncio.to_thread(
                        pd.read_csv,
                        psm_tsv,
                        sep="\t",
                        usecols=["Master_Protein_Accessions", "Unique_PSM"],
                    )
                else:
                    psm_df = None

                if psm_df is not None:
                    psm_counts = psm_df.groupby("Master_Protein_Accessions")[
                        "Unique_PSM"
                    ].nunique()
                    for r in results:
                        acc = r["master_protein_accessions"]
                        if acc in psm_counts.index:
                            r["psm_count"] = int(psm_counts[acc])
            except Exception as e:
                logger.warning(f"Could not compute PSM counts from PSM file: {e}")

        viz_cache.set(cache_key, results)
        return results
    except Exception as e:
        # Log error but return empty list
        logger.error(f"Error loading diff expression results: {e}")
        return []


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

    # Load results from file (supports per-comparison files)
    all_results = await load_diff_expression_results(
        results_dir, session_id, comparison
    )

    # Apply filters
    if significant_only:
        all_results = [r for r in all_results if r["significant"]]

    if search:
        search_lower = search.lower()
        all_results = [
            r
            for r in all_results
            if search_lower in r.get("master_protein_accessions", "").lower()
            or search_lower in r.get("gene_name", "").lower()
        ]

    # Sort results
    reverse = sort_order.lower() == "desc"
    all_results.sort(key=lambda x: x.get(sort_by, 0) or 0, reverse=reverse)

    # Calculate summary statistics
    total_proteins = len(all_results)
    significant_proteins = sum(1 for r in all_results if r.get("significant", False))
    upregulated = sum(
        1 for r in all_results if r.get("significant", False) and r.get("log_fc", 0) > 0
    )
    downregulated = sum(
        1 for r in all_results if r.get("significant", False) and r.get("log_fc", 0) < 0
    )

    # Paginate
    total = len(all_results)
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    paginated_results = all_results[start_idx:end_idx]

    return create_response(
        {
            "results": paginated_results,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size,
            "total_proteins": total_proteins,
            "significant_proteins": significant_proteins,
            "upregulated": upregulated,
            "downregulated": downregulated,
            "pipeline": session.pipeline,
        }
    )


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
    if not ranked_genes:
        de_file = _resolve_de_file(base_results_dir)
        if de_file and de_file.exists():
            try:
                de_df = await asyncio.to_thread(pd.read_csv, de_file, sep="\t")
                gene_col = next(
                    (
                        c
                        for c in de_df.columns
                        if "gene" in c.lower() or "symbol" in c.lower()
                    ),
                    None,
                )
                pval_col = next(
                    (
                        c
                        for c in de_df.columns
                        if "pval" in c.lower() and "adj" not in c.lower()
                    ),
                    None,
                )
                logfc_col = next(
                    (
                        c
                        for c in de_df.columns
                        if "logfc" in c.lower() or "log2fc" in c.lower()
                    ),
                    None,
                )
                if gene_col and pval_col and logfc_col:
                    valid = de_df[(de_df[pval_col] > 0) & (de_df[pval_col] <= 1)].copy()
                    valid["metric"] = -np.log10(valid[pval_col]) * np.sign(
                        valid[logfc_col]
                    )
                    valid = valid.sort_values("metric", ascending=False)
                    valid["gene"] = (
                        valid[gene_col]
                        .str.split(";")
                        .str[0]
                        .str.strip()
                        .str.replace(r"-\d+$", "", regex=True)
                    )
                    ranked_genes = valid["gene"].tolist()
                    ranked_metrics = valid["metric"].tolist()
            except Exception as e:
                logger.warning(
                    f"Could not reconstruct ranked list from DE results: {e}"
                )

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
    cache_key = _cache_key(session_id, "gsea_plot", database, term)
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

    # Check cache first
    cache_key = _cache_key(session_id, "gsea_heatmap", database, term)
    cached = viz_cache.get(cache_key)
    if cached is not None:
        return create_response(cached)

    lead_genes = pathway.get("lead_genes", [])
    if not lead_genes:
        return create_response({"genes": [], "samples": [], "z_scores": []})

    # Build ranked gene list to order heatmap genes by rank position.
    # DE files live in the session results dir, not under gsea/<comparison>/.
    de_file = _resolve_de_file(base_results_dir)
    gene_rank_map: dict[str, int] = {}
    if de_file and de_file.exists():
        try:
            de_df = await asyncio.to_thread(pd.read_csv, de_file, sep="\t")
            gene_col = next(
                (
                    c
                    for c in de_df.columns
                    if "gene" in c.lower() or "symbol" in c.lower()
                ),
                None,
            )
            pval_col = next(
                (
                    c
                    for c in de_df.columns
                    if "pval" in c.lower() and "adj" not in c.lower()
                ),
                None,
            )
            logfc_col = next(
                (
                    c
                    for c in de_df.columns
                    if "logfc" in c.lower() or "log2fc" in c.lower()
                ),
                None,
            )
            if gene_col and pval_col and logfc_col:
                valid = de_df[(de_df[pval_col] > 0) & (de_df[pval_col] <= 1)].copy()
                valid["metric"] = -np.log10(valid[pval_col]) * np.sign(valid[logfc_col])
                valid = valid.sort_values("metric", ascending=False)
                valid["gene"] = (
                    valid[gene_col]
                    .str.split(";")
                    .str[0]
                    .str.strip()
                    .str.replace(r"-\d+$", "", regex=True)
                )
                for rank, gene in enumerate(valid["gene"].tolist()):
                    gene_rank_map[gene.upper()] = rank
        except Exception as e:
            logger.debug(f"Could not build gene rank map: {e}")

    # Load protein abundance data from session results dir (not comparison subdir)
    protein_file = base_results_dir / "Protein_Abundances.tsv"
    if not protein_file.exists():
        return create_response({"genes": [], "samples": [], "z_scores": []})

    try:
        protein_df = await asyncio.to_thread(pd.read_csv, protein_file, sep="\t")
    except Exception as e:
        logger.warning(f"Could not load protein abundance for heatmap: {e}")
        return create_response({"genes": [], "samples": [], "z_scores": []})

    # Filter to only comparison-relevant sample columns
    sample_filter = _build_sample_filter(session, comparison)
    if sample_filter and not protein_df.empty:
        _metadata_cols = {
            "Master_Protein_Accessions",
            "Master Protein Accessions",
            "Gene_Name",
            "Gene",
            "Protein",
            "PSM_Count",
            "psm_count",
        }
        keep_cols = [
            c
            for c in protein_df.columns
            if c in _metadata_cols
            or any(c.startswith(prefix) for prefix in sample_filter)
        ]
        protein_df = protein_df[keep_cols]

    # Use existing method to generate heatmap data (PSM_Count already excluded)
    heatmap_data = gsea_service.generate_heatmap_data(protein_df, lead_genes)

    if heatmap_data is None:
        return create_response({"genes": [], "samples": [], "z_scores": []})

    # Reorder genes and z_scores by rank position if rank info is available
    if gene_rank_map and heatmap_data.get("genes"):
        genes_with_rank = []
        z_scores_by_gene = dict(
            zip(heatmap_data["genes"], heatmap_data["z_scores"], strict=False)
        )
        for gene in heatmap_data["genes"]:
            genes_with_rank.append(
                (
                    gene,
                    gene_rank_map.get(
                        gene.upper(), gene_rank_map.get(gene, float("inf"))
                    ),
                )
            )
        genes_with_rank.sort(key=lambda x: x[1])
        heatmap_data["genes"] = [g for g, _ in genes_with_rank]
        heatmap_data["z_scores"] = [z_scores_by_gene[g] for g in heatmap_data["genes"]]

    if heatmap_data is None:
        return create_response({"genes": [], "samples": [], "z_scores": []})

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


# Strong references to prevent background task GC
_background_tasks: set[asyncio.Task] = set()

# Per-kind locks for status file writes (prevents interleaving from concurrent on_db_done callbacks)
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
            data = await asyncio.to_thread(
                lambda: json.loads(gsea_file.read_text(encoding="utf-8"))
            )
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
            data = await asyncio.to_thread(
                lambda: json.loads(bionet_file.read_text(encoding="utf-8"))
            )
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
            data = await asyncio.to_thread(
                lambda f=status_file: json.loads(f.read_text(encoding="utf-8"))
            )
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
            data = await asyncio.to_thread(
                lambda: json.loads(status_file.read_text(encoding="utf-8"))
            )
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
    protein_file: Path,
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
                protein_abundance_path=protein_file if protein_file.exists() else None,
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

    results_dir = settings.sessions_dir / session_id / "results"
    de_file = results_dir / f"Diff_Expression_{request.comparison}.tsv"
    if not de_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Differential expression file not found: {de_file.name}",
        )

    # Check if GSEA is already running for this session
    gsea_running = task_manager.has_active_task(session_id, TaskKind.GSEA)
    if gsea_running:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A GSEA run is already in progress for this session",
        )

    protein_file = results_dir / "Protein_Abundances.tsv"
    gsea_output_dir = results_dir / "gsea" / request.comparison

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
            protein_file=protein_file,
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

    results_dir = settings.sessions_dir / session_id / "results"
    de_file = results_dir / f"Diff_Expression_{request.comparison}.tsv"
    if not de_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Differential expression file not found: {de_file.name}",
        )

    # Check if BioNet already running for this session
    bionet_active = task_manager.has_active_task(session_id, TaskKind.BIONET)
    if bionet_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A BioNet run is already in progress for this session",
        )

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
            data = await asyncio.to_thread(
                lambda: json.loads(status_file.read_text(encoding="utf-8"))
            )
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

    with open(subnetwork_path, encoding="utf-8") as f:
        subnetwork = json.load(f)

    return create_response(subnetwork)


async def load_protein_abundance(
    results_dir: Path,
    protein_id: str,
    session_id: str = "",
    control: str = "",
    treatment: str = "",
    sample_filter: list[str] | None = None,
) -> dict[str, Any]:
    """Load protein abundance data from TSV file.

    Args:
        results_dir: Path to session results directory
        protein_id: Protein accession ID
        session_id: Session ID for cache keying
        control: Control condition name for label matching
        treatment: Treatment condition name for label matching
        sample_filter: Optional list of condition name prefixes to filter samples by.
                       Only sample columns starting with any of these prefixes are included.

    Returns:
        Protein abundance data dictionary matching frontend ProteinAbundance interface
    """
    filter_tag = ",".join(sorted(sample_filter)) if sample_filter else ""
    cache_key = _cache_key(session_id, "protein_v2", protein_id, filter_tag)
    cached = viz_cache.get(cache_key)
    if cached is not None:
        return cached

    abundance_file = results_dir / "Protein_Abundances.tsv"

    if not abundance_file.exists():
        return {"samples": [], "abundances": [], "conditions": []}

    try:
        df = await asyncio.to_thread(pd.read_csv, abundance_file, sep="\t")

        # Find the protein row (handle multiple accessions separated by ;)
        protein_row = df[
            df["Master_Protein_Accessions"].str.contains(
                re.escape(protein_id), regex=True, na=False
            )
        ]

        if protein_row.empty:
            return {"samples": [], "abundances": [], "conditions": []}

        # Get abundance columns (all columns except metadata)
        metadata_cols = [
            "Master_Protein_Accessions",
            "Gene_Name",
            "PSM_Count",
            "psm_count",
            "Protein",
        ]
        abundance_cols = [col for col in df.columns if col not in metadata_cols]

        # Filter to comparison-relevant samples when sample_filter is provided
        if sample_filter:
            abundance_cols = [
                col
                for col in abundance_cols
                if any(col.startswith(prefix) for prefix in sample_filter)
            ]

        # Build arrays for frontend format - include ALL samples, even with NA/0 values
        samples = []
        abundances = []
        conditions = []

        for col in abundance_cols:
            samples.append(col)
            value = protein_row.iloc[0].get(col)
            # Convert NA to 0, otherwise reverse log2 transform
            if pd.isna(value):
                abundances.append(0.0)
            else:
                abundances.append(2.0 ** float(value))
            # Infer condition from sample name using session config
            condition = "Unknown"
            if control and control.lower() in col.lower():
                condition = "Control"
            elif treatment and treatment.lower() in col.lower():
                condition = "Treatment"
            elif "DMSO" in col.upper() or "VEHICLE" in col.upper():
                condition = "Control"
            conditions.append(condition)

        result = {
            "samples": samples,
            "abundances": abundances,
            "conditions": conditions,
        }
        viz_cache.set(cache_key, result)
        return result
    except Exception as e:
        logger.error(f"Error loading protein abundance: {e}")
        return {"samples": [], "abundances": [], "conditions": []}


@router.get("/{session_id}/protein/{protein_id}/abundance")
async def get_protein_abundance(
    session_id: str,
    protein_id: str,
    comparison: str = Query("", description="Comparison name to filter samples"),
    store: SessionStore = Depends(get_session_store),
):
    """Get protein abundance data, optionally filtered by comparison."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    # Extract control/treatment from session config for condition labeling
    control = session.config.control if session.config else ""
    treatment = session.config.treatment if session.config else ""

    # Build sample filter from comparison config
    sample_filter = _build_sample_filter(session, comparison)

    # Load protein abundance from file
    abundance_data = await load_protein_abundance(
        results_dir,
        protein_id,
        session_id,
        control=control,
        treatment=treatment,
        sample_filter=sample_filter,
    )

    return create_response(abundance_data)


async def load_peptide_abundance(
    results_dir: Path,
    protein_id: str,
    session_id: str = "",
    sample_filter: list[str] | None = None,
) -> dict[str, Any]:
    """Load peptide abundance data from Parquet or TSV file.

    Aggregates PSMs into peptides by summing abundances for each unique
    peptide sequence across samples. Applies normalization coefficients
    from Step 6 so peptide abundances are on the same scale as protein abundances.

    Args:
        results_dir: Path to session results directory
        protein_id: Protein accession ID
        session_id: Session ID for cache keying
        sample_filter: Optional list of condition name prefixes to filter samples by.

    Returns:
        Peptide abundance data dictionary matching frontend PeptideAbundanceData interface
    """
    filter_tag = ",".join(sorted(sample_filter)) if sample_filter else ""
    cache_key = _cache_key(session_id, "peptide", protein_id, filter_tag)
    cached = viz_cache.get(cache_key)
    if cached is not None:
        return cached

    # Load normalization coefficients from Step 6
    norm_coeff_file = results_dir / "normalization_coefficients.tsv"
    norm_factors = {}
    if norm_coeff_file.exists():
        try:
            coeff_df = await asyncio.to_thread(pd.read_csv, norm_coeff_file, sep="\t")
            for _, row in coeff_df.iterrows():
                norm_factors[row["Sample"]] = float(row["LinearFactor"])
            logger.debug(
                f"Loaded normalization coefficients for {len(norm_factors)} samples"
            )
        except Exception as e:
            logger.warning(f"Could not load normalization coefficients: {e}")

    # Pipeline uses Parquet for performance, fall back to TSV for compatibility.
    # MSstats saves PSM_Abundances.parquet; msqrob2 saves PSM_Combined.parquet.
    psm_files = [
        results_dir / "PSM_Abundances.parquet",
        results_dir / "PSM_Combined.parquet",
        results_dir / "PSM_Abundances.tsv",
    ]

    df = None
    for psm_path in psm_files:
        if not psm_path.exists():
            continue
        try:
            if psm_path.suffix == ".parquet":
                df = await asyncio.to_thread(pd.read_parquet, psm_path)
            else:
                df = await asyncio.to_thread(pd.read_csv, psm_path, sep="\t")
            break
        except Exception as e:
            logger.error(f"Error reading {psm_path.name}: {e}")

    if df is None:
        return {"peptides": []}

    try:
        # Filter rows for this protein
        protein_rows = df[
            df["Master_Protein_Accessions"].str.contains(
                protein_id, na=False, regex=False
            )
        ]

        if protein_rows.empty:
            return {"peptides": []}

        # Get unique samples
        all_samples = sorted(protein_rows["Sample_Origination"].dropna().unique())

        # Filter to comparison-relevant samples when sample_filter is provided
        if sample_filter:
            all_samples = [
                s
                for s in all_samples
                if any(str(s).startswith(prefix) for prefix in sample_filter)
            ]

        # Group by Sequence to aggregate PSMs into peptides
        peptides = []
        for sequence, group in protein_rows.groupby("Sequence"):
            # Sum abundances per sample for this peptide
            sample_sums = {}
            for _, row in group.iterrows():
                sample = str(row.get("Sample_Origination", ""))
                abundance = row.get("Abundance")
                if pd.notna(abundance) and sample:
                    sample_sums[sample] = sample_sums.get(sample, 0) + float(abundance)

            samples = []
            abundances = []
            for s in all_samples:
                if s in sample_sums:
                    samples.append(s)
                    # Apply normalization coefficient if available
                    val = sample_sums[s]
                    if s in norm_factors:
                        val *= norm_factors[s]
                    abundances.append(val)

            if samples:
                peptides.append(
                    {
                        "peptide_id": sequence,
                        "sequence": sequence,
                        "abundances": abundances,
                        "samples": samples,
                    }
                )

        result = {"peptides": peptides}
        viz_cache.set(cache_key, result)
        return result
    except Exception as e:
        logger.error(f"Error loading peptide abundance: {e}")
        return {"peptides": []}


@router.get("/{session_id}/protein/{protein_id}/peptide")
async def get_protein_peptide(
    session_id: str,
    protein_id: str,
    comparison: str = Query("", description="Comparison name to filter samples"),
    store: SessionStore = Depends(get_session_store),
):
    """Get peptide abundance data for a protein, optionally filtered by comparison."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    # Build sample filter from comparison config
    sample_filter = _build_sample_filter(session, comparison)

    # Load peptide data from file
    peptide_data = await load_peptide_abundance(
        results_dir, protein_id, session_id, sample_filter=sample_filter
    )

    return create_response(peptide_data)


# ---- PTM-specific endpoints ----

_PTM_COMPARISONS_DIR = "ptm_comparisons"


async def load_ptm_results(
    session_id: str,
    results_dir: Path,
) -> list[dict[str, Any]]:
    """Load PTM differential expression results from the ptm_comparisons directory.

    Reads PTM_Model_{label}.tsv, PROTEIN_Model_{label}.tsv, and ADJUSTED_Model_{label}.tsv
    files and groups them by comparison label.

    Mode A comparisons only have the PTM model file; Mode B has all three.

    Args:
        session_id: Session ID for cache keying
        results_dir: Path to session results directory

    Returns:
        List of comparison dicts with ptm_model, protein_model, adjusted_model entries
    """
    ptm_dir = results_dir / _PTM_COMPARISONS_DIR
    if not ptm_dir.exists() or not ptm_dir.is_dir():
        return []

    # Find all PTM_Model_*.tsv files to discover available labels
    ptm_files = sorted(ptm_dir.glob("PTM_Model_*.tsv"))
    if not ptm_files:
        return []

    comparisons = []
    for ptm_file in ptm_files:
        label = ptm_file.stem[len("PTM_Model_") :]  # Extract label after "PTM_Model_"

        comparison: dict[str, Any] = {"label": label}

        # Load PTM model results
        try:
            df = await asyncio.to_thread(pd.read_csv, ptm_file, sep="\t")
            comparison["ptm_model"] = df.to_dict(orient="records")
        except Exception as e:
            logger.error(f"Error loading PTM model {ptm_file.name}: {e}")
            comparison["ptm_model"] = []

        # Load protein model results (may not exist in Mode A)
        protein_file = ptm_dir / f"PROTEIN_Model_{label}.tsv"
        if protein_file.exists():
            try:
                df = await asyncio.to_thread(pd.read_csv, protein_file, sep="\t")
                comparison["protein_model"] = df.to_dict(orient="records")
            except Exception as e:
                logger.error(f"Error loading protein model {protein_file.name}: {e}")
                comparison["protein_model"] = []
        else:
            comparison["protein_model"] = []

        # Load adjusted model results (may not exist in Mode A)
        adjusted_file = ptm_dir / f"ADJUSTED_Model_{label}.tsv"
        if adjusted_file.exists():
            try:
                df = await asyncio.to_thread(pd.read_csv, adjusted_file, sep="\t")
                comparison["adjusted_model"] = df.to_dict(orient="records")
            except Exception as e:
                logger.error(f"Error loading adjusted model {adjusted_file.name}: {e}")
                comparison["adjusted_model"] = []
        else:
            comparison["adjusted_model"] = []

        comparisons.append(comparison)

    return comparisons


@router.get("/{session_id}/ptm/results")
async def get_ptm_results(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Get PTM differential expression results with three-model output.

    Returns grouped data for each comparison label, containing the PTM model,
    protein model, and adjusted model results where available.
    Mode A comparisons only have the PTM model; Mode B has all three.
    """
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    results_dir = settings.sessions_dir / session_id / "results"

    comparisons = await load_ptm_results(session_id, results_dir)

    return create_response({"comparisons": comparisons})


@router.get("/{session_id}/ptm/site/{site_id}/abundance")
async def get_ptm_site_abundance(
    session_id: str,
    site_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Get per-site PTM abundance data across conditions.

    Currently returns a placeholder -- full data will be available after
    the PTM pipeline completes.
    """
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Placeholder: data will be populated from pipeline results
    return create_response(
        {
            "site": site_id,
            "conditions": [],
            "abundances": [],
            "samples": [],
        }
    )


@router.get("/{session_id}/ptm/qc/plots")
async def get_ptm_qc_plots(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Get PTM-specific QC data."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    results_dir = settings.sessions_dir / session_id / "results"
    qc_file = results_dir / "ptm_qc.json"

    default_result: dict[str, Any] = {
        "total_sites": 0,
        "significant_hits": 0,
        "up_regulated": 0,
        "down_regulated": 0,
        "comparisons": [],
    }

    if not qc_file.exists():
        return create_response(default_result)

    try:
        data = await asyncio.to_thread(
            lambda: json.loads(qc_file.read_text(encoding="utf-8"))
        )
        return create_response(data)
    except Exception as e:
        logger.error(f"Error loading PTM QC data: {e}")
        return create_response(default_result)
