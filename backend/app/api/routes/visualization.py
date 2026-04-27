"""
Visualization API routes.

Plot data endpoints for results, QC, and bioinformatics.
"""

import asyncio
from functools import lru_cache
import json
import logging
import math
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.config import settings
from app.db.session_store import SessionStore
from app.services.gsea_service import gsea_service

VALID_GSEA_DATABASES = {"go_bp", "go_mf", "go_cc", "kegg", "reactome"}

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
            "timestamp": datetime.utcnow().isoformat(),
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
        self._cache[key] = (datetime.utcnow(), value)

    def invalidate(self, session_id: str) -> None:
        """Remove all cached entries for a session."""
        prefix = f"{session_id}:"
        self._cache = {k: v for k, v in self._cache.items() if not k.startswith(prefix)}

    def clear(self) -> None:
        self._cache.clear()


# Global cache instance
viz_cache = FileCache(max_size=50)


def get_session_store() -> SessionStore:
    """Dependency to get session store."""
    return SessionStore(settings.sessions_dir)


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

            result = {
                "master_protein_accessions": str(row.get("Master_Protein_Accessions", "")),
                "gene_name": str(row.get("Gene_Name", "")),
                "log_fc": float(log_fc) if log_fc is not None else 0,
                "pval": float(pval) if pval is not None else 1,
                "adj_pval": float(adj_pval) if adj_pval is not None else 1,
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
            with open(gsea_file, 'r') as f:
                all_results = json.load(f)
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


@router.get("/{session_id}/gsea/{database}/{term}/plot")
async def get_gsea_plot_data(
    session_id: str,
    database: str,
    term: str,
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

    rnk_file = gsea_dir / "gseapy.gene_set.0.rnk"
    if not rnk_file.exists():
        # Try alternate naming: gseapy uses the gene set name in the .rnk filename
        try:
            rnk_file = next(gsea_dir.glob("*.rnk"))
        except StopIteration:
            return create_response({
                "term": term,
                "es": pathway.get("es", 0),
                "nes": pathway.get("nes", 0),
                "running_es_curve": [],
                "rank_metric_positions": [],
            })

    try:
        rnk_df = await asyncio.to_thread(pd.read_csv, rnk_file, sep='\t', header=None)
        ranked_genes = rnk_df.iloc[:, 0].tolist()
        ranked_metrics = rnk_df.iloc[:, 1].tolist()
    except Exception as e:
        logger.warning(f"Could not read .rnk file: {e}")
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
    if cached is not None:
        return create_response(cached)

    # Use existing method to compute curve
    running_es_curve = gsea_service.generate_running_es_curve(
        ranked_genes, lead_genes, nes, ranked_metrics
    )

    # Compute rank metric positions
    lead_genes_set = set(lead_genes)
    rank_metric_positions = [
        [gene, i, float(metric)]
        for i, (gene, metric) in enumerate(zip(ranked_genes, ranked_metrics))
        if gene in lead_genes_set
    ]

    response_data = {
        "term": term,
        "es": pathway.get("es", 0),
        "nes": pathway.get("nes", 0),
        "running_es_curve": running_es_curve,
        "rank_metric_positions": rank_metric_positions,
    }

    # Cache the result
    viz_cache.set(cache_key, response_data)

    return create_response(response_data)


@router.get("/{session_id}/gsea/{database}/{term}/heatmap")
async def get_gsea_heatmap_data(
    session_id: str,
    database: str,
    term: str,
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

    # Cache the result
    viz_cache.set(cache_key, heatmap_data)

    return create_response(heatmap_data)


async def load_protein_abundance(results_dir: Path, protein_id: str, session_id: str = "") -> Dict[str, Any]:
    """Load protein abundance data from TSV file.

    Args:
        results_dir: Path to session results directory
        protein_id: Protein accession ID
        session_id: Session ID for cache keying

    Returns:
        Protein abundance data dictionary matching frontend ProteinAbundance interface
    """
    cache_key = _cache_key(session_id, "protein", protein_id)
    cached = viz_cache.get(cache_key)
    if cached is not None:
        return cached

    abundance_file = results_dir / "Protein_Abundances.tsv"

    if not abundance_file.exists():
        return {"samples": [], "abundances": [], "conditions": []}

    try:
        df = await asyncio.to_thread(pd.read_csv, abundance_file, sep='\t')

        # Find the protein row (handle multiple accessions separated by ;)
        protein_row = df[df['Master_Protein_Accessions'].str.contains(protein_id, na=False)]

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
            # Convert NA to 0, otherwise use the value
            if pd.isna(value):
                abundances.append(0.0)
            else:
                abundances.append(float(value))
            # Try to infer condition from sample name (e.g., "Abundance F1 Sample_DMSO_1")
            # Default to Unknown if can't parse
            condition = "Unknown"
            if "DMSO" in col.upper():
                condition = "Control"
            elif "INCZ" in col.upper() or "TREATMENT" in col.upper():
                condition = "Treatment"
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

    # Load protein abundance from file
    abundance_data = await load_protein_abundance(results_dir, protein_id, session_id)

    return create_response(abundance_data)


async def load_psm_abundance(results_dir: Path, protein_id: str, session_id: str = "") -> Dict[str, Any]:
    """Load PSM abundance data from Parquet or TSV file.

    Args:
        results_dir: Path to session results directory
        protein_id: Protein accession ID
        session_id: Session ID for cache keying

    Returns:
        PSM abundance data dictionary matching frontend PSMAbundanceData interface
    """
    cache_key = _cache_key(session_id, "psm", protein_id)
    cached = viz_cache.get(cache_key)
    if cached is not None:
        return cached

    # Pipeline uses Parquet for performance, fall back to TSV for compatibility
    psm_parquet = results_dir / "PSM_Abundances.parquet"
    psm_tsv = results_dir / "PSM_Abundances.tsv"

    if psm_parquet.exists():
        try:
            df = await asyncio.to_thread(pd.read_parquet, psm_parquet)
        except Exception as e:
            logger.error(f"Error reading Parquet file: {e}")
            return {"psms": []}
    elif psm_tsv.exists():
        try:
            df = await asyncio.to_thread(pd.read_csv, psm_tsv, sep='\t')
        except Exception as e:
            logger.error(f"Error reading TSV file: {e}")
            return {"psms": []}
    else:
        return {"psms": []}

    try:
        # Filter rows for this protein (handle multiple accessions separated by ;)
        protein_rows = df[df['Master_Protein_Accessions'].str.contains(protein_id, na=False)]

        if protein_rows.empty:
            return {"psms": []}

        # Group by Unique_PSM to collect all sample abundances for each PSM
        psms = []
        for unique_psm, group in protein_rows.groupby('Unique_PSM'):
            samples = []
            abundances = []

            for _, row in group.iterrows():
                sample_name = row.get('Sample_Origination', '')
                abundance = row.get('Abundance')
                if pd.notna(abundance) and sample_name:
                    samples.append(str(sample_name))
                    abundances.append(float(abundance))

            if samples:  # Only add if we have data
                psms.append({
                    "psm_id": str(unique_psm),
                    "sequence": str(group.iloc[0].get('Sequence', '')),
                    "abundances": abundances,
                    "samples": samples
                })

        result = {"psms": psms}
        viz_cache.set(cache_key, result)
        return result
    except Exception as e:
        logger.error(f"Error loading PSM abundance: {e}")
        return {"psms": []}


@router.get("/{session_id}/protein/{protein_id}/psm")
async def get_protein_psm(
    session_id: str,
    protein_id: str,
    store: SessionStore = Depends(get_session_store)
):
    """Get PSM abundance data for a protein."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    
    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"
    
    # Load PSM data from file
    psm_data = await load_psm_abundance(results_dir, protein_id, session_id)

    return create_response(psm_data)
