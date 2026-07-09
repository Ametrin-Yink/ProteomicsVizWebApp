"""Pipeline Engine — Core processing abstraction.

Defines the engine, registry, and state management for template-based pipelines.
"""

import asyncio
import json
import logging
import subprocess
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from app.core.config import settings
from app.core.exceptions import ProcessingError
from app.models.analysis import (
    STEP_DISPLAY_NAMES,
    AnalysisConfig,
    AnalysisResult,
    PipelineTool,
    ProcessingProgress,
)

logger = logging.getLogger("proteomics")


class PipelineState:
    """Track pipeline execution state.

    Moved from processing_orchestrator.py — this is a core engine concept.
    """

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.state_file = settings.sessions_dir / session_id / "pipeline_state.json"
        self.data = self._load()
        self._pending_logs: list[dict] = []
        self._last_flush_time: float = time.time()

    def _load(self) -> dict:
        if self.state_file.exists():
            try:
                with open(self.state_file, encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Failed to load pipeline state: {e}")

        return {
            "current_step": 0,
            "completed_steps": [],
            "failed_step": None,
            "error": None,
            "outputs": {},
            "started_at": None,
            "completed_at": None,
            "logs": [],
        }

    def save(self) -> None:
        """Save state to disk, flushing pending logs first."""
        self._flush()
        self._write_to_disk()

    def _write_to_disk(self) -> None:
        """Internal: write self.data to JSON file."""
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.state_file, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=2)

    def _flush(self) -> None:
        """Move pending log entries into self.data['logs']."""
        if not self._pending_logs:
            return
        if "logs" not in self.data:
            self.data["logs"] = []
        self.data["logs"].extend(self._pending_logs)
        self._pending_logs.clear()
        self._last_flush_time = time.time()

    def add_log(self, level: str, message: str, step: int | None = None) -> None:
        """Buffer a log entry. Flush every 100 lines or 5 seconds."""
        self._pending_logs.append(
            {
                "level": level,
                "message": message,
                "step": step,
                "timestamp": datetime.now(UTC).isoformat(),
            }
        )
        now = time.time()
        if len(self._pending_logs) >= 100 or (now - self._last_flush_time) >= 5.0:
            self.save()

    def get_logs(self) -> list:
        """Return all logs including pending (not yet flushed) entries."""
        logs = list(self.data.get("logs", []))
        logs.extend(self._pending_logs)
        return logs

    def mark_started(self) -> None:
        self.data["started_at"] = datetime.now(UTC).isoformat()
        # Reset run-scoped fields for clean retry tracking
        self.data["completed_steps"] = []
        self.data["outputs"] = {}
        self.data["failed_step"] = None
        self.data["error"] = None
        self.data["current_step"] = 0
        self.save()

    def mark_step_started(self, step: int, message: str | None = None) -> None:
        self.data["current_step"] = step
        if "logs" not in self.data:
            self.data["logs"] = []
        self.data["logs"].append(
            {
                "level": "info",
                "message": message or f"Step {step} started",
                "step": step,
                "timestamp": datetime.now(UTC).isoformat(),
            }
        )
        self.save()

    def mark_step_completed(
        self, step: int, output_path: Path | None = None, message: str | None = None
    ) -> None:
        if step not in self.data["completed_steps"]:
            self.data["completed_steps"].append(step)
        if output_path:
            self.data["outputs"][f"step_{step}"] = str(output_path)
        if "logs" not in self.data:
            self.data["logs"] = []
        self.data["logs"].append(
            {
                "level": "info",
                "message": message or f"Step {step} complete",
                "step": step,
                "timestamp": datetime.now(UTC).isoformat(),
            }
        )
        self.save()

    def mark_failed(self, step: int, error: str) -> None:
        self.data["failed_step"] = step
        self.data["error"] = error
        self.save()

    def mark_completed(self) -> None:
        self.data["completed_at"] = datetime.now(UTC).isoformat()
        self.save()

    def can_resume(self) -> bool:
        return (
            self.data["failed_step"] is not None
            and self.data["current_step"] == self.data["failed_step"]
        )

    def get_last_completed_step(self) -> int:
        if self.data["completed_steps"]:
            return max(self.data["completed_steps"])
        return 0


@dataclass
class StepContext:
    """Mutable context passed between pipeline steps."""

    config: AnalysisConfig
    session_id: str
    file_paths: list[Path]
    results_dir: Path
    uploads_dir: Path
    df: pd.DataFrame | None = None
    psm_file_path: Path | None = None
    step_outputs: dict[int, Path] = field(default_factory=dict)
    state: PipelineState | None = None
    result: AnalysisResult | None = None
    current_step_number: int = 0  # Set by engine before each step handler call
    _progress_callbacks: list[Callable] = field(default_factory=list)
    _cancel_event: asyncio.Event | None = None
    timeout_multiplier: int = 1  # Set to 2 on retry after TimeoutExpired


class PipelineStep:
    """A single pipeline step with metadata."""

    def __init__(
        self,
        number: int,
        name: str,
        display_name: str,
        handler: Callable[[StepContext], Awaitable[None]],
    ):
        self.number = number
        self.name = name
        self.display_name = display_name
        self.handler = handler


class PipelineDefinition:
    """Defines the steps for one analysis template."""

    def __init__(
        self,
        template: str,
        steps: list[PipelineStep],
        config_validator: Callable | None = None,
    ):
        self.template = template
        self.steps = steps
        self.config_validator = config_validator


class PipelineEngine:
    """Executes a pipeline definition."""

    def __init__(self, registry: dict[str, PipelineDefinition]):
        self._registry = registry

    def get_pipeline(self, name: str) -> PipelineDefinition:
        if name not in self._registry:
            raise ProcessingError(
                message=f"Unknown pipeline: {name}",
                step=0,
                recoverable=False,
            )
        return self._registry[name]

    async def run(self, ctx: StepContext) -> AnalysisResult:
        pipeline = self.get_pipeline(ctx.config.pipeline)

        # Initialize state and result
        ctx.state = PipelineState(ctx.session_id)
        ctx.result = AnalysisResult(session_id=ctx.session_id)

        ctx.state.mark_started()

        for step in pipeline.steps:
            self._check_cancelled(ctx)
            ctx.state.mark_step_started(
                step.number, f"Step {step.number}: {step.display_name}"
            )
            await self._send_progress(
                ctx, step.number, "started", 0, step.display_name, len(pipeline.steps)
            )

            # Reset timeout multiplier for each step
            ctx.timeout_multiplier = 1

            # Set current step number before calling handler
            ctx.current_step_number = step.number

            try:
                await step.handler(ctx)
            except Exception as e:
                # Retry once on timeout with 2x timeout
                if self._is_timeout_error(e) and ctx.timeout_multiplier == 1:
                    logger.warning(
                        f"Step {step.number} timed out, retrying with 2x timeout"
                    )
                    ctx.state.add_log(
                        "warning",
                        f"Step {step.number} timed out — retrying with doubled timeout",
                        step.number,
                    )
                    ctx.timeout_multiplier = 2
                    try:
                        await step.handler(ctx)
                    except Exception as retry_e:
                        ctx.state.mark_failed(step.number, str(retry_e))
                        await self._send_progress(
                            ctx,
                            step.number,
                            "failed",
                            0,
                            str(retry_e),
                            len(pipeline.steps),
                        )
                        raise
                else:
                    ctx.state.mark_failed(step.number, str(e))
                    await self._send_progress(
                        ctx, step.number, "failed", 0, str(e), len(pipeline.steps)
                    )
                    raise

            if step.number in ctx.step_outputs:
                ctx.state.mark_step_completed(
                    step.number,
                    ctx.step_outputs[step.number],
                    f"{step.display_name} complete",
                )
            else:
                ctx.state.mark_step_completed(
                    step.number, message=f"{step.display_name} complete"
                )

            await self._send_progress(
                ctx,
                step.number,
                "completed",
                100,
                f"{step.display_name} complete",
                len(pipeline.steps),
            )

        # Calculate processing time
        if ctx.state.data["started_at"]:
            start_time = datetime.fromisoformat(ctx.state.data["started_at"])
            ctx.result.processing_time_seconds = (
                datetime.now(UTC) - start_time
            ).total_seconds()
        ctx.result.steps_completed = ctx.state.data["completed_steps"]
        ctx.state.mark_completed()

        return ctx.result

    def _check_cancelled(self, ctx: StepContext) -> None:
        if ctx._cancel_event and ctx._cancel_event.is_set():
            raise ProcessingError(
                message="Processing cancelled by User",
                step=ctx.state.data["current_step"] if ctx.state else 0,
                recoverable=False,
            )

    @staticmethod
    def _is_timeout_error(error: Exception) -> bool:
        """Check if an error is a timeout (should trigger retry)."""
        if isinstance(error, subprocess.TimeoutExpired):
            return True
        from app.core.exceptions import RScriptError

        if isinstance(error, RScriptError):
            msg = str(error).lower()
            return "timed out" in msg or "timeout" in msg
        return False

    async def _send_progress(
        self,
        ctx: StepContext,
        step: int,
        status: str,
        progress_pct: int,
        message: str,
        total_steps: int = 9,
    ) -> None:
        overall_progress = int(((step - 1) * 100 + progress_pct) / total_steps)
        overall_progress = max(0, min(100, overall_progress))

        pipeline_tool = ctx.config.pipeline
        step_display_names = STEP_DISPLAY_NAMES.get(pipeline_tool, STEP_DISPLAY_NAMES.get(PipelineTool.MSQROB2, {}))
        step_name = step_display_names.get(step, message)

        progress = ProcessingProgress(
            step=step,
            step_name=step_name,
            status=status,
            progress=progress_pct,
            message=message,
            overall_progress=overall_progress,
        )

        for callback in ctx._progress_callbacks:
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback(progress)
                else:
                    callback(progress)
            except Exception as e:
                logger.warning(f"Progress callback failed: {e}", exc_info=True)
