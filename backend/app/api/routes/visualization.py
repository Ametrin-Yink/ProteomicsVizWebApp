"""
Visualization API routes.

Plot data endpoints for results, QC, and bioinformatics.
"""

import asyncio
from functools import lru_cache
import json
import logging
import re
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_session_store
from app.core.config import settings
from app.db.session_store import SessionStore
from app.services.gsea_service import gsea_service

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
    with open(gmt_path, 'r') as f:
        for line in f:
            parts = line.strip().split('\t')
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
_cache_hits = {"hits": 0, "misses": 0}


def _cache_key(session_id: str, *args) -> str:
    """Generate a cache key from session_id and additional args."""
    return f"{session_id}:{':'.join(str(a) for a in args)}"


def create_response(data: Any) -> Dict[str, Any]:
    """Create standardized API response wrapper.

    Args:
        data: Response data

    Returns:
        Wrapped response with metadata
    """
    return {
        "data": data,
        "meta": {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request_id": str(uuid.uuid4())
        }
    }


class FileCache:
    """Simple TTL-based file result cache for visualization endpoints."""

    def __init__(self, max_size: int = 50):
        self._max_size = max_size
        self._cache: Dict[str, tuple] = {}  # key -> (timestamp, result)

    def get(self, key: str) -> Any:
        if key in self._cache:
            _cache_hits["hits"] += 1
            return self._cache[key][1]
        _cache_hits["misses"] += 1
        return None

    def set(self, key: str, value: Any) -> None:
        # Evict oldest entries if at capacity
        if len(self._cache) >= self._max_size:
            oldest_key = min(self._cache, key=lambda k: self._cache[k][0])
            del self._cache[oldest_key]
        self._cache[key] = (datetime.now(timezone.utc), value)

    def invalidate(self, session_id: str) -> None:
        """Remove all cached entries for a session."""
        prefix = f"{session_id}:"
        self._cache = {k: v for k, v in self._cache.items() if not k.startswith(prefix)}

    def clear(self) -> None:
        self._cache.clear()


# Global cache instance
viz_cache = FileCache(max_size=50)


async def load_diff_expression_results(results_dir: Path, session_id: str = "") -> List[Dict[str, Any]]:
    """Load differential expression results from TSV file.

    Args:
        results_dir: Path to session results directory
        session_id: Session ID for cache keying

    Returns:
        List of protein results dictionaries
    """
    cache_key = _cache_key(session_id, "diff_expression")
    cached = viz_cache.get(cache_key)
    if cached is not None:
        return cached

    diff_file = results_dir / "Diff_Expression.tsv"

    if not diff_file.exists():
        return []

    try:
        df = await asyncio.to_thread(pd.read_csv, diff_file, sep='\t')

        # Convert to list of dictionaries
        # Field names must match frontend DEResult interface
        results = []
        for _, row in df.iterrows():
            # Handle NaN values - convert to None for JSON serialization
            log_fc = row.get("logFC", 0)
            pval = row.get("pval", 1)
            adj_pval = row.get("adjPval", 1)
            psm_count = row.get("PSM_Count", row.get("psm_count", 0))

            # Convert NaN/Inf to None
            if pd.isna(log_fc) or (isinstance(log_fc, float) and math.isinf(log_fc)):
                log_fc = None
            if pd.isna(pval) or (isinstance(pval, float) and math.isinf(pval)):
                pval = None
            if pd.isna(adj_pval) or (isinstance(adj_pval, float) and math.isinf(adj_pval)):
                adj_pval = None
            if pd.isna(psm_count):
                psm_count = 0

            se = row.get("se", None)
            if pd.isna(se) if se is not None else True:
                se = None

            t_stat = row.get("t", None)
            if pd.isna(t_stat) if t_stat is not None else True:
                t_stat = None

            result = {
                "master_protein_accessions": str(row.get("Master_Protein_Accessions", "")),
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

        viz_cache.set(cache_key, results)
        return results
    except Exception as e:
        # Log error but return empty list
        logger.error(f"Error loading diff expression results: {e}")
        return []


def load_qc_results(results_dir: Path) -> Dict[str, Any]:
    """Load QC results from JSON file.

    Args:
        results_dir: Path to session results directory

    Returns:
        QC results dictionary with summary statistics
    """
    qc_file = results_dir / "QC_Results.json"

    # Default empty structure with all required fields
    default_result = {
        "pca": {"samples": [], "pc1": [], "pc2": [], "conditions": [], "pc1_variance": 0, "pc2_variance": 0},
        "pvalue_distribution": {"bins": [], "counts": []},
        "psm_cv": {},
        "protein_cv": {},
        "intensity_distributions": {"psm": {}, "protein": {}},
        "data_completeness": [],
        "psm_completeness": [],
        # Summary statistics - will be populated from data or set to None
        "total_psms": None,
        "avg_psms_per_sample": None,
        "total_proteins": None,
        "avg_proteins_per_sample": None,
        "average_cv": None,
        "completeness_rate": None
    }

    if not qc_file.exists():
        return default_result

    try:
        with open(qc_file, 'r') as f:
            data = json.load(f)

        # Merge with defaults to ensure all fields exist
        result = {**default_result, **data}

        # Handle legacy format: cv_variance -> psm_cv
        if "cv_variance" in data and not result.get("psm_cv"):
            result["psm_cv"] = data["cv_variance"]

        # MAJ-006: Filter out PSM_Count from PCA samples (legacy cached data)
        if "pca" in result and result["pca"]:
            pca = result["pca"]
            if "samples" in pca and "PSM_Count" in pca["samples"]:
                # Find index of PSM_Count
                psm_count_idx = pca["samples"].index("PSM_Count")
                # Remove from all PCA arrays
                pca["samples"].pop(psm_count_idx)
                pca["pc1"].pop(psm_count_idx)
                pca["pc2"].pop(psm_count_idx)
                pca["conditions"].pop(psm_count_idx)

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
                if hasattr(first_sample, 'get'):
                    estimated_unique = first_sample.get("present", 0)
                    if estimated_unique > 0 and estimated_unique < result["total_psms"]:
                        # Use the estimated unique count as a hint
                        result["total_psms_note"] = f"Estimated ~{estimated_unique:,} unique PSMs (cached value may include duplicates)"

        return result
    except Exception as e:
        logger.error(f"Error loading QC results: {e}")
        return default_result


# Global cache for loaded GSEA results (session_path -> dict of database -> list of results)
# Loaded once per session, then served from memory
_gsea_file_cache: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}


def _load_gsea_json(filepath: Path) -> dict:
    """Load and parse a GSEA JSON file. Run via asyncio.to_thread to avoid blocking."""
    with open(filepath, 'r') as f:
        return json.load(f)


def load_gsea_results(results_dir: Path, database: str, session_id: str = "") -> Dict[str, Any]:
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
        return {"results": [], "database": database, "total_pathways": 0, "significant_pathways": 0, "overrepresented": 0, "underrepresented": 0}

    # Load entire file once per session, cache all databases in memory
    cache_key = str(gsea_file)
    if cache_key not in _gsea_file_cache:
        try:
            logger.info(f"Loading GSEA results into memory: {gsea_file.name} ({gsea_file.stat().st_size / 1024 / 1024:.1f} MB)")
            all_results = _load_gsea_json(gsea_file)
            # Pre-process all databases at once
            processed = {}
            for db_name, db_data in all_results.items():
                results = db_data.get("results", [])
                # Add significant field
                for r in results:
                    r["significant"] = abs(r.get("nes", 0)) >= 1.0 and r.get("fdr", 1) < 0.25
                processed[db_name] = results
            _gsea_file_cache[cache_key] = processed
            logger.info(f"GSEA results cached: {len(processed)} databases")
        except Exception as e:
            logger.error(f"Error loading GSEA results: {e}")
            return {"results": [], "database": database, "total_pathways": 0, "significant_pathways": 0, "overrepresented": 0, "underrepresented": 0}

    db_results = _gsea_file_cache[cache_key].get(database, [])
    results = db_results

    # Calculate summary stats
    significant_count = sum(1 for p in results if p.get("significant", False))
    overrepresented = sum(1 for p in results if p.get("significant", False) and p.get("nes", 0) > 0)
    underrepresented = sum(1 for p in results if p.get("significant", False) and p.get("nes", 0) < 0)

    return {
        "results": results,
        "database": database,
        "total_pathways": len(results),
        "significant_pathways": significant_count,
        "overrepresented": overrepresented,
        "underrepresented": underrepresented
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
    store: SessionStore = Depends(get_session_store)
):
    """Get differential expression results with pagination and filtering."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    
    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"
    
    # Load results from file
    all_results = await load_diff_expression_results(results_dir, session_id)
    
    # Apply filters
    if significant_only:
        all_results = [r for r in all_results if r["significant"]]
    
    if search:
        search_lower = search.lower()
        all_results = [
            r for r in all_results 
            if search_lower in r.get("master_protein_accessions", "").lower() 
            or search_lower in r.get("gene_name", "").lower()
        ]
    
    # Sort results
    reverse = sort_order.lower() == "desc"
    all_results.sort(key=lambda x: x.get(sort_by, 0), reverse=reverse)
    
    # Calculate summary statistics
    total_proteins = len(all_results)
    significant_proteins = sum(1 for r in all_results if r.get("significant", False))
    upregulated = sum(1 for r in all_results if r.get("significant", False) and r.get("log_fc", 0) > 0)
    downregulated = sum(1 for r in all_results if r.get("significant", False) and r.get("log_fc", 0) < 0)
    
    # Paginate
    total = len(all_results)
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    paginated_results = all_results[start_idx:end_idx]
    
    return create_response({
        "results": paginated_results,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
        "total_proteins": total_proteins,
        "significant_proteins": significant_proteins,
        "upregulated": upregulated,
        "downregulated": downregulated
    })


@router.get("/{session_id}/qc/plots")
async def get_qc_plots(
    session_id: str,
    store: SessionStore = Depends(get_session_store)
):
    """Get QC plot data."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    
    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    # Load QC results from file
    qc_data = load_qc_results(results_dir)

    # MAJ-005: Recalculate total_psms from PSM file if cached value looks wrong
    # The bug showed total rows (~49k) instead of unique PSMs (~4k)
    if qc_data.get("total_psms") and qc_data.get("total_psms") > 20000:
        psm_file = results_dir / "PSM_Abundances.tsv"
        if psm_file.exists():
            try:
                psm_df = pd.read_csv(psm_file, sep='\t')
                if 'Unique_PSM' in psm_df.columns:
                    correct_total = psm_df['Unique_PSM'].nunique()
                    qc_data["total_psms"] = int(correct_total)
            except Exception as e:
                logger.error(f"Error recalculating total_psms: {e}")

    return create_response(qc_data)


@router.get("/{session_id}/gsea/{database}/plot")
async def get_gsea_plot_data(
    session_id: str,
    database: str,
    term: str = Query(..., description="Pathway term identifier"),
    store: SessionStore = Depends(get_session_store)
):
    """Get GSEA plot data (running ES curve + rank metric positions) for a specific pathway."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )

    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    # Validate database name to prevent path traversal
    if database not in VALID_GSEA_DATABASES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid GSEA database: {database}. Must be one of: {', '.join(sorted(VALID_GSEA_DATABASES))}"
        )

    # Load slim GSEA results to get lead_genes and pathway metadata
    gsea_data = load_gsea_results(results_dir, database, session_id)
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
            detail=f"Pathway '{term}' not found in {database}"
        )

    # Compute running ES curve on-demand from gseapy output files
    gsea_dir = results_dir / "gsea" / database

    ranked_genes = []
    ranked_metrics = []

    rnk_file = gsea_dir / "gseapy.gene_set.0.rnk"
    if rnk_file.exists():
        try:
            rnk_df = await asyncio.to_thread(pd.read_csv, rnk_file, sep='\t', header=None)
            ranked_genes = rnk_df.iloc[:, 0].tolist()
            ranked_metrics = rnk_df.iloc[:, 1].tolist()
        except Exception as e:
            logger.warning(f"Could not read .rnk file: {e}")
    else:
        # Try alternate naming: gseapy uses the gene set name in the .rnk filename
        alt_rnk = next((gsea_dir.glob("*.rnk")), None)
        if alt_rnk is not None:
            try:
                rnk_df = await asyncio.to_thread(pd.read_csv, alt_rnk, sep='\t', header=None)
                ranked_genes = rnk_df.iloc[:, 0].tolist()
                ranked_metrics = rnk_df.iloc[:, 1].tolist()
            except Exception as e:
                logger.warning(f"Could not read alternate .rnk file: {e}")

    # Fallback: reconstruct ranked list from Diff_Expression.tsv
    if not ranked_genes:
        de_file = results_dir / "Diff_Expression.tsv"
        if de_file.exists():
            try:
                de_df = await asyncio.to_thread(pd.read_csv, de_file, sep='\t')
                gene_col = next((c for c in de_df.columns if 'gene' in c.lower() or 'symbol' in c.lower()), None)
                pval_col = next((c for c in de_df.columns if 'pval' in c.lower() and 'adj' not in c.lower()), None)
                logfc_col = next((c for c in de_df.columns if 'logfc' in c.lower() or 'log2fc' in c.lower()), None)
                if gene_col and pval_col and logfc_col:
                    valid = de_df[(de_df[pval_col] > 0) & (de_df[pval_col] <= 1)].copy()
                    valid['metric'] = -np.log10(valid[pval_col]) * np.sign(valid[logfc_col])
                    valid = valid.sort_values('metric', ascending=False)
                    valid['gene'] = valid[gene_col].str.split('[;]').str[0].str.strip().str.replace(r'-\d+$', '', regex=True)
                    ranked_genes = valid['gene'].tolist()
                    ranked_metrics = valid['metric'].tolist()
            except Exception as e:
                logger.warning(f"Could not reconstruct ranked list from DE results: {e}")

    if not ranked_genes:
        return create_response({
            "term": term,
            "es": pathway.get("es", 0),
            "nes": pathway.get("nes", 0),
            "running_es_curve": [],
            "rank_metric_positions": [],
        })

    lead_genes = pathway.get("lead_genes", [])
    nes = pathway.get("nes", 0)

    # Check cache first
    cache_key = _cache_key(session_id, "gsea_plot", database, term)
    cached = viz_cache.get(cache_key)
    if cached is not None and 'pathway_gene_set_size' in cached:
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
        for i, (gene, metric) in enumerate(zip(ranked_genes, ranked_metrics))
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
    store: SessionStore = Depends(get_session_store)
):
    """Get GSEA heatmap data (z-scores for leading edge genes) for a specific pathway."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )

    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    # Validate database name to prevent path traversal
    if database not in VALID_GSEA_DATABASES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid GSEA database: {database}. Must be one of: {', '.join(sorted(VALID_GSEA_DATABASES))}"
        )

    # Load slim GSEA results to get lead_genes
    gsea_data = load_gsea_results(results_dir, database, session_id)
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
            detail=f"Pathway '{term}' not found in {database}"
        )

    # Check cache first
    cache_key = _cache_key(session_id, "gsea_heatmap", database, term)
    cached = viz_cache.get(cache_key)
    if cached is not None:
        return create_response(cached)

    lead_genes = pathway.get("lead_genes", [])
    if not lead_genes:
        return create_response({"genes": [], "samples": [], "z_scores": []})

    # Build ranked gene list to order heatmap genes by rank position
    de_file = results_dir / "Diff_Expression.tsv"
    gene_rank_map: dict[str, int] = {}
    if de_file.exists():
        try:
            de_df = await asyncio.to_thread(pd.read_csv, de_file, sep='\t')
            gene_col = next((c for c in de_df.columns if 'gene' in c.lower() or 'symbol' in c.lower()), None)
            pval_col = next((c for c in de_df.columns if 'pval' in c.lower() and 'adj' not in c.lower()), None)
            logfc_col = next((c for c in de_df.columns if 'logfc' in c.lower() or 'log2fc' in c.lower()), None)
            if gene_col and pval_col and logfc_col:
                valid = de_df[(de_df[pval_col] > 0) & (de_df[pval_col] <= 1)].copy()
                valid['metric'] = -np.log10(valid[pval_col]) * np.sign(valid[logfc_col])
                valid = valid.sort_values('metric', ascending=False)
                valid['gene'] = valid[gene_col].str.split('[;]').str[0].str.strip().str.replace(r'-\d+$', '', regex=True)
                for rank, gene in enumerate(valid['gene'].tolist()):
                    gene_rank_map[gene.upper()] = rank
        except Exception as e:
            logger.debug(f"Could not build gene rank map: {e}")

    # Load protein abundance data
    protein_file = results_dir / "Protein_Abundances.tsv"
    if not protein_file.exists():
        return create_response({"genes": [], "samples": [], "z_scores": []})

    try:
        protein_df = await asyncio.to_thread(pd.read_csv, protein_file, sep='\t')
    except Exception as e:
        logger.warning(f"Could not load protein abundance for heatmap: {e}")
        return create_response({"genes": [], "samples": [], "z_scores": []})

    # Use existing method to generate heatmap data (PSM_Count already excluded)
    heatmap_data = gsea_service.generate_heatmap_data(protein_df, lead_genes)

    if heatmap_data is None:
        return create_response({"genes": [], "samples": [], "z_scores": []})

    # Reorder genes and z_scores by rank position if rank info is available
    if gene_rank_map and heatmap_data.get("genes"):
        genes_with_rank = []
        z_scores_by_gene = dict(zip(heatmap_data["genes"], heatmap_data["z_scores"]))
        for gene in heatmap_data["genes"]:
            genes_with_rank.append((gene, gene_rank_map.get(gene.upper(), gene_rank_map.get(gene, float('inf')))))
        genes_with_rank.sort(key=lambda x: x[1])
        heatmap_data["genes"] = [g for g, _ in genes_with_rank]
        heatmap_data["z_scores"] = [z_scores_by_gene[g] for g in heatmap_data["genes"]]

    if heatmap_data is None:
        return create_response({"genes": [], "samples": [], "z_scores": []})

    # Cache the result
    viz_cache.set(cache_key, heatmap_data)

    return create_response(heatmap_data)


@router.get("/{session_id}/gsea/{database}")
async def get_gsea_results(
    session_id: str,
    database: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    sort_by: str = Query("nes"),
    sort_order: str = Query("desc"),
    significant_only: bool = Query(False),
    search: str = Query(""),
    store: SessionStore = Depends(get_session_store)
):
    """Get GSEA results for a database with pagination and filtering."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )

    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    # Validate database name to prevent path traversal
    if database not in VALID_GSEA_DATABASES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid GSEA database: {database}. Must be one of: {', '.join(sorted(VALID_GSEA_DATABASES))}"
        )

    # Load GSEA results (cached in memory after first load)
    gsea_data = load_gsea_results(results_dir, database, session_id)

    results = gsea_data.pop("results")

    # Apply filters
    if significant_only:
        results = [r for r in results if r.get("significant", False)]

    if search:
        search_lower = search.lower()
        results = [
            r for r in results
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


async def load_protein_abundance(
    results_dir: Path,
    protein_id: str,
    session_id: str = "",
    control: str = "",
    treatment: str = "",
) -> Dict[str, Any]:
    """Load protein abundance data from TSV file.

    Args:
        results_dir: Path to session results directory
        protein_id: Protein accession ID
        session_id: Session ID for cache keying
        control: Control condition name for label matching
        treatment: Treatment condition name for label matching

    Returns:
        Protein abundance data dictionary matching frontend ProteinAbundance interface
    """
    cache_key = _cache_key(session_id, "protein_v2", protein_id)
    cached = viz_cache.get(cache_key)
    if cached is not None:
        return cached

    abundance_file = results_dir / "Protein_Abundances.tsv"

    if not abundance_file.exists():
        return {"samples": [], "abundances": [], "conditions": []}

    try:
        df = await asyncio.to_thread(pd.read_csv, abundance_file, sep='\t')

        # Find the protein row (handle multiple accessions separated by ;)
        protein_row = df[df['Master_Protein_Accessions'].str.contains(re.escape(protein_id), regex=True, na=False)]

        if protein_row.empty:
            return {"samples": [], "abundances": [], "conditions": []}

        # Get abundance columns (all columns except metadata)
        metadata_cols = ['Master_Protein_Accessions', 'Gene_Name', 'PSM_Count', 'psm_count', 'Protein']
        abundance_cols = [col for col in df.columns if col not in metadata_cols]

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
            "conditions": conditions
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
    store: SessionStore = Depends(get_session_store)
):
    """Get protein abundance data."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    
    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    # Extract control/treatment from session config for condition labeling
    control = session.config.control if session.config else ""
    treatment = session.config.treatment if session.config else ""

    # Load protein abundance from file
    abundance_data = await load_protein_abundance(
        results_dir, protein_id, session_id,
        control=control,
        treatment=treatment,
    )

    return create_response(abundance_data)


async def load_peptide_abundance(results_dir: Path, protein_id: str, session_id: str = "") -> Dict[str, Any]:
    """Load peptide abundance data from Parquet or TSV file.

    Aggregates PSMs into peptides by summing abundances for each unique
    peptide sequence across samples. Applies normalization coefficients
    from Step 6 so peptide abundances are on the same scale as protein abundances.

    Args:
        results_dir: Path to session results directory
        protein_id: Protein accession ID
        session_id: Session ID for cache keying

    Returns:
        Peptide abundance data dictionary matching frontend PeptideAbundanceData interface
    """
    cache_key = _cache_key(session_id, "peptide", protein_id)
    cached = viz_cache.get(cache_key)
    if cached is not None:
        return cached

    # Load normalization coefficients from Step 6
    norm_coeff_file = results_dir / "normalization_coefficients.tsv"
    norm_factors = {}
    if norm_coeff_file.exists():
        try:
            coeff_df = await asyncio.to_thread(pd.read_csv, norm_coeff_file, sep='\t')
            for _, row in coeff_df.iterrows():
                norm_factors[row['Sample']] = float(row['LinearFactor'])
            logger.debug(f"Loaded normalization coefficients for {len(norm_factors)} samples")
        except Exception as e:
            logger.warning(f"Could not load normalization coefficients: {e}")

    # Pipeline uses Parquet for performance, fall back to TSV for compatibility
    psm_parquet = results_dir / "PSM_Abundances.parquet"
    psm_tsv = results_dir / "PSM_Abundances.tsv"

    if psm_parquet.exists():
        try:
            df = await asyncio.to_thread(pd.read_parquet, psm_parquet)
        except Exception as e:
            logger.error(f"Error reading Parquet file: {e}")
            return {"peptides": []}
    elif psm_tsv.exists():
        try:
            df = await asyncio.to_thread(pd.read_csv, psm_tsv, sep='\t')
        except Exception as e:
            logger.error(f"Error reading TSV file: {e}")
            return {"peptides": []}
    else:
        return {"peptides": []}

    try:
        # Filter rows for this protein
        protein_rows = df[df['Master_Protein_Accessions'].str.contains(protein_id, na=False)]

        if protein_rows.empty:
            return {"peptides": []}

        # Get unique samples
        all_samples = sorted(protein_rows['Sample_Origination'].dropna().unique())

        # Group by Sequence to aggregate PSMs into peptides
        peptides = []
        for sequence, group in protein_rows.groupby('Sequence'):
            # Sum abundances per sample for this peptide
            sample_sums = {}
            for _, row in group.iterrows():
                sample = str(row.get('Sample_Origination', ''))
                abundance = row.get('Abundance')
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
                peptides.append({
                    "peptide_id": sequence,
                    "sequence": sequence,
                    "abundances": abundances,
                    "samples": samples,
                })

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
    store: SessionStore = Depends(get_session_store)
):
    """Get peptide abundance data for a protein."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )

    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    # Load peptide data from file
    peptide_data = await load_peptide_abundance(results_dir, protein_id, session_id)

    return create_response(peptide_data)
