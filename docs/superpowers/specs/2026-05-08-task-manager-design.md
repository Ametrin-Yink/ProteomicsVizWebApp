# Task Manager Design

**Date:** 2026-05-08
**Status:** Approved (revised after review)

## Problem

All background calculations share `asyncio.to_thread`'s single `ThreadPoolExecutor`. When GSEA runs (3 databases × 4 gseapy threads), it starves other endpoints (compare, protein list, QC plots). The server also lacks queue visibility, cancel coordination, timeout enforcement, and stale-status cleanup after restarts.

## Design Decisions

| Decision | Choice |
|---|---|
| Thread model | `ThreadPoolExecutor` (shared memory, no serialization) |
| Cross-session ordering | Per-type FIFO queues; same-type requests from different sessions are queued |
| Cross-type ordering | Different types run in parallel (separate pools) |
| Within-session ordering | One heavy task runs at a time per session; LIGHT tasks bypass |
| Queue skip policy | If a queued task's session is busy (running another task), skip it and let the next eligible session's task proceed |
| Cancel behavior | Cancel current running task + remove pending queued tasks for that session |
| Restart recovery | Stale tasks marked `error: server_restarted`; user re-triggers; queue ordering is ephemeral (lost on restart) |
| Pipeline step 6-7 timeout | 12 hours (wall-clock; internal retry can double this — max 24h if retried) |
| Default timeout | 30 minutes |
| Compare timeout | 10 minutes |
| Status serving | From in-memory TaskManager state; disk (task_status.json) written only on state transitions |
| Processing semaphore | Removed; subsumed by TaskManager per-session lock |

## Architecture

```
                         HTTP Requests (any session)
                                  │
                    ┌─────────────▼─────────────┐
                    │      API Routes            │
                    │  (no change in signature)  │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │     TaskManager            │
                    │     (singleton)            │
                    └─────────────┬─────────────┘
                                  │
       ┌──────────┬───────────────┼───────────────┬──────────┐
       ▼          ▼               ▼               ▼          ▼
  ┌─────────┐ ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │GSEA Pool│ │Comp Pool│  │BioNet P. │  │Pipe Pool │  │Default P.│
  │  3T     │ │  2T     │  │  2T      │  │  2T(CPU) │  │  (asyncio)│
  │         │ │         │  │          │  │  per-R(IO)│  │          │
  └────┬────┘ └────┬────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
       │           │            │             │             │
       └───────────┴────────────┴─────────────┘             │
       │  Heavy pools require global CPU semaphore          │
       │  semaphore = max(1, floor(cores/2))                │
       ▼                                                    │
  ┌─────────────────────────────────────────────────────┐  │
  │  Per-type FIFO queues (cross-session ordering)      │  │
  │  Skip-by-session: busy sessions don't block queue   │  │
  │  Per-session lock (one heavy task per session)      │  │
  └─────────────────────────────────────────────────────┘  │
                                                           │
       ┌──────────────────────────────────────────────────┘
       ▼
  ┌──────────┐
  │Light I/O  │  (no queue, no semaphore, no session lock)
  └──────────┘
```

## Task Types & Resource Profiles

| TaskKind | Calculations | Pool Threads | Needs Semaphore | Timeout |
|---|---|---|---|---|
| `PIPELINE` | Steps 1-5, 8 (Python CPU); Steps 6-7 (R subprocess) | 2 (CPU steps) + unlimited (R wait) | Yes (CPU steps only) | 12h (steps 6-7), 30m (others) |
| `GSEA` | gseapy prerank (3-5 DBs, 1000 permutations) | 3 | Yes | 30m |
| `BIONET` | BioNet network analysis | 2 | Yes | 30m |
| `COMPUTE` | PCA, UMAP, t-SNE, clustering, correlation (protein + comparison + report), Venn | 2 | Yes | 10m |
| `LIGHT` | `pd.read_csv`, JSON read/write, status polls, session file listings | default executor | No | N/A |

`LIGHT` tasks bypass the global semaphore, the per-type FIFO queues, AND the per-session lock. They run immediately on the default executor regardless of what else the session is doing. Listing proteins or viewing QC must never wait.

**Pipeline pool split:**
- Steps 1-5, 8 (Python CPU, short): use PIPELINE pool (2 threads) — CPU-bound, needs semaphore
- Steps 6-7 (R subprocess): each step launches an external `Rscript` process and calls `await process.wait()`. This is I/O-bound, does NOT consume Python CPU, and does NOT compete for the GIL. These bypass the PIPELINE CPU pool and use the default executor for the wait call. Only the `ProcessPoolExecutor` batch path (parallel R) is gated by the semaphore.
- This prevents allocating `os.cpu_count()` threads to mostly-idle I/O wait operations.

**Pool size rationale:**
- `PIPELINE` (CPU): 2 threads — steps 1-5 are short (seconds); two concurrent is sufficient
- `GSEA`: 3 — matches 3 databases running in parallel per comparison
- `BIONET`: 2 — conservative; likely network I/O bound
- `COMPUTE`: 2 — PCA/UMAP are sub-minute; 2 concurrent sessions is sufficient

**Global CPU semaphore:** `max(1, floor(cores/2))` — on an 8-core machine, 4 concurrent heavy tasks max to prevent CPU thrash. Only gates `ThreadPoolExecutor`-backed CPU tasks. R subprocesses are not gated by this semaphore (they are external processes; their CPU usage is controlled by the OS and `ProcessPoolExecutor`'s own `max_workers`).

## Queue Policy: Skip-Busy-Session

The per-type FIFO queue only lets a task advance to RUNNING when its session is not already executing another heavy task. If the task at the head of the queue belongs to a busy session, it is skipped and the queue examines the next task. The skipped task remains in queue at its position; when its session becomes idle, it can advance on the next dequeue cycle.

Example:
- Session A: GSEA running, COMPUTE queued (position 1 in COMPUTE queue)
- Session B: COMPUTE queued (position 2 in COMPUTE queue)
- Session B's COMPUTE advances first, because Session A is busy
- Session A's GSEA finishes → Session A's COMPUTE advances next

## API

### Python: TaskManager Public Interface

```python
class TaskKind(Enum):
    PIPELINE = "pipeline"
    GSEA = "gsea"
    BIONET = "bionet"
    COMPUTE = "compute"
    LIGHT = "light"

class TaskManager:
    async def submit(
        session_id: str,
        kind: TaskKind,
        fn: Callable,
        *args,
        label: str = "",                      # human-readable label for status bar
        cancel_event: asyncio.Event | None = None,
        timeout_event: threading.Event | None = None,  # cooperative timeout
        timeout_seconds: int | None = None,   # None → use kind default
    ) -> str: ...                              # returns task_id

    def cancel(session_id: str) -> bool: ...
    def get_status(session_id: str) -> dict: ...
    def get_queue_position(session_id: str, kind: TaskKind) -> int | None: ...

# Singleton
task_manager = TaskManager()
```

### Timeout Mechanism

`asyncio.wait_for` does NOT kill threads — it only cancels the asyncio wrapper, orphaning the thread in the pool. Instead:

1. **R subprocess steps:** `process.wait(timeout=...)` — built into `base_r_wrapper.py` (already exists, line 400)
2. **gseapy/BioNet/compare:** cooperative timeout via `threading.Event`. The `TaskManager` sets a timer thread that calls `timeout_event.set()` after the timeout expires. The task function checks `timeout_event.is_set()` at natural breakpoints and raises `TaskTimeoutError` if set. The thread then exits normally, freeing the pool slot.
3. **Pipeline Python steps:** short duration (<30s), unlikely to need timeout; 30m default is a safety net only

### HTTP Endpoints

**`GET /api/sessions/{session_id}/tasks`** — returns all task states for one session. Served from in-memory TaskManager state (no disk read on poll):

```json
{
  "tasks": [
    {
      "kind": "gsea",
      "comparison": "INCB231845_4h_vs_DMSO_24h",
      "status": "running",
      "progress": {"completed": 2, "total": 3},
      "started_at": "2026-05-08T17:22:59Z"
    },
    {
      "kind": "compute",
      "label": "Protein correlation",
      "status": "queued",
      "queue_position": 1
    }
  ]
}
```

**`POST /api/sessions/{session_id}/tasks/cancel`** — cancels current running task + removes pending queued tasks for the session.

**`GET /api/sessions/{session_id}/gsea/status`** — existing endpoint remains but reads from TaskManager in-memory state (with disk fallback for pre-migration status files).

### Status Bar (Frontend)

Collapsible widget in the bottom-right corner of the app. Minimized shows an icon with a badge count of active/queued tasks. Expanded shows:

- Running task with type label, comparison name, and progress bar
- Queued task(s) with queue position
- Cancel button
- Error state with "retry" link

Polls `GET /{session_id}/tasks` every 5 seconds. Tasks from the current session only.

## Task Lifecycle

```
  submit()
     │
     ▼
  ┌─────────┐
  │ QUEUED  │──→ cancel() ──→ CANCELLED (removed from queue)
  └────┬────┘
       │ session is idle AND at head of per-type FIFO
       ▼
  ┌─────────┐
  │ RUNNING │──→ cancel() ──→ CANCELLED (cancel_event.set(), slot freed)
  └────┬────┘
       │
    ┌──┴──────────┬─────────────┐
    ▼             ▼             ▼
 COMPLETED    TIMEOUT        ERROR
              (cooperative   (exception
              event check)    raised)
```

**Per-session lock:** Within a session, only one heavy task enters RUNNING at a time. LIGHT tasks bypass this lock entirely.

**Per-type FIFO with skip:** Tasks of the same `TaskKind` form a FIFO queue. If the head task's session is busy, it is skipped and the next eligible session's task advances.

## Cancel Checkpoint Locations

Each task function must check the cancel event at defined breakpoints:

| Task | Cancel Checkpoint |
|---|---|
| Pipeline (steps 1-8) | `StepContext._check_cancelled()` between each step (already exists) |
| GSEA (`_background_gsea_run`) | After each database completes (between `on_db_done` callbacks) |
| BioNet (`_background_bionet_run`) | After subnetwork computation, before writing results |
| Protein correlation (`_run_protein_correlation`) | No checkpoints (duration <60s; cancel at boundaries only) |
| Comparison correlation (`_run_comparison_correlation`) | No checkpoints (duration <60s) |
| Venn (`compute_venn_data`) | No checkpoints (duration <5s) |

Tasks without internal checkpoints can still be cancelled: the per-session cancel clears their queue entry if QUEUED, or they run to completion if already RUNNING and the cancel event is recorded. The next task in that session will not start because the cancel event remains set.

## Status Persistence & Migration

### New system
Task status written to `sessions/{id}/task_status.json` **only on state transitions** (`queued → running → completed | error | cancelled`). Status polls read from in-memory `TaskManager` state, not disk.

### Migration from old status files
The codebase currently has five separate status files:

| Old file | Replaced by |
|---|---|
| `sessions/{id}/gsea_run_status.json` | `task_status.json` (TaskManager in-memory for polls, disk for crash recovery) |
| `sessions/{id}/bionet/bionet_status.json` | same |
| `sessions/{id}/results/compare/protein-correlation_status.json` | same |
| `sessions/{id}/results/compare/comparison-correlation_status.json` | same |
| `sessions/{id}/pipeline_state.json` | `task_status.json` (pipeline state is richer; keep `pipeline_state.json` for step-level detail, use `task_status.json` for overall lifecycle) |

During migration, each route is switched one at a time (per migration order). The `GET /{id}/tasks` endpoint reads from `task_status.json` as primary, falling back to old status files for task types not yet migrated. Old status files are kept on disk after migration (no deletion) for backward compatibility with any existing client state.

### Restart recovery
On `TaskManager.__init__`, all session `task_status.json` files are scanned. Any task with status `running` or `queued` is updated to `error` with reason `"server_restarted"`. Queue ordering is ephemeral (in-memory) and is NOT restored — queued tasks become errored and the user must re-submit.

The existing GSEA route-level stale detection (`get_gsea_run_status`, 30-min timeout) and processing route-level stale detection (`start_processing`, 6-hour timeout) are **removed** — the TaskManager's init-time scan replaces both. A single consolidated check is simpler and covers all task types.

### Existing semaphore consolidation
`processing.py` currently has `_processing_semaphore = asyncio.Semaphore(1)` (line 25) which serializes all pipeline runs across sessions. This is subsumed by the TaskManager's per-session lock + PIPELINE pool. The `_processing_semaphore` is **removed** and replaced with `task_manager.submit(session_id, TaskKind.PIPELINE, ...)`.

### Existing GSEA dead-code cleanup
`gsea_service.py` currently defines `_get_gsea_executor()` and `_gsea_run_in_thread()` (lines 31-46) which create a dedicated executor but are never used — both `_run_single_gsea` and `_run_single_gsea_with_params` call `await asyncio.to_thread()` instead. These dead-code functions are **removed** and replaced by the TaskManager's GSEA pool.

## Error Handling

- **Exception in task:** caught by TaskManager, status updated to `error`, semaphore and pool thread freed in `finally` block
- **Timeout (cooperative):** `timeout_event.set()` signals the task function to raise `TaskTimeoutError` at its next checkpoint. Pool thread exits normally (no orphan). Resources freed in `finally`.
- **Cancel:** `cancel_event.set()` triggers `TaskCancelledError` at the next checkpoint. For tasks with no checkpoints (compare), cancel removes queued tasks but running tasks complete naturally (sub-60s).
- **Server restart:** all `running`/`queued` tasks in `task_status.json` marked `error: server_restarted` on `TaskManager.__init__`

## File Layout

```
backend/app/services/
├── task_manager.py          ← NEW

backend/app/api/routes/
├── visualization.py         ← MODIFY: GSEA, BioNet, task endpoints
├── compare.py               ← MODIFY: correlation, Venn through task_manager
├── processing.py            ← MODIFY: pipeline through task_manager; remove _processing_semaphore

frontend/src/
├── components/
│   └── TaskStatusBar.tsx    ← NEW
```

## Migration Order

Each step is independently testable:

1. Create `task_manager.py` with `TaskManager` class, `TaskKind` enum, thread pools, per-type FIFO queues, and cooperative timeout support
2. Wire GSEA through `task_manager.submit()` — remove dead `_get_gsea_executor`/`_gsea_run_in_thread` from `gsea_service.py`; route `_background_gsea_run` through TaskManager; add cancel checkpoint between DB completions
3. Wire Compare (protein correlation, comparison correlation, Venn) — route `_run_protein_correlation`, `_run_comparison_correlation`, and `compute_venn_data` through TaskManager
4. Wire BioNet — route `_background_bionet_run` through TaskManager; add cancel checkpoint
5. Wire Pipeline — route `run_processing_pipeline_async` through TaskManager; remove `_processing_semaphore`; keep `pipeline_state.json` for step-level detail
6. Add `GET /{id}/tasks` and `POST /{id}/tasks/cancel` endpoints — with fallback reads from old status files for types not yet migrated
7. Add `TaskStatusBar` frontend component — polls every 5s, shows current session tasks
8. Remove old route-level stale detection — `get_gsea_run_status` timeout check and `start_processing` orphan recovery are replaced by TaskManager init scan
