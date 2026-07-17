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
