"""Unit tests for processing API routes — /process, /cancel, /retry, /logs."""
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from app.models.analysis import PipelineTool
from app.models.session import Session, SessionConfig, SessionFiles, SessionState
from app.main import app
from app.api.routes.processing import _derive_pipeline


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
    store.load_pipeline_state = AsyncMock(return_value={
        "logs": [{"level": "info", "message": "Step 1 done"}],
        "completed_steps": [1],
        "current_step": 2,
        "completed_at": None,
        "outputs": None,
    })
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

    def test_cancel_session_not_found(self, client, mock_store):
        mock_store.get.return_value = None
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/cancel"
        )
        assert response.status_code == 404


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
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/logs"
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["logs"]) == 1
        assert data["completed_steps"] == [1]
        assert data["is_complete"] is False

    def test_no_pipeline_state_returns_defaults(self, client, mock_store):
        mock_store.load_pipeline_state.return_value = None
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/logs"
        )
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
