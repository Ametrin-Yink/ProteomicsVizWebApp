"""Tests for TaskManager — centralized background computation manager."""

import asyncio
import threading
import time

import pytest
from app.services.task_manager import (
    TaskCancelledError,
    TaskKind,
    TaskManager,
    TaskTimeoutError,
)


def test_task_kind_enum():
    assert TaskKind.PIPELINE.value == "pipeline"
    assert TaskKind.GSEA.value == "gsea"
    assert TaskKind.BIONET.value == "bionet"
    assert TaskKind.COMPUTE.value == "compute"


def test_task_manager_creates_pools():
    tm = TaskManager()
    assert tm._pools[TaskKind.GSEA]._max_workers == 3
    assert tm._pools[TaskKind.COMPUTE]._max_workers == 2
    assert tm._pools[TaskKind.BIONET]._max_workers == 2
    assert tm._pools[TaskKind.PIPELINE]._max_workers == 2


def test_task_manager_semaphore_size():
    import os

    tm = TaskManager()
    n_cores = os.cpu_count() or 4
    expected = max(1, n_cores // 2)
    assert tm._cpu_sem._value == expected


@pytest.mark.asyncio
async def test_submit_heavy_task_completes():
    tm = TaskManager()

    def slow_fn(x):
        time.sleep(0.05)
        return x + 1

    result = await tm.submit("550e8400-e29b-41d4-a716-446655440001", TaskKind.COMPUTE, slow_fn, 5, label="add")
    assert result == 6


@pytest.mark.asyncio
async def test_per_session_serialization():
    tm = TaskManager()
    order = []

    async def run(label, delay):
        def fn():
            order.append(f"{label}-start")
            time.sleep(delay)
            order.append(f"{label}-end")
            return label

        return await tm.submit("550e8400-e29b-41d4-a716-446655440001", TaskKind.COMPUTE, fn, label=label)

    task_a = asyncio.create_task(run("a", 0.05))
    await asyncio.sleep(0.01)
    task_b = asyncio.create_task(run("b", 0.02))

    results = await asyncio.gather(task_a, task_b)
    assert results == ["a", "b"]
    a_end = order.index("a-end")
    b_start = order.index("b-start")
    assert a_end < b_start, f"Expected a-end before b-start, got order={order}"


@pytest.mark.asyncio
async def test_cross_session_parallel():
    tm = TaskManager()
    started = []

    async def run(session_id, label, delay):
        def fn():
            started.append(label)
            time.sleep(delay)
            return label

        return await tm.submit(session_id, TaskKind.COMPUTE, fn, label=label)

    task_1 = asyncio.create_task(run("550e8400-e29b-41d4-a716-44665544000a", "A", 0.1))
    task_2 = asyncio.create_task(run("550e8400-e29b-41d4-a716-44665544000b", "B", 0.1))

    results = await asyncio.gather(task_1, task_2)
    assert set(results) == {"A", "B"}
    assert len(started) == 2


@pytest.mark.asyncio
async def test_cancel_queued_task():
    tm = TaskManager()
    cancel_evt = asyncio.Event()

    blocking_started = threading.Event()
    blocking_done = threading.Event()

    def blocking_fn():
        blocking_started.set()
        blocking_done.wait(timeout=5)
        return "done"

    task_blocking = asyncio.create_task(
        tm.submit("550e8400-e29b-41d4-a716-446655440001", TaskKind.COMPUTE, blocking_fn, label="blocker")
    )
    await asyncio.sleep(0)  # Let event loop start the coroutine
    assert blocking_started.wait(timeout=2), "blocker should start within 2s"

    task_queued = asyncio.create_task(
        tm.submit(
            "550e8400-e29b-41d4-a716-446655440001",
            TaskKind.COMPUTE,
            lambda: "never",
            label="queued",
            cancel_event=cancel_evt,
        )
    )
    await asyncio.sleep(0.05)

    assert tm.cancel("550e8400-e29b-41d4-a716-446655440001") is True
    blocking_done.set()

    with pytest.raises(TaskCancelledError):
        await task_queued
    await task_blocking


@pytest.mark.asyncio
async def test_timeout_event_fires():
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
            "550e8400-e29b-41d4-a716-446655440001",
            TaskKind.COMPUTE,
            checking_fn,
            label="timeout-test",
            timeout_event=timeout_evt,
            timeout_seconds=0.1,
        )

    assert checkpoint_hit.is_set()


@pytest.mark.asyncio
async def test_get_status_shows_running_task():
    """get_status returns running tasks for a session."""
    tm = TaskManager()
    done = threading.Event()

    def slow_fn():
        done.wait(timeout=5)
        return "ok"

    task = asyncio.create_task(
        tm.submit("550e8400-e29b-41d4-a716-446655440001", TaskKind.COMPUTE, slow_fn, label="test-task")
    )

    # Yield to event loop until the task transitions to "running".
    # asyncio.sleep(0) yields control without a real delay.
    for _ in range(100):
        await asyncio.sleep(0)
        status = tm.get_status("550e8400-e29b-41d4-a716-446655440001")
        if any(
            t["kind"] == "compute" and t["status"] == "running" for t in status["tasks"]
        ):
            break

    tasks = tm.get_status("550e8400-e29b-41d4-a716-446655440001")["tasks"]
    assert any(
        t["kind"] == "compute" and t["status"] == "running" for t in tasks
    ), f"Expected running task, got: {tasks}"

    done.set()
    await task


@pytest.mark.asyncio
async def test_queue_position_for_blocked_session():
    """Same-session tasks queue behind each other via per-session lock."""
    tm = TaskManager()

    # Submit a slow task to hold the per-session lock
    done = threading.Event()

    def slow_fn():
        done.wait(timeout=5)
        return "ok"

    task_a = asyncio.create_task(
        tm.submit("550e8400-e29b-41d4-a716-446655440001", TaskKind.COMPUTE, slow_fn, label="blocker")
    )

    # Yield enough cycles for task_a to reach the semaphore/executor and
    # hold the per-session lock. We don't block the event loop with a
    # synchronous wait — just yield repeatedly.
    for _ in range(50):
        await asyncio.sleep(0)

    # Submit to same session — per-session lock keeps this queued
    task_b = asyncio.create_task(
        tm.submit("550e8400-e29b-41d4-a716-446655440001", TaskKind.COMPUTE, lambda: "dummy", label="waiter")
    )
    # Yield to let task_b enter the queue
    for _ in range(20):
        await asyncio.sleep(0)

    pos = tm.get_queue_position("550e8400-e29b-41d4-a716-446655440001", TaskKind.COMPUTE)
    assert pos is not None, "Expected task_b to be queued, got pos=None"
    assert pos >= 1

    done.set()
    await asyncio.gather(task_a, task_b, return_exceptions=True)
