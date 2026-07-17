"""Behavior contract for recovery after an application restart."""

from unittest.mock import AsyncMock

import pytest
from app.main import _recover_interrupted_sessions
from app.models.session import Session, SessionState


@pytest.mark.asyncio
async def test_restart_makes_interrupted_sessions_retryable():
    sessions = [
        Session(id="processing", name="Processing", state=SessionState.PROCESSING),
        Session(id="queued", name="Queued", state=SessionState.QUEUED),
        Session(id="completed", name="Completed", state=SessionState.COMPLETED),
    ]
    store = AsyncMock()
    store.list_all.return_value = sessions

    recovered = await _recover_interrupted_sessions(store)

    assert recovered == 2
    assert store.update_session_state.await_count == 2
    for call in store.update_session_state.await_args_list:
        assert call.args[1] == SessionState.ERROR
        assert (
            call.args[2]
            == "Processing interrupted by server restart. Retry the analysis."
        )


@pytest.mark.asyncio
async def test_restart_recovery_continues_after_one_session_fails():
    sessions = [
        Session(id="broken", name="Broken", state=SessionState.PROCESSING),
        Session(id="recoverable", name="Recoverable", state=SessionState.QUEUED),
    ]
    store = AsyncMock()
    store.list_all.return_value = sessions
    store.update_session_state.side_effect = [RuntimeError("corrupt session"), None]

    recovered = await _recover_interrupted_sessions(store)

    assert recovered == 1
    assert [call.args[0] for call in store.update_session_state.await_args_list] == [
        "broken",
        "recoverable",
    ]
