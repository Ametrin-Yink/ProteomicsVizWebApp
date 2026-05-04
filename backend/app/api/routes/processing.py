"""
Processing API routes.

Processing status and control endpoints.
"""

import asyncio
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_session_store
from app.core.config import MIN_PROTEOMICS_FILES
from app.core.exceptions import ProcessingError
from app.db.session_store import SessionStore
from app.models.session import ProcessingStatus, SessionState, Session
from app.models.analysis import AnalysisConfig, AnalysisTemplate, Organism
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

# Cancellation events for active processing sessions
_cancel_events: dict[str, asyncio.Event] = {}

# Store background task references to prevent GC
_background_tasks: set[asyncio.Task] = set()


def _schedule_background_task(coro) -> asyncio.Task:
    """Schedule a background task and store reference to prevent GC."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


def _is_session_stale(started_at: str, max_age_hours: int = 6) -> bool:
    """Check if a session's processing has exceeded the max age threshold."""
    try:
        started = datetime.fromisoformat(started_at)
        elapsed = datetime.now(timezone.utc) - started
        return elapsed.total_seconds() > max_age_hours * 3600
    except (ValueError, TypeError):
        return False


def _add_to_queue(session_id: str) -> int:
    """Add session to queue, deduplicating first. Returns queue position (1-indexed)."""
    try:
        _queued_sessions.remove(session_id)
    except ValueError:
        pass
    _queued_sessions.append(session_id)
    return len(_queued_sessions)


async def _is_any_session_processing(
    store: SessionStore, exclude_session_id: str, current_session_id: str
) -> bool:
    """Check if any other session is actively processing (with 6-hour stale timeout).

    Args:
        store: Session store instance
        exclude_session_id: Session ID to exclude (the one trying to start)
        current_session_id: Used for logging context

    Returns:
        True if another session is actively processing
    """
    if _processing_sessions:
        logger.info(
            f"Session {current_session_id}: _processing_sessions is non-empty, queuing"
        )
        return True

    # Fallback: check session store for any processing sessions
    all_sessions = await store.list_all()
    logger.info(
        f"Session {current_session_id}: checking {len(all_sessions)} sessions for processing state"
    )
    for s in all_sessions:
        if s.state == SessionState.PROCESSING and s.id != exclude_session_id:
            is_stale = False
            pipeline_state = await store.load_pipeline_state(s.id)
            if pipeline_state:
                started_at = pipeline_state.get("started_at")
                if started_at:
                    if _is_session_stale(started_at):
                        is_stale = True
                        started_time = datetime.fromisoformat(started_at)
                        if started_time.tzinfo is None:
                            started_time = started_time.replace(tzinfo=timezone.utc)
                        elapsed = datetime.now(timezone.utc) - started_time
                        logger.warning(
                            f"Stale processing state for session {s.id}: "
                            f"started {elapsed.total_seconds() / 3600:.1f}h ago, ignoring"
                        )
            if not is_stale:
                logger.info(f"Session {s.id} is actively processing")
                return True
    logger.info(f"Session {current_session_id}: any_processing=False")
    return False


@router.get("/{session_id}/status")
async def get_processing_status(
    session_id: str, store: SessionStore = Depends(get_session_store)
) -> ProcessingStatus:
    """Get detailed processing status."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Return default status based on session state
    queue_position = None
    if session_id in _queued_sessions:
        try:
            queue_position = _queued_sessions.index(session_id) + 1
        except ValueError:
            pass  # Session was removed between check and index

    return ProcessingStatus(
        state=session.state,
        progress=0,
        steps=[],
        queue_position=queue_position,
        queue_length=len(_queued_sessions),
    )


@router.get("/{session_id}/logs")
async def get_processing_logs(
    session_id: str, store: SessionStore = Depends(get_session_store)
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
                detail=f"Session {session_id} not found",
            )

        # Load pipeline state
        pipeline_state = await store.load_pipeline_state(session_id)

        if not pipeline_state:
            return {
                "logs": [],
                "completed_steps": [],
                "current_step": 0,
                "is_complete": False,
                "outputs": None,
            }

        return {
            "logs": pipeline_state.get("logs", []),
            "completed_steps": pipeline_state.get("completed_steps", []),
            "current_step": pipeline_state.get("current_step", 0),
            "is_complete": pipeline_state.get("completed_at") is not None,
            "outputs": pipeline_state.get("outputs"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting processing logs for {session_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load processing logs: {str(e)}",
        )


@router.post("/{session_id}/retry")
async def retry_processing(
    session_id: str, store: SessionStore = Depends(get_session_store)
):
    """Retry failed processing. Routes through the same semaphore/queue logic as start_processing."""
    # Delegate to start_processing — it already handles the case where session.state is ERROR
    # (the session will pass the PROCESSING-state stale check and proceed to normal validation)
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    if session.state != SessionState.ERROR:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only retry failed sessions",
        )

    # Validate session still has configuration and files
    if not session.config:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session configuration is missing. Cannot retry without a valid config.",
        )

    if not session.files or not session.files.proteomics:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No proteomics files found. Cannot retry without uploaded files.",
        )

    if len(session.files.proteomics) < MIN_PROTEOMICS_FILES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"At least {MIN_PROTEOMICS_FILES} proteomics files required. Current: {len(session.files.proteomics)}",
        )

    # Reset to PROCESSING state and clear error — start_processing will handle queue/semaphore
    session.state = SessionState.PROCESSING
    session.error_message = None
    await store.save(session)

    # Create cancellation event
    _cancel_events[session_id] = asyncio.Event()

    # Reuse the same queue/semaphore decision as start_processing
    any_processing = await _is_any_session_processing(store, session_id, session_id)

    if any_processing:
        session.state = SessionState.QUEUED
        await store.save(session)
        queue_position = _add_to_queue(session_id)
        logger.info(f"Retry: Session {session_id} queued at position {queue_position}")
        _schedule_background_task(run_processing_pipeline_async(session_id, session))
        return {"data": {"status": "queued", "queue_position": queue_position}}

    session.state = SessionState.PROCESSING
    await store.save(session)
    _schedule_background_task(run_processing_pipeline_async(session_id, session))
    logger.info(f"Retry: Processing started for session {session_id}")
    return {"data": {"status": "started"}}


@router.post("/{session_id}/process")
async def start_processing(
    session_id: str, store: SessionStore = Depends(get_session_store)
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
            detail=f"Session {session_id} not found",
        )

    # Check if already processing
    if session.state == SessionState.PROCESSING:
        # Check for stale processing state (pipeline started but no recent activity)
        pipeline_state = await store.load_pipeline_state(session_id)
        is_stale = False
        if pipeline_state:
            started_at = pipeline_state.get("started_at")
            if started_at:
                parse_failed = False
                if _is_session_stale(started_at):
                    is_stale = True
                    started_time = datetime.fromisoformat(started_at)
                    if started_time.tzinfo is None:
                        started_time = started_time.replace(tzinfo=timezone.utc)
                    elapsed = datetime.now(timezone.utc) - started_time
                    logger.warning(
                        f"Stale processing state detected for {session_id}: "
                        f"started {elapsed.total_seconds() / 3600:.1f}h ago, resetting"
                    )
                else:
                    # Helper returned False — could be not-stale OR parse failure
                    try:
                        datetime.fromisoformat(started_at)
                    except (ValueError, TypeError):
                        parse_failed = True
                        is_stale = True

                if parse_failed:
                    logger.warning(
                        f"Failed to parse pipeline started_at for {session_id}"
                    )

        if is_stale:
            # Reset stale processing state — use CONFIGURING since config and files are still valid
            session.state = SessionState.CONFIGURING
            await store.save(session)
        else:
            # Add to queue instead of rejecting
            session.state = SessionState.QUEUED
            await store.save(session)
            queue_position = _add_to_queue(session_id)
            logger.info(f"Session {session_id} queued at position {queue_position}")

            # Create background task that will wait for semaphore
            _schedule_background_task(
                run_processing_pipeline_async(session_id, session)
            )

            return {
                "data": {
                    "status": "queued",
                    "queue_position": queue_position,
                    "websocket_url": f"ws://localhost:8000/ws/sessions/{session_id}",
                }
            }

    # Check if ANY other session is currently processing
    any_processing = await _is_any_session_processing(store, session_id, session_id)

    if any_processing:
        session.state = SessionState.QUEUED
        await store.save(session)
        queue_position = _add_to_queue(session_id)
        logger.info(
            f"Session {session_id} queued at position {queue_position} (another session processing)"
        )

        # Create background task that will wait for semaphore
        _schedule_background_task(run_processing_pipeline_async(session_id, session))

        return {
            "data": {
                "status": "queued",
                "queue_position": queue_position,
                "websocket_url": f"ws://localhost:8000/ws/sessions/{session_id}",
            }
        }

    # Validate session has configuration
    if not session.config:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session configuration required. Please configure treatment, control, and organism.",
        )

    # Validate session has files
    if not session.files or not session.files.proteomics:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No proteomics files uploaded. Please upload at least 6 PSM files.",
        )

    # Validate minimum file count (at least 3 per condition, 2 conditions = 6 minimum)
    if len(session.files.proteomics) < MIN_PROTEOMICS_FILES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"At least 6 proteomics files required (3 per condition). Current: {len(session.files.proteomics)}",
        )

    # Update session state to processing
    session.state = SessionState.PROCESSING
    session.error_message = None
    await store.save(session)

    # Create cancellation event for this session
    _cancel_events[session_id] = asyncio.Event()

    # Start processing in background
    _schedule_background_task(run_processing_pipeline_async(session_id, session))

    logger.info(f"Processing started for session {session_id} (async task created)")

    return {
        "data": {
            "status": "started",
            "websocket_url": f"ws://localhost:8000/ws/sessions/{session_id}",
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
    logger.info(
        f"Starting processing for session {session_id} (WebSocket will reconnect if needed)"
    )

    try:
        # If session was queued, log it
        if session.state == SessionState.QUEUED:
            logger.info(f"Session {session_id} is queued, waiting for semaphore...")

        # Acquire semaphore (blocks until it's this session's turn)
        async with _processing_semaphore:
            _processing_sessions.add(session_id)
            logger.info(f"Session {session_id} acquired semaphore, starting processing")

            # Re-check session state — may have been cancelled while waiting in queue
            session = await session_manager.get_session(session_id)
            if session.state in (SessionState.CANCELLED, SessionState.ERROR):
                logger.info(
                    f"Session {session_id} was {session.state.value} while queued, skipping"
                )
                _processing_sessions.discard(session_id)
                try:
                    _queued_sessions.remove(session_id)
                except ValueError:
                    pass
                return

            session.state = SessionState.PROCESSING
            await session_manager.update_session_state(
                session_id, SessionState.PROCESSING
            )

            # Remove from queue tracking
            try:
                _queued_sessions.remove(session_id)
            except ValueError:
                pass

            # Convert session config to AnalysisConfig
            config_kwargs = {
                "treatment": session.config.treatment,
                "control": session.config.control,
                "organism": Organism(session.config.organism),
                "remove_razor": session.config.remove_razor,
                "strict_filtering": session.config.strict_filtering,
                "template": AnalysisTemplate(session.template),
            }
            # Pass MSstats-specific config fields if present
            if (
                hasattr(session.config, "msstats_normalization")
                and session.config.msstats_normalization
            ):
                config_kwargs["msstats_normalization"] = (
                    session.config.msstats_normalization
                )
            if (
                hasattr(session.config, "msstats_feature_selection")
                and session.config.msstats_feature_selection
            ):
                config_kwargs["msstats_feature_selection"] = (
                    session.config.msstats_feature_selection
                )
            if (
                hasattr(session.config, "msstats_summary_method")
                and session.config.msstats_summary_method
            ):
                config_kwargs["msstats_summary_method"] = (
                    session.config.msstats_summary_method
                )
            if (
                hasattr(session.config, "msstats_impute")
                and session.config.msstats_impute is not None
            ):
                config_kwargs["msstats_impute"] = session.config.msstats_impute
            if (
                hasattr(session.config, "msstats_log_base")
                and session.config.msstats_log_base is not None
            ):
                config_kwargs["msstats_log_base"] = session.config.msstats_log_base
            if (
                hasattr(session.config, "msstats_censored_int")
                and session.config.msstats_censored_int
            ):
                config_kwargs["msstats_censored_int"] = (
                    session.config.msstats_censored_int
                )
            if (
                hasattr(session.config, "msstats_max_quantile")
                and session.config.msstats_max_quantile is not None
            ):
                config_kwargs["msstats_max_quantile"] = (
                    session.config.msstats_max_quantile
                )
            if (
                hasattr(session.config, "msstats_remove50missing")
                and session.config.msstats_remove50missing is not None
            ):
                config_kwargs["msstats_remove50missing"] = (
                    session.config.msstats_remove50missing
                )
            if (
                hasattr(session.config, "deqms_fit_method")
                and session.config.deqms_fit_method
            ):
                config_kwargs["deqms_fit_method"] = session.config.deqms_fit_method
            # Multi-condition: comparisons and metadata
            if hasattr(session.config, "comparisons") and session.config.comparisons:
                config_kwargs["comparisons"] = session.config.comparisons
            if (
                hasattr(session.config, "metadata_columns")
                and session.config.metadata_columns
            ):
                config_kwargs["metadata"] = session.config.metadata_columns

            config = AnalysisConfig(**config_kwargs)
            logger.info(
                f"Config created: treatment={config.treatment}, control={config.control}"
            )

            # Create WebSocket callback for progress updates
            async def websocket_callback(progress):
                """Send progress update via WebSocket."""
                try:
                    logger.info(
                        f"WebSocket callback: step {progress.step}, status {progress.status}"
                    )
                    await session_manager.send_progress_update(
                        session_id, progress.model_dump()
                    )
                    logger.info("WebSocket callback: sent successfully")
                except Exception as e:
                    logger.warning(
                        f"Failed to send WebSocket progress update: {e}", exc_info=True
                    )

            # Run the processing pipeline
            logger.info(f"Calling process_session for {session_id}")
            orchestrator = ProcessingOrchestrator(session_id=session_id)
            cancel_event = _cancel_events.get(session_id)
            if cancel_event:
                orchestrator.set_cancel_event(cancel_event)
            result = await orchestrator.process_session(
                config=config, websocket_callback=websocket_callback
            )

            logger.info(
                f"Processing completed for session {session_id}",
                extra={
                    "session_id": session_id,
                    "total_psms": result.total_psms,
                    "total_proteins": result.total_proteins,
                    "significant_proteins": result.significant_proteins,
                },
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
                    duration=result.processing_time_seconds or 0,
                )
                logger.info(f"Sent completion message to session {session_id}")
            except Exception as e:
                logger.warning(f"Failed to send completion message: {e}")

    except ProcessingError as e:
        logger.error(
            f"Processing failed for session {session_id}: {e.message}",
            extra={
                "session_id": session_id,
                "error": e.message,
                "step": e.step,
                "traceback": traceback.format_exc(),
            },
        )
        # Session state already updated by orchestrator
    except Exception as e:
        logger.error(
            f"Unexpected error during processing for session {session_id}: {str(e)}",
            extra={
                "session_id": session_id,
                "error": str(e),
                "traceback": traceback.format_exc(),
            },
        )
        # Update session state to error
        await session_manager.update_session_state(
            session_id, SessionState.ERROR, str(e)
        )
    finally:
        _processing_sessions.discard(session_id)
        _cancel_events.pop(session_id, None)


async def _recover_orphaned_sessions(store: SessionStore) -> None:
    """Recover sessions stuck in QUEUED or stale PROCESSING state after a restart.

    QUEUED sessions are reset to CONFIGURING (safe — user files/config preserved).
    PROCESSING sessions are checked for staleness (6-hour timeout) and reset if stale.
    """
    all_sessions = await store.list_all()
    recovered = 0
    for session in all_sessions:
        if session.state == SessionState.QUEUED:
            logger.info(
                f"Recovering orphaned queued session {session.id}: resetting to CONFIGURING"
            )
            session.state = SessionState.CONFIGURING
            await store.save(session)
            recovered += 1
        elif session.state == SessionState.PROCESSING:
            pipeline_state = await store.load_pipeline_state(session.id)
            is_stale = False
            if pipeline_state and pipeline_state.get("started_at"):
                if _is_session_stale(pipeline_state["started_at"]):
                    is_stale = True
            else:
                # No pipeline state or no started_at — likely orphaned from restart
                is_stale = True

            if is_stale:
                logger.info(
                    f"Recovering stale processing session {session.id}: "
                    f"resetting to CONFIGURING"
                )
                session.state = SessionState.CONFIGURING
                await store.save(session)
                recovered += 1

    if recovered:
        logger.info(f"Session recovery: {recovered} session(s) reset to CONFIGURING")


@router.post("/{session_id}/cancel")
async def cancel_processing(
    session_id: str, store: SessionStore = Depends(get_session_store)
):
    """Cancel processing or remove session from queue."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Handle queued sessions
    if session.state == SessionState.QUEUED:
        try:
            _queued_sessions.remove(session_id)
        except ValueError:
            pass
        session.state = SessionState.CANCELLED
        await store.save(session)
        return {"data": {"status": "cancelled"}}

    if session.state != SessionState.PROCESSING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only cancel sessions that are processing or queued",
        )

    # Cancel processing — signal the background task to stop
    if session_id in _cancel_events:
        _cancel_events[session_id].set()
        logger.info(f"Signalled cancel event for session {session_id}")
    session.state = SessionState.CANCELLED
    await store.save(session)
    return {"data": {"status": "cancelled"}}
