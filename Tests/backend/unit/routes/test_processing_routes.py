"""Unit tests for processing API routes — /process, /cancel, /retry, /logs."""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.api.routes.processing import _build_analysis_config, _derive_pipeline
from app.db.session_store import SessionStore
from app.main import app
from app.models.analysis import AnalysisConfig, Organism, PipelineTool
from app.models.session import (
    ProteomicsFileInfo,
    Session,
    SessionConfig,
    SessionFiles,
    SessionState,
)
from app.services.task_manager import TaskCancelledError
from fastapi.testclient import TestClient

_SESSION_ID = "550e8400-e29b-41d4-a716-446655440000"


@pytest.fixture
def store(tmp_path, monkeypatch):
    """Real SessionStore with isolated sessions_dir."""
    from app.core import config
    monkeypatch.setattr(config.settings, "sessions_dir", tmp_path)
    return SessionStore(sessions_dir=tmp_path)


def _make_session(**overrides):
    kwargs = dict(
        id=_SESSION_ID, name="Test",
        template="multi_condition_comparison", pipeline="msqrob2",
        state=SessionState.CONFIGURING,
        config=SessionConfig(
            treatment="DrugA", control="DMSO", organism="human",
        ),
        files=SessionFiles(),
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    )
    kwargs.update(overrides)
    session = Session(**kwargs)
    # Attach real ProteomicsFileInfo objects (JSON-serializable)
    session.files.proteomics = [
        ProteomicsFileInfo(filename=f"sample_{i}.txt", size=1024)
        for i in range(1, 7)
    ]
    return session


@pytest.fixture
def client(store):
    """TestClient with real SessionStore as dependency override."""
    from app.api.deps import get_session_store

    session = _make_session()
    asyncio.run(store.create(session))

    app.dependency_overrides[get_session_store] = lambda: store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    # Clean up cancel events left by processing tests
    from app.api.routes import processing
    processing._cancel_events.pop(_SESSION_ID, None)


class TestStartProcessing:
    def test_requires_config(self, client, store):
        session = asyncio.run(store.get(_SESSION_ID))
        session.config = None
        asyncio.run(store.update(session))
        response = client.post(
            f"/api/sessions/{_SESSION_ID}/process"
        )
        assert response.status_code == 400

    def test_requires_files(self, client, store):
        session = asyncio.run(store.get(_SESSION_ID))
        session.files.proteomics = []
        asyncio.run(store.update(session))
        response = client.post(
            f"/api/sessions/{_SESSION_ID}/process"
        )
        assert response.status_code == 400

    def test_requires_minimum_files_dia(self, client, store):
        session = asyncio.run(store.get(_SESSION_ID))
        session.config.file_type = "dia"
        session.files.proteomics = [ProteomicsFileInfo(filename="sample_1.txt", size=1024)]  # 1 file < 2
        asyncio.run(store.update(session))
        response = client.post(
            f"/api/sessions/{_SESSION_ID}/process"
        )
        assert response.status_code == 400

    def test_single_file_tmt_passes(self, client, store):
        session = asyncio.run(store.get(_SESSION_ID))
        session.config.file_type = "tmt"
        session.files.proteomics = [ProteomicsFileInfo(filename="sample_1.txt", size=1024)]  # 1 file >= 1
        asyncio.run(store.update(session))
        response = client.post(
            f"/api/sessions/{_SESSION_ID}/process"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["status"] == "started"

    def test_session_not_found(self, client):
        response = client.post(
            "/api/sessions/660e8400-e29b-41d4-a716-446655440001/process"
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_concurrent_requests_schedule_pipeline_once(self, store):
        """The state transition must reject a racing duplicate request."""
        from app.api.routes import processing

        session = _make_session(id="660e8400-e29b-41d4-a716-44665544000c")
        await store.create(session)

        class RacingStore:
            async def get(self, _session_id):
                await asyncio.sleep(0)
                s = await store.get(_session_id)
                return s.model_copy(deep=True)

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

        started = [r for r in results if isinstance(r, dict)]
        conflicts = [
            r for r in results if getattr(r, "status_code", None) == 409
        ]
        assert len(started) == 1
        assert len(conflicts) == 1
        schedule.assert_called_once()
        processing._cancel_events.pop(session.id, None)


class TestCancelProcessing:
    def test_cancel_non_processing_fails(self, client, store):
        session = asyncio.run(store.get(_SESSION_ID))
        session.state = SessionState.CREATED
        asyncio.run(store.update(session))
        response = client.post(
            f"/api/sessions/{_SESSION_ID}/cancel"
        )
        assert response.status_code == 400

    def test_cancel_queued_succeeds(self, client, store):
        session = asyncio.run(store.get(_SESSION_ID))
        session.state = SessionState.QUEUED
        asyncio.run(store.update(session))
        response = client.post(
            f"/api/sessions/{_SESSION_ID}/cancel"
        )
        assert response.status_code == 200
        assert response.json()["data"]["status"] == "cancelled"

    def test_cancel_processing_succeeds(self, client, store):
        session = asyncio.run(store.get(_SESSION_ID))
        session.state = SessionState.PROCESSING
        asyncio.run(store.update(session))
        response = client.post(
            f"/api/sessions/{_SESSION_ID}/cancel"
        )
        assert response.status_code == 200

    def test_cancel_error_state_succeeds(self, client, store):
        session = asyncio.run(store.get(_SESSION_ID))
        session.state = SessionState.ERROR
        asyncio.run(store.update(session))
        response = client.post(
            f"/api/sessions/{_SESSION_ID}/cancel"
        )
        assert response.status_code == 200
        assert response.json()["data"]["status"] == "cancelled"

    def test_cancel_session_not_found(self, client):
        response = client.post(
            "/api/sessions/660e8400-e29b-41d4-a716-446655440002/cancel"
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_background_cancellation_preserves_cancelled_state(self, store):
        from app.api.routes import processing

        session = _make_session()
        await store.create(session)
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
    def test_retry_only_from_error_state(self, client, store):
        session = asyncio.run(store.get(_SESSION_ID))
        session.state = SessionState.COMPLETED
        asyncio.run(store.update(session))
        response = client.post(
            f"/api/sessions/{_SESSION_ID}/retry"
        )
        assert response.status_code == 400

    def test_retry_requires_config(self, client, store):
        session = asyncio.run(store.get(_SESSION_ID))
        session.state = SessionState.ERROR
        session.config = None
        asyncio.run(store.update(session))
        response = client.post(
            f"/api/sessions/{_SESSION_ID}/retry"
        )
        assert response.status_code == 400

    def test_retry_requires_files(self, client, store):
        session = asyncio.run(store.get(_SESSION_ID))
        session.state = SessionState.ERROR
        session.files.proteomics = []
        asyncio.run(store.update(session))
        response = client.post(
            f"/api/sessions/{_SESSION_ID}/retry"
        )
        assert response.status_code == 400

    def test_retry_session_not_found(self, client):
        response = client.post(
            "/api/sessions/660e8400-e29b-41d4-a716-446655440003/retry"
        )
        assert response.status_code == 404


class TestReprocess:
    def test_requires_completed_session(self, client, store):
        session = asyncio.run(store.get(_SESSION_ID))
        session.state = SessionState.ERROR
        asyncio.run(store.update(session))
        response = client.post(
            f"/api/sessions/{_SESSION_ID}/reprocess",
            json={"confirm_replace": True},
        )
        assert response.status_code == 400

    def test_requires_explicit_replace_confirmation(self, client, store):
        session = asyncio.run(store.get(_SESSION_ID))
        session.state = SessionState.COMPLETED
        asyncio.run(store.update(session))
        response = client.post(
            f"/api/sessions/{_SESSION_ID}/reprocess",
            json={"confirm_replace": False},
        )
        assert response.status_code == 400

    def test_schedules_confirmed_reprocess(self, client, store):
        from app.api.routes import processing

        session = asyncio.run(store.get(_SESSION_ID))
        session.state = SessionState.COMPLETED
        asyncio.run(store.update(session))

        with (
            patch.object(processing, "_schedule_background_task") as schedule,
            patch.object(
                processing,
                "run_reprocess_pipeline_async",
                new=MagicMock(return_value=None),
            ),
        ):
            response = client.post(
                f"/api/sessions/{_SESSION_ID}/reprocess",
                json={"confirm_replace": True},
            )

        assert response.status_code == 200
        assert response.json()["data"]["status"] == "started"
        schedule.assert_called_once()
        processing._cancel_events.pop(_SESSION_ID, None)


class TestGetLogs:
    def test_returns_logs(self, client, store):
        asyncio.run(
            store.save_pipeline_state(
                _SESSION_ID,
                {
                    "logs": [{"level": "info", "message": "Step 1 done"}],
                    "completed_steps": [1],
                    "current_step": 2,
                    "completed_at": None,
                    "outputs": None,
                },
            )
        )
        response = client.get(f"/api/sessions/{_SESSION_ID}/logs")
        assert response.status_code == 200
        data = response.json()
        assert len(data["logs"]) == 1
        assert data["completed_steps"] == [1]
        assert data["is_complete"] is False

    def test_no_pipeline_state_returns_defaults(self, client):
        response = client.get(f"/api/sessions/{_SESSION_ID}/logs")
        assert response.status_code == 200
        data = response.json()
        assert data["logs"] == []
        assert data["is_complete"] is False


class TestGetStatus:
    def test_returns_status(self, client):
        response = client.get(
            f"/api/sessions/{_SESSION_ID}/status"
        )
        assert response.status_code == 200
        data = response.json()
        assert "state" in data
        assert "progress" in data

    def test_status_session_not_found(self, client):
        response = client.get(
            "/api/sessions/660e8400-e29b-41d4-a716-446655440004/status"
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
                "condition": "DrugA", "replicate": "1", "batch": "Plate1",
            }
        }
        session_config = SessionConfig(
            treatment="DrugA", control="Vehicle", organism="mouse",
            resolve_shared_peptides=True,
            max_missing_fraction_per_condition=0.25, min_psms_per_protein=3,
            comparisons=[
                {"group1": {"condition": "DrugA"}, "group2": {"condition": "Vehicle"}}
            ],
            metadata_columns=metadata,
            pvalue_threshold=0.02, logfc_threshold=1.5,
            msstats_normalization="quantile", msstats_feature_selection="topN",
            msstats_summary_method="linear", msstats_impute=False,
            msstats_log_base=10, msstats_censored_int="0",
            msstats_max_quantile=0.95, msstats_remove50missing=True,
            msstats_n_top_feature=5, msstats_min_feature_count=4,
            msstats_remove_uninformative_feature_outlier=True,
            msstats_equal_feature_var=False,
            msstats_name_standards="P1,P2", msstats_save_fitted_models=False,
            msstats_n_cores=2,
            msqrob2_ridge=True, msqrob2_normalization="quantiles",
            msqrob2_imputation="knn", msqrob2_aggregation="medianPolish",
            msqrob2_adjust_method="holm", msqrob2_n_cores=3,
            msqrob2_batch_column="batch",
            covariate_columns=["batch"],
            file_type="tmt",
            tmt_channel_mapping={
                "sample.txt::126": {"condition": "DrugA", "replicate": 1}
            },
        )
        session = Session(
            id="config-contract", name="Config contract",
            template="multi_condition_comparison",
            state=SessionState.CONFIGURING, config=session_config,
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
        session = Session(
            id="derive-test-tmt", name="TMT Test",
            state=SessionState.CREATED,
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
            config=SessionConfig(file_type="tmt"),
        )
        result = _derive_pipeline(session)
        assert result == PipelineTool.MSSTATS

    def test_derive_pipeline_dia(self):
        session = Session(
            id="derive-test-dia", name="DIA Test",
            state=SessionState.CREATED,
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
            config=SessionConfig(file_type="dia"),
        )
        result = _derive_pipeline(session)
        assert result == PipelineTool.MSQROB2

    def test_derive_pipeline_legacy(self):
        session = Session(
            id="derive-test-legacy", name="Legacy Test",
            state=SessionState.CREATED,
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
            pipeline="msqrob2",
        )
        result = _derive_pipeline(session)
        assert result == PipelineTool.MSQROB2
