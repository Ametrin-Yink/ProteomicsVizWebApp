"""
Analysis API routes.

Analysis orchestration and control.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_session_store
from app.core.config import settings, MIN_PROTEOMICS_FILES
from app.db.session_store import SessionStore
from app.models.session import SessionState

router = APIRouter()


@router.post("/{session_id}/start")
async def start_analysis(
    session_id: str,
    store: SessionStore = Depends(get_session_store)
):
    """Start the analysis pipeline.

    Deprecated: use POST /{session_id}/process from the processing router instead.
    This endpoint now redirects to the processing endpoint to avoid setting
    PROCESSING state without actually starting anything.
    """
    from fastapi.responses import RedirectResponse

    # Redirect to the actual processing endpoint
    return RedirectResponse(
        url=f"/api/sessions/{session_id}/process",
        status_code=status.HTTP_307_TEMPORARY_REDIRECT
    )


@router.post("/{session_id}/cancel")
async def cancel_analysis(
    session_id: str,
    store: SessionStore = Depends(get_session_store)
):
    """Cancel the running analysis."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    
    # Update session state to cancelled
    session.state = SessionState.CANCELLED
    await store.save(session)
    
    return {"message": "Analysis cancelled", "session_id": session_id}
