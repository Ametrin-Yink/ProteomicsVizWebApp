"""Unit tests for GSEA API routes — run, status, data, plot, heatmap."""
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    from datetime import UTC, datetime

    from app.core import config
    monkeypatch.setattr(config.settings, "sessions_dir", tmp_path)

    from app.models.session import Session, SessionConfig, SessionFiles, SessionState
    session = Session(
        id="550e8400-e29b-41d4-a716-446655440000",
        name="Test", template="multi_condition_comparison",
        pipeline="msqrob2", state=SessionState.COMPLETED,
        config=SessionConfig(treatment="A", control="B", organism="human"),
        files=SessionFiles(),
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    )

    mock_store = AsyncMock()
    mock_store.get = AsyncMock(return_value=session)

    from app.api.deps import get_session_store
    app.dependency_overrides[get_session_store] = lambda: mock_store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


class TestGseaStatus:
    def test_returns_idle_when_no_status(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/status"
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["status"] == "idle"


class TestGseaData:
    def test_returns_results_structure(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/go_bp"
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert "results" in data
        assert "database" in data

    def test_rejects_invalid_database(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/invalid_db"
        )
        assert response.status_code == 400


class TestGseaPlot:
    def test_missing_pathway_returns_404(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/go_bp/plot"
            "?term=nonexistent_pathway"
        )
        assert response.status_code == 404

    def test_invalid_database_returns_400(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/bad_db/plot"
            "?term=test"
        )
        assert response.status_code == 400


class TestGseaHeatmap:
    def test_missing_pathway_returns_404(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/go_bp/heatmap"
            "?term=nonexistent"
        )
        assert response.status_code == 404
