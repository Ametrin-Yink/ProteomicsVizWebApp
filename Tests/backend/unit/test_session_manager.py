"""Unit tests for SessionManager — session lifecycle and WebSocket management."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.models.session import SessionCreate, SessionState


@pytest.fixture
def mock_store():
    store = AsyncMock()
    store.get = AsyncMock()
    store.create = AsyncMock()
    store.save = AsyncMock()
    store.update = AsyncMock()
    store.delete = AsyncMock()
    store.list_all = AsyncMock(return_value=[])
    store.load_pipeline_state = AsyncMock(return_value=None)
    return store


@pytest.fixture
def manager(mock_store):
    from app.services.session_manager import SessionManager
    return SessionManager(store=mock_store)


class TestCreateSession:
    @pytest.mark.asyncio
    async def test_creates_session_with_valid_name(self, manager, mock_store):
        data = SessionCreate(name="My Experiment", template="multi_condition_comparison")
        result = await manager.create_session(data)
        assert result is not None
        mock_store.create.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_rejects_empty_name(self, manager, mock_store):
        with pytest.raises(Exception):
            await manager.create_session(
                SessionCreate(name="", template="multi_condition_comparison")
            )

    @pytest.mark.asyncio
    async def test_rejects_name_too_long(self, manager, mock_store):
        with pytest.raises(Exception):
            await manager.create_session(
                SessionCreate(name="x" * 201, template="multi_condition_comparison")
            )

    @pytest.mark.asyncio
    async def test_validates_name_characters(self, manager, mock_store):
        with pytest.raises(Exception):
            await manager.create_session(
                SessionCreate(name="test<script>", template="multi_condition_comparison")
            )


class TestUpdateSessionState:
    @pytest.mark.asyncio
    async def test_delegates_to_store(self, manager, mock_store):
        mock_store.update_session_state = AsyncMock()
        session = MagicMock()
        mock_store.update_session_state.return_value = session

        result = await manager.update_session_state(
            "550e8400-e29b-41d4-a716-446655440000",
            SessionState.COMPLETED,
        )
        mock_store.update_session_state.assert_awaited_once_with(
            "550e8400-e29b-41d4-a716-446655440000",
            SessionState.COMPLETED,
            None,
        )
        assert result is session

    @pytest.mark.asyncio
    async def test_delegates_with_error_message(self, manager, mock_store):
        mock_store.update_session_state = AsyncMock()
        session = MagicMock()
        mock_store.update_session_state.return_value = session

        await manager.update_session_state(
            "test-id", SessionState.ERROR, "R script failed"
        )
        mock_store.update_session_state.assert_awaited_once_with(
            "test-id", SessionState.ERROR, "R script failed"
        )


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
        await manager.send_complete_message("session-1", outputs=outputs, duration=120.5)

        ws.send_json.assert_awaited_once()
        sent = ws.send_json.call_args[0][0]
        assert sent["type"] == "complete"
        assert sent["payload"]["outputs"] == outputs
        assert sent["payload"]["duration"] == 120.5
