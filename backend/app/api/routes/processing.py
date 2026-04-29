"""
Processing API routes.

Processing status and control endpoints.
"""

import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Request

from app.core.config import settings, MIN_PROTEOMICS_FILES
from app.core.exceptions import ProcessingError
from app.db.session_store import SessionStore
from app.models.session import ProcessingStatus, SessionState, Session
from app.models.analysis import AnalysisConfig, Organism
from app.services.processing_orchestrator import ProcessingOrchestrator
from app.services.session_manager import session_manager

router = APIRouter()
logger = logging.getLogger("proteomics")

# Concurrency limit: max 1 concurrent processing session
_processing_semaphore = asyncio.Semaphore(1)

# Track sessions currently waiting in queue
_queued_sessions: list[str] = []  # Ordered list of session_ids

# Track sessions actively running inside the semaphore
_processing_sessions: set[str] = set()


def get_session_store() -> SessionStore:
    """Dependency to get session store."""
    return SessionStore(settings.sessions_dir)


@router.get("/{session_id}/status")
async def get_processing_status(
    session_id: str,
    store: SessionStore = Depends(get_session_store)
) -> ProcessingStatus:
    """Get detailed processing status."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )

    # Return default status based on session state
    queue_position = None
    if session_id in _queued_sessions:
        queue_position = _queued_sessions.index(session_id) + 1

    return ProcessingStatus(
        state=session.state,
        progress=0,
        steps=[],
        queue_position=queue_position,
        queue_length=len(_queued_sessions),
    )


@router.get("/{session_id}/logs")
async def get_processing_logs(
    session_id: str,
    store: SessionStore = Depends(get_session_store)
):
    """Get processing logs and pipeline state for a session.

    Returns historical logs, completed steps, and completion status.
    Used by frontend when connecting to an already-running or completed session.
    """
    try:
        session = await store.get(session_id)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session {session_id} not found"
            )

        # Load pipeline state
        pipeline_state = await store.load_pipeline_state(session_id)

        if not pipeline_state:
            return {
                "logs": [],
                "completed_steps": [],
                "current_step": 0,
                "is_complete": False,
                "outputs": None
            }

        return {
            "logs": pipeline_state.get("logs", []),
            "completed_steps": pipeline_state.get("completed_steps", []),
            "current_step": pipeline_state.get("current_step", 0),
            "is_complete": pipeline_state.get("completed_at") is not None,
            "outputs": pipeline_state.get("outputs")
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting processing logs for {session_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load processing logs: {str(e)}"
        )


@router.post("/{session_id}/retry")
async def retry_processing(
    session_id: str,
    store: SessionStore = Depends(get_session_store)
):
    """Retry failed processing."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    
    if session.state != SessionState.ERROR:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only retry failed sessions"
        )
    
    # Reset state and retry
    session.state = SessionState.PROCESSING
    session.error_message = None
    await store.save(session)

    # Start processing in background using asyncio.create_task
    asyncio.create_task(run_processing_pipeline_async(session_id, session))

    return {
        "message": "Processing retry initiated",
        "session_id": session_id,
        "websocket_url": f"ws://localhost:8000/ws/sessions/{session_id}"
    }


@router.post("/{session_id}/process")
async def start_processing(
    session_id: str,
    store: SessionStore = Depends(get_session_store)
):
    """Start the processing pipeline for a session.

    Args:
        session_id: Session ID
        background_tasks: FastAPI background tasks
        store: Session store dependency

    Returns:
        202 Accepted with WebSocket URL

    Raises:
        HTTPException: 404 if session not found, 400 if validation fails, 409 if already processing
    """
    logger.info(f"Starting processing for session {session_id}")

    # Get session
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )

    # Check if already processing
    if session.state == SessionState.PROCESSING:
        # Check for stale processing state (pipeline started but no recent activity)
        pipeline_state = await store.load_pipeline_state(session_id)
        is_stale = False
        if pipeline_state:
            started_at = pipeline_state.get("started_at")
            if started_at:
                try:
                    from datetime import datetime, timezone, timedelta
                    started_time = datetime.fromisoformat(started_at)
                    if started_time.tzinfo is None:
                        started_time = started_time.replace(tzinfo=timezone.utc)
                    elapsed = datetime.now(timezone.utc) - started_time
                    # If processing started more than 6 hours ago with no completion, consider it stale
                    if elapsed > timedelta(hours=6) and not pipeline_state.get("completed_at"):
                        is_stale = True
                        logger.warning(
                            f"Stale processing state detected for {session_id}: "
                            f"started {elapsed.total_seconds()/3600:.1f}h ago, resetting"
                        )
                except (ValueError, TypeError) as e:
                    logger.warning(f"Failed to parse pipeline started_at for {session_id}: {e}")
                    is_stale = True

        if is_stale:
            # Reset stale processing state and allow re-processing
            session.state = SessionState.CREATED
            await store.save(session)
        else:
            # Add to queue instead of rejecting
            session.state = SessionState.QUEUED
            await store.save(session)
            _queued_sessions.append(session_id)
            queue_position = len(_queued_sessions)
            logger.info(f"Session {session_id} queued at position {queue_position}")

            # Create background task that will wait for semaphore
            asyncio.create_task(run_processing_pipeline_async(session_id, session))

            return {
                "data": {
                    "status": "queued",
                    "queue_position": queue_position,
                    "websocket_url": f"ws://localhost:8000/ws/sessions/{session_id}"
                }
            }

    # Check if ANY other session is currently processing
    if _processing_sessions:
        # Fast path: in-memory tracking shows active processing
        any_processing = True
        logger.info(f"Session {session_id}: _processing_sessions is non-empty, queuing")
    else:
        # Fallback: check session store for any processing sessions
        all_sessions = await store.list_all()
        logger.info(f"Session {session_id}: checking {len(all_sessions)} sessions for processing state")
        any_processing = any(
            s.state == SessionState.PROCESSING and s.id != session_id
            for s in all_sessions
        )
        logger.info(f"Session {session_id}: any_processing={any_processing}")

    if any_processing:
        session.state = SessionState.QUEUED
        await store.save(session)
        _queued_sessions.append(session_id)
        queue_position = len(_queued_sessions)
        logger.info(f"Session {session_id} queued at position {queue_position} (another session processing)")

        # Create background task that will wait for semaphore
        asyncio.create_task(run_processing_pipeline_async(session_id, session))

        return {
            "data": {
                "status": "queued",
                "queue_position": queue_position,
                "websocket_url": f"ws://localhost:8000/ws/sessions/{session_id}"
            }
        }

    # Validate session has configuration
    if not session.config:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session configuration required. Please configure treatment, control, and organism."
        )

    # Validate session has files
    if not session.files or not session.files.proteomics:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No proteomics files uploaded. Please upload at least 6 PSM files."
        )

    # Validate minimum file count (at least 3 per condition, 2 conditions = 6 minimum)
    if len(session.files.proteomics) < MIN_PROTEOMICS_FILES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"At least 6 proteomics files required (3 per condition). Current: {len(session.files.proteomics)}"
        )

    # Update session state to processing
    session.state = SessionState.PROCESSING
    session.error_message = None
    await store.save(session)

    # Start processing in background using asyncio.create_task
    # This properly schedules the async function to run
    asyncio.create_task(run_processing_pipeline_async(session_id, session))

    logger.info(f"Processing started for session {session_id} (async task created)")

    return {
        "data": {
            "status": "started",
            "websocket_url": f"ws://localhost:8000/ws/sessions/{session_id}"
        }
    }


async def run_processing_pipeline_async(session_id: str, session: Session):
    """Run the processing pipeline (async version).

    Args:
        session_id: Session ID
        session: Session object with config
    """
    import traceback

    logger.info(f"BACKGROUND TASK STARTED for session {session_id}")

    # Don't wait for WebSocket - start processing immediately
    # WebSocket will reconnect and receive updates
    logger.info(f"Starting processing for session {session_id} (WebSocket will reconnect if needed)")

    try:
        # If session was queued, log it
        if session.state == SessionState.QUEUED:
            logger.info(f"Session {session_id} is queued, waiting for semaphore...")

        # Acquire semaphore (blocks until it's this session's turn)
        async with _processing_semaphore:
            _processing_sessions.add(session_id)
            logger.info(f"Session {session_id} acquired semaphore, starting processing")

            # Update state to processing
            session = await session_manager.get_session(session_id)
            session.state = SessionState.PROCESSING
            await session_manager.update_session_state(session_id, SessionState.PROCESSING)

            # Remove from queue tracking
            if session_id in _queued_sessions:
                _queued_sessions.remove(session_id)

            # Convert session config to AnalysisConfig
            config = AnalysisConfig(
                treatment=session.config.treatment,
                control=session.config.control,
                organism=Organism(session.config.organism),
                remove_razor=session.config.remove_razor,
                strict_filtering=session.config.strict_filtering,
            )
            logger.info(f"Config created: treatment={config.treatment}, control={config.control}")

            # Create WebSocket callback for progress updates
            async def websocket_callback(progress):
                """Send progress update via WebSocket."""
                try:
                    logger.info(f"WebSocket callback: step {progress.step}, status {progress.status}")
                    await session_manager.send_progress_update(session_id, progress.model_dump())
                    logger.info(f"WebSocket callback: sent successfully")
                except Exception as e:
                    logger.warning(f"Failed to send WebSocket progress update: {e}", exc_info=True)

            # Run the processing pipeline
            logger.info(f"Calling process_session for {session_id}")
            orchestrator = ProcessingOrchestrator(session_id=session_id)
            result = await orchestrator.process_session(
                config=config,
                websocket_callback=websocket_callback
            )

            logger.info(
                f"Processing completed for session {session_id}",
                extra={
                    "session_id": session_id,
                    "total_psms": result.total_psms,
                    "total_proteins": result.total_proteins,
                    "significant_proteins": result.significant_proteins,
                }
            )

            # Send completion message via WebSocket
            try:
                await session_manager.send_complete_message(
                    session_id=session_id,
                    outputs={
                        "psm_abundances": result.psm_abundances_path,
                        "protein_abundances": result.protein_abundances_path,
                        "diff_expression": result.diff_expression_path,
                        "qc_results": result.qc_results_path,
                        "gsea_results": result.gsea_results_path,
                    },
                    duration=result.processing_time_seconds or 0
                )
                logger.info(f"Sent completion message to session {session_id}")
            except Exception as e:
                logger.warning(f"Failed to send completion message: {e}")

    except ProcessingError as e:
        logger.error(
            f"Processing failed for session {session_id}: {e.message}",
            extra={"session_id": session_id, "error": e.message, "step": e.step, "traceback": traceback.format_exc()}
        )
        # Session state already updated by orchestrator
    except Exception as e:
        logger.error(
            f"Unexpected error during processing for session {session_id}: {str(e)}",
            extra={"session_id": session_id, "error": str(e), "traceback": traceback.format_exc()}
        )
        # Update session state to error
        await session_manager.update_session_state(
            session_id, SessionState.ERROR, str(e)
        )
    finally:
        _processing_sessions.discard(session_id)


@router.post("/{session_id}/cancel")
async def cancel_processing(
    session_id: str,
    store: SessionStore = Depends(get_session_store)
):
    """Cancel processing or remove session from queue."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )

    # Handle queued sessions
    if session.state == SessionState.QUEUED:
        if session_id in _queued_sessions:
            _queued_sessions.remove(session_id)
        session.state = SessionState.CANCELLED
        await store.save(session)
        return {"data": {"status": "cancelled"}}

    if session.state not in (SessionState.PROCESSING, SessionState.QUEUED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only cancel sessions that are processing or queued"
        )

    # Cancel processing
    _processing_sessions.discard(session_id)
    session.state = SessionState.CANCELLED
    await store.save(session)
    return {"data": {"status": "cancelled"}}
