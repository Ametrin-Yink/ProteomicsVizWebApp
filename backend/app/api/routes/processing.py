"""
Processing API routes.

Processing status and control endpoints.
"""

import asyncio
import logging
import shutil
import traceback
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.deps import get_session_store
from app.api.routes.visualization_shared import visualization_cache
from app.core.config import MIN_DIA_FILES, MIN_PROTEOMICS_FILES, settings
from app.core.exceptions import ProcessingError
from app.db.session_store import SessionStore
from app.models.analysis import AnalysisConfig, AnalysisTemplate, Organism, PipelineTool
from app.models.session import ProcessingStatus, Session, SessionState
from app.services.processing_orchestrator import ProcessingOrchestrator
from app.services.report_generator import refresh_reports_for_session
from app.services.reprocess_service import (
    clear_saved_analysis_state,
    commit_staged_results,
    preflight_reprocess_space,
    write_reprocess_status,
)
from app.services.session_manager import session_manager
from app.services.task_manager import (
    TaskCancelledError,
    TaskKind,
    TaskTimeoutError,
    task_manager,
)
from app.services.visualization_artifacts import load_visualization_artifact_manifest

router = APIRouter()
logger = logging.getLogger("proteomics")

# Cancellation events for active processing sessions
_cancel_events: dict[str, asyncio.Event] = {}

# Store background task references to prevent GC
_background_tasks: set[asyncio.Task] = set()


class ReprocessRequest(BaseModel):
    """Explicit acknowledgement for destructive successful replacement."""

    confirm_replace: bool


def _reserve_processing(session_id: str, session: Session) -> None:
    """Atomically reserve one in-process pipeline start for a session."""
    if session.state in (SessionState.QUEUED, SessionState.PROCESSING) or (
        session_id in _cancel_events
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Session is already queued or processing",
        )
    _cancel_events[session_id] = asyncio.Event()


def _derive_pipeline(session: Session) -> PipelineTool:
    """Derive pipeline tool from session, with backward compat for old sessions."""
    if getattr(session, "pipeline", None) == "ptm":
        return PipelineTool.PTM
    ft = getattr(session.config, "file_type", None) if session.config else None
    if ft == "tmt":
        return PipelineTool.MSSTATS
    if ft == "dia":
        return PipelineTool.MSQROB2
    # Legacy fallback for old sessions without file_type
    raw = getattr(session, "pipeline", None)
    if raw in ("msqrob2", "msstats"):
        return PipelineTool(raw)
    return PipelineTool.MSQROB2


def _derive_template(template: str) -> AnalysisTemplate:
    """Derive analysis template from session template string."""
    if template == "msstats":
        return AnalysisTemplate.MULTI_CONDITION
    try:
        return AnalysisTemplate(template)
    except ValueError:
        return AnalysisTemplate.MULTI_CONDITION


def _build_analysis_config(session: Session) -> AnalysisConfig:
    """Translate persisted session configuration into pipeline configuration."""
    if session.config is None:
        raise ValueError("Session configuration is required")

    config_kwargs = session.config.model_dump(exclude_none=True)
    organism = config_kwargs.pop("organism", None)
    metadata = config_kwargs.pop("metadata_columns", None)
    target_modification = config_kwargs.get("ptm_target_modification")
    if target_modification:
        config_kwargs["ptm_mod_ids"] = [target_modification]
    config_kwargs.update(
        {
            "organism": Organism(organism) if organism else Organism.HUMAN,
            "template": _derive_template(session.template),
            "pipeline": _derive_pipeline(session),
        }
    )
    if metadata:
        config_kwargs["metadata"] = metadata
    return AnalysisConfig(**config_kwargs)


def _validate_ptm_session(session: Session) -> None:
    """Validate the complete immutable PTM run contract before queueing."""
    if session.config is None:
        raise ValueError("Session configuration is required")
    if len(session.files.ptm_enrichment) != 1:
        raise ValueError("PTM analysis requires exactly one enriched PTM file")
    if len(session.files.global_proteome) > 1:
        raise ValueError("PTM analysis accepts at most one protein PSM file")
    target = session.config.ptm_target_modification
    if not target:
        raise ValueError("Select one target modification")
    detected = {
        item.get("name")
        for item in session.files.ptm_enrichment[0].detected_modifications
    }
    if target not in detected:
        raise ValueError(f"Target modification '{target}' was not detected")
    fasta_source = session.config.ptm_fasta_source
    if fasta_source not in {"human", "mouse", "custom"}:
        raise ValueError("Select Human, Mouse, or Custom FASTA")
    if fasta_source == "custom" and len(session.files.fasta) != 1:
        raise ValueError("Custom FASTA selection is required")
    mapping = session.config.tmt_channel_mapping or {}
    channels = set(session.files.ptm_enrichment[0].tmt_channels or [])
    mapping_channel_list = [str(key).rsplit("::", 1)[-1] for key in mapping]
    mapping_channels = set(mapping_channel_list)
    if mapping_channels != channels or len(mapping_channel_list) != len(channels):
        raise ValueError("TMT metadata must cover every PTM reporter channel exactly")
    for channel, values in mapping.items():
        if "replicate" not in values:
            raise ValueError(
                f"Channel {channel} is missing biological replicate metadata"
            )
        condition_keys = {
            key for key in values if key not in {"replicate", "role", "channel_role"}
        }
        if not condition_keys:
            raise ValueError(f"Channel {channel} is missing condition metadata")
    if session.files.global_proteome:
        protein_channels = set(session.files.global_proteome[0].tmt_channels or [])
        if protein_channels != channels:
            raise ValueError("PTM and protein reporter channels must match exactly")
    if not session.config.comparisons:
        raise ValueError("At least one comparison is required")


def _validate_processing_inputs(session: Session) -> None:
    if session.pipeline == "ptm":
        _validate_ptm_session(session)
        return
    if not session.files or not session.files.proteomics:
        raise ValueError(
            "No proteomics files uploaded. Please select proteomics files before processing."
        )
    min_files = (
        MIN_DIA_FILES
        if (session.config and session.config.file_type == "dia")
        else MIN_PROTEOMICS_FILES
    )
    if len(session.files.proteomics) < min_files:
        raise ValueError(
            f"At least {min_files} proteomics files required. "
            f"Current: {len(session.files.proteomics)}"
        )


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

    try:
        _validate_processing_inputs(session)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e

    _reserve_processing(session_id, session)

    # Reset to PROCESSING state and clear error
    session.state = SessionState.PROCESSING
    session.error_message = None
    try:
        await store.save(session)
    except Exception:
        _cancel_events.pop(session_id, None)
        raise

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
    if not session.config or (
        session.pipeline != "ptm" and not session.config.organism
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session configuration required. Please configure treatment, control, and organism.",
        )

    try:
        _validate_processing_inputs(session)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e

    _reserve_processing(session_id, session)

    # Update session state to processing
    session.state = SessionState.PROCESSING
    session.error_message = None
    try:
        await store.save(session)
    except Exception:
        _cancel_events.pop(session_id, None)
        raise

    # Start processing in background
    _schedule_background_task(run_processing_pipeline_async(session_id, session))

    logger.info(f"Processing started for session {session_id} (async task created)")

    return {
        "data": {
            "status": "started",
            "websocket_url": f"ws://localhost:8000/ws/sessions/{session_id}",
        }
    }


@router.post("/{session_id}/reprocess")
async def start_reprocess(
    session_id: str,
    request: ReprocessRequest,
    store: SessionStore = Depends(get_session_store),
):
    """Re-run a completed session into staging, then replace results in place."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    if session.state != SessionState.COMPLETED:
        raise HTTPException(
            status_code=400, detail="Only completed sessions can be reprocessed"
        )
    if not request.confirm_replace:
        raise HTTPException(
            status_code=400,
            detail="Explicit confirmation is required to replace session results",
        )
    if not session.config:
        raise HTTPException(status_code=400, detail="Session configuration is required")
    try:
        _validate_processing_inputs(session)
        _build_analysis_config(session)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    _reserve_processing(session_id, session)
    session.state = SessionState.PROCESSING
    session.error_message = None
    try:
        await store.save(session)
    except Exception:
        _cancel_events.pop(session_id, None)
        raise

    _schedule_background_task(run_reprocess_pipeline_async(session_id, session))
    return {"data": {"status": "started"}}


async def run_reprocess_pipeline_async(session_id: str, session: Session) -> None:
    """Run a checkpoint-free pipeline and transactionally publish its output."""
    session_dir = settings.sessions_dir / session_id
    staging_root = session_dir / f".reprocess-{uuid.uuid4().hex}"
    staged_results = staging_root / "results"
    committed = False
    started_at = datetime.now(UTC).isoformat()
    try:
        await asyncio.to_thread(preflight_reprocess_space, session_dir)
        await asyncio.to_thread(staged_results.mkdir, parents=True)
        await asyncio.to_thread(
            write_reprocess_status,
            session_dir,
            {"status": "running", "started_at": started_at},
        )
        config = _build_analysis_config(session)
        orchestrator = ProcessingOrchestrator(session_id=session_id)
        cancel_event = _cancel_events.get(session_id)
        if cancel_event:
            orchestrator.set_cancel_event(cancel_event)

        def _run_pipeline():
            return asyncio.run(
                orchestrator.process_session(
                    config=config,
                    results_dir_override=staged_results,
                    manage_session_state=False,
                )
            )

        await task_manager.submit(
            session_id,
            TaskKind.PIPELINE,
            _run_pipeline,
            label=f"Reprocess pipeline ({config.pipeline.value})",
            cancel_event=cancel_event,
            timeout_seconds=12 * 60 * 60,
        )
        if (
            await asyncio.to_thread(
                load_visualization_artifact_manifest, staged_results
            )
            is None
        ):
            raise ValueError("Reprocessed results failed visualization validation")

        await asyncio.to_thread(commit_staged_results, session_dir, staged_results)
        committed = True
        await asyncio.to_thread(clear_saved_analysis_state, session_dir)
        visualization_cache.invalidate(session_id)
        await session_manager.update_session_state(session_id, SessionState.COMPLETED)

        report_failures = await asyncio.to_thread(
            refresh_reports_for_session, session_id
        )
        await asyncio.to_thread(
            write_reprocess_status,
            session_dir,
            {
                "status": "completed",
                "started_at": started_at,
                "completed_at": datetime.now(UTC).isoformat(),
                "report_refresh_failures": report_failures,
            },
        )
    except TaskCancelledError:
        await session_manager.update_session_state(session_id, SessionState.COMPLETED)
        await asyncio.to_thread(
            write_reprocess_status,
            session_dir,
            {
                "status": "cancelled",
                "started_at": started_at,
                "results_replaced": committed,
            },
        )
    except Exception as error:
        logger.exception("Reprocessing failed for session %s", session_id)
        await session_manager.update_session_state(session_id, SessionState.COMPLETED)
        await asyncio.to_thread(
            write_reprocess_status,
            session_dir,
            {
                "status": "error",
                "started_at": started_at,
                "error": str(error),
                "results_replaced": committed,
            },
        )
    finally:
        await asyncio.to_thread(shutil.rmtree, staging_root, ignore_errors=True)
        _cancel_events.pop(session_id, None)


@router.get("/{session_id}/reprocess/status")
async def get_reprocess_status(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Return the last staged reprocess and report-refresh outcome."""
    if not await store.get(session_id):
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    path = settings.sessions_dir / session_id / "reprocess_status.json"
    if not path.exists():
        return {"data": {"status": "idle"}}
    from app.utils.json_io import read_json_file

    return {"data": await read_json_file(path)}


async def run_processing_pipeline_async(session_id: str, session: Session):
    """Run the processing pipeline (async version).

    Args:
        session_id: Session ID
        session: Session object with config
    """
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

        config = _build_analysis_config(session)
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
            label=f"Pipeline ({config.pipeline.value})",
            cancel_event=cancel_event,
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

    except TaskCancelledError:
        logger.info("Processing cancelled for session %s", session_id)
        await session_manager.update_session_state(session_id, SessionState.CANCELLED)
    except TaskTimeoutError as e:
        logger.error("Processing timed out for session %s: %s", session_id, e)
        await session_manager.update_session_state(
            session_id, SessionState.ERROR, str(e)
        )
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

    if session.state not in (SessionState.PROCESSING, SessionState.ERROR):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only cancel sessions that are processing, queued, or in error",
        )

    # Cancel processing — signal the background task to stop (if running)
    if session.state == SessionState.PROCESSING and session_id in _cancel_events:
        _cancel_events[session_id].set()
        logger.info(f"Signalled cancel event for session {session_id}")
    session.state = SessionState.CANCELLED
    await store.save(session)
    return {"data": {"status": "cancelled"}}
