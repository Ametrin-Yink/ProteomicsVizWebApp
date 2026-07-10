"""Unit tests for PipelineState and PipelineEngine."""

import asyncio
import json
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest
from app.core.config import settings
from app.core.exceptions import ProcessingError
from app.models.analysis import AnalysisConfig, AnalysisTemplate, PipelineTool
from app.services.pipeline_engine import (
    PipelineDefinition,
    PipelineEngine,
    PipelineState,
    PipelineStep,
    StepContext,
)

# ── Fixtures ──────────────────────────────────────────────────────────


@pytest.fixture
def sessions_dir(tmp_path):
    """Create a temporary sessions directory and monkeypatch settings."""
    sd = tmp_path / "sessions"
    sd.mkdir(parents=True)
    with patch.object(settings, "sessions_dir", sd):
        yield sd


@pytest.fixture
def state(sessions_dir, tmp_path):
    """Create a PipelineState with a valid UUID session id."""
    session_id = "550e8400-e29b-41d4-a716-446655440000"
    ps = PipelineState(session_id)
    return ps


# ── PipelineState Tests ──────────────────────────────────────────────


class TestPipelineStateInit:
    """PipelineState initialisation and default values."""

    def test_default_data(self, state):
        """Fresh PipelineState has all default fields."""
        assert state.session_id == "550e8400-e29b-41d4-a716-446655440000"
        assert state.data["current_step"] == 0
        assert state.data["completed_steps"] == []
        assert state.data["failed_step"] is None
        assert state.data["error"] is None
        assert state.data["outputs"] == {}
        assert state.data["started_at"] is None
        assert state.data["completed_at"] is None
        assert state.data["logs"] == []
        assert state._pending_logs == []

    def test_state_file_path(self, state, sessions_dir):
        """State file points to correct location."""
        expected = sessions_dir / state.session_id / "pipeline_state.json"
        assert state.state_file == expected


class TestPipelineStateLoad:
    """Loading existing state from disk."""

    def test_load_existing_state(self, sessions_dir):
        """Loading a pre-existing state file populates data correctly."""
        session_id = "550e8400-e29b-41d4-a716-446655440001"
        state_dir = sessions_dir / session_id
        state_dir.mkdir(parents=True)
        state_file = state_dir / "pipeline_state.json"

        existing = {
            "current_step": 3,
            "completed_steps": [1, 2],
            "failed_step": None,
            "error": None,
            "outputs": {"step_1": "/tmp/out1.tsv"},
            "started_at": "2025-01-01T00:00:00+00:00",
            "completed_at": None,
            "logs": [{"level": "info", "message": "Step 1 complete", "step": 1}],
        }
        state_file.write_text(json.dumps(existing), encoding="utf-8")

        ps = PipelineState(session_id)
        assert ps.data["current_step"] == 3
        assert ps.data["completed_steps"] == [1, 2]
        assert ps.data["outputs"] == {"step_1": "/tmp/out1.tsv"}
        assert len(ps.data["logs"]) == 1

    def test_corrupt_state_file_returns_defaults(self, sessions_dir):
        """When the state file is corrupt, PipelineState returns defaults."""
        session_id = "550e8400-e29b-41d4-a716-446655440002"
        state_dir = sessions_dir / session_id
        state_dir.mkdir(parents=True)
        state_file = state_dir / "pipeline_state.json"
        state_file.write_text("{invalid json!!!", encoding="utf-8")

        ps = PipelineState(session_id)
        assert ps.data["current_step"] == 0
        assert ps.data["completed_steps"] == []
        assert ps.data["failed_step"] is None
        assert ps.data["error"] is None


class TestPipelineStateLogging:
    """Log buffering, flushing, and retrieval."""

    def test_add_log_buffers_entry(self, state):
        """add_log appends to the pending buffer without immediately writing."""
        state.add_log("info", "test message", step=1)
        assert len(state._pending_logs) == 1
        assert state._pending_logs[0]["level"] == "info"
        assert state._pending_logs[0]["message"] == "test message"
        assert state._pending_logs[0]["step"] == 1
        assert "timestamp" in state._pending_logs[0]

        # Not flushed yet — data["logs"] is still empty
        assert len(state.data["logs"]) == 0

    def test_flush_writes_to_disk(self, state):
        """flush() moves pending logs into data['logs'] and clears buffer."""
        state.add_log("info", "flush me", step=2)
        state._flush()
        assert len(state.data["logs"]) == 1
        assert state.data["logs"][0]["message"] == "flush me"
        assert state._pending_logs == []

    def test_save_flushes_and_writes_file(self, state):
        """save() flushes then persists to disk."""
        state.add_log("info", "save test", step=1)
        state.save()

        assert state.state_file.exists()
        on_disk = json.loads(state.state_file.read_text(encoding="utf-8"))
        assert len(on_disk["logs"]) == 1
        assert on_disk["logs"][0]["message"] == "save test"

    def test_get_logs_includes_pending(self, state):
        """get_logs() returns both flushed and pending entries."""
        state.add_log("info", "flushed entry", step=1)
        state._flush()
        state.add_log("info", "pending entry", step=2)

        all_logs = state.get_logs()
        assert len(all_logs) == 2
        assert all_logs[0]["message"] == "flushed entry"
        assert all_logs[1]["message"] == "pending entry"


class TestPipelineStateLifecycle:
    """Step progression, failure, and completion lifecycle."""

    def test_mark_started(self, state):
        """mark_started sets started_at and resets run-scoped fields."""
        state.data["completed_steps"] = [1, 2]
        state.data["outputs"] = {"step_1": "x"}
        state.data["failed_step"] = 2
        state.data["error"] = "oops"
        state.data["current_step"] = 2

        state.mark_started()

        assert state.data["started_at"] is not None
        assert state.data["completed_steps"] == []
        assert state.data["outputs"] == {}
        assert state.data["failed_step"] is None
        assert state.data["error"] is None
        assert state.data["current_step"] == 0

    def test_mark_started_persists(self, state):
        """After mark_started the file on disk reflects the reset state."""
        state.mark_started()
        assert state.state_file.exists()
        on_disk = json.loads(state.state_file.read_text(encoding="utf-8"))
        assert on_disk["started_at"] is not None
        assert on_disk["completed_steps"] == []

    def test_mark_step_started(self, state):
        """mark_step_started sets current_step and appends a log."""
        state.mark_step_started(1, "Custom message")
        assert state.data["current_step"] == 1
        assert len(state.data["logs"]) > 0
        assert state.data["logs"][-1]["message"] == "Custom message"

    def test_complete_step(self, state):
        """mark_step_completed adds step to completed_steps and outputs."""
        out = Path("/tmp/result.tsv")
        state.mark_step_completed(1, output_path=out)
        assert 1 in state.data["completed_steps"]
        assert state.data["outputs"]["step_1"] == str(out)

    def test_complete_step_no_duplicate(self, state):
        """mark_step_completed does not duplicate an already completed step."""
        state.mark_step_completed(1)
        state.mark_step_completed(1)
        assert state.data["completed_steps"] == [1]

    def test_complete_step_without_output(self, state):
        """mark_step_completed works when no output_path is given."""
        state.mark_step_completed(2, message="Step 2 done")
        assert 2 in state.data["completed_steps"]
        assert "step_2" not in state.data["outputs"]

    def test_fail_step(self, state):
        """mark_failed sets failed_step and error message."""
        state.mark_failed(3, "Something went wrong")
        assert state.data["failed_step"] == 3
        assert state.data["error"] == "Something went wrong"

    def test_mark_completed(self, state):
        """mark_completed sets completed_at."""
        state.mark_completed()
        assert state.data["completed_at"] is not None

    def test_can_resume_when_failed(self, state):
        """can_resume returns True when failed at current step."""
        state.data["failed_step"] = 2
        state.data["current_step"] = 2
        assert state.can_resume() is True

    def test_can_resume_false_when_not_failed(self, state):
        """can_resume returns False when no failure."""
        assert state.can_resume() is False

    def test_can_resume_false_step_mismatch(self, state):
        """can_resume returns False when failed_step differs from current_step."""
        state.data["failed_step"] = 2
        state.data["current_step"] = 3
        assert state.can_resume() is False

    def test_get_last_completed_step(self, state):
        """get_last_completed_step returns max completed step."""
        state.data["completed_steps"] = [1, 3, 2]
        assert state.get_last_completed_step() == 3

    def test_get_last_completed_step_empty(self, state):
        """get_last_completed_step returns 0 when no steps completed."""
        assert state.get_last_completed_step() == 0

    def test_mark_step_started_default_message(self, state):
        """mark_step_started uses default message when none provided."""
        state.mark_step_started(5)
        assert state.data["logs"][-1]["message"] == "Step 5 started"

    def test_mark_step_completed_default_message(self, state):
        """mark_step_completed uses default message when none provided."""
        state.mark_step_completed(5)
        assert state.data["logs"][-1]["message"] == "Step 5 complete"

    def test_complete_step_persists_output(self, state):
        """mark_step_completed with output writes the output path to disk."""
        state.mark_step_completed(1, output_path=Path("/tmp/out.tsv"))
        state.save()
        on_disk = json.loads(state.state_file.read_text(encoding="utf-8"))
        assert "step_1" in on_disk["outputs"]

    def test_fail_step_persists(self, state):
        """mark_failed writes error to disk."""
        state.mark_failed(4, "fail msg")
        on_disk = json.loads(state.state_file.read_text(encoding="utf-8"))
        assert on_disk["failed_step"] == 4
        assert on_disk["error"] == "fail msg"


class TestPipelineStateAutoFlush:
    """Auto-flush triggers on 100 logs or 5 second threshold."""

    def test_auto_flush_on_100_logs(self, state):
        """add_log auto-flushes after 100 pending logs."""
        for i in range(100):
            state.add_log("debug", f"log {i}", step=0)
        # The 100th entry should trigger a flush
        assert len(state._pending_logs) == 0
        assert len(state.data["logs"]) == 100

    def test_no_auto_flush_below_threshold(self, state):
        """add_log does not flush below 100 pending logs."""
        for i in range(99):
            state.add_log("debug", f"log {i}", step=0)
        assert len(state._pending_logs) == 99
        assert len(state.data["logs"]) == 0


# ── PipelineEngine Tests ─────────────────────────────────────────────


class TestPipelineEngine:
    """PipelineEngine — registry access and timeout detection."""

    def test_get_pipeline_known(self):
        """get_pipeline returns a PipelineDefinition for a registered name."""
        step = PipelineStep(1, "test_step", "Test Step", MagicMock())
        pipeline = PipelineDefinition("test_pipeline", [step])
        engine = PipelineEngine({"test_pipeline": pipeline})

        result = engine.get_pipeline("test_pipeline")
        assert result is pipeline
        assert result.template == "test_pipeline"
        assert len(result.steps) == 1

    def test_get_pipeline_unknown_raises_error(self):
        """get_pipeline raises ProcessingError for unknown pipeline names."""
        engine = PipelineEngine({})
        with pytest.raises(ProcessingError) as exc:
            engine.get_pipeline("nonexistent")
        assert "Unknown pipeline" in str(exc.value)
        assert exc.value.step == 0
        assert exc.value.recoverable is False

    def test_is_timeout_error_subprocess(self):
        """_is_timeout_error returns True for subprocess.TimeoutExpired."""
        error = subprocess.TimeoutExpired(cmd="Rscript", timeout=300)
        assert PipelineEngine._is_timeout_error(error) is True

    def test_is_timeout_error_other_exception(self):
        """_is_timeout_error returns False for generic exceptions."""
        error = ValueError("something broke")
        assert PipelineEngine._is_timeout_error(error) is False

    def test_get_pipeline_multiple_registered(self):
        """get_pipeline can retrieve any pipeline from multiple registrations."""
        step_a = PipelineStep(1, "a", "A", MagicMock())
        step_b = PipelineStep(2, "b", "B", MagicMock())
        pipe_a = PipelineDefinition("pipeline_a", [step_a])
        pipe_b = PipelineDefinition("pipeline_b", [step_b])
        engine = PipelineEngine({"pipeline_a": pipe_a, "pipeline_b": pipe_b})

        assert engine.get_pipeline("pipeline_b") is pipe_b
        assert engine.get_pipeline("pipeline_a") is pipe_a


# ── PipelineEngine.run() Tests ─────────────────────────────────────────


# Use msqrob2 as the pipeline key so the engine's registry lookup works.
# All tests below register their mock pipeline under PipelineTool.MSQROB2.
_TEST_PIPELINE = PipelineTool.MSQROB2


def _make_run_ctx(tmp_path: Path) -> StepContext:
    """Create a minimal StepContext for PipelineEngine.run() tests."""
    config = AnalysisConfig(
        template=AnalysisTemplate.MULTI_CONDITION,
        pipeline=_TEST_PIPELINE,
    )
    results_dir = tmp_path / "results"
    uploads_dir = tmp_path / "uploads"
    results_dir.mkdir(exist_ok=True)
    uploads_dir.mkdir(exist_ok=True)
    return StepContext(
        config=config,
        session_id="550e8400-e29b-41d4-a716-446655440000",
        file_paths=[],
        results_dir=results_dir,
        uploads_dir=uploads_dir,
        df=pd.DataFrame({"x": [1, 2, 3]}),
    )


class TestPipelineEngineRun:
    """Tests for PipelineEngine.run() — the main execution loop."""

    def test_run_completes_all_steps(self, tmp_path):
        """All mock handlers are called and result is returned."""
        ctx = _make_run_ctx(tmp_path)
        handler1 = AsyncMock()
        handler2 = AsyncMock()
        step1 = PipelineStep(1, "s1", "Step 1", handler1)
        step2 = PipelineStep(2, "s2", "Step 2", handler2)
        pipeline = PipelineDefinition(_TEST_PIPELINE, [step1, step2])
        engine = PipelineEngine({_TEST_PIPELINE: pipeline})

        result = asyncio.run(engine.run(ctx))

        handler1.assert_awaited_once_with(ctx)
        handler2.assert_awaited_once_with(ctx)
        assert result.steps_completed == [1, 2]
        assert (
            result.processing_time_seconds >= 0
        )  # may be 0.0 with mocked instant handlers

    def test_run_stops_on_error(self, tmp_path):
        """Engine stops at failing step, marks state, and re-raises."""
        ctx = _make_run_ctx(tmp_path)
        handler1 = AsyncMock()
        handler2 = AsyncMock(side_effect=ValueError("step 2 failed"))
        step1 = PipelineStep(1, "s1", "Step 1", handler1)
        step2 = PipelineStep(2, "s2", "Step 2", handler2)
        pipeline = PipelineDefinition(_TEST_PIPELINE, [step1, step2])
        engine = PipelineEngine({_TEST_PIPELINE: pipeline})

        with pytest.raises(ValueError, match="step 2 failed"):
            asyncio.run(engine.run(ctx))

        handler1.assert_awaited_once()
        handler2.assert_awaited_once()
        assert ctx.state.data["failed_step"] == 2

    def test_run_retries_on_timeout(self, tmp_path):
        """Timeout errors are retried once."""
        ctx = _make_run_ctx(tmp_path)
        handler = AsyncMock(side_effect=[subprocess.TimeoutExpired("cmd", 300), None])
        step = PipelineStep(1, "s1", "Step 1", handler)
        pipeline = PipelineDefinition(_TEST_PIPELINE, [step])
        engine = PipelineEngine({_TEST_PIPELINE: pipeline})

        result = asyncio.run(engine.run(ctx))

        assert handler.await_count == 2
        assert result.steps_completed == [1]

    def test_run_timeout_retry_fails(self, tmp_path):
        """If retry also times out, engine gives up and re-raises."""
        ctx = _make_run_ctx(tmp_path)
        handler = AsyncMock(
            side_effect=[
                subprocess.TimeoutExpired("cmd", 300),
                subprocess.TimeoutExpired("cmd", 600),
            ]
        )
        step = PipelineStep(1, "s1", "Step 1", handler)
        pipeline = PipelineDefinition(_TEST_PIPELINE, [step])
        engine = PipelineEngine({_TEST_PIPELINE: pipeline})

        with pytest.raises(subprocess.TimeoutExpired):
            asyncio.run(engine.run(ctx))

        assert handler.await_count == 2
        assert ctx.state.data["failed_step"] == 1

    def test_run_non_timeout_not_retried(self, tmp_path):
        """Non-timeout errors are not retried."""
        ctx = _make_run_ctx(tmp_path)
        handler = AsyncMock(side_effect=ValueError("not a timeout"))
        step = PipelineStep(1, "s1", "Step 1", handler)
        pipeline = PipelineDefinition(_TEST_PIPELINE, [step])
        engine = PipelineEngine({_TEST_PIPELINE: pipeline})

        with pytest.raises(ValueError, match="not a timeout"):
            asyncio.run(engine.run(ctx))

        handler.assert_awaited_once()

    def test_run_cancelled_before_start(self, tmp_path):
        """Engine raises if cancelled before execution."""
        ctx = _make_run_ctx(tmp_path)
        ctx._cancel_event = asyncio.Event()
        ctx._cancel_event.set()
        handler = AsyncMock()
        step = PipelineStep(1, "s1", "Step 1", handler)
        pipeline = PipelineDefinition(_TEST_PIPELINE, [step])
        engine = PipelineEngine({_TEST_PIPELINE: pipeline})

        with pytest.raises(ProcessingError, match="cancelled"):
            asyncio.run(engine.run(ctx))

        handler.assert_not_awaited()

    def test_run_records_step_outputs(self, tmp_path):
        """Step outputs set by handlers are persisted to state."""
        from pathlib import Path

        ctx = _make_run_ctx(tmp_path)
        out = Path("/tmp/fake_output.tsv")

        async def set_output(ctx):
            ctx.step_outputs[1] = out

        step = PipelineStep(1, "s1", "Step 1", set_output)
        pipeline = PipelineDefinition(_TEST_PIPELINE, [step])
        engine = PipelineEngine({_TEST_PIPELINE: pipeline})

        result = asyncio.run(engine.run(ctx))

        assert result.steps_completed == [1]
        assert ctx.state.data["outputs"]["step_1"] == str(out)

    def test_run_unknown_pipeline_raises(self, tmp_path):
        """Unknown pipeline raises ProcessingError before any steps run."""
        ctx = _make_run_ctx(tmp_path)
        # Override pipeline after construction to bypass Pydantic enum validation
        ctx.config.pipeline = "nonexistent"
        engine = PipelineEngine({})

        with pytest.raises(ProcessingError, match="Unknown pipeline"):
            asyncio.run(engine.run(ctx))

    def test_run_sends_progress_callbacks(self, tmp_path):
        """Progress callbacks receive started and completed events."""
        ctx = _make_run_ctx(tmp_path)
        handler = AsyncMock()
        step = PipelineStep(1, "s1", "Step 1", handler)
        pipeline = PipelineDefinition(_TEST_PIPELINE, [step])
        engine = PipelineEngine({_TEST_PIPELINE: pipeline})

        callback = AsyncMock()
        ctx._progress_callbacks.append(callback)

        asyncio.run(engine.run(ctx))

        assert callback.await_count >= 2  # started + completed events
