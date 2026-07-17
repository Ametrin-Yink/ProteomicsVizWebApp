"""Track R subprocesses by the session that owns them."""

import logging
import subprocess
import threading
from contextvars import ContextVar, Token

logger = logging.getLogger("proteomics")

_current_session_id: ContextVar[str | None] = ContextVar(
    "r_process_session_id", default=None
)
_processes: dict[str | None, set[subprocess.Popen]] = {}
_lock = threading.Lock()


def set_current_session(session_id: str) -> Token:
    """Associate subsequently launched R processes with a session."""
    return _current_session_id.set(session_id)


def reset_current_session(token: Token) -> None:
    """Restore the previous process-owner context."""
    _current_session_id.reset(token)


def get_current_session() -> str | None:
    """Return the session associated with the current task worker."""
    return _current_session_id.get()


def register_process(
    process: subprocess.Popen, session_id: str | None = None
) -> str | None:
    """Register a subprocess and return the owner used for registration."""
    owner = session_id if session_id is not None else get_current_session()
    with _lock:
        _processes.setdefault(owner, set()).add(process)
    return owner


def unregister_process(
    process: subprocess.Popen, session_id: str | None = None
) -> None:
    """Remove a subprocess from its owner set."""
    owner = session_id if session_id is not None else get_current_session()
    with _lock:
        processes = _processes.get(owner)
        if processes is None:
            return
        processes.discard(process)
        if not processes:
            _processes.pop(owner, None)


def cancel_processes(session_id: str | None = None) -> int:
    """Kill one session's R processes, or every process when no session is given."""
    with _lock:
        if session_id is None:
            targets = [
                process for processes in _processes.values() for process in processes
            ]
            _processes.clear()
        else:
            targets = list(_processes.pop(session_id, set()))

    for process in targets:
        logger.warning(
            "Killing R subprocess PID %s for session %s",
            process.pid,
            session_id or "shutdown",
        )
        try:
            if process.returncode is None:
                process.kill()
                process.wait(timeout=5)
        except Exception as e:
            logger.error("Error killing R subprocess PID %s: %s", process.pid, e)

    return len(targets)
