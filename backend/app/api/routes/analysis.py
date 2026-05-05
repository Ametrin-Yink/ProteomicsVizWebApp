"""
Analysis API routes.

Analysis orchestration and control.
"""

from fastapi import APIRouter, Depends, status

from app.api.deps import get_session_store
from app.db.session_store import SessionStore

router = APIRouter()


@router.post("/{session_id}/start")
async def start_analysis(
    session_id: str, store: SessionStore = Depends(get_session_store)
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
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )


# cancel endpoint removed — processing router handles it at the same path
# (processing router is registered first in main.py, so its cancel_processing
#  correctly signals the asyncio.Event to stop the background pipeline task)
