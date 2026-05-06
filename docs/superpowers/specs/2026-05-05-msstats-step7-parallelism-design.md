# MSstats Step 7 Parallelism — Design Spec

**Date:** 2026-05-05
**Status:** Draft
**Scope:** Speed up MSstats pipeline Step 7 by batching comparisons across parallel R subprocesses

## Problem

MSstats Step 7 (`msstats_group_comparison_multi.R`) calls `MSstats::groupComparison()` once with a full contrast matrix for ALL comparisons. `groupComparison()` fits a linear model per protein and tests every contrast row — but processes comparisons sequentially within the single call. With 4 comparisons, this already takes ~20 minutes. At 100+ comparisons, runtime scales linearly to potentially **hours** in one blocking R subprocess.

The msqrob2 pipeline does NOT have this problem — it fits the model once, then parallelizes `hypothesisTest()` calls per comparison via `bplapply`. MSstats's API doesn't separate these two phases, so we can't replicate that pattern directly.

## Architecture Decision

**Python-level batching with threshold gating.** Split comparisons into fixed-size batches, run each batch in its own R subprocess, and execute batches concurrently (up to a configurable max). Below the batch size threshold, behavior is unchanged — single R process, zero overhead.

```
Comparisons > batch_size?
  No  → Single R process (current behavior, unchanged)
  Yes → Split into ceil(N / batch_size) batches
        Run batches concurrently via ProcessPoolExecutor (capped at max_workers)
        Each R process calls groupComparison with its subset contrast matrix
        Each writes Diff_Expression_*.tsv files independently
        Aggregate results after all batches complete
```

## Design Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MSSTATS_BATCH_SIZE` | 10 | Comparisons per R subprocess |
| `MSSTATS_MAX_WORKERS` | `min(cpu_count // 2, 32)` | Max concurrent R subprocesses (auto-detected) |
| `MSSTATS_N_CORES_CAP` | 32 | Max cores per R subprocess (diminishing returns beyond ~32) |
| `MSSTATS_BATCH_THRESHOLD` | 10 | Minimum comparisons to activate batching |

**Core distribution:** System auto-detects CPU count via `os.cpu_count()`. Cores are distributed across concurrent batches:

```
wave_workers = min(batches_remaining, max_workers)
n_cores_per_process = max(1, min(cpu_count // wave_workers, n_cores_cap))
```

On a 112-core machine with `max_workers=16`:
- 4 batches running: each gets `min(112//4, 32)` = **28 cores** (R-level parallelism via BiocParallel)
- 1 batch running (threshold not met): gets `min(112, 32)` = **32 cores** (single process, still fast)

On an 8-core machine:
- 4 batches: each gets `max(1, min(8//4, 32))` = **2 cores**
- 1 batch: gets **8 cores** (full machine)

This gives us **two-level parallelism**: Python-level across batches × R-level within each batch via BiocParallel/SnowParam.

**Memory guard:** The existing `_check_memory_headroom` check is adapted to account for concurrent processes. Estimated total memory = `single_process_memory × wave_workers`. If estimated total exceeds a threshold (e.g., 80% of system RAM), max_workers is reduced to keep memory safe.

## Scope — 4 files changed, 1 new

### Backend

| File | Change |
|------|--------|
| `app/core/config.py` | Add `msstats_batch_size`, `msstats_max_workers` settings |
| `app/services/base_r_wrapper.py` | Add `run_batched()` method for batched subprocess execution |
| `app/services/steps/group_comparison_multi.py` | Wire batching into `step_msstats_group_comparison` |
| `app/services/msstats_wrapper.py` | Add `_build_cmd_extras` override for covariates; minor |

### No changes to

- **R script** (`msstats_group_comparison_multi.R`) — unchanged. Each batch runs the same script with a subset comparison JSON.
- **Pipeline registry** — step count and ordering unchanged.
- **Frontend** — progress reporting already works via WebSocket log callbacks.

## Detailed Design

### 1. Settings (`config.py`)

```python
import os
_cpu_count = os.cpu_count() or 4

msstats_batch_size: int = Field(default=10, ge=1, le=50)
msstats_max_workers: int = Field(
    default=min(_cpu_count // 2, 32), ge=1, le=64,
    description="Max concurrent R subprocesses for Step 7 batching"
)
msstats_n_cores_cap: int = Field(
    default=32, ge=1, le=64,
    description="Max cores per R subprocess (diminishing returns beyond ~32)"
)
```

### 2. Batch Execution (`base_r_wrapper.py`)

New method `run_batched()` on `BaseRWrapper`:

```python
async def run_batched(
    self,
    *,
    items: list[dict],          # Comparison dicts
    batch_size: int,
    max_workers: int,
    build_batch_cmd,            # Callable: (batch_items, batch_idx) -> (cmd, timeout)
    log_callback=None,
) -> list[Path]:
    """Split items into batches and execute concurrently.

    If len(items) <= batch_size, runs a single batch (no parallelism overhead).
    """
```

Flow:
1. If `len(items) <= batch_size`: run one batch via existing `_run_r_script()`, return
2. Split into `ceil(len(items) / batch_size)` batches
3. Execute batches via `concurrent.futures.ProcessPoolExecutor(max_workers=max_workers)`
4. Each worker runs `asyncio.to_thread(subprocess.run, ...)` with its batch command
5. Collect results; log per-batch progress via callback
6. If any batch fails, cancel remaining, raise error with batch details

**Error handling:** If batch 3 of 10 fails, remaining batches are cancelled (SIGTERM to subprocess). The error message identifies which batch failed so the user can retry. Already-completed batches' output files remain on disk — a retry only re-runs failed batches.

### 3. Step Handler Wiring (`group_comparison_multi.py`)

In `step_msstats_group_comparison`:

```python
if len(comparisons) > settings.msstats_batch_size:
    # Batched path
    await msstats_wrapper.group_comparison_batched(
        rds_file=rds_input,
        output_dir=ctx.results_dir,
        comparisons=comparisons,
        batch_size=settings.msstats_batch_size,
        max_workers=settings.msstats_max_workers,
        ...
    )
else:
    # Unchanged single-process path (threshold gating)
    await msstats_wrapper.group_comparison_multi(
        rds_file=rds_input,
        output_dir=ctx.results_dir,
        comparisons=comparisons,
        ...
    )
```

**Progress reporting:** Each batch completion fires a log message: `"Batch 3/10 complete (comparisons 21-30, 5.2min)"`. The last batch completion fires the normal step-complete progress.

### 4. MsstatsWrapper

Add `group_comparison_batched` method that:
1. Splits comparisons into batches
2. Builds subprocess command per batch (same R script, subset comparison JSON)
3. Delegates to `run_batched()`
4. Validates all expected output files exist after completion
5. Aggregates significant protein counts

Override `_build_cmd_extras` to include covariates (moved from `group_comparison_multi` caller). Also provides the base for building per-batch commands.

When batching is active, compute `n_cores` per R subprocess as:
```
wave_workers = min(batches_remaining, max_workers)
n_cores_per_r = max(1, min(cpu_count // wave_workers, n_cores_cap))
```
This gives each R subprocess a share of the machine's cores for internal BiocParallel parallelism, achieving two-level parallelism: Python process-level × R core-level.

## Data Flow

```
Step 7 invoked with 45 comparisons on 112-core machine
  batch_size=10, max_workers=auto→16, n_cores_cap=32

Phase 1: Split
  Batch 1: comparisons  1-10
  Batch 2: comparisons 11-20
  Batch 3: comparisons 21-30
  Batch 4: comparisons 31-40
  Batch 5: comparisons 41-45

Phase 2: Execute
  Wave 1: 5 batches, all fit within max_workers=16
  n_cores_per_r = max(1, min(112 // 5, 32)) = 22 cores each
  5 R processes × 22 SnowParam workers running in parallel

Phase 3: Aggregate
  Verify all Diff_Expression_*.tsv files exist
  Sum significant protein counts
  Set ctx.result
```

Each batch's R process:
```
Rscript msstats_group_comparison_multi.R <rds> <output_dir> <batch_comparisons_json> <covariates_json> <gene_mapping> <config_with_n_cores=22>
  → MSstats::groupComparison with 10-row contrast matrix, 22 BiocParallel workers
  → Writes Diff_Expression_<label>.tsv for its 10 comparisons
  → All batches write to same output_dir (no conflicts — filenames keyed by comparison label)
```

## Time Estimates

On a 112-core machine with `batch_size=10`, `max_workers=16`, current baseline ~20 min for 4 comparisons in one batch:

| Comparisons | Batches | Cores/R process | Estimated time |
|-------------|---------|-----------------|----------------|
| 4 | 1 (below threshold) | 32 (capped) | ~20 min (unchanged) |
| 10 | 1 (at threshold) | 32 (capped) | ~20 min (unchanged) |
| 20 | 2 | 32 (capped) | ~10 min (2× parallel) |
| 40 | 4 | 28 | ~5 min (4× parallel) |
| 100 | 10 | 11 | ~7 min (10 batches, 1 wave) |
| 200 | 20 | 5 | ~10 min (16 concurrent max, 2 waves) |

**Note:** These are wall-clock estimates assuming linear scaling with comparison count per batch. Actual runtime depends on protein count, sample count, and R/BiocParallel overhead. Even with imperfect scaling, 100 comparisons should drop from ~hours to well under 30 minutes.

## Out of Scope

- Modifying the R script (`msstats_group_comparison_multi.R`) — it works correctly as-is
- Changing msqrob2 pipeline Step 7 — already parallelized via `bplapply`
- Persistent batch state across server restarts — if the server dies mid-batch, the user re-runs the pipeline
- Adaptive batch sizing based on dataset dimensions — could be added later if needed

## Verification

- 4 comparisons: single R process, no change from current behavior
- 15 comparisons with batch_size=10: 2 batches, 2 concurrent processes
- 45 comparisons with batch_size=10, max_workers=4: 5 batches, max 4 concurrent
- Batch failure: remaining batches cancelled, error message identifies failed batch
- All per-comparison TSV files written correctly
- Backend unit tests pass: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v`
