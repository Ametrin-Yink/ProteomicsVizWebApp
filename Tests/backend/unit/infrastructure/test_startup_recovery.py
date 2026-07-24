"""Behavior contract for recovery after an application restart.

Uses a real SessionStore backed by tmp_path. Sessions are created on disk
in various states, then the recovery function is called and the on-disk
state is verified.
"""

import pytest
from app.db.session_store import SessionStore
from app.main import _recover_interrupted_sessions
from app.models.session import Session, SessionState

_RESTART_MSG = "Processing interrupted by server restart. Retry the analysis."


@pytest.mark.asyncio
async def test_restart_makes_interrupted_sessions_retryable(tmp_path):
    """PROCESSING and QUEUED sessions become ERROR; COMPLETED is untouched."""
    store = SessionStore(sessions_dir=tmp_path)

    # Create sessions on disk in each relevant state
    processing = Session(
        id="550e8400-e29b-41d4-a716-446655440001",
        name="Processing", state=SessionState.PROCESSING,
    )
    queued = Session(
        id="550e8400-e29b-41d4-a716-446655440002",
        name="Queued", state=SessionState.QUEUED,
    )
    completed = Session(
        id="550e8400-e29b-41d4-a716-446655440003",
        name="Completed", state=SessionState.COMPLETED,
    )

    for s in (processing, queued, completed):
        await store.create(s)

    recovered = await _recover_interrupted_sessions(store)

    assert recovered == 2

    # Verify on-disk state
    p = await store.get(processing.id)
    assert p.state == SessionState.ERROR
    assert p.error_message == _RESTART_MSG

    q = await store.get(queued.id)
    assert q.state == SessionState.ERROR
    assert q.error_message == _RESTART_MSG

    c = await store.get(completed.id)
    assert c.state == SessionState.COMPLETED
    assert c.error_message is None


@pytest.mark.asyncio
async def test_recovery_skips_corrupt_session_and_continues(tmp_path):
    """A corrupt session file must not prevent recovery of valid sessions."""
    store = SessionStore(sessions_dir=tmp_path)

    # Write a valid PROCESSING session
    valid = Session(
        id="550e8400-e29b-41d4-a716-44665544000a",
        name="Valid", state=SessionState.PROCESSING,
    )
    await store.create(valid)

    # Write a corrupt session.json in a UUID-named directory
    corrupt_id = "550e8400-e29b-41d4-a716-44665544000b"
    corrupt_dir = tmp_path / corrupt_id
    corrupt_dir.mkdir(parents=True)
    (corrupt_dir / "session.json").write_text("{this is not valid json", encoding="utf-8")

    recovered = await _recover_interrupted_sessions(store)

    # The valid session should still be recovered
    assert recovered == 1
    v = await store.get(valid.id)
    assert v.state == SessionState.ERROR
    assert v.error_message == _RESTART_MSG
