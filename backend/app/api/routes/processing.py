"""
Processing API routes.

Processing status and control endpoints.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_session_store
from app.core.config import MIN_PROTEOMICS_FILES
from app.core.exceptions import ProcessingError
from app.db.session_store import SessionStore
from app.models.analysis import AnalysisConfig, AnalysisTemplate, Organism, PipelineTool
from app.models.session import ProcessingStatus, Session, SessionState
from app.services.processing_orchestrator import ProcessingOrchestrator
from app.services.session_manager import session_manager
from app.services.task_manager import TaskKind, task_manager

router = APIRouter()
logger = logging.getLogger("proteomics")

# Cancellation events for active processing sessions
_cancel_events: dict[str, asyncio.Event] = {}

# Store background task references to prevent GC
_background_tasks: set[asyncio.Task] = set()


def _derive_pipeline(session: Session) -> PipelineTool:
    """Derive pipeline tool from session, with backward compat for old sessions."""
    raw = getattr(session, "pipeline", None)
    if raw in ("msqrob2", "msstats"):
        return PipelineTool(raw)
    # Fallback: old sessions only had template
    if session.template == "msstats":
        return PipelineTool.MSSTATS
    return PipelineTool.MSQROB2


def _derive_template(template: str) -> AnalysisTemplate:
    """Derive analysis template from session template string."""
    if template == "msstats":
        return AnalysisTemplate.MULTI_CONDITION
    try:
        return AnalysisTemplate(template)
    except ValueError:
        return AnalysisTemplate.MULTI_CONDITION


def _schedule_background_task(coro) -> asyncio.Task:
    """Schedule a background task and store reference to prevent GC."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


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
    queue_position = task_manager.get_queue_position(session_id, TaskKind.PIPELINE)

    return ProcessingStatus(
        state=session.state,
        progress=0,
        steps=[],
        queue_position=queue_position,
        queue_length=sum(
            1
            for info in task_manager._active_tasks.values()
            if info.kind == TaskKind.PIPELINE and info.status in ("queued", "running")
        ),
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
            detail=f"Failed to load processing logs: {e!s}",
        ) from e


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

    # Reset to PROCESSING state and clear error
    session.state = SessionState.PROCESSING
    session.error_message = None
    await store.save(session)

    # Create cancellation event
    _cancel_events[session_id] = asyncio.Event()

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

    # Validate session has required configuration
    if not session.config or not session.config.organism:
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
            logger.info(f"Session {session_id} is queued, waiting for pipeline slot...")

        # Report queue position if waiting
        queue_pos = task_manager.get_queue_position(session_id, TaskKind.PIPELINE)
        if queue_pos is not None and queue_pos > 1:
            session.state = SessionState.QUEUED
            await session_manager.update_session_state(session_id, SessionState.QUEUED)

        # Ensure processing state
        session.state = SessionState.PROCESSING
        await session_manager.update_session_state(session_id, SessionState.PROCESSING)

        # Define all config fields to forward from SessionConfig to AnalysisConfig
        config_forward_fields = [
            # Core
            "treatment",
            "control",
            "remove_razor",
            "strict_filtering",
            # Shared advanced
            "pvalue_threshold",
            "logfc_threshold",
            "min_peptides_per_protein",
            # MSstats basic (existing)
            "msstats_normalization",
            "msstats_feature_selection",
            "msstats_summary_method",
            "msstats_impute",
            "msstats_log_base",
            "msstats_censored_int",
            "msstats_max_quantile",
            "msstats_remove50missing",
            # MSstats advanced (new)
            "msstats_n_top_feature",
            "msstats_min_feature_count",
            "msstats_remove_uninformative_feature_outlier",
            "msstats_equal_feature_var",
            "msstats_name_standards",
            "msstats_save_fitted_models",
            "msstats_n_cores",
            # Multi-condition
            "comparisons",
            # Batch correction (msqrob2)
            "msqrob2_batch_column",
        ]

        sc = session.config
        pipeline = _derive_pipeline(session)
        template = _derive_template(session.template)
        config_kwargs = {
            "organism": Organism(sc.organism) if sc.organism else Organism.HUMAN,
            "template": template,
            "pipeline": pipeline,
        }

        for field in config_forward_fields:
            if hasattr(sc, field):
                val = getattr(sc, field)
                if val is not None:
                    config_kwargs[field] = val

        # Map metadata_columns to metadata (different field name)
        if hasattr(sc, "metadata_columns") and sc.metadata_columns:
            config_kwargs["metadata"] = sc.metadata_columns

        # Map covariate_columns (new)
        if hasattr(sc, "covariate_columns") and sc.covariate_columns:
            config_kwargs["covariate_columns"] = sc.covariate_columns

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

        # Run the processing pipeline via TaskManager
        logger.info(f"Calling process_session for {session_id}")
        orchestrator = ProcessingOrchestrator(session_id=session_id)
        cancel_event = _cancel_events.get(session_id)
        if cancel_event:
            orchestrator.set_cancel_event(cancel_event)

        def _run_pipeline():
            return asyncio.run(
                orchestrator.process_session(
                    config=config, websocket_callback=websocket_callback
                )
            )

        result = await task_manager.submit(
            session_id,
            TaskKind.PIPELINE,
            _run_pipeline,
            label=f"Pipeline ({pipeline.value})",
            timeout_seconds=12 * 60 * 60,
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
            f"Unexpected error during processing for session {session_id}: {e!s}",
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
        _cancel_events.pop(session_id, None)


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

    # Cancel via TaskManager (handles queued + running tasks)
    task_manager.cancel(session_id)

    if session.state == SessionState.QUEUED:
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
