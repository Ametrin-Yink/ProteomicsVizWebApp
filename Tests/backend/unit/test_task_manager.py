"""Tests for TaskManager — centralized background computation manager."""

import asyncio
import time
import threading

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
    assert TaskKind.LIGHT not in tm._pools


def test_task_manager_semaphore_size():
    import os
    tm = TaskManager()
    n_cores = os.cpu_count() or 4
    expected = max(1, n_cores // 2)
    assert tm._cpu_sem._value == expected


@pytest.mark.asyncio
async def test_submit_light_task_runs_immediately():
    tm = TaskManager()
    results = []

    def fast_fn(x):
        results.append(x)
        return x * 2

    result = await tm.submit("sess-1", TaskKind.LIGHT, fast_fn, 21, label="test")
    assert result == 42
    assert results == [21]
    assert tm.get_active_count("sess-1") == 0


@pytest.mark.asyncio
async def test_submit_heavy_task_completes():
    tm = TaskManager()

    def slow_fn(x):
        time.sleep(0.05)
        return x + 1

    result = await tm.submit("sess-1", TaskKind.COMPUTE, slow_fn, 5, label="add")
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
        return await tm.submit("sess-1", TaskKind.COMPUTE, fn, label=label)

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

    task_1 = asyncio.create_task(run("sess-A", "A", 0.1))
    task_2 = asyncio.create_task(run("sess-B", "B", 0.1))

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
        tm.submit("sess-1", TaskKind.COMPUTE, blocking_fn, label="blocker")
    )
    await asyncio.sleep(0)  # Let event loop start the coroutine
    assert blocking_started.wait(timeout=2), "blocker should start within 2s"

    task_queued = asyncio.create_task(
        tm.submit("sess-1", TaskKind.COMPUTE, lambda: "never", label="queued", cancel_event=cancel_evt)
    )
    await asyncio.sleep(0.05)

    assert tm.cancel("sess-1") is True
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
            "sess-1", TaskKind.COMPUTE, checking_fn,
            label="timeout-test", timeout_event=timeout_evt, timeout_seconds=0.1
        )

    assert checkpoint_hit.is_set()


@pytest.mark.asyncio
async def test_get_status_and_queue_position():
    tm = TaskManager()
    blocking_started = threading.Event()
    blocking_done = threading.Event()

    def blocking_fn():
        blocking_started.set()
        blocking_done.wait(timeout=5)
        return "ok"

    task_a = asyncio.create_task(
        tm.submit("sess-1", TaskKind.COMPUTE, blocking_fn, label="blocker")
    )
    await asyncio.sleep(0)  # Let event loop start the coroutine
    assert blocking_started.wait(timeout=2)

    def dummy():
        return "dummy"

    task_b = asyncio.create_task(
        tm.submit("sess-2", TaskKind.COMPUTE, dummy, label="waiter")
    )
    await asyncio.sleep(0.05)

    status = tm.get_status("sess-1")
    assert len(status["tasks"]) >= 1
    assert any(t["kind"] == "compute" and t["status"] == "running" for t in status["tasks"])

    pos = tm.get_queue_position("sess-2", TaskKind.COMPUTE)
    assert pos is not None
    assert pos >= 1

    blocking_done.set()
    await asyncio.gather(task_a, task_b, return_exceptions=True)
