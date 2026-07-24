"""Tests for session-scoped R subprocess ownership."""

from app.services.r_process_registry import (
    cancel_processes,
    register_process,
    unregister_process,
)


class FakeProcess:
    def __init__(self, pid: int):
        self.pid = pid
        self.returncode = None
        self.killed = False

    def kill(self):
        self.killed = True
        self.returncode = -9

    def wait(self, timeout=None):
        return self.returncode


def test_cancel_processes_only_kills_target_session():
    first = FakeProcess(101)
    second = FakeProcess(202)
    register_process(first, "session-a")
    register_process(second, "session-b")

    try:
        assert cancel_processes("session-a") == 1
        assert first.killed is True
        assert second.killed is False
    finally:
        unregister_process(first, "session-a")
        unregister_process(second, "session-b")
        cancel_processes()


def test_cancel_without_session_kills_all_registered_processes():
    first = FakeProcess(303)
    second = FakeProcess(404)
    register_process(first, "session-a")
    register_process(second, "session-b")

    try:
        assert cancel_processes() == 2
        assert first.killed is True
        assert second.killed is True
    finally:
        unregister_process(first, "session-a")
        unregister_process(second, "session-b")
        cancel_processes()


# ── Context-var session tracking ────────────────────────────────────────


def test_set_and_get_current_session():
    from app.services.r_process_registry import (
        get_current_session,
        reset_current_session,
        set_current_session,
    )

    assert get_current_session() is None
    token = set_current_session("session-1")
    try:
        assert get_current_session() == "session-1"
    finally:
        reset_current_session(token)
    assert get_current_session() is None


def test_reset_restores_previous():
    from app.services.r_process_registry import (
        get_current_session,
        reset_current_session,
        set_current_session,
    )

    token1 = set_current_session("outer")
    assert get_current_session() == "outer"
    token2 = set_current_session("inner")
    assert get_current_session() == "inner"

    reset_current_session(token2)
    assert get_current_session() == "outer"

    reset_current_session(token1)
    assert get_current_session() is None
