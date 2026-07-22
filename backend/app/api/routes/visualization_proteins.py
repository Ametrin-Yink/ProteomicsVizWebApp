"""Protein and peptide abundance visualization routes."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_session_store
from app.api.routes.visualization_shared import (
    create_response,
)
from app.core.config import settings
from app.db.session_store import SessionStore
from app.services.abundance_repository import AbundanceRepository

router = APIRouter()


@router.get("/{session_id}/protein/{protein_id}/abundance")
async def get_protein_abundance(
    session_id: str,
    protein_id: str,
    comparison: str = Query("", description="Comparison name to filter samples"),
    layer: str = Query("protein", description="Processed result layer"),
    point_budget: int = Query(100_000, ge=0, le=500_000),
    store: SessionStore = Depends(get_session_store),
):
    """Get protein abundance data, optionally filtered by comparison."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    results_dir = settings.sessions_dir / session_id / "results"
    try:
        repository = AbundanceRepository(results_dir)
        selected_comparison = comparison or await asyncio.to_thread(
            repository.first_comparison_id
        )
        abundance_data = await asyncio.to_thread(
            repository.get_summary,
            entity="protein",
            protein_accession=protein_id,
            comparison_id=selected_comparison,
            result_layer=layer,
            point_budget=point_budget,
        )
    except ValueError as error:
        detail = str(error)
        code = (
            status.HTTP_409_CONFLICT
            if "reprocessing" in detail.lower()
            else status.HTTP_404_NOT_FOUND
        )
        raise HTTPException(status_code=code, detail=detail) from error

    return create_response(abundance_data)


@router.get("/{session_id}/protein/{protein_id}/peptide")
async def get_protein_peptide(
    session_id: str,
    protein_id: str,
    comparison: str = Query("", description="Comparison name to filter samples"),
    layer: str = Query("protein", description="Processed result layer"),
    point_budget: int = Query(100_000, ge=0, le=500_000),
    store: SessionStore = Depends(get_session_store),
):
    """Get peptide abundance data for a protein, optionally filtered by comparison."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    results_dir = settings.sessions_dir / session_id / "results"
    try:
        repository = AbundanceRepository(results_dir)
        selected_comparison = comparison or await asyncio.to_thread(
            repository.first_comparison_id
        )
        peptide_data = await asyncio.to_thread(
            repository.get_summary,
            entity="peptide",
            protein_accession=protein_id,
            comparison_id=selected_comparison,
            result_layer=layer,
            point_budget=point_budget,
        )
    except ValueError as error:
        detail = str(error)
        code = (
            status.HTTP_409_CONFLICT
            if "reprocessing" in detail.lower()
            else status.HTTP_404_NOT_FOUND
        )
        raise HTTPException(status_code=code, detail=detail) from error

    return create_response(peptide_data)


@router.get("/{session_id}/protein/{protein_id}/abundance/detail")
async def get_protein_abundance_detail(
    session_id: str,
    protein_id: str,
    comparison: str = Query(...),
    layer: str = Query("protein"),
    cursor: str | None = Query(None),
    limit: int = Query(1000, ge=1, le=10_000),
    store: SessionStore = Depends(get_session_store),
):
    """Return a bounded page of processed protein/sample observations."""
    if not await store.get(session_id):
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    try:
        repository = AbundanceRepository(settings.sessions_dir / session_id / "results")
        data = await asyncio.to_thread(
            repository.get_detail,
            entity="protein",
            protein_accession=protein_id,
            comparison_id=comparison,
            result_layer=layer,
            cursor=cursor,
            limit=limit,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return create_response(data)


@router.get("/{session_id}/protein/{protein_id}/peptide/detail")
async def get_protein_peptide_detail(
    session_id: str,
    protein_id: str,
    comparison: str = Query(...),
    layer: str = Query("protein"),
    cursor: str | None = Query(None),
    limit: int = Query(1000, ge=1, le=10_000),
    store: SessionStore = Depends(get_session_store),
):
    """Return a bounded page of processed peptide/sample observations."""
    if not await store.get(session_id):
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    try:
        repository = AbundanceRepository(settings.sessions_dir / session_id / "results")
        data = await asyncio.to_thread(
            repository.get_detail,
            entity="peptide",
            protein_accession=protein_id,
            comparison_id=comparison,
            result_layer=layer,
            cursor=cursor,
            limit=limit,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return create_response(data)
