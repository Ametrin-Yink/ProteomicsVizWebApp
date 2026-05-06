"""
Compare API routes — on-demand protein and comparison correlation analysis.
Follows the same async polling pattern as GSEA routes.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_session_store
from app.core.config import settings
from app.db.session_store import SessionStore
from app.services.compare_service import (
    build_fold_change_matrix,
    compute_protein_correlations,
    compute_correlation_matrix,
    compute_venn_data,
    run_cluster,
    _load_pvalues_for_protein,
)

logger = logging.getLogger("proteomics")

router = APIRouter()


# ── Request/Response models ──

class ProteinCorrelationRequest(BaseModel):
    protein_id: str
    correlation_method: str = "pearson"
    cluster_method: str = "pca"
    color_comparison: str


class ComparisonCorrelationRequest(BaseModel):
    primary_comparison: str
    selected_comparisons: list[str]
    marked_proteins: dict[str, list[str]]
    correlation_method: str = "pearson"
    cluster_method: str = "pca"


class VennRequest(BaseModel):
    comparisons: list[str]
    pvalue_threshold: float = 0.05
    logfc_threshold: float = 1.0


class RunStatusResponse(BaseModel):
    status: str
    error: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


# ── Helpers ──

def _status_path(session_id: str, compute_type: str) -> Path:
    return settings.sessions_dir / session_id / "results" / "compare" / f"{compute_type}_status.json"


def _result_path(session_id: str, compute_type: str) -> Path:
    return settings.sessions_dir / session_id / "results" / "compare" / f"{compute_type}_result.json"


def _read_status(session_id: str, compute_type: str) -> dict:
    sp = _status_path(session_id, compute_type)
    if not sp.exists():
        return {"status": "idle"}
    with open(sp, "r") as f:
        return json.load(f)


def _write_status(session_id: str, compute_type: str, data: dict):
    sp = _status_path(session_id, compute_type)
    sp.parent.mkdir(parents=True, exist_ok=True)
    with open(sp, "w") as f:
        json.dump(data, f)


def _write_result(session_id: str, compute_type: str, data: dict):
    rp = _result_path(session_id, compute_type)
    rp.parent.mkdir(parents=True, exist_ok=True)
    with open(rp, "w") as f:
        json.dump(data, f, default=str)


def _get_comparisons_from_session(session_id: str) -> list[str]:
    """Discover all comparisons from DE result files in the session."""
    results_dir = settings.sessions_dir / session_id / "results"
    comparisons = []
    if results_dir.exists():
        for f in sorted(results_dir.glob("Diff_Expression_*.tsv")):
            stem = f.stem
            comp = stem.replace("Diff_Expression_", "")
            if comp:
                comparisons.append(comp)
    if not comparisons and (results_dir / "Diff_Expression.tsv").exists():
        comparisons = ["treatment_vs_control"]
    return comparisons


async def _run_protein_correlation(session_id: str, req: ProteinCorrelationRequest):
    """Background task: compute protein correlation analysis."""
    compute_type = "protein-correlation"
    session_dir = str(settings.sessions_dir / session_id)
    try:
        _write_status(session_id, compute_type, {"status": "running"})

        comparisons = _get_comparisons_from_session(session_id)
        matrix, accessions, gene_names = build_fold_change_matrix(session_dir, comparisons)

        query_idx = None
        for i, acc in enumerate(accessions):
            if req.protein_id in acc or acc in req.protein_id:
                query_idx = i
                break
        if query_idx is None:
            raise ValueError(f"Protein {req.protein_id} not found in any comparison")

        # Selected protein fold changes across comparisons (with real p-values)
        pvals = _load_pvalues_for_protein(
            session_dir, comparisons, req.protein_id, accessions
        )
        selected_fc = []
        for j, comp in enumerate(comparisons):
            val = matrix[query_idx, j]
            if not np.isnan(val):
                pv = pvals.get(comp, {})
                selected_fc.append({
                    "comparison": comp,
                    "log_fc": float(val),
                    "pval": pv.get("pval", 1.0),
                    "adj_pval": pv.get("adj_pval", 1.0),
                })

        # Correlated proteins
        correlated = compute_protein_correlations(
            matrix, accessions, gene_names, query_idx, req.correlation_method
        )

        # Cluster coordinates for all proteins
        coords, var = run_cluster(matrix, req.cluster_method)
        cluster_coords = [
            {"accession": accessions[i], "gene_name": gene_names[i],
             "x": float(coords[i, 0]), "y": float(coords[i, 1])}
            for i in range(len(accessions))
        ]

        result = {
            "selected_protein_fc": selected_fc,
            "correlated_proteins": correlated,
            "cluster_coords": cluster_coords,
            "cluster_var_explained": var,
        }
        _write_result(session_id, compute_type, result)
        _write_status(session_id, compute_type, {"status": "completed"})
    except Exception as e:
        logger.exception(f"Protein correlation compute failed: {e}")
        _write_status(session_id, compute_type, {"status": "error", "error": str(e)})


async def _run_comparison_correlation(session_id: str, req: ComparisonCorrelationRequest):
    """Background task: compute comparison correlation analysis."""
    compute_type = "comparison-correlation"
    session_dir = str(settings.sessions_dir / session_id)
    try:
        _write_status(session_id, compute_type, {"status": "running"})

        all_comparisons = _get_comparisons_from_session(session_id)
        selected = [c for c in req.selected_comparisons if c in all_comparisons]
        if not selected:
            raise ValueError("No valid selected comparisons found")

        # Build full matrix (proteins x all comparisons)
        matrix, accessions, gene_names = build_fold_change_matrix(session_dir, all_comparisons)

        # Similarity matrix: correlation between all comparisons (transpose)
        sim_matrix = compute_correlation_matrix(matrix.T, req.correlation_method)
        similarity = {
            "comparisons": all_comparisons,
            "matrix": sim_matrix.tolist(),
        }

        # Heatmap: filter by marked proteins then selected comparisons
        marked_set = set()
        for comp in selected:
            if comp in req.marked_proteins:
                marked_set.update(req.marked_proteins[comp])
        # Fall back to top 100 by max absolute FC if no marks
        if not marked_set:
            sel_indices = [all_comparisons.index(c) for c in selected if c in all_comparisons]
            sel_matrix_for_fallback = matrix[:, sel_indices]
            max_fc = np.nanmax(np.abs(sel_matrix_for_fallback), axis=1)
            top_100 = np.argsort(max_fc)[-100:]
            for i in top_100:
                if not np.isnan(sel_matrix_for_fallback[i]).all():
                    marked_set.add(accessions[i])

        marked_list = sorted(marked_set)
        row_indices = [accessions.index(acc) for acc in marked_list if acc in set(accessions)]
        sel_indices = [all_comparisons.index(c) for c in selected if c in all_comparisons]
        heatmap_fc = matrix[np.array(row_indices)][:, sel_indices]
        heatmap_proteins = [
            {"accession": accessions[i], "gene_name": gene_names[i]}
            for i in row_indices
        ]
        # Truncate to top 500
        if len(heatmap_proteins) > 500:
            max_fc = np.nanmax(np.abs(heatmap_fc), axis=1)
            top_idx = np.argsort(max_fc)[-500:]
            heatmap_fc = heatmap_fc[top_idx]
            heatmap_proteins = [heatmap_proteins[i] for i in top_idx]

        heatmap_data = {
            "proteins": heatmap_proteins,
            "comparisons": selected,
            "fold_changes": heatmap_fc.tolist(),
        }

        # Comparison correlations to primary
        primary_idx = all_comparisons.index(req.primary_comparison) if req.primary_comparison in all_comparisons else 0
        comp_corrs = []
        for j, comp in enumerate(all_comparisons):
            if j == primary_idx:
                comp_corrs.append({"comparison": comp, "correlation": 1.0})
            else:
                comp_corrs.append({"comparison": comp, "correlation": float(sim_matrix[primary_idx, j])})
        comp_corrs.sort(key=lambda x: x["correlation"], reverse=True)

        # Cluster coords for comparisons
        coords, _ = run_cluster(matrix.T, req.cluster_method)
        cluster_coords = [
            {"comparison": all_comparisons[i],
             "x": float(coords[i, 0]), "y": float(coords[i, 1])}
            for i in range(len(all_comparisons))
        ]

        result = {
            "similarity_matrix": similarity,
            "heatmap_data": heatmap_data,
            "comparison_correlations": comp_corrs,
            "cluster_coords": cluster_coords,
        }
        _write_result(session_id, compute_type, result)
        _write_status(session_id, compute_type, {"status": "completed"})
    except Exception as e:
        logger.exception(f"Comparison correlation compute failed: {e}")
        _write_status(session_id, compute_type, {"status": "error", "error": str(e)})


# ── Protein Correlation Endpoints ──

@router.post("/{session_id}/compare/protein-correlation")
async def trigger_protein_correlation(
    session_id: str,
    req: ProteinCorrelationRequest,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    asyncio.create_task(_run_protein_correlation(session_id, req))
    return {"status": "running"}


@router.get("/{session_id}/compare/protein-correlation/status")
async def get_protein_correlation_status(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return _read_status(session_id, "protein-correlation")


@router.get("/{session_id}/compare/protein-correlation")
async def get_protein_correlation_data(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    rp = _result_path(session_id, "protein-correlation")
    if not rp.exists():
        raise HTTPException(status_code=404, detail="No results found — run protein correlation first")
    with open(rp, "r") as f:
        return json.load(f)


# ── Comparison Correlation Endpoints ──

@router.post("/{session_id}/compare/comparison-correlation")
async def trigger_comparison_correlation(
    session_id: str,
    req: ComparisonCorrelationRequest,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    asyncio.create_task(_run_comparison_correlation(session_id, req))
    return {"status": "running"}


@router.get("/{session_id}/compare/comparison-correlation/status")
async def get_comparison_correlation_status(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return _read_status(session_id, "comparison-correlation")


@router.get("/{session_id}/compare/comparison-correlation")
async def get_comparison_correlation_data(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    rp = _result_path(session_id, "comparison-correlation")
    if not rp.exists():
        raise HTTPException(status_code=404, detail="No results found — run comparison correlation first")
    with open(rp, "r") as f:
        return json.load(f)


# ── Protein List Endpoint ──

@router.get("/{session_id}/compare/proteins")
async def list_proteins(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """List all proteins across all comparisons for dropdown selectors."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    comparisons = _get_comparisons_from_session(session_id)
    session_dir = str(settings.sessions_dir / session_id)
    matrix, accessions, gene_names = build_fold_change_matrix(session_dir, comparisons)
    return [
        {"accession": acc, "gene_name": gn}
        for acc, gn in zip(accessions, gene_names)
    ]


# ── Venn Diagram Endpoints ──

@router.post("/{session_id}/compare/venn")
async def trigger_venn(
    session_id: str,
    req: VennRequest,
    store: SessionStore = Depends(get_session_store),
):
    """Compute Venn diagram data for 2-3 comparisons (synchronous, fast)."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if len(req.comparisons) < 2 or len(req.comparisons) > 3:
        raise HTTPException(status_code=400, detail="Venn requires 2 or 3 comparisons")
    session_dir = str(settings.sessions_dir / session_id)
    result = await asyncio.to_thread(
        compute_venn_data,
        session_dir,
        req.comparisons,
        req.pvalue_threshold,
        req.logfc_threshold,
    )
    return result
