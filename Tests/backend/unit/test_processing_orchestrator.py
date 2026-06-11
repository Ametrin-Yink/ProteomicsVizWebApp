"""Unit tests for ProcessingOrchestrator — validation and state transitions."""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.models.analysis import AnalysisConfig, AnalysisResult, PipelineTool
from app.models.session import SessionState


@pytest.fixture
def mock_session():
    session = MagicMock()
    session.id = "550e8400-e29b-41d4-a716-446655440000"
    session.name = "Test"
    session.state = SessionState.CONFIGURING
    session.template = "multi_condition_comparison"
    session.pipeline = "msqrob2"
    session.config = MagicMock()
    session.config.treatment = "DrugA"
    session.config.control = "DMSO"
    session.config.organism = "human"
    session.config.remove_razor = False
    session.config.strict_filtering = False
    session.config.comparisons = [
        {"group1": {"C": "DrugA"}, "group2": {"C": "DMSO"}}
    ]
    session.files = MagicMock()
    session.files.proteomics = [
        MagicMock(filename=f"PSM_Exp_DrugA_{i}.csv") for i in range(1, 4)
    ] + [MagicMock(filename=f"PSM_Exp_DMSO_{i}.csv") for i in range(1, 4)]
    session.markers = {}
    return session


class TestPipelineDerivation:
    def test_explicit_msqrob2(self):
        from app.api.routes.processing import _derive_pipeline
        session = MagicMock()
        session.pipeline = "msqrob2"
        session.template = "multi_condition_comparison"
        assert _derive_pipeline(session) == PipelineTool.MSQROB2

    def test_explicit_msstats(self):
        from app.api.routes.processing import _derive_pipeline
        session = MagicMock()
        session.pipeline = "msstats"
        session.template = "multi_condition_comparison"
        assert _derive_pipeline(session) == PipelineTool.MSSTATS

    def test_backward_compat_no_pipeline_field(self):
        from app.api.routes.processing import _derive_pipeline
        session = MagicMock()
        session.pipeline = None
        session.template = "multi_condition_comparison"
        assert _derive_pipeline(session) == PipelineTool.MSQROB2


class TestTemplateDerivation:
    def test_msstats_template(self):
        from app.api.routes.processing import _derive_template
        result = _derive_template("msstats")
        assert result is not None

    def test_default_fallback(self):
        from app.api.routes.processing import _derive_template
        result = _derive_template("unknown_template")
        assert result is not None  # Falls back to multi_condition


class TestOrchestratorInit:
    def test_stores_session_id(self):
        from app.services.processing_orchestrator import ProcessingOrchestrator
        orch = ProcessingOrchestrator(session_id="test-id")
        assert orch._session_id == "test-id"

    def test_progress_callbacks_initially_empty(self):
        from app.services.processing_orchestrator import ProcessingOrchestrator
        orch = ProcessingOrchestrator(session_id="test-id")
        assert orch.progress_callbacks == []

    def test_set_cancel_event(self):
        from app.services.processing_orchestrator import ProcessingOrchestrator
        import asyncio
        orch = ProcessingOrchestrator(session_id="test-id")
        event = asyncio.Event()
        orch.set_cancel_event(event)
        assert orch._cancel_event is event

    def test_register_progress_callback(self):
        from app.services.processing_orchestrator import ProcessingOrchestrator
        orch = ProcessingOrchestrator(session_id="test-id")

        async def dummy_callback(progress):
            pass

        orch.register_progress_callback(dummy_callback)
        assert len(orch.progress_callbacks) == 1
        assert orch.progress_callbacks[0] is dummy_callback


# ── ProcessingOrchestrator.process_session() Tests ──────────────────────


@pytest.fixture
def mock_engine_result():
    """Mock AnalysisResult returned by PipelineEngine.run()."""
    return AnalysisResult(session_id="test-orch-id")


@pytest.fixture
def orch_config():
    """Minimal AnalysisConfig for orchestrator tests."""
    return AnalysisConfig(
        pipeline=PipelineTool.MSQROB2,
        organism="human",
    )


class TestOrchestratorProcessSession:
    """Tests for process_session() — the main orchestration entry point."""

    def test_success_transitions_to_completed(
        self, mock_session, orch_config, mock_engine_result, tmp_path
    ):
        """Happy path: PROCESSING → COMPLETED state transition."""
        from app.services.processing_orchestrator import ProcessingOrchestrator

        uploads_dir = tmp_path / "uploads"
        results_dir = tmp_path / "results"
        uploads_dir.mkdir()
        results_dir.mkdir()

        orch = ProcessingOrchestrator(session_id="test-orch-id")

        with patch(
            "app.services.processing_orchestrator.PipelineEngine.run",
            new=AsyncMock(return_value=mock_engine_result),
        ), patch(
            "app.services.processing_orchestrator.session_manager"
        ) as mock_sm:
            mock_sm.get_uploads_dir = AsyncMock(return_value=uploads_dir)
            mock_sm.get_results_dir = AsyncMock(return_value=results_dir)
            mock_sm.get_session = AsyncMock(return_value=mock_session)
            mock_sm.update_session_state = AsyncMock()

            import asyncio
            result = asyncio.run(orch.process_session(orch_config))

            assert result is mock_engine_result
            mock_sm.update_session_state.assert_any_call(
                "test-orch-id", SessionState.PROCESSING
            )
            mock_sm.update_session_state.assert_any_call(
                "test-orch-id", SessionState.COMPLETED
            )

    def test_failure_transitions_to_error(
        self, mock_session, orch_config, tmp_path
    ):
        """On engine failure: PROCESSING → ERROR with error message."""
        from app.services.processing_orchestrator import ProcessingOrchestrator

        uploads_dir = tmp_path / "uploads"
        results_dir = tmp_path / "results"
        uploads_dir.mkdir()
        results_dir.mkdir()

        orch = ProcessingOrchestrator(session_id="test-orch-id")

        with patch(
            "app.services.processing_orchestrator.PipelineEngine.run",
            new=AsyncMock(side_effect=ValueError("step 3 failed")),
        ), patch(
            "app.services.processing_orchestrator.session_manager"
        ) as mock_sm:
            mock_sm.get_uploads_dir = AsyncMock(return_value=uploads_dir)
            mock_sm.get_results_dir = AsyncMock(return_value=results_dir)
            mock_sm.get_session = AsyncMock(return_value=mock_session)
            mock_sm.update_session_state = AsyncMock()

            import asyncio
            with pytest.raises(ValueError, match="step 3 failed"):
                asyncio.run(orch.process_session(orch_config))

            mock_sm.update_session_state.assert_any_call(
                "test-orch-id", SessionState.ERROR, "step 3 failed"
            )
