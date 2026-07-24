"""Unit tests for SessionManager — session lifecycle and WebSocket management.

Uses a real SessionStore backed by tmp_path so session persistence is
exercised end-to-end. WebSocket objects remain MagicMock stubs because
the framework does not expose a trivially constructible WebSocket.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from app.db.session_store import SessionStore
from app.models.session import SessionCreate, SessionState
from app.services.session_manager import SessionManager


@pytest.fixture
def store(tmp_path):
    """Real SessionStore writing to a temp directory."""
    return SessionStore(sessions_dir=tmp_path)


@pytest.fixture
def manager(store):
    """Real SessionManager backed by the real store."""
    return SessionManager(store=store)


# ── Session Creation ────────────────────────────────────────────────────


class TestCreateSession:
    @pytest.mark.asyncio
    async def test_creates_session_with_valid_name(self, manager, store, tmp_path):
        data = SessionCreate(
            name="My Experiment", template="multi_condition_comparison"
        )
        session = await manager.create_session(data)

        assert session is not None
        assert session.name == "My Experiment"
        assert session.template == "multi_condition_comparison"
        assert session.state == SessionState.CREATED

        # Verify the session was persisted to disk
        session_file = tmp_path / session.id / "session.json"
        assert session_file.exists(), "Session file must be written to disk"

        # Verify we can re-read it through the store
        reloaded = await store.get(session.id)
        assert reloaded.name == "My Experiment"
        assert reloaded.state == SessionState.CREATED

    @pytest.mark.asyncio
    async def test_rejects_empty_name(self, manager):
        with pytest.raises(Exception):
            await manager.create_session(
                SessionCreate(name="", template="multi_condition_comparison")
            )

    @pytest.mark.asyncio
    async def test_rejects_name_too_long(self, manager):
        with pytest.raises(Exception):
            await manager.create_session(
                SessionCreate(name="x" * 201, template="multi_condition_comparison")
            )

    @pytest.mark.asyncio
    async def test_validates_name_characters(self, manager):
        with pytest.raises(Exception):
            await manager.create_session(
                SessionCreate(
                    name="test<script>", template="multi_condition_comparison"
                )
            )


# ── State Transitions ───────────────────────────────────────────────────


class TestUpdateSessionState:
    @pytest.mark.asyncio
    async def test_persists_state_transition_to_disk(self, manager, store):
        """Updating session state must survive a re-read from the store."""
        session = await manager.create_session(
            SessionCreate(name="State test", template="multi_condition_comparison")
        )

        updated = await manager.update_session_state(
            session.id,
            SessionState.COMPLETED,
        )

        assert updated.state == SessionState.COMPLETED

        # Re-read from disk — the state change must be durable
        reloaded = await store.get(session.id)
        assert reloaded.state == SessionState.COMPLETED

    @pytest.mark.asyncio
    async def test_persists_error_message_with_state(self, manager, store):
        session = await manager.create_session(
            SessionCreate(name="Error test", template="multi_condition_comparison")
        )

        await manager.update_session_state(
            session.id, SessionState.ERROR, "R script failed"
        )

        reloaded = await store.get(session.id)
        assert reloaded.state == SessionState.ERROR
        assert reloaded.error_message == "R script failed"


# ── WebSocket Management ────────────────────────────────────────────────


class TestWebSocketManagement:
    @pytest.mark.asyncio
    async def test_register_websocket(self, manager):
        ws = MagicMock()
        await manager.register_websocket("session-1", ws)
        assert "session-1" in manager._websocket_connections
        assert ws in manager._websocket_connections["session-1"]

    @pytest.mark.asyncio
    async def test_unregister_removes_specific_websocket(self, manager):
        ws1 = MagicMock()
        ws2 = MagicMock()
        await manager.register_websocket("session-1", ws1)
        await manager.register_websocket("session-1", ws2)

        await manager.unregister_websocket("session-1", ws1)

        assert ws1 not in manager._websocket_connections["session-1"]
        assert ws2 in manager._websocket_connections["session-1"]

    @pytest.mark.asyncio
    async def test_unregister_cleans_empty_session(self, manager):
        ws = MagicMock()
        await manager.register_websocket("session-1", ws)
        await manager.unregister_websocket("session-1", ws)

        # Session key should be removed when no connections remain
        assert "session-1" not in manager._websocket_connections

    @pytest.mark.asyncio
    async def test_send_progress_update_to_all_connections(self, manager):
        ws1 = MagicMock()
        ws1.send_json = AsyncMock()
        ws2 = MagicMock()
        ws2.send_json = AsyncMock()
        await manager.register_websocket("session-1", ws1)
        await manager.register_websocket("session-1", ws2)

        progress = {"step": 3, "status": "running", "progress": 75}
        await manager.send_progress_update("session-1", progress)

        ws1.send_json.assert_awaited_once()
        ws2.send_json.assert_awaited_once()
        sent = ws1.send_json.call_args[0][0]
        assert sent["type"] == "progress"
        assert sent["payload"]["step"] == 3
        assert sent["payload"]["status"] == "running"

    @pytest.mark.asyncio
    async def test_send_complete_message(self, manager):
        ws = MagicMock()
        ws.send_json = AsyncMock()
        await manager.register_websocket("session-1", ws)

        outputs = {"diff_expression": "Diff_Expression.tsv"}
        await manager.send_complete_message(
            "session-1", outputs=outputs, duration=120.5
        )

        ws.send_json.assert_awaited_once()
        sent = ws.send_json.call_args[0][0]
        assert sent["type"] == "complete"
        assert sent["payload"]["outputs"] == outputs
        assert sent["payload"]["duration"] == 120.5
