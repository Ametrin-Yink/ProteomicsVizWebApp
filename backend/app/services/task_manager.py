"""Centralized task manager for background computation.

Isolates long-running calculations into dedicated thread pools so they
never starve the default asyncio executor used by other endpoints.
"""

import asyncio
import json
import logging
import os
import re
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
from typing import Any

from app.core.config import settings
from app.services.r_process_registry import (
    cancel_processes,
    reset_current_session,
    set_current_session,
)

logger = logging.getLogger("proteomics")


class TaskKind(Enum):
    PIPELINE = "pipeline"
    GSEA = "gsea"
    BIONET = "bionet"
    COMPUTE = "compute"


class TaskCancelledError(Exception):
    """Raised when a task is cancelled via cancel_event."""


class TaskTimeoutError(Exception):
    """Raised when a cooperative timeout event fires."""


DEFAULT_TIMEOUTS: dict[TaskKind, int] = {
    TaskKind.PIPELINE: 30 * 60,
    TaskKind.GSEA: 30 * 60,
    TaskKind.BIONET: 30 * 60,
    TaskKind.COMPUTE: 10 * 60,
}


@dataclass
class TaskInfo:
    task_id: str
    kind: TaskKind
    session_id: str
    label: str
    status: str  # queued | running | completed | error | cancelled | timed_out
    started_at: str | None = None
    completed_at: str | None = None
    error: str | None = None
    progress: dict | None = None
    queue_position: int | None = None


class TaskManager:
    """Singleton manager for all background computation tasks.

    Owns per-type ThreadPoolExecutor pools, a global CPU semaphore,
    per-type FIFO queues, and per-session locks.
    """

    def __init__(self):
        n_cores = os.cpu_count() or 4
        semaphore_size = max(1, n_cores // 2)
        self._cpu_sem = asyncio.Semaphore(semaphore_size)

        self._pools: dict[TaskKind, ThreadPoolExecutor] = {
            TaskKind.GSEA: ThreadPoolExecutor(max_workers=3, thread_name_prefix="gsea"),
            TaskKind.COMPUTE: ThreadPoolExecutor(
                max_workers=2, thread_name_prefix="compute"
            ),
            TaskKind.BIONET: ThreadPoolExecutor(
                max_workers=2, thread_name_prefix="bionet"
            ),
            TaskKind.PIPELINE: ThreadPoolExecutor(
                max_workers=2, thread_name_prefix="pipeline"
            ),
        }

        # Per-type FIFO queues: each holds (session_id, asyncio.Event, TaskInfo)
        self._queues: dict[TaskKind, list[tuple[str, asyncio.Event, TaskInfo]]] = {
            kind: [] for kind in TaskKind
        }

        # Per-session locks: one heavy task per session at a time
        self._session_locks: dict[str, asyncio.Lock] = {}
        # Which session is currently running which task kind
        self._session_active: dict[str, TaskKind | None] = {}

        # Active tasks: task_id -> TaskInfo (in-memory, served to status polls)
        self._active_tasks: dict[str, TaskInfo] = {}

        # Cancel events per session
        self._cancel_events: dict[str, asyncio.Event] = {}
        # Recover from restart: mark any stale running/queued tasks
        self._recover_stale_tasks()

    # ── Public API ──

    async def submit(
        self,
        session_id: str,
        kind: TaskKind,
        fn: Callable,
        *args,
        label: str = "",
        cancel_event: asyncio.Event | None = None,
        timeout_event: threading.Event | None = None,
        timeout_seconds: int | None = None,
    ) -> Any:
        """Submit a computation task.

        Tasks enter a per-type FIFO queue and acquire the per-session
        lock + global CPU semaphore before running.
        """
        task_id = f"{session_id}:{kind.value}:{time.monotonic_ns()}"
        info = TaskInfo(
            task_id=task_id,
            kind=kind,
            session_id=session_id,
            label=label,
            status="queued",
            started_at=datetime.now(UTC).isoformat(),
        )

        shared_cancel_event = self._cancel_events.get(session_id)
        if shared_cancel_event is None:
            shared_cancel_event = cancel_event or asyncio.Event()
            self._cancel_events[session_id] = shared_cancel_event
        cancel_event = shared_cancel_event

        # Compute queue position
        queue = self._queues[kind]
        position = len(queue) + 1
        info.queue_position = position

        # Add to queue
        ready_event = asyncio.Event()
        queue.append((session_id, ready_event, info))
        self._active_tasks[task_id] = info
        self._write_task_status(session_id)

        # Wait for turn
        while True:
            if cancel_event.is_set():
                self._dequeue(kind, session_id, task_id)
                self._active_tasks.pop(task_id, None)
                self._cleanup_idle_session(session_id)
                raise TaskCancelledError(f"Task {task_id} cancelled while queued")

            # Check if we're at head of queue
            head_session, _head_event, head_info = (
                queue[0] if queue else (None, None, None)
            )
            if (
                head_session == session_id
                and head_info.task_id == task_id
                and self._session_active.get(session_id) is None
            ):
                break

            import contextlib

            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(ready_event.wait(), timeout=1.0)
            ready_event.clear()

            try:
                idx = next(
                    i for i, (_, _, qi) in enumerate(queue) if qi.task_id == task_id
                )
                info.queue_position = idx + 1
            except StopIteration:
                pass

        # Dequeue ourselves — verify against concurrent cancel()
        popped = queue.pop(0)
        if popped[0] != session_id or popped[2].task_id != task_id:
            # A concurrent cancel() removed our task before we could pop.
            # Put the popped item back and raise cancellation.
            queue.insert(0, popped)
            self._active_tasks.pop(task_id, None)
            raise TaskCancelledError(f"Task {task_id} cancelled by concurrent cancel")
        info.queue_position = None

        if cancel_event.is_set():
            self._active_tasks.pop(task_id, None)
            raise TaskCancelledError(f"Task {task_id} cancelled before start")

        session_lock = self._get_session_lock(session_id)
        async with session_lock:
            if cancel_event.is_set():
                self._active_tasks.pop(task_id, None)
                raise TaskCancelledError(f"Task {task_id} cancelled at lock")

            self._session_active[session_id] = kind

            async with self._cpu_sem:
                if cancel_event.is_set():
                    self._session_active[session_id] = None
                    self._active_tasks.pop(task_id, None)
                    raise TaskCancelledError(f"Task {task_id} cancelled at semaphore")

                info.status = "running"
                info.started_at = datetime.now(UTC).isoformat()
                self._active_tasks[task_id] = info
                self._write_task_status(session_id)

                effective_timeout = timeout_seconds or DEFAULT_TIMEOUTS.get(
                    kind, 30 * 60
                )
                if timeout_event is None:
                    timeout_event = threading.Event()

                worker_future: asyncio.Future | None = None
                cancel_waiter: asyncio.Task | None = None
                lingering_worker = False

                try:
                    loop = asyncio.get_running_loop()

                    def run_with_session_context():
                        token = set_current_session(session_id)
                        try:
                            return fn(*args)
                        finally:
                            reset_current_session(token)

                    worker_future = loop.run_in_executor(
                        self._pools[kind], run_with_session_context
                    )
                    cancel_waiter = asyncio.create_task(cancel_event.wait())
                    done, _ = await asyncio.wait(
                        {worker_future, cancel_waiter},
                        timeout=effective_timeout,
                        return_when=asyncio.FIRST_COMPLETED,
                    )

                    if not done:
                        timeout_event.set()
                        cancel_event.set()
                        self._kill_r_processes(session_id)
                        lingering_worker = not worker_future.done()
                        if lingering_worker:
                            self._track_lingering_worker(
                                worker_future, session_id, kind
                            )
                        raise TaskTimeoutError(
                            f"Task {task_id} timed out after {effective_timeout}s"
                        )

                    if cancel_waiter in done and cancel_event.is_set():
                        self._kill_r_processes(session_id)
                        lingering_worker = not worker_future.done()
                        if lingering_worker:
                            self._track_lingering_worker(
                                worker_future, session_id, kind
                            )
                        raise TaskCancelledError(f"Task {task_id} cancelled")

                    result = await worker_future
                    info.status = "completed"
                    info.completed_at = datetime.now(UTC).isoformat()
                    return result
                except TaskCancelledError:
                    info.status = "cancelled"
                    info.error = "Task cancelled"
                    raise
                except TaskTimeoutError:
                    info.status = "timed_out"
                    info.error = "Task timed out"
                    raise
                except asyncio.CancelledError:
                    info.status = "cancelled"
                    info.error = "Task coroutine cancelled"
                    if worker_future is not None and not worker_future.done():
                        cancel_event.set()
                        self._kill_r_processes(session_id)
                        lingering_worker = True
                        self._track_lingering_worker(worker_future, session_id, kind)
                    raise
                except Exception as e:
                    logger.exception("Task failed")
                    info.status = "error"
                    info.error = str(e)
                    raise
                finally:
                    if cancel_waiter is not None:
                        cancel_waiter.cancel()
                    self._active_tasks.pop(task_id, None)
                    if not lingering_worker:
                        self._release_session(session_id, kind)
                    else:
                        self._write_task_status(session_id)

    def cancel(self, session_id: str) -> bool:
        """Cancel running + queued tasks for a session. Returns True if anything was cancelled."""
        cancelled = False
        evt = self._cancel_events.get(session_id)
        if evt and not evt.is_set():
            evt.set()
            cancelled = True

        for kind, queue in self._queues.items():
            to_remove = [qi.task_id for (sid, _, qi) in queue if sid == session_id]
            for task_id in to_remove:
                self._active_tasks.pop(task_id, None)
            self._queues[kind] = [
                (sid, ev, qi) for (sid, ev, qi) in queue if sid != session_id
            ]
            if to_remove:
                cancelled = True
                self._wake_next(kind)

        # Kill any running R subprocess for this session
        self._kill_r_processes(session_id)
        self._cleanup_idle_session(session_id)

        self._write_task_status(session_id)
        return cancelled

    def _kill_r_processes(self, session_id: str) -> None:
        """Kill only the R subprocesses owned by one session."""
        try:
            cancel_processes(session_id)
        except Exception as e:
            logger.warning("Error killing R processes: %s", e)

    def get_status(self, session_id: str) -> dict:
        """Return all task states for a session (from in-memory state)."""
        tasks = [
            info
            for info in self._active_tasks.values()
            if info.session_id == session_id
        ]
        return {
            "tasks": [
                {
                    "kind": t.kind.value,
                    "label": t.label,
                    "status": t.status,
                    "started_at": t.started_at,
                    "completed_at": t.completed_at,
                    "error": t.error,
                    "progress": t.progress,
                    "queue_position": t.queue_position,
                }
                for t in tasks
            ]
        }

    def get_queue_position(self, session_id: str, kind: TaskKind) -> int | None:
        """Return 1-based queue position for a session in a task kind's queue, or None."""
        for i, (sid, _, _info) in enumerate(self._queues.get(kind, [])):
            if sid == session_id:
                return i + 1
        return None

    def get_active_count(self, session_id: str) -> int:
        """Number of active (queued + running) tasks for a session."""
        return sum(
            1
            for info in self._active_tasks.values()
            if info.session_id == session_id and info.status in ("queued", "running")
        )

    def has_active_task(self, session_id: str, kind: TaskKind) -> bool:
        """True if session has a queued or running task of the given kind."""
        return any(
            info.kind == kind and info.status in ("queued", "running")
            for info in self._active_tasks.values()
            if info.session_id == session_id
        )

    # ── Internal helpers ──

    def _get_session_lock(self, session_id: str) -> asyncio.Lock:
        if session_id not in self._session_locks:
            self._session_locks[session_id] = asyncio.Lock()
        return self._session_locks[session_id]

    def _dequeue(self, kind: TaskKind, session_id: str, task_id: str) -> None:
        queue = self._queues[kind]
        self._queues[kind] = [
            (sid, ev, qi) for (sid, ev, qi) in queue if qi.task_id != task_id
        ]
        self._wake_next(kind)

    def _wake_next(self, kind: TaskKind) -> None:
        queue = self._queues[kind]
        if queue:
            _, ready_event, _ = queue[0]
            ready_event.set()

    def _track_lingering_worker(
        self,
        worker_future: asyncio.Future,
        session_id: str,
        kind: TaskKind,
    ) -> None:
        """Keep a timed-out or cancelled session blocked until its thread exits."""

        def release_when_done(completed: asyncio.Future) -> None:
            if not completed.cancelled():
                try:
                    completed.exception()
                except Exception:
                    logger.debug("Lingering worker exited with an error", exc_info=True)
            self._release_session(session_id, kind)

        worker_future.add_done_callback(release_when_done)

    def _release_session(self, session_id: str, kind: TaskKind) -> None:
        """Release task ownership and wake the next queued task."""
        if self.get_active_count(session_id) == 0:
            self._session_active.pop(session_id, None)
            self._session_locks.pop(session_id, None)
            self._cancel_events.pop(session_id, None)
        else:
            self._session_active[session_id] = None
        self._write_task_status(session_id)
        self._wake_next(kind)

    def _cleanup_idle_session(self, session_id: str) -> None:
        """Remove per-session coordination state when no task owns it."""
        if (
            self.get_active_count(session_id) == 0
            and self._session_active.get(session_id) is None
        ):
            self._session_active.pop(session_id, None)
            self._session_locks.pop(session_id, None)
            self._cancel_events.pop(session_id, None)

    # Match SessionStore._get_session_dir() UUID validation to prevent
    # non-UUID session directories from being created outside the store.
    _UUID_RE = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        re.IGNORECASE,
    )

    def _write_task_status(self, session_id: str) -> None:
        """Persist current task state to disk (fire-and-forget).

        Only writes for valid UUID session IDs — non-UUID IDs are silently
        skipped to prevent creating session directories outside SessionStore.
        """
        if not self._UUID_RE.match(session_id):
            return
        try:
            tasks_data = self.get_status(session_id)
            status_file = settings.sessions_dir / session_id / "task_status.json"
            status_file.parent.mkdir(parents=True, exist_ok=True)
            status_file.write_text(
                json.dumps(tasks_data, indent=2, default=str),
                encoding="utf-8",
            )
        except Exception:
            logger.exception(f"Failed to write task_status for {session_id}")

    def _recover_stale_tasks(self) -> None:
        """On startup, mark any running/queued tasks as error: server_restarted."""
        sessions_dir = settings.sessions_dir
        if not sessions_dir.exists():
            return
        for session_dir in sessions_dir.iterdir():
            status_file = session_dir / "task_status.json"
            if not status_file.exists():
                continue
            try:
                data = json.loads(status_file.read_text(encoding="utf-8"))
                changed = False
                for task in data.get("tasks", []):
                    if task.get("status") in ("running", "queued"):
                        task["status"] = "error"
                        task["error"] = "server_restarted"
                        changed = True
                if changed:
                    status_file.write_text(
                        json.dumps(data, indent=2, default=str),
                        encoding="utf-8",
                    )
            except Exception:
                logger.exception(
                    f"Failed to recover stale tasks for {session_dir.name}"
                )


# Singleton
task_manager = TaskManager()
