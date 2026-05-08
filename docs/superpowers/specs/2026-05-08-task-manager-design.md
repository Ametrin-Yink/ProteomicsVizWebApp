# Task Manager Design

**Date:** 2026-05-08
**Status:** Approved

## Problem

All background calculations share `asyncio.to_thread`'s single `ThreadPoolExecutor`. When GSEA runs (3 databases × 4 gseapy threads), it starves other endpoints (compare, protein list, QC plots). The server also lacks queue visibility, cancel coordination, timeout enforcement, and stale-status cleanup after restarts.

## Design Decisions

| Decision | Choice |
|---|---|
| Thread model | `ThreadPoolExecutor` (shared memory, no serialization) |
| Cross-session ordering | Per-type FIFO queues; same-type requests from different sessions are queued |
| Cross-type ordering | Different types run in parallel (separate pools) |
| Within-session ordering | One task runs at a time per session |
| Cancel behavior | Cancel current task + remove pending queued tasks for that session |
| Restart recovery | Stale tasks marked `error: server_restarted`; user re-triggers |
| Pipeline step 6-7 timeout | 12 hours |
| Default timeout | 30 minutes |
| Compare timeout | 10 minutes |

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
  │  3T     │ │  2T     │  │  2T      │  │  cores T │  │  (asyncio)│
  └────┬────┘ └────┬────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
       │           │            │             │             │
       └───────────┴────────────┴─────────────┘             │
       │  Heavy pools require global CPU semaphore          │
       │  semaphore = max(1, floor(cores/2))                │
       ▼                                                    │
  ┌─────────────────────────────────────────────────────┐  │
  │  Per-type FIFO queues (cross-session ordering)      │  │
  │  Per-session lock (one task per session at a time)  │  │
  └─────────────────────────────────────────────────────┘  │
                                                           │
       ┌──────────────────────────────────────────────────┘
       ▼
  ┌──────────┐
  │Light I/O  │  (no queue, no semaphore, instant)
  └──────────┘
```

## Task Types & Resource Profiles

| TaskKind | Calculations | Pool Threads | Needs Semaphore | Timeout |
|---|---|---|---|---|
| `PIPELINE` | Steps 1-8 (Python + R subprocess) | `os.cpu_count()` | Yes | 12h (steps 6-7), 30m (others) |
| `GSEA` | gseapy prerank (3-5 DBs, 1000 permutations) | 3 | Yes | 30m |
| `BIONET` | BioNet network analysis | 2 | Yes | 30m |
| `COMPUTE` | PCA, UMAP, t-SNE, clustering, correlation, Venn | 2 | Yes | 10m |
| `LIGHT` | `pd.read_csv`, JSON read/write, status polls | default executor | No | N/A |

`LIGHT` tasks bypass both the global semaphore AND the per-session lock. They run immediately on the default executor regardless of what else the session is doing. Listing proteins or viewing QC must never wait.

**Pool size rationale:**
- `PIPELINE`: one thread per step; R subprocess steps only `await process.wait()`, don't consume Python CPU
- `GSEA`: matches 3 databases running in parallel per comparison
- `BIONET`: conservative; likely network I/O bound
- `COMPUTE`: PCA/UMAP are sub-minute; 2 concurrent is sufficient

**Global CPU semaphore:** `max(1, floor(cores/2))` — on an 8-core machine, 4 concurrent heavy tasks max to prevent CPU thrash.

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
        timeout_seconds: int | None = None,   # None → use kind default
    ) -> Any: ...

    def cancel(session_id: str) -> bool: ...
    def get_status(session_id: str) -> dict: ...
    def get_queue_position(session_id: str, kind: TaskKind) -> int | None: ...

# Singleton
task_manager = TaskManager()
```

### HTTP Endpoints

**`GET /api/sessions/{session_id}/tasks`** — returns all task states for one session:

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

**`GET /api/sessions/{session_id}/gsea/status`** — existing endpoint modified: response includes `queue_position` when status is `queued`.

### Status Bar (Frontend)

Collapsible widget in the bottom-right corner of the app. Minimized shows an icon with a badge count of active/queued tasks. Expanded shows:

- Running task with type label, comparison name, and progress bar
- Queued task(s) with queue position
- Cancel button
- Error state with "retry" link

The status bar polls `GET /{session_id}/tasks` every 5 seconds.

## Task Lifecycle

```
  submit()
     │
     ▼
  ┌─────────┐
  │ QUEUED  │──→ cancel() ──→ CANCELLED (removed from queue)
  └────┬────┘
       │ slot opens in per-type FIFO
       ▼
  ┌─────────┐
  │ RUNNING │──→ cancel() ──→ CANCELLED (task killed, slot freed)
  └────┬────┘
       │
    ┌──┴──────────┬─────────────┐
    ▼             ▼             ▼
 COMPLETED    TIMEOUT        ERROR
```

**Per-session lock:** Within a session, only one task enters RUNNING at a time. A second task can be QUEUED (it enters the per-type queue) but waits for the first to complete before starting.

**Per-type FIFO:** Tasks of the same `TaskKind` from different sessions form a FIFO queue. Position is visible via `queue_position` in the status response.

## Status Persistence

Task status written to `sessions/{id}/task_status.json` on state transitions: `queued → running → completed | error | cancelled`.

On `TaskManager.__init__`, all session `task_status.json` files are scanned. Any task with status `running` or `queued` is updated to `error` with reason `"server_restarted"`.

The existing GSEA route-level stale detection (in `get_gsea_run_status`) remains as defense-in-depth.

## Error Handling

- **Exception in task:** caught by TaskManager, status updated to `error`, semaphore and pool thread freed in `finally`
- **Timeout:** `asyncio.wait_for` kills the task, status marked `error: timed_out`, resources freed
- **Cancel:** `cancel_event.set()` triggers `TaskCancelledError`; task functions check the event at natural breakpoints (pipeline between steps, GSEA between databases)
- **Server restart:** stale `running`/`queued` tasks marked `error: server_restarted`

## File Layout

```
backend/app/services/
├── task_manager.py          ← NEW

backend/app/api/routes/
├── visualization.py         ← MODIFY: GSEA, BioNet through task_manager
├── compare.py               ← MODIFY: correlation through task_manager
├── processing.py            ← MODIFY: pipeline through task_manager

frontend/src/
├── components/
│   └── TaskStatusBar.tsx    ← NEW
```

## Migration Order

Each step is independently testable:

1. Create `task_manager.py` with `TaskManager` class and `TaskKind` enum
2. Wire GSEA through `task_manager.submit()` (current pain point)
3. Wire Compare (protein + comparison correlation + Venn)
4. Wire BioNet
5. Wire Pipeline (steps 1-8)
6. Add `GET /{id}/tasks` and `POST /{id}/tasks/cancel` endpoints
7. Add `TaskStatusBar` frontend component
8. Wire cancel event propagation to all task functions
