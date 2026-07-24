"""Unit tests for ProcessingOrchestrator — validation and state transitions.

Uses a real SessionStore and SessionManager so state transitions and
directory resolution exercise the actual persistence layer. Only
PipelineEngine.run is mocked (it chains 6 pipeline steps including R).
"""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from app.db.session_store import SessionStore
from app.models.analysis import AnalysisConfig, AnalysisResult, PipelineTool
from app.models.session import (
    ProteomicsFileInfo, Session, SessionConfig, SessionFiles, SessionState,
)
from app.services.processing_orchestrator import ProcessingOrchestrator
from app.services.session_manager import SessionManager


def _make_session(session_id="550e8400-e29b-41d4-a716-446655440000", **overrides):
    """Create a real Session with proteomics files for orchestrator tests."""
    kwargs = dict(
        id=session_id, name="Test",
        template="multi_condition_comparison", pipeline="msqrob2",
        state=SessionState.CONFIGURING,
        config=SessionConfig(
            treatment="DrugA", control="DMSO", organism="human",
            comparisons=[{"group1": {"C": "DrugA"}, "group2": {"C": "DMSO"}}],
        ),
        files=SessionFiles(),
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    )
    kwargs.update(overrides)
    session = Session(**kwargs)
    session.files.proteomics = [
        ProteomicsFileInfo(filename=f"PSM_Exp_DrugA_{i}.csv", size=1024)
        for i in range(1, 4)
    ] + [
        ProteomicsFileInfo(filename=f"PSM_Exp_DMSO_{i}.csv", size=1024)
        for i in range(1, 4)
    ]
    return session


class TestPipelineDerivation:
    def test_explicit_msqrob2(self):
        from app.api.routes.processing import _derive_pipeline

        session = _make_session()
        session.pipeline = "msqrob2"
        assert _derive_pipeline(session) == PipelineTool.MSQROB2

    def test_explicit_msstats(self):
        from app.api.routes.processing import _derive_pipeline

        session = _make_session()
        session.pipeline = "msstats"
        assert _derive_pipeline(session) == PipelineTool.MSSTATS

    def test_backward_compat_no_pipeline_field(self):
        from app.api.routes.processing import _derive_pipeline

        session = _make_session()
        session.pipeline = None
        assert _derive_pipeline(session) == PipelineTool.MSQROB2

    def test_ptm_pipeline_takes_precedence_over_tmt_file_type(self):
        from app.api.routes.processing import _derive_pipeline

        session = _make_session()
        session.pipeline = "ptm"
        session.config.file_type = "tmt"
        assert _derive_pipeline(session) == PipelineTool.PTM


class TestTemplateDerivation:
    def test_msstats_template(self):
        from app.api.routes.processing import _derive_template

        result = _derive_template("msstats")
        assert result is not None

    def test_default_fallback(self):
        from app.api.routes.processing import _derive_template

        result = _derive_template("unknown_template")
        assert result is not None


class TestOrchestratorInit:
    def test_stores_session_id(self):
        orch = ProcessingOrchestrator(session_id="test-id")
        assert orch._session_id == "test-id"

    def test_progress_callbacks_initially_empty(self):
        orch = ProcessingOrchestrator(session_id="test-id")
        assert orch.progress_callbacks == []

    def test_set_cancel_event(self):
        orch = ProcessingOrchestrator(session_id="test-id")
        event = asyncio.Event()
        orch.set_cancel_event(event)
        assert orch._cancel_event is event

    def test_register_progress_callback(self):
        orch = ProcessingOrchestrator(session_id="test-id")

        async def dummy_callback(progress):
            pass

        orch.register_progress_callback(dummy_callback)
        assert len(orch.progress_callbacks) == 1
        assert orch.progress_callbacks[0] is dummy_callback


class TestOrchestratorProcessSession:
    """Tests for process_session() — the main orchestration entry point."""

    def test_success_transitions_to_completed(self, tmp_path):
        """Happy path: PROCESSING → COMPLETED via real store and session."""
        store = SessionStore(sessions_dir=tmp_path)
        mgr = SessionManager(store=store)

        session = _make_session()
        asyncio.run(store.create(session))

        mock_result = AnalysisResult(session_id=session.id)

        orch = ProcessingOrchestrator(session_id=session.id)

        orch_config = AnalysisConfig(
            pipeline=PipelineTool.MSQROB2,
            organism="human",
            comparisons=[{"group1": {"C": "DrugA"}, "group2": {"C": "DMSO"}}],
        )

        with (
            patch(
                "app.services.processing_orchestrator.PipelineEngine.run",
                new=AsyncMock(return_value=mock_result),
            ),
            patch(
                "app.services.processing_orchestrator.session_manager",
                new=mgr,
            ),
        ):
            result = asyncio.run(orch.process_session(orch_config))

        assert result is mock_result

        # Verify state transition persisted to disk
        updated = asyncio.run(store.get(session.id))
        assert updated.state == SessionState.COMPLETED

    def test_failure_transitions_to_error(self, tmp_path):
        """On engine failure: PROCESSING → ERROR with error message."""
        store = SessionStore(sessions_dir=tmp_path)
        mgr = SessionManager(store=store)

        session = _make_session()
        asyncio.run(store.create(session))

        orch = ProcessingOrchestrator(session_id=session.id)

        orch_config = AnalysisConfig(
            pipeline=PipelineTool.MSQROB2,
            organism="human",
            comparisons=[{"group1": {"C": "DrugA"}, "group2": {"C": "DMSO"}}],
        )

        with (
            patch(
                "app.services.processing_orchestrator.PipelineEngine.run",
                new=AsyncMock(side_effect=ValueError("step 3 failed")),
            ),
            patch(
                "app.services.processing_orchestrator.session_manager",
                new=mgr,
            ),
        ):
            with pytest.raises(ValueError, match="step 3 failed"):
                asyncio.run(orch.process_session(orch_config))

        updated = asyncio.run(store.get(session.id))
        assert updated.state == SessionState.ERROR
        assert updated.error_message == "step 3 failed"

    def test_registered_progress_callback_is_forwarded(self, tmp_path):
        """Callbacks registered on the orchestrator receive engine progress."""
        store = SessionStore(sessions_dir=tmp_path)
        mgr = SessionManager(store=store)

        session = _make_session()
        asyncio.run(store.create(session))

        callback = AsyncMock()
        mock_result = AnalysisResult(session_id=session.id)

        orch = ProcessingOrchestrator(session_id=session.id)
        orch_config = AnalysisConfig(
            pipeline=PipelineTool.MSQROB2,
            organism="human",
            comparisons=[{"group1": {"C": "DrugA"}, "group2": {"C": "DMSO"}}],
        )
        orch.register_progress_callback(callback)

        async def run_with_progress(ctx):
            for registered_callback in ctx._progress_callbacks:
                await registered_callback("progress")
            return mock_result

        with (
            patch(
                "app.services.processing_orchestrator.PipelineEngine.run",
                new=AsyncMock(side_effect=run_with_progress),
            ),
            patch(
                "app.services.processing_orchestrator.session_manager",
                new=mgr,
            ),
        ):
            asyncio.run(orch.process_session(orch_config))

        callback.assert_awaited_once_with("progress")
