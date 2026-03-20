"""
Analysis API routes.

Analysis orchestration and control.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import settings
from app.db.session_store import SessionStore
from app.models.session import SessionState

router = APIRouter()


def get_session_store() -> SessionStore:
    """Dependency to get session store."""
    return SessionStore(settings.sessions_dir)


@router.post("/{session_id}/start")
async def start_analysis(
    session_id: str,
    store: SessionStore = Depends(get_session_store)
):
    """Start the analysis pipeline."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    
    # Validate session is ready
    if not session.config:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session configuration required"
        )
    
    if len(session.files.proteomics) < 6:  # At least 3 per condition, 2 conditions
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 6 proteomics files required (3 per condition)"
        )
    
    # Update session state
    session.state = SessionState.PROCESSING
    await store.save(session)
    
    # Start processing in background
    # TODO: Implement background task
    
    return {"message": "Analysis started", "session_id": session_id}


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
