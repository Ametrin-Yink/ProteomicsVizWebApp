"""Unit tests for processing API routes — /process, /cancel, /retry, /logs."""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.api.routes.processing import _build_analysis_config, _derive_pipeline
from app.main import app
from app.models.analysis import AnalysisConfig, Organism, PipelineTool
from app.models.session import Session, SessionConfig, SessionFiles, SessionState
from app.services.task_manager import TaskCancelledError
from fastapi.testclient import TestClient


@pytest.fixture
def mock_store():
    from datetime import UTC, datetime

    store = AsyncMock()
    session = Session(
        id="550e8400-e29b-41d4-a716-446655440000",
        name="Test",
        template="multi_condition_comparison",
        pipeline="msqrob2",
        state=SessionState.CONFIGURING,
        config=SessionConfig(treatment="DrugA", control="DMSO", organism="human"),
        files=SessionFiles(),
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.files.proteomics = [MagicMock() for _ in range(6)]
    store.get = AsyncMock(return_value=session)
    store.save = AsyncMock()
    store.load_pipeline_state = AsyncMock(
        return_value={
            "logs": [{"level": "info", "message": "Step 1 done"}],
            "completed_steps": [1],
            "current_step": 2,
            "completed_at": None,
            "outputs": None,
        }
    )
    return store


@pytest.fixture
def client(mock_store):
    from app.api.deps import get_session_store

    app.dependency_overrides[get_session_store] = lambda: mock_store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


class TestStartProcessing:
    def test_requires_config(self, client, mock_store):
        mock_store.get.return_value.config = None
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/process"
        )
        assert response.status_code == 400

    def test_requires_files(self, client, mock_store):
        mock_store.get.return_value.files.proteomics = []
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/process"
        )
        assert response.status_code == 400

    def test_requires_minimum_files_dia(self, client, mock_store):
        """DIA session with fewer than 2 files raises 400."""
        mock_store.get.return_value.config.file_type = "dia"
        mock_store.get.return_value.files.proteomics = [MagicMock()]  # 1 file < 2
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/process"
        )
        assert response.status_code == 400

    def test_single_file_tmt_passes(self, client, mock_store):
        """TMT session with 1 file passes (MIN_PROTEOMICS_FILES=1)."""
        mock_store.get.return_value.config.file_type = "tmt"
        mock_store.get.return_value.files.proteomics = [MagicMock()]  # 1 file >= 1
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/process"
        )
        # Should pass validation and return 200 with "started" status
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["status"] == "started"

    def test_session_not_found(self, client, mock_store):
        mock_store.get.return_value = None
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/process"
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_concurrent_requests_schedule_pipeline_once(self, mock_store):
        """The state transition must reject a racing duplicate request."""
        from app.api.routes import processing

        session = mock_store.get.return_value.model_copy(
            update={"id": "concurrent-process-session"}, deep=True
        )

        class RacingStore:
            async def get(self, _session_id):
                await asyncio.sleep(0)
                return session.model_copy(deep=True)

            async def save(self, _session):
                await asyncio.sleep(0)

        with (
            patch.object(
                processing,
                "run_processing_pipeline_async",
                new=MagicMock(return_value=None),
            ),
            patch.object(processing, "_schedule_background_task") as schedule,
        ):
            results = await asyncio.gather(
                processing.start_processing(session.id, RacingStore()),
                processing.start_processing(session.id, RacingStore()),
                return_exceptions=True,
            )

        started = [result for result in results if isinstance(result, dict)]
        conflicts = [
            result for result in results if getattr(result, "status_code", None) == 409
        ]
        assert len(started) == 1
        assert len(conflicts) == 1
        schedule.assert_called_once()
        processing._cancel_events.pop(session.id, None)


class TestCancelProcessing:
    def test_cancel_non_processing_fails(self, client, mock_store):
        mock_store.get.return_value.state = SessionState.CREATED
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/cancel"
        )
        assert response.status_code == 400

    def test_cancel_queued_succeeds(self, client, mock_store):
        mock_store.get.return_value.state = SessionState.QUEUED
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/cancel"
        )
        assert response.status_code == 200
        assert response.json()["data"]["status"] == "cancelled"

    def test_cancel_processing_succeeds(self, client, mock_store):
        mock_store.get.return_value.state = SessionState.PROCESSING
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/cancel"
        )
        assert response.status_code == 200

    def test_cancel_error_state_succeeds(self, client, mock_store):
        """Errored processing must retain an exit path for the user."""
        mock_store.get.return_value.state = SessionState.ERROR
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/cancel"
        )
        assert response.status_code == 200
        assert response.json()["data"]["status"] == "cancelled"

    def test_cancel_session_not_found(self, client, mock_store):
        mock_store.get.return_value = None
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/cancel"
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_background_cancellation_preserves_cancelled_state(self, mock_store):
        from app.api.routes import processing

        session = mock_store.get.return_value
        update_state = AsyncMock()
        with (
            patch.object(
                processing.task_manager,
                "submit",
                new=AsyncMock(side_effect=TaskCancelledError("cancelled")),
            ),
            patch.object(
                processing.session_manager,
                "update_session_state",
                new=update_state,
            ),
        ):
            await processing.run_processing_pipeline_async(session.id, session)

        states = [call.args[1] for call in update_state.await_args_list]
        assert states[-1] == SessionState.CANCELLED
        assert SessionState.ERROR not in states


class TestRetryProcessing:
    def test_retry_only_from_error_state(self, client, mock_store):
        mock_store.get.return_value.state = SessionState.COMPLETED
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/retry"
        )
        assert response.status_code == 400

    def test_retry_requires_config(self, client, mock_store):
        mock_store.get.return_value.state = SessionState.ERROR
        mock_store.get.return_value.config = None
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/retry"
        )
        assert response.status_code == 400

    def test_retry_requires_files(self, client, mock_store):
        mock_store.get.return_value.state = SessionState.ERROR
        mock_store.get.return_value.files.proteomics = []
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/retry"
        )
        assert response.status_code == 400

    def test_retry_session_not_found(self, client, mock_store):
        mock_store.get.return_value = None
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/retry"
        )
        assert response.status_code == 404


class TestGetLogs:
    def test_returns_logs(self, client, mock_store):
        response = client.get("/api/sessions/550e8400-e29b-41d4-a716-446655440000/logs")
        assert response.status_code == 200
        data = response.json()
        assert len(data["logs"]) == 1
        assert data["completed_steps"] == [1]
        assert data["is_complete"] is False

    def test_no_pipeline_state_returns_defaults(self, client, mock_store):
        mock_store.load_pipeline_state.return_value = None
        response = client.get("/api/sessions/550e8400-e29b-41d4-a716-446655440000/logs")
        assert response.status_code == 200
        data = response.json()
        assert data["logs"] == []
        assert data["is_complete"] is False


class TestGetStatus:
    def test_returns_status(self, client, mock_store):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/status"
        )
        assert response.status_code == 200
        data = response.json()
        assert "state" in data
        assert "progress" in data

    def test_status_session_not_found(self, client, mock_store):
        mock_store.get.return_value = None
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/status"
        )
        assert response.status_code == 404


class TestBuildAnalysisConfig:
    """Protect the API-session to scientific-pipeline configuration contract."""

    def test_all_session_config_fields_have_pipeline_destinations(self):
        renamed_fields = {"metadata_columns"}
        direct_fields = set(SessionConfig.model_fields) - renamed_fields
        assert direct_fields <= set(AnalysisConfig.model_fields)

    def test_forwards_non_default_values(self):
        metadata = {
            "sample.txt": {
                "condition": "DrugA",
                "replicate": "1",
                "batch": "Plate1",
            }
        }
        session_config = SessionConfig(
            treatment="DrugA",
            control="Vehicle",
            organism="mouse",
            resolve_shared_peptides=True,
            max_missing_fraction_per_condition=0.25,
            min_psms_per_protein=3,
            comparisons=[
                {
                    "group1": {"condition": "DrugA"},
                    "group2": {"condition": "Vehicle"},
                }
            ],
            metadata_columns=metadata,
            pvalue_threshold=0.02,
            logfc_threshold=1.5,
            msstats_normalization="quantile",
            msstats_feature_selection="topN",
            msstats_summary_method="linear",
            msstats_impute=False,
            msstats_log_base=10,
            msstats_censored_int="0",
            msstats_max_quantile=0.95,
            msstats_remove50missing=True,
            msstats_n_top_feature=5,
            msstats_min_feature_count=4,
            msstats_remove_uninformative_feature_outlier=True,
            msstats_equal_feature_var=False,
            msstats_name_standards="P1,P2",
            msstats_save_fitted_models=False,
            msstats_n_cores=2,
            msqrob2_ridge=True,
            msqrob2_normalization="quantiles",
            msqrob2_imputation="knn",
            msqrob2_aggregation="medianPolish",
            msqrob2_adjust_method="holm",
            msqrob2_n_cores=3,
            msqrob2_batch_column="batch",
            covariate_columns=["batch"],
            file_type="tmt",
            tmt_channel_mapping={
                "sample.txt::126": {"condition": "DrugA", "replicate": 1}
            },
        )
        session = Session(
            id="config-contract",
            name="Config contract",
            template="multi_condition_comparison",
            state=SessionState.CONFIGURING,
            config=session_config,
        )

        analysis_config = _build_analysis_config(session)
        source_values = session_config.model_dump(exclude_none=True)
        source_values.pop("organism")
        source_values.pop("metadata_columns")
        source_values.pop("remove_razor", None)
        source_values.pop("strict_filtering", None)
        source_values.pop("min_peptides_per_protein", None)

        for field, expected in source_values.items():
            assert getattr(analysis_config, field) == expected, field
        assert analysis_config.metadata == metadata
        assert analysis_config.organism == Organism.MOUSE
        assert analysis_config.pipeline == PipelineTool.MSSTATS

    def test_legacy_filter_settings_migrate_to_explicit_options(self):
        session_config = SessionConfig.model_validate(
            {
                "remove_razor": True,
                "strict_filtering": True,
                "min_peptides_per_protein": 3,
            }
        )

        assert session_config.resolve_shared_peptides is True
        assert session_config.max_missing_fraction_per_condition == 0.20
        assert session_config.min_psms_per_protein == 3


class TestDerivePipeline:
    """Test the _derive_pipeline helper function."""

    def test_derive_pipeline_tmt(self):
        """file_type='tmt' returns MSSTATS."""
        session = Session(
            id="derive-test-tmt",
            name="TMT Test",
            state=SessionState.CREATED,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            config=SessionConfig(file_type="tmt"),
        )
        result = _derive_pipeline(session)
        assert result == PipelineTool.MSSTATS

    def test_derive_pipeline_dia(self):
        """file_type='dia' returns MSQROB2."""
        session = Session(
            id="derive-test-dia",
            name="DIA Test",
            state=SessionState.CREATED,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            config=SessionConfig(file_type="dia"),
        )
        result = _derive_pipeline(session)
        assert result == PipelineTool.MSQROB2

    def test_derive_pipeline_legacy(self):
        """No file_type in config, session.pipeline='msqrob2' returns MSQROB2."""
        session = Session(
            id="derive-test-legacy",
            name="Legacy Test",
            state=SessionState.CREATED,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            pipeline="msqrob2",
        )
        result = _derive_pipeline(session)
        assert result == PipelineTool.MSQROB2
