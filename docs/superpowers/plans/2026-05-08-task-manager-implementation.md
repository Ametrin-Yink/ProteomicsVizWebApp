# Task Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a centralized TaskManager that isolates background computation into dedicated thread pools with queue visibility, cancel support, and stale-status recovery.

**Architecture:** A singleton `TaskManager` owns per-type `ThreadPoolExecutor` pools (GSEA 3T, Compute 2T, BioNet 2T, Pipeline 2T), a global CPU semaphore, per-type FIFO queues with skip-busy-session policy, and per-session locks. Routes delegate to `task_manager.submit()` instead of `asyncio.create_task(asyncio.to_thread(...))`. Status served from in-memory state, persisted to disk on transitions only.

**Tech Stack:** Python 3.12, asyncio, concurrent.futures.ThreadPoolExecutor, FastAPI, React/TypeScript

---

### Task 0: Setup — Create test file

**Files:**
- Create: `Tests/backend/unit/test_task_manager.py`

- [ ] **Step 1: Create test file skeleton**

```python
"""Tests for TaskManager — centralized background computation manager."""

import asyncio
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from app.services.task_manager import (
    TaskManager,
    TaskKind,
    TaskInfo,
    TaskCancelledError,
    TaskTimeoutError,
    task_manager,  # singleton
)


def test_task_kind_enum():
    """TaskKind covers all defined calculation types."""
    assert TaskKind.PIPELINE.value == "pipeline"
    assert TaskKind.GSEA.value == "gsea"
    assert TaskKind.BIONET.value == "bionet"
    assert TaskKind.COMPUTE.value == "compute"
    assert TaskKind.LIGHT.value == "light"
```

- [ ] **Step 2: Run test to verify it fails (module doesn't exist yet)**

Run: `cd C:\Users\IncyteProteomics\Desktop\Dev\ProteomicsVizWebApp && backend\.venv\Scripts\python.exe -m pytest Tests/backend/unit/test_task_manager.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.task_manager'`

- [ ] **Step 3: Commit**

```bash
git add Tests/backend/unit/test_task_manager.py
git commit -m "test: add task_manager test skeleton

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 1: Core TaskManager — Types, pools, submit, cancel, status

**Files:**
- Create: `backend/app/services/task_manager.py`
- Modify: `Tests/backend/unit/test_task_manager.py`

- [ ] **Step 1: Write tests for TaskKind, TaskInfo, and TaskManager init**

Replace the test skeleton with:

```python
"""Tests for TaskManager — centralized background computation manager."""

import asyncio
import time
import threading
from pathlib import Path

import pytest

from app.services.task_manager import (
    TaskManager,
    TaskKind,
    TaskInfo,
    TaskCancelledError,
    TaskTimeoutError,
    task_manager,
)


def test_task_kind_enum():
    assert TaskKind.PIPELINE.value == "pipeline"
    assert TaskKind.GSEA.value == "gsea"
    assert TaskKind.BIONET.value == "bionet"
    assert TaskKind.COMPUTE.value == "compute"
    assert TaskKind.LIGHT.value == "light"


def test_task_manager_creates_pools():
    tm = TaskManager()
    assert tm._pools[TaskKind.GSEA]._max_workers == 3
    assert tm._pools[TaskKind.COMPUTE]._max_workers == 2
    assert tm._pools[TaskKind.BIONET]._max_workers == 2
    assert tm._pools[TaskKind.PIPELINE]._max_workers == 2
    # LIGHT has no dedicated pool
    assert TaskKind.LIGHT not in tm._pools


def test_task_manager_semaphore_size():
    import os
    tm = TaskManager()
    n_cores = os.cpu_count() or 4
    expected = max(1, n_cores // 2)
    assert tm._cpu_sem._value == expected


@pytest.mark.asyncio
async def test_submit_light_task_runs_immediately():
    """LIGHT tasks bypass queue, semaphore, and session lock."""
    tm = TaskManager()
    results = []

    def fast_fn(x):
        results.append(x)
        return x * 2

    result = await tm.submit("sess-1", TaskKind.LIGHT, fast_fn, 21, label="test")
    assert result == 42
    assert results == [21]
    # LIGHT tasks don't create persistent task state
    assert tm.get_active_count("sess-1") == 0


@pytest.mark.asyncio
async def test_submit_heavy_task_completes():
    """A heavy task acquires semaphore, runs, and returns result."""
    tm = TaskManager()

    def slow_fn(x):
        time.sleep(0.05)
        return x + 1

    result = await tm.submit("sess-1", TaskKind.COMPUTE, slow_fn, 5, label="add")
    assert result == 6


@pytest.mark.asyncio
async def test_per_session_serialization():
    """Only one heavy task runs per session at a time."""
    tm = TaskManager()
    order = []

    async def run(label, delay):
        def fn():
            order.append(f"{label}-start")
            time.sleep(delay)
            order.append(f"{label}-end")
            return label

        return await tm.submit("sess-1", TaskKind.COMPUTE, fn, label=label)

    # Submit two tasks for same session; second should wait for first
    task_a = asyncio.create_task(run("a", 0.05))
    await asyncio.sleep(0.01)  # let task_a start
    task_b = asyncio.create_task(run("b", 0.02))

    results = await asyncio.gather(task_a, task_b)
    assert results == ["a", "b"]
    # a must finish before b starts
    a_end = order.index("a-end")
    b_start = order.index("b-start")
    assert a_end < b_start, f"Expected a-end before b-start, got order={order}"


@pytest.mark.asyncio
async def test_cross_session_parallel():
    """Different sessions can run heavy tasks in parallel."""
    tm = TaskManager()
    started = []
    completed = []

    async def run(session_id, label, delay):
        def fn():
            started.append(label)
            time.sleep(delay)
            completed.append(label)
            return label

        return await tm.submit(session_id, TaskKind.COMPUTE, fn, label=label)

    task_1 = asyncio.create_task(run("sess-A", "A", 0.1))
    task_2 = asyncio.create_task(run("sess-B", "B", 0.1))

    results = await asyncio.gather(task_1, task_2)
    assert set(results) == {"A", "B"}
    # Both started before either completed (parallel)
    assert len(started) == 2


@pytest.mark.asyncio
async def test_cancel_queued_task():
    """Cancel removes a QUEUED task from its queue."""
    tm = TaskManager()
    cancel_evt = asyncio.Event()

    # Start a task to hold the session lock
    blocking_started = threading.Event()
    blocking_done = threading.Event()

    def blocking_fn():
        blocking_started.set()
        blocking_done.wait(timeout=5)
        return "done"

    # Submit blocking task (occupies session)
    task_blocking = asyncio.create_task(
        tm.submit("sess-1", TaskKind.COMPUTE, blocking_fn, label="blocker")
    )
    assert blocking_started.wait(timeout=2), "blocker should start within 2s"

    # Submit second task (will be queued)
    task_queued = asyncio.create_task(
        tm.submit("sess-1", TaskKind.COMPUTE, lambda: "never", label="queued", cancel_event=cancel_evt)
    )
    await asyncio.sleep(0.05)

    # Cancel
    assert tm.cancel("sess-1") is True
    blocking_done.set()

    # Queued task should raise TaskCancelledError
    with pytest.raises(TaskCancelledError):
        await task_queued
    await task_blocking


@pytest.mark.asyncio
async def test_timeout_event_fires():
    """Cooperative timeout event is set after timeout_seconds."""
    tm = TaskManager()
    timeout_evt = threading.Event()

    checkpoint_hit = threading.Event()

    def checking_fn():
        for _ in range(100):
            if timeout_evt.is_set():
                checkpoint_hit.set()
                raise TaskTimeoutError("timed out")
            time.sleep(0.01)

    with pytest.raises(TaskTimeoutError):
        await tm.submit(
            "sess-1", TaskKind.COMPUTE, checking_fn,
            label="timeout-test", timeout_event=timeout_evt, timeout_seconds=0.1
        )

    assert checkpoint_hit.is_set()


@pytest.mark.asyncio
async def test_get_status_and_queue_position():
    """get_status returns active tasks; get_queue_position returns position."""
    tm = TaskManager()
    blocking_started = threading.Event()
    blocking_done = threading.Event()

    def blocking_fn():
        blocking_started.set()
        blocking_done.wait(timeout=5)
        return "ok"

    # Start blocking task
    task_a = asyncio.create_task(
        tm.submit("sess-1", TaskKind.COMPUTE, blocking_fn, label="blocker")
    )
    assert blocking_started.wait(timeout=2)

    # Submit same-type task from different session
    def dummy():
        return "dummy"

    task_b = asyncio.create_task(
        tm.submit("sess-2", TaskKind.COMPUTE, dummy, label="waiter")
    )
    await asyncio.sleep(0.05)

    # Status
    status = tm.get_status("sess-1")
    assert len(status["tasks"]) >= 1
    assert any(t["kind"] == "compute" and t["status"] == "running" for t in status["tasks"])

    # Queue position for sess-2
    pos = tm.get_queue_position("sess-2", TaskKind.COMPUTE)
    assert pos is not None
    assert pos >= 1

    blocking_done.set()
    await asyncio.gather(task_a, task_b, return_exceptions=True)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Users\IncyteProteomics\Desktop\Dev\ProteomicsVizWebApp && backend\.venv\Scripts\python.exe -m pytest Tests/backend/unit/test_task_manager.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement TaskManager**

Write `backend/app/services/task_manager.py`:

```python
"""Centralized task manager for background computation.

Isolates long-running calculations into dedicated thread pools so they
never starve the default asyncio executor used by other endpoints.
"""

import asyncio
import json
import logging
import os
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable

from app.core.config import settings

logger = logging.getLogger("proteomics")


class TaskKind(Enum):
    PIPELINE = "pipeline"
    GSEA = "gsea"
    BIONET = "bionet"
    COMPUTE = "compute"
    LIGHT = "light"


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
PIPELINE_R_STEP_TIMEOUT = 12 * 60 * 60  # steps 6-7


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
            TaskKind.COMPUTE: ThreadPoolExecutor(max_workers=2, thread_name_prefix="compute"),
            TaskKind.BIONET: ThreadPoolExecutor(max_workers=2, thread_name_prefix="bionet"),
            TaskKind.PIPELINE: ThreadPoolExecutor(max_workers=2, thread_name_prefix="pipeline"),
        }

        # Per-type FIFO queues: each holds (session_id, asyncio.Event, TaskInfo)
        self._queues: dict[TaskKind, list[tuple[str, asyncio.Event, TaskInfo]]] = {
            kind: [] for kind in TaskKind if kind != TaskKind.LIGHT
        }

        # Per-session locks: one heavy task per session at a time
        self._session_locks: dict[str, asyncio.Lock] = {}
        # Which session is currently running which task kind
        self._session_active: dict[str, TaskKind | None] = {}

        # Active tasks: task_id -> TaskInfo (in-memory, served to status polls)
        self._active_tasks: dict[str, TaskInfo] = {}

        # Cancel events per session
        self._cancel_events: dict[str, asyncio.Event] = {}
        # Timeout timer threads per task_id
        self._timeout_timers: dict[str, threading.Timer] = {}

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

        LIGHT tasks bypass all queuing/locking and run immediately on the
        default executor. Heavy tasks enter a per-type FIFO queue and
        acquire the per-session lock + global CPU semaphore before running.
        """
        if kind == TaskKind.LIGHT:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, fn, *args)

        task_id = f"{session_id}:{kind.value}:{time.monotonic_ns()}"
        info = TaskInfo(
            task_id=task_id,
            kind=kind,
            session_id=session_id,
            label=label,
            status="queued",
            started_at=datetime.now(timezone.utc).isoformat(),
        )

        if cancel_event is None:
            cancel_event = asyncio.Event()
        self._cancel_events.setdefault(session_id, cancel_event)

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
                raise TaskCancelledError(f"Task {task_id} cancelled while queued")

            # Check if we're at head of queue
            head_session, head_event, head_info = queue[0] if queue else (None, None, None)
            if head_session == session_id and head_info.task_id == task_id:
                # We're at the head. Is our session busy?
                session_lock = self._get_session_lock(session_id)
                if self._session_active.get(session_id) is None:
                    break  # session idle, proceed
                # Session busy — we'll retry via event wait below

            # Wait and recheck
            try:
                await asyncio.wait_for(ready_event.wait(), timeout=1.0)
            except asyncio.TimeoutError:
                pass  # periodic recheck
            ready_event.clear()

            # Update queue position
            try:
                idx = next(i for i, (_, _, qi) in enumerate(queue) if qi.task_id == task_id)
                info.queue_position = idx + 1
            except StopIteration:
                pass  # was dequeued

        # Dequeue ourselves
        queue.pop(0)
        info.queue_position = None

        # Check cancel again before acquiring lock
        if cancel_event.is_set():
            self._active_tasks.pop(task_id, None)
            raise TaskCancelledError(f"Task {task_id} cancelled before start")

        # Acquire per-session lock
        session_lock = self._get_session_lock(session_id)
        async with session_lock:
            if cancel_event.is_set():
                self._active_tasks.pop(task_id, None)
                raise TaskCancelledError(f"Task {task_id} cancelled at lock")

            self._session_active[session_id] = kind

            # Acquire global CPU semaphore
            async with self._cpu_sem:
                if cancel_event.is_set():
                    self._session_active[session_id] = None
                    self._active_tasks.pop(task_id, None)
                    raise TaskCancelledError(f"Task {task_id} cancelled at semaphore")

                info.status = "running"
                info.started_at = datetime.now(timezone.utc).isoformat()
                self._active_tasks[task_id] = info
                self._write_task_status(session_id)

                # Start cooperative timeout timer
                effective_timeout = timeout_seconds or DEFAULT_TIMEOUTS.get(kind, 30 * 60)
                if timeout_event is None:
                    timeout_event = threading.Event()
                timer = threading.Timer(effective_timeout, timeout_event.set)
                timer.daemon = True
                self._timeout_timers[task_id] = timer
                timer.start()

                try:
                    loop = asyncio.get_running_loop()
                    result = await loop.run_in_executor(self._pools[kind], fn, *args)
                    info.status = "completed"
                    info.completed_at = datetime.now(timezone.utc).isoformat()
                    return result
                except TaskCancelledError:
                    info.status = "cancelled"
                    info.error = "Task cancelled"
                    raise
                except TaskTimeoutError:
                    info.status = "timed_out"
                    info.error = "Task timed out"
                    raise
                except Exception as e:
                    logger.exception("Task failed")
                    info.status = "error"
                    info.error = str(e)
                    raise
                finally:
                    timer.cancel()
                    self._timeout_timers.pop(task_id, None)
                    self._session_active[session_id] = None
                    self._active_tasks.pop(task_id, None)
                    self._write_task_status(session_id)
                    # Signal next task in this kind's queue
                    self._wake_next(kind)

    def cancel(self, session_id: str) -> bool:
        """Cancel running + queued tasks for a session. Returns True if anything was cancelled."""
        cancelled = False
        # Set cancel event
        evt = self._cancel_events.get(session_id)
        if evt and not evt.is_set():
            evt.set()
            cancelled = True

        # Remove queued tasks
        for kind, queue in self._queues.items():
            to_remove = [qi.task_id for (sid, _, qi) in queue if sid == session_id]
            for task_id in to_remove:
                self._active_tasks.pop(task_id, None)
            self._queues[kind] = [(sid, ev, qi) for (sid, ev, qi) in queue if sid != session_id]
            if to_remove:
                cancelled = True

        self._write_task_status(session_id)
        return cancelled

    def get_status(self, session_id: str) -> dict:
        """Return all task states for a session (from in-memory state)."""
        tasks = [info for info in self._active_tasks.values() if info.session_id == session_id]
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
        for i, (sid, _, info) in enumerate(self._queues.get(kind, [])):
            if sid == session_id:
                return i + 1
        return None

    def get_active_count(self, session_id: str) -> int:
        """Number of active (queued + running) tasks for a session."""
        return sum(1 for info in self._active_tasks.values()
                   if info.session_id == session_id and info.status in ("queued", "running"))

    # ── Internal helpers ──

    def _get_session_lock(self, session_id: str) -> asyncio.Lock:
        if session_id not in self._session_locks:
            self._session_locks[session_id] = asyncio.Lock()
        return self._session_locks[session_id]

    def _dequeue(self, kind: TaskKind, session_id: str, task_id: str) -> None:
        queue = self._queues[kind]
        self._queues[kind] = [(sid, ev, qi) for (sid, ev, qi) in queue if qi.task_id != task_id]
        self._wake_next(kind)

    def _wake_next(self, kind: TaskKind) -> None:
        queue = self._queues[kind]
        if queue:
            _, ready_event, _ = queue[0]
            ready_event.set()

    def _write_task_status(self, session_id: str) -> None:
        """Persist current task state to disk (fire-and-forget)."""
        try:
            tasks_data = self.get_status(session_id)
            status_file = settings.sessions_dir / session_id / "task_status.json"
            status_file.parent.mkdir(parents=True, exist_ok=True)
            with open(status_file, "w", encoding="utf-8") as f:
                json.dump(tasks_data, f, indent=2, default=str)
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
                with open(status_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                changed = False
                for task in data.get("tasks", []):
                    if task.get("status") in ("running", "queued"):
                        task["status"] = "error"
                        task["error"] = "server_restarted"
                        changed = True
                if changed:
                    with open(status_file, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2, default=str)
            except Exception:
                logger.exception(f"Failed to recover stale tasks for {session_dir.name}")


# Singleton
task_manager = TaskManager()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Users\IncyteProteomics\Desktop\Dev\ProteomicsVizWebApp && backend\.venv\Scripts\python.exe -m pytest Tests/backend/unit/test_task_manager.py -v`
Expected: ALL PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/task_manager.py Tests/backend/unit/test_task_manager.py
git commit -m "feat: add TaskManager with dedicated thread pools per calculation type

- TaskKind enum: PIPELINE, GSEA, BIONET, COMPUTE, LIGHT
- Per-type ThreadPoolExecutor pools with CPU semaphore
- Per-type FIFO queues with skip-busy-session policy
- Per-session lock for serial execution within a session
- Cooperative timeout via threading.Event
- Cancel support: cancel_event.set() + queue removal
- Restart recovery: mark stale running/queued tasks as error
- In-memory status serving, disk persistence on transitions only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Wire GSEA through TaskManager

**Files:**
- Modify: `backend/app/api/routes/visualization.py` — `_background_gsea_run`, `run_gsea_on_demand`, `get_gsea_run_status`
- Modify: `backend/app/services/gsea_service.py` — remove dead `_get_gsea_executor`/`_gsea_run_in_thread`

- [ ] **Step 1: Remove dead executor code from gsea_service.py**

Delete lines 28-46 (the `_gsea_executor`, `_get_gsea_executor`, and `_gsea_run_in_thread` definitions) and the unused `ThreadPoolExecutor` import.

In `backend/app/services/gsea_service.py`, change:

```python
import os
import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Optional
```

to:

```python
import os
import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Callable, Optional
```

And remove lines 28-46:

```python
# Dedicated executor for long-running gseapy prerank calls.
# Isolated from the default asyncio executor so GSEA does not exhaust the
# shared thread pool and block other endpoints (compare, protein list, etc.).
_gsea_executor: ThreadPoolExecutor | None = None


def _get_gsea_executor() -> ThreadPoolExecutor:
    global _gsea_executor
    if _gsea_executor is None:
        n_cores = os.cpu_count() or 4
        max_workers = min(6, n_cores)
        _gsea_executor = ThreadPoolExecutor(max_workers=max_workers)
    return _gsea_executor


async def _gsea_run_in_thread(fn: Callable, *args) -> Any:
    """Run a CPU-bound gseapy call in the dedicated GSEA thread pool."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_get_gsea_executor(), fn, *args)
```

- [ ] **Step 2: Rewrite `_background_gsea_run` to use TaskManager**

In `backend/app/api/routes/visualization.py`, replace `_background_gsea_run` (lines 1132-1185):

```python
async def _background_gsea_run(
    session_id: str,
    request: GseaRunRequest,
    results_dir: Path,
    de_file: Path,
    protein_file: Path,
    gsea_output_dir: Path,
) -> None:
    """Background GSEA run dispatched through TaskManager."""
    from app.services.task_manager import TaskKind, TaskCancelledError, TaskTimeoutError

    comparison = request.comparison
    gsea_output_dir.mkdir(parents=True, exist_ok=True)

    async def on_db_done(db_name: str, success: bool) -> None:
        """Update progress after each database completes (for status bar)."""
        info = task_manager._active_tasks.get(active_task_id)
        if info:
            if info.progress is None:
                info.progress = {"completed": 0, "total": len(request.databases)}
            if success:
                info.progress["completed"] += 1

    def _run_gsea():
        """Run gseapy in the dedicated GSEA thread pool."""
        import asyncio as async_mod
        new_loop = async_mod.new_event_loop()
        async_mod.set_event_loop(new_loop)
        try:
            return new_loop.run_until_complete(
                gsea_service.run_gsea_for_comparison(
                    diff_expression_path=de_file,
                    comparison_name=comparison,
                    output_dir=gsea_output_dir,
                    databases=request.databases,
                    protein_abundance_path=protein_file if protein_file.exists() else None,
                    min_size=request.min_size,
                    max_size=request.max_size,
                    permutations=request.permutations,
                    on_db_complete=on_db_done,
                )
            )
        finally:
            new_loop.close()

    label = f"GSEA: {comparison}"

    try:
        gsea_results = await task_manager.submit(
            session_id=session_id,
            kind=TaskKind.GSEA,
            fn=_run_gsea,
            label=label,
            timeout_seconds=30 * 60,
        )

        # Save results
        results_file = gsea_output_dir / "GSEA_Results.json"
        await asyncio.to_thread(gsea_service.save_results, gsea_results, results_file)

        with _cache_lock:
            _gsea_file_cache.invalidate(str(results_file))

    except TaskCancelledError:
        logger.info(f"GSEA cancelled for {session_id}/{comparison}")
    except TaskTimeoutError:
        logger.error(f"GSEA timed out for {session_id}/{comparison}")
    except Exception as e:
        logger.error(f"Background GSEA failed: {e}")
```

But wait — gseapy's `run_gsea_for_comparison` is async (it uses `asyncio.to_thread` internally). We can't call an async function from within a thread-pool thread without an event loop. We need a different approach: wrap the sync gseapy calls directly.

Let me reconsider. The `run_gsea_for_comparison` is async because it calls `asyncio.to_thread(_run_prerank)` internally. Instead, we can extract the sync parts and call them directly from our dedicated thread.

Actually, the simpler approach: have the TaskManager submit a function that calls `asyncio.run()` with the async gseapy work. This is what the code above does, but it creates its own event loop in the thread.

Let me revise the plan to use a simpler wrapper.

- [ ] **Step 2 (revised): Rewrite `_background_gsea_run` to use TaskManager**

```python
async def _background_gsea_run(
    session_id: str,
    request: GseaRunRequest,
    results_dir: Path,
    de_file: Path,
    protein_file: Path,
    gsea_output_dir: Path,
) -> None:
    """Background GSEA run dispatched through TaskManager."""
    from app.services.task_manager import TaskKind, TaskCancelledError, TaskTimeoutError

    comparison = request.comparison
    gsea_output_dir.mkdir(parents=True, exist_ok=True)
    progress = {"completed": 0, "total": len(request.databases)}

    async def on_db_done(db_name: str, success: bool) -> None:
        if success:
            progress["completed"] += 1

    # Run the async gseapy work in a dedicated thread via TaskManager.
    # gseapy's prerank releases the GIL (compiled .pyd), so threads work well.
    def _run_gsea_sync():
        return asyncio.run(
            gsea_service.run_gsea_for_comparison(
                diff_expression_path=de_file,
                comparison_name=comparison,
                output_dir=gsea_output_dir,
                databases=request.databases,
                protein_abundance_path=protein_file if protein_file.exists() else None,
                min_size=request.min_size,
                max_size=request.max_size,
                permutations=request.permutations,
                on_db_complete=on_db_done,
            )
        )

    label = f"GSEA: {comparison}"

    try:
        gsea_results = await task_manager.submit(
            session_id=session_id,
            kind=TaskKind.GSEA,
            fn=_run_gsea_sync,
            label=label,
            timeout_seconds=30 * 60,
        )

        results_file = gsea_output_dir / "GSEA_Results.json"
        await asyncio.to_thread(gsea_service.save_results, gsea_results, results_file)
        with _cache_lock:
            _gsea_file_cache.invalidate(str(results_file))

    except TaskCancelledError:
        logger.info(f"GSEA cancelled for {session_id}/{comparison}")
    except TaskTimeoutError:
        logger.error(f"GSEA timed out for {session_id}/{comparison}")
    except Exception as e:
        logger.error(f"Background GSEA failed: {e}")
```

- [ ] **Step 3: Rewrite `run_gsea_on_demand` to use TaskManager lock check**

Replace the per-session lock logic (`_gsea_run_locks`) with `task_manager.get_active_count()`:

```python
@router.post("/{session_id}/gsea/run")
async def run_gsea_on_demand(
    session_id: str,
    request: GseaRunRequest,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    results_dir = settings.sessions_dir / session_id / "results"
    de_file = results_dir / f"Diff_Expression_{request.comparison}.tsv"
    if not de_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Differential expression file not found: {de_file.name}",
        )

    # Check if GSEA is already running for this session
    active = task_manager.get_active_count(session_id)
    gsea_running = any(
        t.kind == TaskKind.GSEA and t.status in ("queued", "running")
        for t in task_manager._active_tasks.values()
        if t.session_id == session_id
    )
    if gsea_running:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A GSEA run is already in progress for this session",
        )

    protein_file = results_dir / "Protein_Abundances.tsv"
    gsea_output_dir = results_dir / "gsea" / request.comparison

    task = asyncio.create_task(
        _background_gsea_run(
            session_id=session_id,
            request=request,
            results_dir=results_dir,
            de_file=de_file,
            protein_file=protein_file,
            gsea_output_dir=gsea_output_dir,
        )
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return create_response(
        {
            "status": "started",
            "comparison": request.comparison,
            "databases": request.databases,
        }
    )
```

- [ ] **Step 4: Rewrite `get_gsea_run_status` to read from TaskManager**

Replace the stale-detection logic with a read from TaskManager in-memory state (with disk fallback):

```python
@router.get("/{session_id}/gsea/status")
async def get_gsea_run_status(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Read from TaskManager in-memory state (primary)
    from app.services.task_manager import TaskKind
    tasks = [
        t for t in task_manager._active_tasks.values()
        if t.session_id == session_id and t.kind == TaskKind.GSEA
    ]
    if tasks:
        t = tasks[0]
        databases_val = {}
        if t.progress:
            databases_val = {"completed": t.progress.get("completed", 0), "total": t.progress.get("total", 0)}
        return create_response({
            "status": t.status,
            "started_at": t.started_at,
            "error": t.error,
            "databases": databases_val,
            "queue_position": t.queue_position,
        })

    # Fallback: read from old status file for pre-migration state
    status_data = _read_gsea_status(session_id)
    if status_data is None:
        return create_response({"status": "idle"})

    # Mark stale if running for too long (defense-in-depth)
    if status_data.get("status") == "running" and status_data.get("started_at"):
        try:
            started = datetime.fromisoformat(status_data["started_at"])
            elapsed = datetime.now(timezone.utc) - started
            if elapsed.total_seconds() > GSEA_STALE_TIMEOUT_MINUTES * 60:
                status_data["status"] = "error"
                status_data["error"] = "Server restarted during processing"
                await _write_gsea_status(session_id, status_data)
        except (ValueError, TypeError):
            pass

    return create_response(status_data)
```

- [ ] **Step 5: Remove dead imports and variables**

At the top of `visualization.py`, remove `_gsea_run_locks` (line 1023) and `_gsea_write_locks` (line 1026) since TaskManager handles locking now. Keep `_gsea_status_path`, `_read_gsea_status`, `_write_gsea_status` for the disk fallback.

- [ ] **Step 6: Test manually**

Start the backend, trigger a GSEA run, verify:
- `POST /{id}/gsea/run` returns `{"status": "started"}`
- `GET /{id}/gsea/status` returns running state with progress
- `GET /{id}/tasks` shows the active GSEA task
- Trigger a second GSEA for the same session → 409 conflict
- Cancel via `POST /{id}/tasks/cancel` → task cancels

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/gsea_service.py backend/app/api/routes/visualization.py
git commit -m "refactor: route GSEA through TaskManager dedicated pool

- Remove dead _get_gsea_executor/_gsea_run_in_thread from gsea_service.py
- _background_gsea_run uses task_manager.submit(TaskKind.GSEA, ...)
- run_gsea_on_demand checks active count instead of per-session lock
- get_gsea_run_status reads from TaskManager in-memory state
- Keep old status file read/write as disk fallback

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Wire Compare through TaskManager

**Files:**
- Modify: `backend/app/api/routes/compare.py`

- [ ] **Step 1: Route `trigger_protein_correlation` through TaskManager**

Remove the old status-file pattern and use `task_manager.submit()`:

In `backend/app/api/routes/compare.py`, add import:

```python
from app.services.task_manager import task_manager, TaskKind, TaskCancelledError
```

Replace `trigger_protein_correlation` (lines 297-315):

```python
@router.post("/{session_id}/compare/protein-correlation")
async def trigger_protein_correlation(
    session_id: str,
    req: ProteinCorrelationRequest,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    existing = task_manager.get_active_count(session_id)
    if any(
        t.kind == TaskKind.COMPUTE and t.label == f"Protein: {req.protein_id}"
        for t in task_manager._active_tasks.values()
        if t.session_id == session_id
    ):
        raise HTTPException(status_code=409, detail="Computation already in progress")

    _schedule_background_task(
        _run_protein_correlation_task(session_id, req)
    )
    return {"status": "running"}
```

- [ ] **Step 2: Create `_run_protein_correlation_task` wrapper**

Add a new async wrapper that calls the existing sync function through TaskManager:

```python
async def _run_protein_correlation_task(
    session_id: str, req: ProteinCorrelationRequest
):
    """Run protein correlation through TaskManager."""
    import asyncio as _asyncio
    try:
        await task_manager.submit(
            session_id,
            TaskKind.COMPUTE,
            _run_protein_correlation,
            session_id,
            req,
            label=f"Protein: {req.protein_id}",
            timeout_seconds=10 * 60,
        )
    except TaskCancelledError:
        logger.info(f"Protein correlation cancelled for {session_id}")
    except Exception:
        logger.exception("Protein correlation failed")
```

This passes `session_id` and `req` as positional args to `_run_protein_correlation(session_id, req)`.

- [ ] **Step 3: Apply same pattern to `trigger_comparison_correlation`**

```python
@router.post("/{session_id}/compare/comparison-correlation")
async def trigger_comparison_correlation(
    session_id: str,
    req: ComparisonCorrelationRequest,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    existing = task_manager.get_active_count(session_id)
    if any(
        t.kind == TaskKind.COMPUTE and t.status in ("queued", "running")
        for t in task_manager._active_tasks.values()
        if t.session_id == session_id
    ):
        raise HTTPException(status_code=409, detail="Computation already in progress")

    _schedule_background_task(
        _run_comparison_correlation_task(session_id, req)
    )
    return {"status": "running"}


async def _run_comparison_correlation_task(
    session_id: str, req: ComparisonCorrelationRequest
):
    try:
        await task_manager.submit(
            session_id,
            TaskKind.COMPUTE,
            _run_comparison_correlation,
            session_id,
            req,
            label=f"Compare: {req.primary_comparison}",
            timeout_seconds=10 * 60,
        )
    except TaskCancelledError:
        logger.info(f"Comparison correlation cancelled for {session_id}")
    except Exception:
        logger.exception("Comparison correlation failed")
```

- [ ] **Step 4: Route Venn through TaskManager (same pattern, shorter)**

```python
@router.post("/{session_id}/compare/venn")
async def trigger_venn(
    session_id: str,
    req: VennRequest,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if len(req.comparisons) < 2 or len(req.comparisons) > 3:
        raise HTTPException(status_code=400, detail="Venn requires 2 or 3 comparisons")
    session_dir = str(settings.sessions_dir / session_id)

    # Venn is fast (<5s) — still route through TaskManager for visibility
    result = await task_manager.submit(
        session_id,
        TaskKind.COMPUTE,
        compute_venn_data,
        session_dir,
        req.comparisons,
        req.pvalue_threshold,
        req.logfc_threshold,
        label=f"Venn: {'+'.join(req.comparisons)}",
        timeout_seconds=5 * 60,
    )
    return result
```

Note: `compute_venn_data` takes positional args `(session_dir, comparisons, pvalue_threshold, logfc_threshold)` — matched by the positional `*args` in `submit()`.

- [ ] **Step 5: Remove old session locks for compare**

The `_session_locks` dict and `_get_session_lock` in `compare.py` (lines 47-52) are no longer needed for GSEA-style conflict prevention — TaskManager handles serialization. But keep them if used elsewhere. Check: they're only used in `trigger_protein_correlation` and `trigger_comparison_correlation`, which we just replaced. Remove:

```python
# Remove these lines (46-52 in compare.py):
_session_locks: dict[str, asyncio.Lock] = {}

def _get_session_lock(session_id: str) -> asyncio.Lock:
    if session_id not in _session_locks:
        _session_locks[session_id] = asyncio.Lock()
    return _session_locks[session_id]
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routes/compare.py
git commit -m "refactor: route compare tasks through TaskManager

- protein correlation, comparison correlation, Venn use TaskManager
- Remove per-session lock dict (TaskManager handles it)
- All compare tasks use TaskKind.COMPUTE pool (2 threads)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Wire BioNet through TaskManager

**Files:**
- Modify: `backend/app/api/routes/visualization.py`

- [ ] **Step 1: Rewrite `_background_bionet_run` to use TaskManager**

Match the existing `BioNetService.run_bionet(de_file, config, nodes_csv, edges_csv)` API:

```python
async def _background_bionet_run(
    session_id: str,
    request: BioNetRunRequest,
    results_dir: Path,
    de_file: Path,
) -> None:
    """Background BioNet run dispatched through TaskManager."""
    from app.services.task_manager import TaskKind, TaskCancelledError, TaskTimeoutError
    from app.services.bionet_service import bionet_service
    import pandas as pd

    comparison = request.comparison
    bionet_output_dir = _bionet_output_dir(session_id)
    bionet_output_dir.mkdir(parents=True, exist_ok=True)
    nodes_csv = bionet_output_dir / "nodes.csv"
    edges_csv = bionet_output_dir / "edges.csv"

    def _run_bionet_sync():
        """Run BioNet in the dedicated pool (sync function, no event loop needed)."""
        config_dict = request.model_dump()
        return bionet_service.run_bionet(
            de_file=de_file,
            config=config_dict,
            nodes_csv=nodes_csv,
            edges_csv=edges_csv,
        )

    label = f"BioNet: {comparison}"

    try:
        node_count, edge_count = await task_manager.submit(
            session_id,
            TaskKind.BIONET,
            _run_bionet_sync,
            label=label,
            timeout_seconds=30 * 60,
        )

        # Convert CSVs to JSON for API response
        nodes_df = await asyncio.to_thread(pd.read_csv, nodes_csv)
        edges_df = await asyncio.to_thread(pd.read_csv, edges_csv)
        subnetwork = {
            "nodes": nodes_df.to_dict(orient="records"),
            "edges": edges_df.to_dict(orient="records"),
        }
        subnetwork_path = _bionet_subnetwork_path(session_id)
        await asyncio.to_thread(_write_json_file, subnetwork_path, subnetwork)

    except TaskCancelledError:
        logger.info(f"BioNet cancelled for {session_id}/{comparison}")
    except TaskTimeoutError:
        logger.error(f"BioNet timed out for {session_id}/{comparison}")
    except Exception as e:
        logger.error(f"Background BioNet failed: {e}")
```

- [ ] **Step 2: Update `run_bionet_on_demand` to check active count**

Replace the `_bionet_run_locks` pattern:

```python
@router.post("/{session_id}/bionet/run")
async def run_bionet_on_demand(
    session_id: str,
    request: BioNetRunRequest,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    results_dir = settings.sessions_dir / session_id / "results"
    de_file = results_dir / f"Diff_Expression_{request.comparison}.tsv"
    if not de_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Differential expression file not found: {de_file.name}",
        )

    # Check if BioNet is already running for this session
    bionet_active = any(
        t.kind == TaskKind.BIONET and t.status in ("queued", "running")
        for t in task_manager._active_tasks.values()
        if t.session_id == session_id
    )
    if bionet_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A BioNet run is already in progress for this session",
        )

    task = asyncio.create_task(
        _background_bionet_run(
            session_id=session_id,
            request=request,
            results_dir=results_dir,
            de_file=de_file,
        )
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return create_response({"status": "started", "comparison": request.comparison})
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/routes/visualization.py
git commit -m "refactor: route BioNet through TaskManager dedicated pool

- _background_bionet_run uses task_manager.submit(TaskKind.BIONET, ...)
- run_bionet_on_demand checks active count for conflict detection
- Remove per-session run lock dict (TaskManager handles it)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Wire Pipeline through TaskManager

**Files:**
- Modify: `backend/app/api/routes/processing.py`

- [ ] **Step 1: Remove `_processing_semaphore` and `_queued_sessions`**

Delete lines 24-28:

```python
# Remove these:
_processing_semaphore = asyncio.Semaphore(1)
_queued_sessions: list[str] = []
```

And the `_processing_sessions` set (line 31):

```python
# Remove:
_processing_sessions: set[str] = set()
```

- [ ] **Step 2: Update `run_processing_pipeline_async` to use TaskManager**

Replace the direct execution with TaskManager submission:

In `backend/app/api/routes/processing.py`, add import:

```python
from app.services.task_manager import task_manager, TaskKind
```

Then replace the semaphore-acquire pattern in `run_processing_pipeline_async`. The key change: instead of acquiring `_processing_semaphore`, submit through `task_manager`:

Find the section where the semaphore is acquired (around lines 425-450) and replace with:

```python
async def run_processing_pipeline_async(
    session_id: str,
    session: Session,
    websocket_callback: Callable | None = None,
):
    """Run processing pipeline through TaskManager."""
    try:
        orchestrator = ProcessingOrchestrator(session_id)
        cancel_evt = _cancel_events.setdefault(session_id, asyncio.Event())
        orchestrator.set_cancel_event(cancel_evt)

        pipeline = _derive_pipeline(session)
        template = _derive_template(session.template)
        config = AnalysisConfig(
            template=template,
            pipeline=pipeline,
            organism=session.organism or Organism.HUMAN,
        )

        def _run_pipeline():
            """Run the pipeline synchronously in the dedicated pool."""
            return asyncio.run(
                orchestrator.process_session(config, websocket_callback=websocket_callback)
            )

        label = f"Pipeline ({pipeline.value})"
        # Report queue position if waiting
        queue_pos = task_manager.get_queue_position(session_id, TaskKind.PIPELINE)
        if queue_pos is not None:
            session.state = SessionState.QUEUED
            await store.save(session)  # frontend sees queued state

        await task_manager.submit(
            session_id,
            TaskKind.PIPELINE,
            _run_pipeline,
            label=label,
            timeout_seconds=12 * 60 * 60,
        )

        logger.info(f"Pipeline completed for session {session_id}")

    except TaskCancelledError:
        logger.info(f"Pipeline cancelled for session {session_id}")
        await session_manager.update_session_state(session_id, SessionState.CONFIGURING)
    except Exception as e:
        logger.exception(f"Pipeline failed for session {session_id}: {e}")
        await session_manager.update_session_state(session_id, SessionState.ERROR, str(e))
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/routes/processing.py
git commit -m "refactor: route pipeline through TaskManager PIPELINE pool

- Remove _processing_semaphore (subsumed by TaskManager)
- run_processing_pipeline_async uses task_manager.submit()
- Pipeline runs in dedicated PIPELINE pool (2 threads)
- Queue position reported from TaskManager get_queue_position()

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Add HTTP endpoints for task status and cancel

**Files:**
- Create/Modify: `backend/app/api/routes/visualization.py` (add task routes)

- [ ] **Step 1: Add `GET /{session_id}/tasks` endpoint**

In `visualization.py`, after the existing imports:

```python
@router.get("/{session_id}/tasks")
async def get_session_tasks(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Return all task states for a session (from in-memory TaskManager)."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    return create_response(task_manager.get_status(session_id))
```

- [ ] **Step 2: Add `POST /{session_id}/tasks/cancel` endpoint**

```python
@router.post("/{session_id}/tasks/cancel")
async def cancel_session_tasks(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Cancel all running and queued tasks for a session."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    cancelled = task_manager.cancel(session_id)
    return create_response({"cancelled": cancelled, "status": "cancelled"})
```

- [ ] **Step 3: Test manually**

```bash
# Start backend, then:
curl -s http://localhost:8000/api/sessions/{id}/tasks | python -m json.tool
curl -s -X POST http://localhost:8000/api/sessions/{id}/tasks/cancel | python -m json.tool
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/routes/visualization.py
git commit -m "feat: add GET /tasks and POST /tasks/cancel endpoints

- GET /{session_id}/tasks returns all task states from TaskManager
- POST /{session_id}/tasks/cancel cancels running + queued tasks

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Add TaskStatusBar frontend component

**Files:**
- Create: `frontend/src/components/layout/TaskStatusBar.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useApi } from "@/hooks/useApi";

interface TaskInfo {
  kind: string;
  label: string;
  status: "queued" | "running" | "completed" | "error" | "cancelled";
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  progress: { completed: number; total: number } | null;
  queue_position: number | null;
}

interface TaskStatus {
  tasks: TaskInfo[];
}

export function TaskStatusBar() {
  const api = useApi();
  const [status, setStatus] = useState<TaskStatus>({ tasks: [] });
  const [expanded, setExpanded] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const sessionId = getCurrentSessionId();
      if (!sessionId) return;
      const res = await api.get(`/sessions/${sessionId}/tasks`);
      setStatus(res.data);
    } catch {
      // silently ignore fetch errors
    }
  }, [api]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleCancel = async () => {
    try {
      const sessionId = getCurrentSessionId();
      if (!sessionId) return;
      await api.post(`/sessions/${sessionId}/tasks/cancel`);
      fetchStatus();
    } catch {
      // silently ignore
    }
  };

  const activeTasks = status.tasks.filter(
    (t) => t.status === "running" || t.status === "queued"
  );

  if (activeTasks.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {expanded ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-4 min-w-[320px] max-w-[420px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Tasks ({activeTasks.length})
            </h3>
            <button
              onClick={() => setExpanded(false)}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              ✕
            </button>
          </div>
          {activeTasks.map((task, i) => (
            <div
              key={`${task.kind}-${task.started_at}-${i}`}
              className="mb-2 last:mb-0 p-2 bg-gray-50 dark:bg-gray-750 rounded"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate max-w-[200px]">
                  {task.label || task.kind}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    task.status === "running"
                      ? "bg-blue-100 text-blue-700"
                      : task.status === "queued"
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {task.status === "running"
                    ? "Running"
                    : task.status === "queued"
                    ? `Queued #${task.queue_position || "?"}`
                    : task.status}
                </span>
              </div>
              {task.progress && task.status === "running" && (
                <div className="mt-1 w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all"
                    style={{
                      width: `${(task.progress.completed / task.progress.total) * 100}%`,
                    }}
                  />
                </div>
              )}
              {task.error && (
                <p className="text-xs text-red-500 mt-1 truncate">{task.error}</p>
              )}
            </div>
          ))}
          {activeTasks.some((t) => t.status === "running") && (
            <button
              onClick={handleCancel}
              className="mt-3 w-full text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded px-3 py-1"
            >
              Cancel All
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={() => setExpanded(true)}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-lg p-3 relative hover:bg-gray-50"
        >
          <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-2a8 8 0 110-16 8 8 0 010 16zm-1-5h2v2h-2v-2zm0-8h2v6h-2V7z" />
          </svg>
          <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {activeTasks.length}
          </span>
        </button>
      )}
    </div>
  );
}

function getCurrentSessionId(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/sessions\/([^/]+)/);
  return match ? match[1] : null;
}
```

- [ ] **Step 2: Integrate into app layout**

Find the main layout component (likely `frontend/src/app/layout.tsx` or the session page layout) and add `<TaskStatusBar />` after the main content.

If no single layout component exists, add it to the session page directly. Check: `frontend/src/app/sessions/[id]/page.tsx` or similar.

- [ ] **Step 3: Test manually**

Start frontend, open a session, trigger GSEA. Verify:
- Collapsed icon appears with badge count
- Click to expand — shows running task with progress bar
- Cancel button visible
- After task completes, widget disappears

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/TaskStatusBar.tsx
git add frontend/src/app/  # layout integration
git commit -m "feat: add TaskStatusBar component with queue visibility

- Collapsible bottom-right widget shows running/queued tasks
- Progress bar for GSEA multi-database status
- Cancel button for active tasks
- Polls GET /{session_id}/tasks every 5 seconds
- Auto-hides when no active tasks

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: Clean up old stale-detection code

**Files:**
- Modify: `backend/app/api/routes/visualization.py` — remove `GSEA_STALE_TIMEOUT_MINUTES` stale check
- Modify: `backend/app/api/routes/processing.py` — remove `_is_session_stale` and `_recover_orphaned_sessions`

- [ ] **Step 1: Simplify `get_gsea_run_status`**

Remove the `GSEA_STALE_TIMEOUT_MINUTES` constant and the stale-detection block (lines 1105-1127 in visualization.py), relying solely on TaskManager's init-time recovery.

The `get_gsea_run_status` function after this change should be ~15 lines: read from TaskManager memory, fall back to disk for pre-migration compatibility, return.

- [ ] **Step 2: Remove `_is_session_stale` and `_recover_orphaned_sessions` from processing.py**

Remove `_is_session_stale` function (lines 69-77).
Remove `_recover_orphaned_sessions` function (lines 606-643).
Remove the call to `_recover_orphaned_sessions` from the startup lifespan handler.

- [ ] **Step 3: Verify no imports broken**

```bash
cd backend && ..\.venv\Scripts\python.exe -c "from app.api.routes import visualization, processing; print('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/routes/visualization.py backend/app/api/routes/processing.py
git commit -m "cleanup: remove old stale-detection code

- TaskManager startup scan replaces GSEA_STALE_TIMEOUT_MINUTES check
- TaskManager startup scan replaces _recover_orphaned_sessions
- Single consolidated stale recovery for all task types

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
