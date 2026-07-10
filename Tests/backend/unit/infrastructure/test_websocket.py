"""Unit tests for WebSocket endpoint — connection lifecycle and message handling."""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from app.main import app
from fastapi.testclient import TestClient


@pytest.fixture
def mock_session_manager():
    mgr = MagicMock()
    mgr.register_websocket = AsyncMock()
    mgr.unregister_websocket = AsyncMock()
    return mgr


@pytest.fixture
def mock_store():
    store = AsyncMock()
    store.load_pipeline_state = AsyncMock(return_value=None)
    return store


class TestWebSocketConnection:
    def test_websocket_accepts_connection(
        self, mock_session_manager, mock_store, monkeypatch
    ):
        app.state.session_manager = mock_session_manager
        app.state.session_store = mock_store

        client = TestClient(app)
        with client.websocket_connect(
            "/ws/sessions/550e8400-e29b-41d4-a716-446655440000"
        ) as ws:
            assert ws is not None
            mock_session_manager.register_websocket.assert_awaited_once()

    def test_ping_pong(self, mock_session_manager, mock_store, monkeypatch):
        app.state.session_manager = mock_session_manager
        app.state.session_store = mock_store

        client = TestClient(app)
        with client.websocket_connect(
            "/ws/sessions/550e8400-e29b-41d4-a716-446655440000"
        ) as ws:
            ws.send_text("ping")
            response = ws.receive_text()
            assert "pong" in response

    def test_subscribe_replays_logs(
        self, mock_session_manager, mock_store, monkeypatch
    ):
        app.state.session_manager = mock_session_manager
        mock_store.load_pipeline_state = AsyncMock(
            return_value={
                "logs": [
                    {"level": "info", "message": "Step 1 complete"},
                    {"level": "info", "message": "Step 2 complete"},
                ],
                "completed_steps": [1, 2],
                "completed_at": None,
                "outputs": {},
            }
        )
        app.state.session_store = mock_store

        client = TestClient(app)
        with client.websocket_connect(
            "/ws/sessions/550e8400-e29b-41d4-a716-446655440000"
        ) as ws:
            ws.send_text('{"type":"subscribe"}')
            # Should receive log messages
            response = ws.receive_text()
            data = json.loads(response)
            assert data["type"] == "log"

    def test_subscribe_sends_progress_for_completed_steps(
        self, mock_session_manager, mock_store, monkeypatch
    ):
        app.state.session_manager = mock_session_manager
        mock_store.load_pipeline_state = AsyncMock(
            return_value={
                "logs": [],
                "completed_steps": [1],
                "completed_at": None,
                "outputs": {},
            }
        )
        app.state.session_store = mock_store

        client = TestClient(app)
        with client.websocket_connect(
            "/ws/sessions/550e8400-e29b-41d4-a716-446655440000"
        ) as ws:
            ws.send_text('{"type":"subscribe"}')
            response = ws.receive_text()
            data = json.loads(response)
            assert data["type"] == "progress"
            assert data["payload"]["status"] == "completed"

    def test_unregisters_on_disconnect(
        self, mock_session_manager, mock_store, monkeypatch
    ):
        app.state.session_manager = mock_session_manager
        app.state.session_store = mock_store

        client = TestClient(app)
        with client.websocket_connect(
            "/ws/sessions/550e8400-e29b-41d4-a716-446655440000"
        ):
            pass  # Context exit triggers disconnect

        mock_session_manager.unregister_websocket.assert_awaited()
