"""
Unit tests for Sessions API routes (visualization state endpoint).
"""

from datetime import UTC
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def mock_store():
    """Mock SessionStore that returns a basic session."""
    from datetime import datetime

    from app.db.session_store import SessionStore
    from app.models.session import Session, SessionState

    session = Session(
        id="test-session-id",
        name="test",
        state=SessionState.COMPLETED,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        markers={},
        volcano_filters=None,
    )

    store = AsyncMock(spec=SessionStore)
    store.get = AsyncMock(return_value=session)
    store.update = AsyncMock()
    return store


@pytest.fixture
def client_with_mock_store(mock_store):
    """TestClient with mocked session store."""
    from app.main import app

    def override_get_store():
        return mock_store

    from app.api.routes.sessions import get_session_store

    app.dependency_overrides[get_session_store] = override_get_store

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


class TestPatchVisualizationState:
    """Test PATCH /api/sessions/{id}/visualization-state endpoint."""

    def test_patch_markers_only(self, client_with_mock_store, mock_store):
        """Can update markers without changing filters."""
        response = client_with_mock_store.patch(
            "/api/sessions/test-session-id/visualization-state",
            json={"markers": {"default": ["P00367", "Q9Y6Q9"]}},
        )
        assert response.status_code == 200
        mock_store.update.assert_awaited_once()
        updated_session = mock_store.update.call_args[0][0]
        assert updated_session.markers == {"default": ["P00367", "Q9Y6Q9"]}
        assert updated_session.volcano_filters is None  # unchanged

    def test_patch_volcano_filters_only(self, client_with_mock_store, mock_store):
        """Can update volcano_filters without changing markers."""
        response = client_with_mock_store.patch(
            "/api/sessions/test-session-id/visualization-state",
            json={
                "volcano_filters": {
                    "foldChange": 2.0,
                    "pValue": 0.01,
                    "adjPValue": 0.05,
                    "s0": 0.2,
                }
            },
        )
        assert response.status_code == 200
        mock_store.update.assert_awaited_once()
        updated_session = mock_store.update.call_args[0][0]
        assert updated_session.volcano_filters["foldChange"] == 2.0
        assert updated_session.markers == {}  # unchanged

    def test_patch_both_fields(self, client_with_mock_store, mock_store):
        """Can update both markers and volcano_filters in one call."""
        response = client_with_mock_store.patch(
            "/api/sessions/test-session-id/visualization-state",
            json={
                "markers": {"default": ["P00367"]},
                "volcano_filters": {
                    "foldChange": 1.5,
                    "pValue": 0.05,
                    "adjPValue": 1,
                    "s0": 0.1,
                },
            },
        )
        assert response.status_code == 200
        mock_store.update.assert_awaited_once()
        updated_session = mock_store.update.call_args[0][0]
        assert updated_session.markers == {"default": ["P00367"]}
        assert updated_session.volcano_filters["foldChange"] == 1.5

    def test_patch_session_not_found(self, client_with_mock_store, mock_store):
        """Returns 404 for non-existent session."""
        mock_store.get = AsyncMock(return_value=None)
        response = client_with_mock_store.patch(
            "/api/sessions/nonexistent-id/visualization-state",
            json={"markers": {"default": ["P00367"]}},
        )
        assert response.status_code == 404


class TestUpdateSession:
    def test_put_updates_session_name(self, client_with_mock_store, mock_store):
        response = client_with_mock_store.put(
            "/api/sessions/test-session-id",
            json={"name": "Updated Name"},
        )
        assert response.status_code == 200
        mock_store.update.assert_awaited_once()

    def test_put_session_not_found(self, client_with_mock_store, mock_store):
        mock_store.get = AsyncMock(return_value=None)
        response = client_with_mock_store.put(
            "/api/sessions/nonexistent-id",
            json={"name": "Test"},
        )
        assert response.status_code == 404

    def test_config_with_pipeline_selection(self, client_with_mock_store, mock_store):
        response = client_with_mock_store.put(
            "/api/sessions/test-session-id/config",
            json={
                "treatment": "DrugA",
                "control": "DMSO",
                "organism": "human",
                "pipeline": "msstats",
            },
        )
        assert response.status_code == 200
        # Verify pipeline was set on the session
        updated = mock_store.update.call_args[0][0]
        assert updated.pipeline == "msstats"

    def test_config_preserves_state_on_second_config(
        self, client_with_mock_store, mock_store
    ):
        response = client_with_mock_store.put(
            "/api/sessions/test-session-id/config",
            json={"treatment": "DrugB", "control": "Vehicle", "organism": "mouse"},
        )
        assert response.status_code == 200
