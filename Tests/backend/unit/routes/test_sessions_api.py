"""
Unit tests for Sessions API routes (visualization state endpoint).

Uses a real SessionStore backed by tmp_path so session CRUD flows
through the actual persistence layer.
"""

import asyncio
from datetime import UTC, datetime

import pytest
from app.db.session_store import SessionStore
from app.models.session import Session, SessionState
from fastapi.testclient import TestClient

# Distinct UUIDs per test to avoid cross-test pollution
_SID_MARKERS = "550e8400-e29b-41d4-a716-446655440001"
_SID_FILTERS = "550e8400-e29b-41d4-a716-446655440002"
_SID_BOTH = "550e8400-e29b-41d4-a716-446655440003"
_SID_PTM = "550e8400-e29b-41d4-a716-446655440004"
_SID_UPDATE = "550e8400-e29b-41d4-a716-446655440005"
_SID_CONFIG1 = "550e8400-e29b-41d4-a716-446655440006"
_SID_CONFIG2 = "550e8400-e29b-41d4-a716-446655440007"
_SID_LIST = "550e8400-e29b-41d4-a716-446655440008"


@pytest.fixture
def store(tmp_path, monkeypatch):
    """Real SessionStore with isolated sessions_dir."""
    from app.core import config
    monkeypatch.setattr(config.settings, "sessions_dir", tmp_path)
    return SessionStore(sessions_dir=tmp_path)


@pytest.fixture
def client_with_store(store):
    """TestClient with real SessionStore as dependency override."""
    from app.api.deps import get_session_store
    from app.main import app

    app.dependency_overrides[get_session_store] = lambda: store

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


def _persist(store, session):
    """Synchronous helper to persist a session via the async store."""
    asyncio.run(store.create(session))


# ── Visualization State ──────────────────────────────────────────────────


class TestPatchVisualizationState:
    def test_patch_markers_only(self, client_with_store, store):
        session = Session(
            id=_SID_MARKERS, name="test", state=SessionState.COMPLETED,
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
            markers={}, volcano_filters=None,
        )
        _persist(store, session)

        response = client_with_store.patch(
            f"/api/sessions/{_SID_MARKERS}/visualization-state",
            json={"markers": {"default": ["P00367", "Q9Y6Q9"]}},
        )
        assert response.status_code == 200

        updated = asyncio.run(store.get(_SID_MARKERS))
        assert updated.markers == {"default": ["P00367", "Q9Y6Q9"]}
        assert updated.volcano_filters is None

    def test_patch_volcano_filters_only(self, client_with_store, store):
        session = Session(
            id=_SID_FILTERS, name="test", state=SessionState.COMPLETED,
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
            markers={}, volcano_filters=None,
        )
        _persist(store, session)

        response = client_with_store.patch(
            f"/api/sessions/{_SID_FILTERS}/visualization-state",
            json={
                "volcano_filters": {
                    "foldChange": 2.0, "pValue": 0.01,
                    "adjPValue": 0.05, "s0": 0.2,
                }
            },
        )
        assert response.status_code == 200

        updated = asyncio.run(store.get(_SID_FILTERS))
        assert updated.volcano_filters["foldChange"] == 2.0
        assert updated.markers == {}

    def test_patch_both_fields(self, client_with_store, store):
        session = Session(
            id=_SID_BOTH, name="test", state=SessionState.COMPLETED,
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
            markers={}, volcano_filters=None,
        )
        _persist(store, session)

        response = client_with_store.patch(
            f"/api/sessions/{_SID_BOTH}/visualization-state",
            json={
                "markers": {"default": ["P00367"]},
                "volcano_filters": {
                    "foldChange": 1.5, "pValue": 0.05,
                    "adjPValue": 1, "s0": 0.1,
                },
            },
        )
        assert response.status_code == 200

        updated = asyncio.run(store.get(_SID_BOTH))
        assert updated.markers == {"default": ["P00367"]}
        assert updated.volcano_filters["foldChange"] == 1.5

    def test_patch_ptm_filters_by_comparison(self, client_with_store, store):
        session = Session(
            id=_SID_PTM, name="test", state=SessionState.COMPLETED,
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
            markers={}, volcano_filters=None,
        )
        _persist(store, session)

        response = client_with_store.patch(
            f"/api/sessions/{_SID_PTM}/visualization-state",
            json={
                "ptm_volcano_filters": {
                    "Drug_vs_DMSO": {
                        "foldChange": 1, "pValue": 0.05,
                        "adjPValue": 1, "s0": 0.1,
                    }
                }
            },
        )
        assert response.status_code == 200

        updated = asyncio.run(store.get(_SID_PTM))
        assert updated.ptm_volcano_filters["Drug_vs_DMSO"]["s0"] == 0.1

    def test_patch_session_not_found(self, client_with_store):
        """Non-UUID ID raises SessionNotFoundError from real store → 404."""
        response = client_with_store.patch(
            "/api/sessions/660e8400-e29b-41d4-a716-446655440010/visualization-state",
            json={"markers": {"default": ["P00367"]}},
        )
        assert response.status_code == 404


# ── Session Update ───────────────────────────────────────────────────────


class TestUpdateSession:
    def test_put_updates_session_name(self, client_with_store, store):
        session = Session(
            id=_SID_UPDATE, name="Before", state=SessionState.COMPLETED,
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
        )
        _persist(store, session)

        response = client_with_store.put(
            f"/api/sessions/{_SID_UPDATE}",
            json={"name": "Updated Name"},
        )
        assert response.status_code == 200

        updated = asyncio.run(store.get(_SID_UPDATE))
        assert updated.name == "Updated Name"

    def test_put_session_not_found(self, client_with_store):
        response = client_with_store.put(
            "/api/sessions/660e8400-e29b-41d4-a716-446655440020",
            json={"name": "Test"},
        )
        assert response.status_code == 404

    def test_config_with_pipeline_selection(self, client_with_store, store):
        session = Session(
            id=_SID_CONFIG1, name="test", state=SessionState.CREATED,
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
        )
        _persist(store, session)

        response = client_with_store.put(
            f"/api/sessions/{_SID_CONFIG1}/config",
            json={
                "treatment": "DrugA", "control": "DMSO",
                "organism": "human", "pipeline": "msstats",
            },
        )
        assert response.status_code == 200
        updated = asyncio.run(store.get(_SID_CONFIG1))
        assert updated.pipeline == "msstats"

    def test_config_preserves_state_on_second_config(
        self, client_with_store, store
    ):
        session = Session(
            id=_SID_CONFIG2, name="test", state=SessionState.CREATED,
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
        )
        _persist(store, session)

        response = client_with_store.put(
            f"/api/sessions/{_SID_CONFIG2}/config",
            json={"treatment": "DrugB", "control": "Vehicle", "organism": "mouse"},
        )
        assert response.status_code == 200


# ── List Sessions ────────────────────────────────────────────────────────


class TestListSessions:
    def test_includes_pipeline_for_client_routing(self, client_with_store, store):
        session = Session(
            id=_SID_LIST, name="PTM Session", state=SessionState.COMPLETED,
            pipeline="ptm",
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
        )
        _persist(store, session)

        response = client_with_store.get("/api/sessions")

        assert response.status_code == 200
        sessions = response.json()
        assert len(sessions) >= 1
        assert any(s["pipeline"] == "ptm" for s in sessions)
