# MSstats Pipeline Performance — Design Spec

**Date:** 2026-05-05
**Status:** Approved
**Approach:** B — Checkpointing + parallelism

## Problem

Session `1a7da1bf` failed: `MSstats::dataProcess()` timed out after 1800s on a dataset of
~2M PSMs / 10K proteins / 10 runs / 3 conditions with `featureSubset="all"` and
`MBimpute=TRUE`. The R process was still computing but the global 30-minute timeout
killed it.

As datasets grow larger, a single global timeout is insufficient. Three priorities:
1. **Reliability** — guarantee completion even if slow (checkpointing, per-step timeouts, retry)
2. **Speed** — make each step as fast as possible (parameter tuning, SnowParam calibration)
3. **Visibility** — show progress during long-running R computations (heartbeat logs)

## Design

### 1. Split the combined MSstats step

The MSstats pipeline currently runs both `dataProcess()` and `groupComparison()` inside a
single step 6 handler (`step_group_comparison_multi`). Split into two independent pipeline
steps so each has its own timeout, progress reporting, and checkpoint.

| Step | Name | Handler | Default Timeout |
|------|------|---------|-----------------|
| 6 | Protein Abundance (MSstats) | `msstats_wrapper.data_process()` | 7200s |
| 7 | Differential Expression (MSstats) | `msstats_wrapper.group_comparison_multi()` | 3600s |
| 8 | QC Metrics | (existing) | — |
| 9 | GSEA Analysis | (existing) | — |

- `pipeline_registry.py`: MSSTATS template gains one step (6→8 steps becomes 5→9 steps)
- The new step 6 handler calls only `data_process()`
- The new step 7 handler calls only `group_comparison_multi()`
- `STEP_NAMES` / `STEP_DISPLAY_NAMES` updated to reflect the count change

### 2. RDS checkpointing

`dataProcess()` writes `MSstats_Processed.rds` before returning. If the pipeline crashes
during step 7 (groupComparison), re-running must not repeat dataProcess.

**Checkpoint logic in step 6 handler:**
- Before calling `data_process()`, check if `MSstats_Processed.rds` exists and is newer
  than the input PSM file
- If valid checkpoint exists → skip dataProcess, log "Checkpoint found", advance to step 7
- If not → run dataProcess, write RDS, record checkpoint in pipeline state

**Checkpoint tracking:**
- `pipeline_state.json` already has `completed_steps` and `outputs` dict
- Add `outputs.rds_path` pointing to the RDS file
- On pipeline retry, the engine reads `completed_steps` and skips already-completed steps
  (this already works — the new piece is the RDS existence check for step 6 specifically)

### 3. Per-step R script timeouts

Replace the single `r_script_timeout` with per-step overrides.

**Config fields (in `config.py`):**
```python
r_script_timeout: int = 7200  # default for most R scripts
r_data_process_timeout: int = 7200  # step 6 — heaviest computation
r_group_comparison_timeout: int = 3600  # step 7 — per-contrast modeling
```

**Wrapper changes:**
- `MsstatsWrapper.data_process()` accepts optional `timeout` param, falls back to `r_data_process_timeout`
- `MsstatsWrapper.group_comparison_multi()` uses `r_group_comparison_timeout`
- `_run_r_script()` uses the timeout passed from the calling method

### 4. SnowParam calibration

On Windows, MSstats parallel processing uses `SnowParam` (cluster-based). Overhead grows
with worker count; more cores is not always faster. Run a one-time calibration to find the
optimal worker count for this machine.

**Calibration approach:**
- At first `dataProcess()` call per backend session, run a quick benchmark on a slice
  of the input data (first 100K rows) with worker counts [1, 4, 8, 16, 32]
- Pick the fastest `n_cores` and use it for the full run
- Cache the result in memory for the backend process lifetime
- If calibration fails or is skipped, fall back to the user-configured `msstats_n_cores`
- Log the chosen value

**In `msstats_wrapper.py`:**
- New method `_calibrate_ncores(input_file: Path) -> int`
- Called once per backend process; result cached in `_optimal_ncores: int | None`
- `data_process()` uses calibrated value unless user explicitly overrides

### 5. Heartbeat during R computation

`MSstats::dataProcess()` and `groupComparison()` produce no stdout while computing.
Add a parallel heartbeat that flushes a progress character every 60 seconds so the
frontend log doesn't appear frozen.

**In `msstats_data_process.R`:**
```r
# Start heartbeat before dataProcess
# Use R's later/future or a simple parallel thread
# Log "." to stdout every 60s while dataProcess runs
```

**Implementation:** Use R's `parallel` package to spawn a lightweight heartbeat thread
that cat's a `.` every 60s. Kill the thread after the main computation returns. The
existing stdout streaming in `_run_r_script` picks these up as log entries.

### 6. Automatic retry on timeout

If a step fails with `TimeoutExpired`, retry once automatically with 2x timeout before
marking the step as failed.

**In `pipeline_engine.py`:**
- Wrap step execution in try/except
- On `RScriptError` with "timed out" in message → retry once with doubled timeout
- If retry also fails → mark step failed
- Maximum one retry per step

Limit: retry only for timeout errors, not for R script errors (bad data, missing packages).

## Files Changed

| File | Change |
|------|--------|
| `backend/app/core/config.py` | Add `r_data_process_timeout`, `r_group_comparison_timeout` |
| `backend/app/services/pipeline_registry.py` | Split MSSTATS step 6 into steps 6 + 7 |
| `backend/app/services/steps/group_comparison_multi.py` | Split into two step handlers |
| `backend/app/services/msstats_wrapper.py` | Per-step timeout; Snow calibration; checkpoint helper |
| `backend/scripts/msstats_data_process.R` | Heartbeat during dataProcess |
| `backend/scripts/msstats_group_comparison_multi.R` | Heartbeat during groupComparison |
| `backend/app/services/pipeline_engine.py` | Timeout retry; checkpoint skip logic |
| `backend/app/models/analysis.py` | Update STEP_NAMES (9→10 for MSstats, or dynamic) |

## Non-Goals

- Persistent R server (Rserve) — deferred to future
- Sampled "quick mode" — deferred to future
- Changing default `featureSubset` from "all" to "topN" — user-facing behavior change,
  needs separate UX discussion

## Testing

- **Unit:** `test_msstats_wrapper.py` — timeout selection, calibration, checkpoint detection
- **Unit:** `test_pipeline_registry.py` — MSstats template has correct step count
- **Integration:** Run 2M PSM dataset through MSstats pipeline, verify:
  - Step 6 completes and writes RDS checkpoint
  - Step 7 picks up checkpoint and runs groupComparison
  - Heartbeat logs appear during long computations
  - Timeout retry triggers on artificially low timeout
