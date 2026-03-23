"""
Visualization API routes.

Plot data endpoints for results, QC, and bioinformatics.
"""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.config import settings
from app.db.session_store import SessionStore

router = APIRouter()


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


def get_session_store() -> SessionStore:
    """Dependency to get session store."""
    return SessionStore(settings.sessions_dir)


def load_diff_expression_results(results_dir: Path) -> List[Dict[str, Any]]:
    """Load differential expression results from TSV file.
    
    Args:
        results_dir: Path to session results directory
        
    Returns:
        List of protein results dictionaries
    """
    diff_file = results_dir / "Diff_Expression.tsv"
    
    if not diff_file.exists():
        return []
    
    try:
        df = pd.read_csv(diff_file, sep='\t')
        
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
            import math
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
        
        return results
    except Exception as e:
        # Log error but return empty list
        print(f"Error loading diff expression results: {e}")
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

        return result
    except Exception as e:
        print(f"Error loading QC results: {e}")
        return default_result


def load_gsea_results(results_dir: Path, database: str) -> Dict[str, Any]:
    """Load GSEA results from JSON file.
    
    Args:
        results_dir: Path to session results directory
        database: Database name (go_bp, go_cc, go_mf, kegg, reactome)
        
    Returns:
        GSEA results dictionary
    """
    gsea_file = results_dir / "GSEA_Results.json"
    
    if not gsea_file.exists():
        return {"results": [], "database": database, "total_pathways": 0, "significant_pathways": 0, "overrepresented": 0, "underrepresented": 0}

    try:
        with open(gsea_file, 'r') as f:
            all_results = json.load(f)

        # Get results for specific database
        db_results = all_results.get(database, {})
        results = db_results.get("results", [])

        # Add significant field to each result (GSEA significance: |NES| >= 1 and FDR < 0.05)
        for r in results:
            r["significant"] = abs(r.get("nes", 0)) >= 1.0 and r.get("fdr", 1) < 0.05

        # Use summary stats from file if available, otherwise calculate
        significant_count = db_results.get("significant_pathways", sum(1 for p in results if p.get("significant", False)))
        overrepresented = db_results.get("overrepresented", sum(1 for p in results if p.get("significant", False) and p.get("nes", 0) > 0))
        underrepresented = db_results.get("underrepresented", sum(1 for p in results if p.get("significant", False) and p.get("nes", 0) < 0))

        return {
            "results": results,
            "database": database,
            "total_pathways": db_results.get("total_pathways", len(results)),
            "significant_pathways": significant_count,
            "overrepresented": overrepresented,
            "underrepresented": underrepresented
        }
    except Exception as e:
        print(f"Error loading GSEA results: {e}")
        return {"results": [], "database": database, "total_pathways": 0, "significant_pathways": 0, "overrepresented": 0, "underrepresented": 0}


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
    all_results = load_diff_expression_results(results_dir)
    
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
    
    return create_response(qc_data)


@router.get("/{session_id}/gsea/{database}")
async def get_gsea_results(
    session_id: str,
    database: str,
    store: SessionStore = Depends(get_session_store)
):
    """Get GSEA results for a database."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    
    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"
    
    # Load GSEA results from file
    gsea_data = load_gsea_results(results_dir, database)
    
    return create_response(gsea_data)


def load_protein_abundance(results_dir: Path, protein_id: str) -> Dict[str, Any]:
    """Load protein abundance data from TSV file.

    Args:
        results_dir: Path to session results directory
        protein_id: Protein accession ID

    Returns:
        Protein abundance data dictionary matching frontend ProteinAbundance interface
    """
    abundance_file = results_dir / "Protein_Abundances.tsv"

    if not abundance_file.exists():
        return {"samples": [], "abundances": [], "conditions": []}

    try:
        df = pd.read_csv(abundance_file, sep='\t')

        # Find the protein row (handle multiple accessions separated by ;)
        protein_row = df[df['Master_Protein_Accessions'].str.contains(protein_id, na=False)]

        if protein_row.empty:
            return {"samples": [], "abundances": [], "conditions": []}

        # Get abundance columns (all columns except metadata)
        metadata_cols = ['Master_Protein_Accessions', 'Gene_Name']
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

        return {
            "samples": samples,
            "abundances": abundances,
            "conditions": conditions
        }
    except Exception as e:
        print(f"Error loading protein abundance: {e}")
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
    abundance_data = load_protein_abundance(results_dir, protein_id)
    
    return create_response(abundance_data)


def load_psm_abundance(results_dir: Path, protein_id: str) -> Dict[str, Any]:
    """Load PSM abundance data from TSV file.

    Args:
        results_dir: Path to session results directory
        protein_id: Protein accession ID

    Returns:
        PSM abundance data dictionary matching frontend PSMAbundanceData interface
    """
    psm_file = results_dir / "PSM_Abundances.tsv"

    if not psm_file.exists():
        return {"psms": []}

    try:
        df = pd.read_csv(psm_file, sep='\t')

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

        return {"psms": psms}
    except Exception as e:
        print(f"Error loading PSM abundance: {e}")
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
    psm_data = load_psm_abundance(results_dir, protein_id)
    
    return create_response(psm_data)
