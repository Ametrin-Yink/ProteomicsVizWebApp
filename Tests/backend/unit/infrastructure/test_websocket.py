"""Unit tests for WebSocket endpoint — connection lifecycle and message handling.

Uses a real SessionStore and SessionManager wired to app.state so the
WebSocket endpoint exercises real registration, pipeline-state replay,
and cleanup — not just mock-call counting.
"""

import asyncio
import json

import pytest
from app.db.session_store import SessionStore
from app.main import app
from app.services.session_manager import SessionManager, session_manager as global_sm
from fastapi.testclient import TestClient

_SESSION_ID = "550e8400-e29b-41d4-a716-446655440000"


@pytest.fixture
def store(tmp_path, monkeypatch):
    """Real SessionStore with isolated sessions_dir."""
    from app.core import config
    monkeypatch.setattr(config.settings, "sessions_dir", tmp_path)
    return SessionStore(sessions_dir=tmp_path)


@pytest.fixture
def ws_app(store):
    """Wire a real SessionStore + SessionManager into app.state for WebSocket tests."""
    mgr = SessionManager(store=store)
    app.state.session_store = store
    app.state.session_manager = mgr
    # Also update the global singleton (used by other code paths)
    global_sm.store = store
    yield app
    # Clean up WebSocket connections that may have been registered
    mgr._websocket_connections.clear()


class TestWebSocketConnection:
    def test_websocket_accepts_connection(self, ws_app, store):
        client = TestClient(ws_app)
        with client.websocket_connect(
            f"/ws/sessions/{_SESSION_ID}"
        ) as ws:
            assert ws is not None
            # The connection should be registered in our real manager
            mgr = ws_app.state.session_manager
            assert _SESSION_ID in mgr._websocket_connections

    def test_ping_pong(self, ws_app):
        client = TestClient(ws_app)
        with client.websocket_connect(
            f"/ws/sessions/{_SESSION_ID}"
        ) as ws:
            ws.send_text("ping")
            response = ws.receive_text()
            assert "pong" in response

    def test_subscribe_replays_logs(self, ws_app, store):
        # Write pipeline state with logs to disk
        asyncio.run(
            store.save_pipeline_state(
                _SESSION_ID,
                {
                    "logs": [
                        {"level": "info", "message": "Step 1 complete"},
                        {"level": "info", "message": "Step 2 complete"},
                    ],
                    "completed_steps": [1, 2],
                    "completed_at": None,
                    "outputs": {},
                },
            )
        )

        client = TestClient(ws_app)
        with client.websocket_connect(
            f"/ws/sessions/{_SESSION_ID}"
        ) as ws:
            ws.send_text('{"type":"subscribe"}')
            # Should receive log messages from disk
            response = ws.receive_text()
            data = json.loads(response)
            assert data["type"] == "log"

    def test_subscribe_sends_progress_for_completed_steps(self, ws_app, store):
        asyncio.run(
            store.save_pipeline_state(
                _SESSION_ID,
                {
                    "logs": [],
                    "completed_steps": [1],
                    "completed_at": None,
                    "outputs": {},
                },
            )
        )

        client = TestClient(ws_app)
        with client.websocket_connect(
            f"/ws/sessions/{_SESSION_ID}"
        ) as ws:
            ws.send_text('{"type":"subscribe"}')
            response = ws.receive_text()
            data = json.loads(response)
            assert data["type"] == "progress"
            assert data["payload"]["status"] == "completed"

    def test_unregisters_on_disconnect(self, ws_app):
        client = TestClient(ws_app)
        mgr = ws_app.state.session_manager

        with client.websocket_connect(
            f"/ws/sessions/{_SESSION_ID}"
        ):
            pass  # Context exit triggers disconnect

        # After disconnect, the session should be cleaned up
        assert _SESSION_ID not in mgr._websocket_connections
