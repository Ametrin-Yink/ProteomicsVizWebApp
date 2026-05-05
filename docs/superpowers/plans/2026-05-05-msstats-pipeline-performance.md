# MSstats Pipeline Performance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MSstats pipeline reliable for large datasets (>2M PSMs) by splitting combined steps, adding checkpointing, per-step timeouts, SnowParam calibration, heartbeat progress, and timeout retry.

**Architecture:** Split the MSstats combined step 6 (dataProcess + groupComparison) into independent steps 6 and 7. Each R subprocess step gets a configurable timeout, heartbeat progress via the Python wrapper, and one automatic retry on timeout. The pipeline engine detects existing RDS checkpoints to skip redundant dataProcess runs. SnowParam worker count is calibrated once per backend process.

**Tech Stack:** Python 3.12 (FastAPI, asyncio, subprocess), R 4.5 (MSstats 4.16.1, BiocParallel, data.table)

---

### File Structure

| File | Responsibility |
|------|---------------|
| `backend/app/core/config.py` | Per-step timeout settings |
| `backend/app/models/analysis.py` | Step name/display name maps (no change needed — 9 steps already exist) |
| `backend/app/services/pipeline_engine.py` | Timeout retry, heartbeat, `StepContext.timeout_multiplier` |
| `backend/app/services/pipeline_registry.py` | Split MSSTATS step 6 into steps 6 + 7 |
| `backend/app/services/steps/__init__.py` | Export new step handlers |
| `backend/app/services/steps/group_comparison_multi.py` | Split into `step_msstats_protein_abundance` and `step_msstats_group_comparison` |
| `backend/app/services/msstats_wrapper.py` | Per-step timeout params, SnowParam calibration, heartbeat |
| `backend/scripts/msstats_data_process.R` | No changes (heartbeat handled at Python level) |
| `backend/scripts/msstats_group_comparison_multi.R` | No changes (heartbeat handled at Python level) |

---

### Task 1: Per-step timeout config

**Files:**
- Modify: `backend/app/core/config.py:89-94`

- [ ] **Step 1: Add per-step timeout fields to config**

```python
# Replace existing r_script_timeout block (lines 89-94) with:

    r_script_timeout: int = Field(
        default=7200,  # 2 hours — default for most R scripts
        description="R script execution timeout in seconds",
        ge=30,
        le=14400,  # Max 4 hours
    )

    r_data_process_timeout: int = Field(
        default=7200,  # 2 hours — MSstats dataProcess is the heaviest step
        description="Timeout for MSstats dataProcess (protein abundance) in seconds",
        ge=30,
        le=28800,
    )

    r_group_comparison_timeout: int = Field(
        default=3600,  # 1 hour — per-contrast modeling
        description="Timeout for MSstats groupComparison (differential expression) in seconds",
        ge=30,
        le=14400,
    )
```

- [ ] **Step 2: Restart backend and verify config loads**

```bash
cd backend && taskkill //F //IM python.exe 2>&1; find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null; sleep 1
.venv/Scripts/python.exe -c "from app.core.config import settings; print('default:', settings.r_script_timeout); print('data_process:', settings.r_data_process_timeout); print('group_comparison:', settings.r_group_comparison_timeout)"
```

Expected: all three values printed.

- [ ] **Step 3: Commit**

```bash
git add backend/app/core/config.py
git commit -m "$(cat <<'EOF'
feat: add per-step R script timeouts for MSstats pipeline

r_data_process_timeout (7200s) for dataProcess, r_group_comparison_timeout
(3600s) for groupComparison. Default r_script_timeout raised to 7200s.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add timeout_multiplier to StepContext

**Files:**
- Modify: `backend/app/services/pipeline_engine.py:143-159`

- [ ] **Step 1: Add timeout_multiplier field**

```python
# In StepContext dataclass, add after _cancel_event line (159):

@dataclass
class StepContext:
    """Mutable context passed between pipeline steps."""

    config: AnalysisConfig
    session_id: str
    file_paths: list[Path]
    results_dir: Path
    uploads_dir: Path
    df: pd.DataFrame | None = None
    psm_file_path: Path | None = None
    step_outputs: dict[int, Path] = field(default_factory=dict)
    state: PipelineState | None = None
    result: AnalysisResult | None = None
    _progress_callbacks: list[Callable] = field(default_factory=list)
    _cancel_event: asyncio.Event | None = None
    timeout_multiplier: int = 1  # Set to 2 on retry after TimeoutExpired
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/pipeline_engine.py
git commit -m "feat: add timeout_multiplier to StepContext for retry support"
```

---

### Task 3: Per-step timeout + heartbeat in msstats_wrapper

**Files:**
- Modify: `backend/app/services/msstats_wrapper.py:32-120`

- [ ] **Step 1: Update __init__ and add calibration cache**

```python
# Replace the __init__ method (lines 32-36):

def __init__(self):
    """Initialize wrapper with R executable path."""
    self.r_executable = settings.r_executable
    self.timeout = settings.r_script_timeout
    self.scripts_dir = Path(__file__).parent.parent.parent / "scripts"
    self._optimal_ncores: int | None = None
```

No change — already sets up `_optimal_ncores`.

- [ ] **Step 2: Add _calibrate_ncores method**

Insert after `__init__`:

```python
    async def _calibrate_ncores(self, input_file: Path) -> int:
        """Benchmark SnowParam worker counts on a data slice, return optimal ncores.

        Runs dataProcess on first 100K rows with worker counts [1, 4, 8, 16, 32],
        picks the fastest. Result cached for backend process lifetime.
        Falls back to user-configured msstats_n_cores if calibration fails.
        """
        if self._optimal_ncores is not None:
            return self._optimal_ncores

        logger.info("Calibrating optimal SnowParam worker count...")
        candidate_counts = [1, 4, 8, 16, 32]
        best_n = 4  # conservative default
        best_time = float("inf")

        for n in candidate_counts:
            try:
                elapsed = await self._benchmark_ncores(input_file, n)
                logger.info(f"  n_cores={n}: {elapsed:.1f}s")
                if elapsed < best_time:
                    best_time = elapsed
                    best_n = n
            except Exception as e:
                logger.warning(f"  n_cores={n}: calibration failed ({e})")

        self._optimal_ncores = best_n
        logger.info(f"Calibration complete: optimal n_cores={best_n} ({best_time:.1f}s)")
        return best_n

    async def _benchmark_ncores(self, input_file: Path, n_cores: int) -> float:
        """Run a quick dataProcess benchmark with n_cores on a data slice."""
        import tempfile
        import time

        # Create a small slice of input data
        slice_file = input_file.parent / f"_calibration_slice_{n_cores}.parquet"
        rds_file = input_file.parent / f"_calibration_{n_cores}.rds"
        out_file = input_file.parent / f"_calibration_output_{n_cores}.tsv"

        try:
            # Read first 100K rows into a slice
            import pandas as pd
            df = pd.read_parquet(input_file)
            slice_df = df.head(100000)
            slice_df.to_parquet(slice_file)

            # Minimal config for benchmarking
            bench_config = {
                "normalization": "equalizeMedians",
                "logTrans": 2,
                "summaryMethod": "TMP",
                "MBimpute": False,
                "featureSubset": "highQuality",
                "n_top_feature": 3,
                "censoredInt": "NA",
                "maxQuantileforCensored": 0.999,
                "remove50missing": False,
                "min_feature_count": 2,
                "remove_uninformative_feature_outlier": False,
                "equalFeatureVar": True,
                "nameStandards": None,
                "min_peptides": 1,
                "numberOfCores": n_cores,
            }

            script_path = self.scripts_dir / "msstats_data_process.R"
            config_json = json.dumps(bench_config)
            cmd = [
                self.r_executable, str(script_path),
                str(slice_file), str(out_file), str(rds_file), "", config_json,
            ]

            start = time.time()
            await self._run_r_script(cmd, script_path, timeout=120)
            return time.time() - start
        finally:
            for f in [slice_file, rds_file, out_file]:
                if f.exists():
                    f.unlink(missing_ok=True)
```

- [ ] **Step 3: Update _run_r_script to accept timeout parameter**

Replace the `_run_r_script` method signature and the `process.wait` line:

```python
    async def _run_r_script(
        self, cmd: list[str], script_path: Path,
        log_callback: Optional[callable] = None,
        timeout: int | None = None,
    ) -> None:
        """
        Run an R script via subprocess with real-time output streaming.

        Args:
            cmd: Full command list (executable + script + args)
            script_path: Path to R script (for error messages)
            log_callback: Optional async callback (level, message) for real-time logging
            timeout: Override timeout in seconds (uses self.timeout if None)

        Raises:
            RScriptError: If script fails or times out
        """
        effective_timeout = timeout if timeout is not None else self.timeout
        logger.info(f"Starting R script with timeout {effective_timeout}s")
```

And replace line 113 (`await asyncio.to_thread(process.wait, timeout=self.timeout)`):

```python
        # Wait for process to complete with timeout (non-blocking)
        # Start heartbeat log every 60s while waiting
        heartbeat_stop = threading.Event()

        def heartbeat():
            count = 0
            while not heartbeat_stop.is_set():
                if heartbeat_stop.wait(60):
                    break
                count += 1
                msg = f"Still working... ({count * 60}s elapsed)"
                logger.info(f"Heartbeat: {msg}")
                if log_callback and loop:
                    try:
                        asyncio.run_coroutine_threadsafe(
                            log_callback("info", msg), loop
                        )
                    except Exception:
                        pass

        heartbeat_thread = threading.Thread(target=heartbeat, daemon=True)
        heartbeat_thread.start()

        try:
            await asyncio.to_thread(process.wait, timeout=effective_timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            await asyncio.to_thread(process.wait)
            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)
            raise
        finally:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=1)
```

- [ ] **Step 4: Update data_process to accept timeout and use calibration**

Replace the signature and config dict in `data_process` (lines 143-243):

Change the method signature:
```python
    async def data_process(
        self,
        input_file: Path,
        output_file: Path,
        rds_output: Path,
        gene_mapping_file: Optional[Path] = None,
        config: Optional[object] = None,
        log_callback: Optional[callable] = None,
        timeout: int | None = None,
        timeout_multiplier: int = 1,
    ) -> Path:
```

In the body, after line 199 (`"numberOfCores": cfg.msstats_n_cores if cfg.msstats_n_cores else settings.r_n_cores,`):

Replace that line with calibration logic:
```python
            # Use calibrated n_cores or fall back to user config
            "numberOfCores": (
                cfg.msstats_n_cores
                if cfg.msstats_n_cores and cfg.msstats_n_cores != 32
                else await self._calibrate_ncores(input_file)
            ),
```

And update the `_run_r_script` call on line 221:
```python
            effective_timeout = (timeout if timeout is not None else settings.r_data_process_timeout) * timeout_multiplier
            await self._run_r_script(cmd, script_path, log_callback, timeout=effective_timeout)
```

- [ ] **Step 5: Update group_comparison_multi to accept timeout**

Change the signature (line 245):
```python
    async def group_comparison_multi(
        self,
        rds_file: Path,
        output_dir: Path,
        comparisons: list[dict[str, str]],
        gene_mapping_file: Optional[Path] = None,
        covariates: Optional[dict] = None,
        log_base: int = 2,
        save_fitted_models: bool = True,
        n_cores: int = 32,
        log_callback: Optional[callable] = None,
        timeout: int | None = None,
        timeout_multiplier: int = 1,
    ) -> Path:
```

Update the `_run_r_script` call on line 315:
```python
            effective_timeout = (timeout if timeout is not None else settings.r_group_comparison_timeout) * timeout_multiplier
            await self._run_r_script(cmd, script_path, log_callback, timeout=effective_timeout)
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/msstats_wrapper.py
git commit -m "feat: add per-step timeout, SnowParam calibration, heartbeat to MSstats wrapper"
```

---

### Task 4: Split combined step into two handlers

**Files:**
- Modify: `backend/app/services/steps/group_comparison_multi.py`
- Modify: `backend/app/services/steps/__init__.py`
- Modify: `backend/app/services/pipeline_registry.py`

- [ ] **Step 1: Replace group_comparison_multi.py with two handlers**

Write the full file replacing `step_group_comparison_multi` with two separate handlers:

```python
"""Step handlers for MSstats multi-condition pipeline — protein abundance + DE."""

import asyncio
import logging
from pathlib import Path

import pandas as pd

from app.core.config import settings
from app.services.msstats_wrapper import msstats_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import (
    create_log_callback,
    get_gene_mapping,
    get_psm_input,
)

logger = logging.getLogger("proteomics")


async def step_msstats_protein_abundance(ctx: StepContext) -> None:
    """Step 6 (MSstats): Protein abundance via MSstats dataProcess.

    Writes Protein_Abundances.tsv and MSstats_Processed.rds.
    Skips if a valid RDS checkpoint exists (newer than the input PSM file).
    """
    gene_mapping = get_gene_mapping(ctx.config.organism)
    psm_input = get_psm_input(ctx)

    protein_output = ctx.results_dir / "Protein_Abundances.tsv"
    rds_output = ctx.results_dir / "MSstats_Processed.rds"

    # Checkpoint: skip dataProcess if valid RDS exists
    if rds_output.exists() and psm_input.exists():
        rds_mtime = rds_output.stat().st_mtime
        psm_mtime = psm_input.stat().st_mtime
        if rds_mtime > psm_mtime:
            logger.info(
                "RDS checkpoint found (newer than input), skipping dataProcess",
                extra={"rds": str(rds_output), "rds_mtime": rds_mtime, "psm_mtime": psm_mtime},
            )
            ctx.state.add_log("info", "Checkpoint found — skipping protein abundance", step=6)
            # Still need to count proteins from existing output
            if protein_output.exists():
                protein_df = await asyncio.to_thread(pd.read_csv, protein_output, sep="\t")
                ctx.result.total_proteins = len(protein_df)
            ctx.result.protein_abundances_path = str(protein_output)
            ctx.step_outputs[6] = protein_output
            return

    logger.info("Step 6 (MSstats dataProcess): Calculating protein abundance")

    await msstats_wrapper.data_process(
        input_file=psm_input,
        output_file=protein_output,
        rds_output=rds_output,
        gene_mapping_file=gene_mapping,
        config=ctx.config,
        log_callback=create_log_callback(ctx, step=6),
        timeout_multiplier=ctx.timeout_multiplier,
    )

    ctx.result.protein_abundances_path = str(protein_output)
    protein_df = await asyncio.to_thread(pd.read_csv, protein_output, sep="\t")
    ctx.result.total_proteins = len(protein_df)
    ctx.step_outputs[6] = protein_output


async def step_msstats_group_comparison(ctx: StepContext) -> None:
    """Step 7 (MSstats): Multi-condition DE via MSstats groupComparison.

    Loads MSstats_Processed.rds from step 6, runs groupComparison for all
    contrasts, writes per-comparison Diff_Expression_*.tsv files.
    """
    rds_input = ctx.results_dir / "MSstats_Processed.rds"
    if not rds_input.exists():
        raise FileNotFoundError(
            f"MSstats_Processed.rds not found at {rds_input}. "
            "Step 6 (dataProcess) must complete first."
        )

    comparisons = ctx.config.comparisons if ctx.config.comparisons else []
    if not comparisons:
        if ctx.config.treatment and ctx.config.control:
            comparisons = [
                {"treatment": ctx.config.treatment, "control": ctx.config.control}
            ]
        else:
            raise ValueError("No comparisons specified for multi-condition analysis")

    logger.info(f"Step 7 (MSstats groupComparison): Running {len(comparisons)} comparisons")

    # Filter metadata to only include columns selected as covariates
    covariate_data = ctx.config.metadata or {}
    if getattr(ctx.config, "covariate_columns", None):
        selected_cols = set(ctx.config.covariate_columns)
        covariate_data = {
            fn: {k: v for k, v in cols.items() if k in selected_cols}
            for fn, cols in covariate_data.items()
        }

    gene_mapping = get_gene_mapping(ctx.config.organism)

    # If user explicitly set n_cores to non-default, use it; otherwise use calibrated
    n_cores = ctx.config.msstats_n_cores if ctx.config.msstats_n_cores else settings.r_n_cores
    if n_cores == 32 and msstats_wrapper._optimal_ncores is not None:
        n_cores = msstats_wrapper._optimal_ncores

    await msstats_wrapper.group_comparison_multi(
        rds_file=rds_input,
        output_dir=ctx.results_dir,
        comparisons=comparisons,
        gene_mapping_file=gene_mapping,
        covariates=covariate_data,
        log_base=ctx.config.msstats_log_base if ctx.config.msstats_log_base else 2,
        save_fitted_models=ctx.config.msstats_save_fitted_models,
        n_cores=n_cores,
        log_callback=create_log_callback(ctx, step=7),
        timeout_multiplier=ctx.timeout_multiplier,
    )

    # Record the first comparison result as the primary diff_expression_path
    if comparisons:
        first = comparisons[0]
        # Build label from group criteria
        def build_label(group: dict) -> str:
            return "+".join(str(v) for v in group.values())

        label = f"{build_label(first['group1'])}_vs_{build_label(first['group2'])}"
        ctx.result.diff_expression_path = str(
            ctx.results_dir / f"Diff_Expression_{label}.tsv"
        )

    # Count total significant proteins across all comparisons
    total_sig = 0
    for comp in comparisons:
        g1_label = "+".join(str(v) for v in comp["group1"].values())
        g2_label = "+".join(str(v) for v in comp["group2"].values())
        label = f"{g1_label}_vs_{g2_label}"
        de_file = ctx.results_dir / f"Diff_Expression_{label}.tsv"
        if de_file.exists():
            de_df = await asyncio.to_thread(pd.read_csv, de_file, sep="\t")
            sig_count = len(de_df[de_df["adjPval"] < ctx.config.pvalue_threshold])
            total_sig += sig_count

    ctx.result.significant_proteins = total_sig
    ctx.step_outputs[7] = ctx.results_dir
```

- [ ] **Step 2: Update __init__.py exports**

Replace `backend/app/services/steps/__init__.py`:

```python
"""Pipeline step handlers."""

from .combine_replicates import step_combine_replicates
from .unique_psm import step_generate_unique_psm
from .remove_razor import step_remove_razor
from .remove_low_quality import step_remove_low_quality_default
from .filter_criteria import step_filter_criteria_default
from .protein_abundance import step_protein_abundance_msqrob2
from .qc_metrics import step_qc_metrics
from .gsea_analysis import step_gsea_analysis
from .group_comparison_multi import (
    step_msstats_protein_abundance,
    step_msstats_group_comparison,
)
from .multi_condition_de import step_multi_condition_de

__all__ = [
    "step_combine_replicates",
    "step_generate_unique_psm",
    "step_remove_razor",
    "step_remove_low_quality_default",
    "step_filter_criteria_default",
    "step_protein_abundance_msqrob2",
    "step_qc_metrics",
    "step_gsea_analysis",
    "step_msstats_protein_abundance",
    "step_msstats_group_comparison",
    "step_multi_condition_de",
]
```

- [ ] **Step 3: Update pipeline_registry.py MSSTATS template**

Replace the MSSTATS pipeline definition (lines 60-87 of `pipeline_registry.py`):

```python
# Register MSstats multi-condition pipeline
# Steps 1-5: Python pre-processing (shared with msqrob2 pipeline)
# Step 6: protein abundance via MSstats dataProcess
# Step 7: differential expression via MSstats groupComparison
# Steps 8-9: QC metrics, GSEA
register(
    AnalysisTemplate.MSSTATS,
    [
        PipelineStep(
            1, "combine_replicates", "Combining Replicates", step_combine_replicates
        ),
        PipelineStep(
            2, "generate_unique_psm", "Generate Unique PSM", step_generate_unique_psm
        ),
        PipelineStep(3, "remove_razor", "Remove Razor Peptides", step_remove_razor),
        PipelineStep(
            4,
            "remove_low_quality",
            "Remove Low Quality",
            step_remove_low_quality_default,
        ),
        PipelineStep(5, "filter", "Filter by Criteria", step_filter_criteria_default),
        PipelineStep(
            6,
            "protein_abundance",
            "Protein Abundance (MSstats)",
            step_msstats_protein_abundance,
        ),
        PipelineStep(
            7,
            "differential_expression",
            "Differential Expression (MSstats)",
            step_msstats_group_comparison,
        ),
        PipelineStep(8, "qc_metrics", "QC Metrics", step_qc_metrics),
        PipelineStep(9, "gsea", "GSEA Analysis", step_gsea_analysis),
    ],
)
```

Update the imports at the top of `pipeline_registry.py` (lines 5-16):

```python
from app.services.steps import (
    step_combine_replicates,
    step_generate_unique_psm,
    step_remove_razor,
    step_remove_low_quality_default,
    step_filter_criteria_default,
    step_protein_abundance_msqrob2,
    step_multi_condition_de,
    step_msstats_protein_abundance,
    step_msstats_group_comparison,
    step_qc_metrics,
    step_gsea_analysis,
)
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/steps/group_comparison_multi.py backend/app/services/steps/__init__.py backend/app/services/pipeline_registry.py
git commit -m "feat: split MSstats combined step into dataProcess + groupComparison

Step 6 now runs only dataProcess (with RDS checkpointing). Step 7 runs
only groupComparison. Each step has independent timeout and progress.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Timeout retry logic in pipeline engine

**Files:**
- Modify: `backend/app/services/pipeline_engine.py:206-262`

- [ ] **Step 1: Replace the `run()` method's step execution loop**

Replace lines 215-251 (the `for step in pipeline.steps:` loop body):

```python
        for step in pipeline.steps:
            self._check_cancelled(ctx)
            ctx.state.mark_step_started(
                step.number, f"Step {step.number}: {step.display_name}"
            )
            await self._send_progress(
                ctx, step.number, "started", 0, step.display_name, len(pipeline.steps)
            )

            # Reset timeout multiplier for each step
            ctx.timeout_multiplier = 1

            try:
                await step.handler(ctx)
            except Exception as e:
                # Retry once on timeout with 2x timeout
                if self._is_timeout_error(e) and ctx.timeout_multiplier == 1:
                    logger.warning(
                        f"Step {step.number} timed out, retrying with 2x timeout"
                    )
                    ctx.state.add_log(
                        "warning",
                        f"Step {step.number} timed out — retrying with doubled timeout",
                        step.number,
                    )
                    ctx.timeout_multiplier = 2
                    try:
                        await step.handler(ctx)
                    except Exception as retry_e:
                        ctx.state.mark_failed(step.number, str(retry_e))
                        await self._send_progress(
                            ctx, step.number, "failed", 0, str(retry_e), len(pipeline.steps)
                        )
                        raise
                else:
                    ctx.state.mark_failed(step.number, str(e))
                    await self._send_progress(
                        ctx, step.number, "failed", 0, str(e), len(pipeline.steps)
                    )
                    raise

            if step.number in ctx.step_outputs:
                ctx.state.mark_step_completed(
                    step.number,
                    ctx.step_outputs[step.number],
                    f"{step.display_name} complete",
                )
            else:
                ctx.state.mark_step_completed(
                    step.number, message=f"{step.display_name} complete"
                )

            await self._send_progress(
                ctx,
                step.number,
                "completed",
                100,
                f"{step.display_name} complete",
                len(pipeline.steps),
            )
```

- [ ] **Step 2: Add `_is_timeout_error` helper method**

After `_check_cancelled` (after line 270), add:

```python
    @staticmethod
    def _is_timeout_error(error: Exception) -> bool:
        """Check if an error is a timeout (should trigger retry)."""
        if isinstance(error, subprocess.TimeoutExpired):
            return True
        from app.core.exceptions import RScriptError
        if isinstance(error, RScriptError):
            msg = str(error).lower()
            return "timed out" in msg or "timeout" in msg
        return False
```

Add `import subprocess` to the imports at the top of `pipeline_engine.py` (line 6 area):

```python
import asyncio
import subprocess
from dataclasses import dataclass, field
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/pipeline_engine.py
git commit -m "feat: add automatic timeout retry with 2x multiplier in pipeline engine"
```

---

### Task 6: Integration test — verify pipeline works end-to-end

**Files:**
- Create: `Tests/backend/integration/test_msstats_pipeline_performance.py`

- [ ] **Step 1: Write the integration test**

```python
"""Integration tests for MSstats pipeline performance features."""

import asyncio
import json
import time
from pathlib import Path

import pytest

from app.core.config import settings
from app.services.msstats_wrapper import MsstatsWrapper
from app.services.pipeline_engine import PipelineEngine, StepContext
from app.services.pipeline_registry import PIPELINES
from app.models.analysis import AnalysisConfig, AnalysisTemplate


class TestMsstatsPipelineSplit:
    """Verify the MSstats pipeline has 9 steps with correct handlers."""

    def test_pipeline_has_nine_steps(self):
        pipeline = PIPELINES[AnalysisTemplate.MSSTATS]
        assert len(pipeline.steps) == 9, f"Expected 9 steps, got {len(pipeline.steps)}"

    def test_step_6_is_protein_abundance(self):
        pipeline = PIPELINES[AnalysisTemplate.MSSTATS]
        step_6 = pipeline.steps[5]  # 0-indexed
        assert step_6.number == 6
        assert step_6.name == "protein_abundance"
        assert "Protein Abundance" in step_6.display_name

    def test_step_7_is_differential_expression(self):
        pipeline = PIPELINES[AnalysisTemplate.MSSTATS]
        step_7 = pipeline.steps[6]  # 0-indexed
        assert step_7.number == 7
        assert step_7.name == "differential_expression"
        assert "Differential Expression" in step_7.display_name


class TestPerStepTimeouts:
    """Verify per-step timeout configuration."""

    def test_data_process_timeout_exists(self):
        assert hasattr(settings, "r_data_process_timeout")
        assert settings.r_data_process_timeout == 7200

    def test_group_comparison_timeout_exists(self):
        assert hasattr(settings, "r_group_comparison_timeout")
        assert settings.r_group_comparison_timeout == 3600


class TestTimeoutRetry:
    """Verify timeout retry logic in pipeline engine."""

    def test_is_timeout_error_detects_rscipt_error(self):
        from app.core.exceptions import RScriptError
        engine = PipelineEngine(PIPELINES)
        err = RScriptError(
            message="Protein abundance calculation timed out after 7200s",
            details={"timeout": 7200},
        )
        assert engine._is_timeout_error(err) is True

    def test_is_timeout_error_rejects_other_errors(self):
        from app.core.exceptions import RScriptError
        engine = PipelineEngine(PIPELINES)
        err = RScriptError(
            message="R package 'MSstats' not installed",
            details={},
        )
        assert engine._is_timeout_error(err) is False

    def test_is_timeout_error_detects_subprocess_timeout(self):
        import subprocess
        engine = PipelineEngine(PIPELINES)
        err = subprocess.TimeoutExpired(cmd=["Rscript"], timeout=10)
        assert engine._is_timeout_error(err) is True


class TestMsstatsWrapper:
    """Verify wrapper uses correct timeouts."""

    def test_timeout_config_values(self):
        wrapper = MsstatsWrapper()
        assert wrapper.timeout == settings.r_script_timeout
```

- [ ] **Step 2: Run the tests**

```bash
cd backend && ../.venv/Scripts/python.exe -m pytest Tests/backend/integration/test_msstats_pipeline_performance.py -v
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add Tests/backend/integration/test_msstats_pipeline_performance.py
git commit -m "test: add integration tests for MSstats pipeline performance features"
```

---

### Task 7: Final verification — clear cache and restart backend

- [ ] **Step 1: Kill Python, clear cache, restart backend**

```bash
taskkill //F //IM python.exe 2>&1
find backend -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
find backend -name "*.pyc" -delete 2>/dev/null
sleep 1
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000 &
```

- [ ] **Step 2: Verify backend starts and serves API**

```bash
sleep 3 && curl -s http://localhost:8000/api/sessions | python -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d)} sessions loaded')"
```

Expected: prints session count.

- [ ] **Step 3: Verify MSstats pipeline registration**

```bash
curl -s http://localhost:8000/openapi.json | python -c "
import sys,json
d = json.load(sys.stdin)
# Just verify the server is healthy
print('API healthy, routes:', len(d['paths']), 'endpoints')
"
```

Expected: prints endpoint count.

---

### Task 8: Restore session and trigger processing

The session `1a7da1bf` previously failed with the old timeout. Restore its state and trigger processing to validate the fix end-to-end.

- [ ] **Step 1: Reset session state to configuring**

Read the session file, change state to "configuring", clear error_message, write back.

- [ ] **Step 2: Trigger processing**

```bash
curl -s -X POST "http://localhost:8000/api/sessions/1a7da1bf-c6e2-4d2c-8957-e42859980daf/process" -H "Content-Type: application/json"
```

Expected: `{"status": "started"}` or similar.

- [ ] **Step 3: Monitor progress — verify heartbeat logs appear**

```bash
# After 60-90 seconds, check pipeline_state.json for heartbeat entries
sleep 90 && python -c "
import json
state = json.load(open('backend/sessions/1a7da1bf-c6e2-4d2c-8957-e42859980daf/pipeline_state.json'))
logs = state.get('logs', [])
heartbeats = [l for l in logs if 'Still working' in l.get('message', '')]
print(f'Heartbeat log entries: {len(heartbeats)}')
for h in heartbeats:
    print(f'  {h[\"timestamp\"]}: {h[\"message\"]}')
"
```

Expected: at least one heartbeat log entry.

- [ ] **Step 4: Monitor until step 6 completes, verify checkpoint**

Wait for step 6 to complete, then verify the RDS checkpoint was written:

```bash
ls -la backend/sessions/1a7da1bf-c6e2-4d2c-8957-e42859980daf/results/MSstats_Processed.rds
```

Expected: file exists with non-zero size.

- [ ] **Step 5: Commit (if session config was modified)**

```bash
# No commit needed for session changes — they're runtime state
```
