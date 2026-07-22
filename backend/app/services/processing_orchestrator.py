"""Processing Pipeline Orchestrator.

Thin wrapper around the PipelineEngine. Maintains the same public interface
so API routes don't need changes.
"""

import asyncio
import logging
from collections.abc import Callable
from pathlib import Path

from app.models.analysis import AnalysisConfig, AnalysisResult
from app.models.session import SessionState as SessionStateEnum
from app.services.pipeline_engine import PipelineEngine, StepContext
from app.services.pipeline_registry import PIPELINES
from app.services.session_manager import session_manager

logger = logging.getLogger("proteomics")


class ProcessingOrchestrator:
    """Orchestrates the processing pipeline via the engine."""

    def __init__(self, session_id: str):
        self._session_id = session_id
        self.progress_callbacks: list[Callable] = []
        self._cancel_event: asyncio.Event | None = None

    def set_cancel_event(self, event: asyncio.Event) -> None:
        self._cancel_event = event

    def register_progress_callback(self, callback: Callable) -> None:
        self.progress_callbacks.append(callback)

    async def process_session(
        self,
        config: AnalysisConfig,
        websocket_callback: Callable | None = None,
        results_dir_override: Path | None = None,
        manage_session_state: bool = True,
    ) -> AnalysisResult:
        engine = PipelineEngine(PIPELINES)

        uploads_dir = await session_manager.get_uploads_dir(self._session_id)
        results_dir = results_dir_override or await session_manager.get_results_dir(
            self._session_id
        )

        session = await session_manager.get_session(self._session_id)
        selected_files = (
            session.files.ptm_enrichment
            if config.pipeline.value == "ptm"
            else session.files.proteomics
        )
        file_paths = [uploads_dir / f.filename for f in selected_files]

        ctx = StepContext(
            config=config,
            session_id=self._session_id,
            file_paths=file_paths,
            results_dir=results_dir,
            uploads_dir=uploads_dir,
        )

        ctx._progress_callbacks.extend(self.progress_callbacks)
        if websocket_callback:
            ctx._progress_callbacks.append(websocket_callback)
        if self._cancel_event:
            ctx._cancel_event = self._cancel_event

        if manage_session_state:
            await session_manager.update_session_state(
                self._session_id, SessionStateEnum.PROCESSING
            )

        try:
            result = await engine.run(ctx)
            if manage_session_state:
                await session_manager.update_session_state(
                    self._session_id, SessionStateEnum.COMPLETED
                )
            return result
        except Exception as e:
            # engine.run() already called ctx.state.mark_failed(...)
            # Just update session store state and re-raise
            if manage_session_state:
                await session_manager.update_session_state(
                    self._session_id, SessionStateEnum.ERROR, str(e)
                )
            raise
