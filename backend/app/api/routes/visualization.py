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
            result = {
                "master_protein_accessions": str(row.get("Master_Protein_Accessions", "")),
                "gene_name": str(row.get("Gene_Name", "")),
                "log_fc": float(row.get("logFC", 0) or 0),
                "pval": float(row.get("pval", 1) or 1),
                "adj_pval": float(row.get("adjPval", 1) or 1),
                "significant": bool((row.get("adjPval", 1) or 1) < 0.05),
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
        QC results dictionary
    """
    qc_file = results_dir / "QC_Results.json"
    
    if not qc_file.exists():
        return {
            "pca": {},
            "pvalue_distribution": {},
            "cv_variance": {},
            "intensity_distributions": {},
            "data_completeness": {}
        }
    
    try:
        with open(qc_file, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading QC results: {e}")
        return {
            "pca": {},
            "pvalue_distribution": {},
            "cv_variance": {},
            "intensity_distributions": {},
            "data_completeness": {}
        }


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
        return {"pathways": [], "database": database}
    
    try:
        with open(gsea_file, 'r') as f:
            all_results = json.load(f)
        
        # Get results for specific database
        db_results = all_results.get(database, {})
        pathways = db_results.get("pathways", [])
        
        return {
            "pathways": pathways,
            "database": database,
            "total_pathways": len(pathways),
            "significant_pathways": sum(1 for p in pathways if p.get("significant", False))
        }
    except Exception as e:
        print(f"Error loading GSEA results: {e}")
        return {"pathways": [], "database": database}


@router.get("/{session_id}/results")
async def get_results(
    session_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
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
        Protein abundance data dictionary
    """
    abundance_file = results_dir / "Protein_Abundances.tsv"
    
    if not abundance_file.exists():
        return {"protein_id": protein_id, "abundances": []}
    
    try:
        df = pd.read_csv(abundance_file, sep='\t')
        
        # Find the protein row
        protein_row = df[df['Master_Protein_Accessions'] == protein_id]
        
        if protein_row.empty:
            return {"protein_id": protein_id, "abundances": []}
        
        # Get abundance columns (all columns except metadata)
        metadata_cols = ['Master_Protein_Accessions', 'Gene_Name', 'Description', 'Organism']
        abundance_cols = [col for col in df.columns if col not in metadata_cols]
        
        # Build abundance data
        abundances = []
        for col in abundance_cols:
            value = protein_row.iloc[0].get(col)
            if pd.notna(value):
                abundances.append({
                    "sample": col,
                    "abundance": float(value)
                })
        
        return {
            "protein_id": protein_id,
            "gene_name": str(protein_row.iloc[0].get('Gene_Name', '')),
            "abundances": abundances
        }
    except Exception as e:
        print(f"Error loading protein abundance: {e}")
        return {"protein_id": protein_id, "abundances": []}


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
        PSM abundance data dictionary
    """
    psm_file = results_dir / "PSM_Abundances.tsv"
    
    if not psm_file.exists():
        return {"protein_id": protein_id, "psms": []}
    
    try:
        df = pd.read_csv(psm_file, sep='\t')
        
        # Filter rows for this protein
        protein_rows = df[df['Master_Protein_Accessions'] == protein_id]
        
        if protein_rows.empty:
            return {"protein_id": protein_id, "psms": []}
        
        # Get abundance columns (all columns except metadata)
        metadata_cols = ['PSM_ID', 'Sequence', 'Modifications', 'Charge', 'Master_Protein_Accessions']
        abundance_cols = [col for col in df.columns if col not in metadata_cols]
        
        # Build PSM data
        psms = []
        for _, row in protein_rows.iterrows():
            abundances = []
            for col in abundance_cols:
                value = row.get(col)
                if pd.notna(value):
                    abundances.append({
                        "sample": col,
                        "abundance": float(value)
                    })
            
            psms.append({
                "psm_id": str(row.get('PSM_ID', '')),
                "sequence": str(row.get('Sequence', '')),
                "modifications": str(row.get('Modifications', '')),
                "charge": int(row.get('Charge', 0)) if pd.notna(row.get('Charge')) else 0,
                "abundances": abundances
            })
        
        return {
            "protein_id": protein_id,
            "psms": psms
        }
    except Exception as e:
        print(f"Error loading PSM abundance: {e}")
        return {"protein_id": protein_id, "psms": []}


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
