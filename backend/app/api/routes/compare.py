"""
Compare API routes — on-demand protein and comparison correlation analysis.
Follows the same async polling pattern as GSEA routes.
"""

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_session_store
from app.core.config import settings
from app.db.session_store import SessionStore
from app.services.compare_service import (
    _read_status,
    _result_path,
    _write_result,
    _write_status,
    build_fold_change_matrix,
    compute_hierarchical_order,
    compute_protein_similarities,
    compute_similarity_matrix,
    compute_venn_data,
    load_pvalues_for_protein,
    run_cluster,
)
from app.services.task_manager import TaskCancelledError, TaskKind, task_manager

logger = logging.getLogger("proteomics")

router = APIRouter()

# Keep strong references to background tasks to prevent GC
_background_tasks: set[asyncio.Task] = set()


def _schedule_background_task(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


# ── Request/Response models ──


class ProteinCorrelationRequest(BaseModel):
    protein_id: str
    cluster_method: Literal["pca", "umap", "tsne"] = "pca"
    color_comparison: str


class ComparisonCorrelationRequest(BaseModel):
    primary_comparison: str
    selected_comparisons: list[str]
    marked_proteins: dict[str, list[str]]
    cluster_method: Literal["pca", "umap", "tsne"] = "pca"


class VennRequest(BaseModel):
    comparisons: list[str]
    pvalue_threshold: float = 0.05
    logfc_threshold: float = 1.0


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


# ── Background Tasks (sync functions, run via asyncio.to_thread) ──


def _run_protein_correlation(session_id: str, req: ProteinCorrelationRequest):
    """Background task: compute protein correlation analysis."""
    compute_type = "protein-correlation"
    session_dir = str(settings.sessions_dir / session_id)
    try:
        comparisons = _get_comparisons_from_session(session_id)
        matrix, accessions, gene_names = build_fold_change_matrix(
            session_dir, comparisons
        )

        query_idx = None
        for i, acc in enumerate(accessions):
            if req.protein_id in acc or acc in req.protein_id:
                query_idx = i
                break
        if query_idx is None:
            raise ValueError(f"Protein {req.protein_id} not found in any comparison")

        # Selected protein fold changes across comparisons (with real p-values)
        pvals = load_pvalues_for_protein(
            session_dir, comparisons, req.protein_id, accessions
        )
        selected_fc = []
        for j, comp in enumerate(comparisons):
            val = matrix[query_idx, j]
            if not np.isnan(val):
                pv = pvals.get(comp, {})
                selected_fc.append(
                    {
                        "comparison": comp,
                        "log_fc": float(val),
                        "pval": pv.get("pval", 1.0),
                        "adj_pval": pv.get("adj_pval", 1.0),
                    }
                )

        # Protein similarities (Euclidean distance: lower = more similar)
        similar = compute_protein_similarities(
            matrix, accessions, gene_names, comparisons, query_idx
        )

        # Cluster coordinates for all proteins
        coords, variance = run_cluster(matrix, req.cluster_method)
        cluster_coords = [
            {
                "accession": accessions[i],
                "gene_name": gene_names[i],
                "x": float(coords[i, 0]),
                "y": float(coords[i, 1]),
            }
            for i in range(len(accessions))
        ]

        # Build fold-change map for the color-by comparison
        color_comp_idx = (
            comparisons.index(req.color_comparison)
            if req.color_comparison in comparisons
            else 0
        )
        color_fc_map = {
            accessions[i]: float(matrix[i, color_comp_idx])
            if not np.isnan(matrix[i, color_comp_idx])
            else 0.0
            for i in range(len(accessions))
        }

        result = {
            "selected_protein_fc": selected_fc,
            "similar_proteins": similar,
            "cluster_coords": cluster_coords,
            "cluster_var_explained": variance,
            "color_fc_map": color_fc_map,
        }
        current_status = _read_status(session_id, compute_type)
        _write_result(session_id, compute_type, result)
        _write_status(
            session_id,
            compute_type,
            {
                "status": "completed",
                "started_at": current_status.get("started_at"),
                "completed_at": datetime.now(UTC).isoformat(),
            },
        )
    except Exception as e:
        logger.exception(f"Protein correlation compute failed: {e}")
        current_status = _read_status(session_id, compute_type)
        _write_status(
            session_id,
            compute_type,
            {
                "status": "error",
                "error": str(e),
                "started_at": current_status.get("started_at"),
                "completed_at": datetime.now(UTC).isoformat(),
            },
        )


def _run_comparison_correlation(session_id: str, req: ComparisonCorrelationRequest):
    """Background task: compute comparison correlation analysis."""
    compute_type = "comparison-correlation"
    session_dir = str(settings.sessions_dir / session_id)
    try:
        all_comparisons = _get_comparisons_from_session(session_id)
        selected = [c for c in req.selected_comparisons if c in all_comparisons]
        if not selected:
            raise ValueError("No valid selected comparisons found")

        # Build full matrix (proteins x all comparisons)
        matrix, accessions, gene_names = build_fold_change_matrix(
            session_dir, all_comparisons
        )

        # Similarity matrix: Euclidean distance between comparisons (columns)
        sim_matrix = compute_similarity_matrix(matrix.T)
        similarity = {
            "comparisons": all_comparisons,
            "matrix": sim_matrix.tolist(),
        }

        # Heatmap: union all marked proteins across all comparison keys
        marked_set = set()
        for acc_list in req.marked_proteins.values():
            marked_set.update(acc_list)
        # Fall back to proteins significant in at least one selected comparison
        if not marked_set:
            from app.services.compare_service import _load_de_file

            for comp in selected:
                df = _load_de_file(session_dir, comp)
                if df is not None:
                    sig = df[(df["adj_pval"] < 0.05) & (df["log_fc"].abs() >= 1)]
                    marked_set.update(sig["accession"].tolist())
            # If still empty (no DE files), fall back to top 100 by max FC
            if not marked_set:
                sel_indices = [
                    all_comparisons.index(c) for c in selected if c in all_comparisons
                ]
                sel_matrix_for_fallback = matrix[:, sel_indices]
                max_fc = np.nanmax(np.abs(sel_matrix_for_fallback), axis=1)
                top_100 = np.argsort(max_fc)[-100:]
                for i in top_100:
                    if not np.isnan(sel_matrix_for_fallback[i]).all():
                        marked_set.add(accessions[i])

        marked_list = sorted(marked_set)
        acc_to_idx = {acc: i for i, acc in enumerate(accessions)}
        row_indices = [acc_to_idx[acc] for acc in marked_list if acc in acc_to_idx]
        sel_indices = [
            all_comparisons.index(c) for c in selected if c in all_comparisons
        ]
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

        if heatmap_fc.shape[0] > 1:
            row_order = compute_hierarchical_order(heatmap_fc)
            heatmap_fc = heatmap_fc[row_order]
            heatmap_proteins = [heatmap_proteins[i] for i in row_order]

        if heatmap_fc.shape[1] > 1:
            col_order = compute_hierarchical_order(heatmap_fc.T)
            heatmap_fc = heatmap_fc[:, col_order]
            selected_ordered = [selected[i] for i in col_order]
        else:
            selected_ordered = selected

        heatmap_data = {
            "proteins": heatmap_proteins,
            "comparisons": selected_ordered,
            "fold_changes": heatmap_fc.tolist(),
        }

        # Comparison distances to primary (lower = more similar)
        primary_idx = (
            all_comparisons.index(req.primary_comparison)
            if req.primary_comparison in all_comparisons
            else 0
        )
        comp_dists = []
        for j, comp in enumerate(all_comparisons):
            d = (
                float(sim_matrix[primary_idx, j])
                if not np.isnan(sim_matrix[primary_idx, j])
                else float("inf")
            )
            comp_dists.append({"comparison": comp, "similarity": d})
        comp_dists.sort(key=lambda x: x["similarity"])

        # Cluster coords for comparisons
        coords, variance = run_cluster(matrix.T, req.cluster_method)
        cluster_coords = [
            {
                "comparison": all_comparisons[i],
                "x": float(coords[i, 0]),
                "y": float(coords[i, 1]),
            }
            for i in range(len(all_comparisons))
        ]

        result = {
            "similarity_matrix": similarity,
            "heatmap_data": heatmap_data,
            "comparison_similarities": comp_dists,
            "cluster_coords": cluster_coords,
            "cluster_var_explained": variance,
        }
        current_status = _read_status(session_id, compute_type)
        _write_result(session_id, compute_type, result)
        _write_status(
            session_id,
            compute_type,
            {
                "status": "completed",
                "started_at": current_status.get("started_at"),
                "completed_at": datetime.now(UTC).isoformat(),
            },
        )
    except Exception as e:
        logger.exception(f"Comparison correlation compute failed: {e}")
        current_status = _read_status(session_id, compute_type)
        _write_status(
            session_id,
            compute_type,
            {
                "status": "error",
                "error": str(e),
                "started_at": current_status.get("started_at"),
                "completed_at": datetime.now(UTC).isoformat(),
            },
        )


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

    existing = task_manager.has_active_task(session_id, TaskKind.COMPUTE)
    if existing:
        raise HTTPException(status_code=409, detail="Computation already in progress")

    # Write "running" status before spawning so the TaskStatusBar sees it
    # immediately (same pattern as GSEA).  The task function will overwrite
    # this with "completed" or "error" when it finishes.
    _write_status(
        session_id,
        "protein-correlation",
        {
            "status": "running",
            "protein_id": req.protein_id,
            "started_at": datetime.now(UTC).isoformat(),
            "error": None,
        },
    )
    _schedule_background_task(_run_protein_correlation_task(session_id, req))
    return {"status": "running"}


async def _run_protein_correlation_task(
    session_id: str, req: ProteinCorrelationRequest
):
    """Run protein correlation through TaskManager."""
    try:
        await task_manager.submit(
            session_id,
            TaskKind.COMPUTE,
            _run_protein_correlation,
            session_id,
            req,
            label=f"Protein: {req.protein_id}",
            timeout_seconds=10 * 60,
        )
    except TaskCancelledError:
        logger.info(f"Protein correlation cancelled for {session_id}")
    except Exception:
        logger.exception("Protein correlation failed")


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
        raise HTTPException(
            status_code=404, detail="No results found — run protein correlation first"
        )
    with open(rp) as f:
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

    existing = task_manager.has_active_task(session_id, TaskKind.COMPUTE)
    if existing:
        raise HTTPException(status_code=409, detail="Computation already in progress")

    # Write "running" status before spawning so the TaskStatusBar sees it
    # immediately (same pattern as GSEA).  The task function will overwrite
    # this with "completed" or "error" when it finishes.
    _write_status(
        session_id,
        "comparison-correlation",
        {
            "status": "running",
            "primary_comparison": req.primary_comparison,
            "started_at": datetime.now(UTC).isoformat(),
            "error": None,
        },
    )
    _schedule_background_task(_run_comparison_correlation_task(session_id, req))
    return {"status": "running"}


async def _run_comparison_correlation_task(
    session_id: str, req: ComparisonCorrelationRequest
):
    try:
        await task_manager.submit(
            session_id,
            TaskKind.COMPUTE,
            _run_comparison_correlation,
            session_id,
            req,
            label=f"Compare: {req.primary_comparison}",
            timeout_seconds=10 * 60,
        )
    except TaskCancelledError:
        logger.info(f"Comparison correlation cancelled for {session_id}")
    except Exception:
        logger.exception("Comparison correlation failed")


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
        raise HTTPException(
            status_code=404,
            detail="No results found — run comparison correlation first",
        )
    with open(rp) as f:
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
    if not comparisons:
        return []

    def _load():
        session_dir = str(settings.sessions_dir / session_id)
        _matrix, accessions, gene_names = build_fold_change_matrix(
            session_dir, comparisons
        )
        return [
            {"accession": acc, "gene_name": gn}
            for acc, gn in zip(accessions, gene_names, strict=False)
        ]

    return await asyncio.to_thread(_load)


# ── Venn Diagram Endpoints ──


@router.post("/{session_id}/compare/venn")
async def trigger_venn(
    session_id: str,
    req: VennRequest,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if len(req.comparisons) < 2 or len(req.comparisons) > 3:
        raise HTTPException(status_code=400, detail="Venn requires 2 or 3 comparisons")
    session_dir = str(settings.sessions_dir / session_id)

    result = await task_manager.submit(
        session_id,
        TaskKind.COMPUTE,
        compute_venn_data,
        session_dir,
        req.comparisons,
        req.pvalue_threshold,
        req.logfc_threshold,
        label=f"Venn: {'+'.join(req.comparisons)}",
        timeout_seconds=5 * 60,
    )
    return result
