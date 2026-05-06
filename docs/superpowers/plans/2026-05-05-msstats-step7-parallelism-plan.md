# MSstats Step 7 Parallelism — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Speed up MSstats Step 7 by splitting comparisons into batches and running them across parallel R subprocesses, with two-level parallelism (Python process-level × R BiocParallel-level).

**Architecture:** Python-level batching with threshold gating. Below `batch_size` comparisons: unchanged single R process. Above: split into batches, run concurrently via `ProcessPoolExecutor` (capped at `max_workers`). Each R process gets `cpu_count // active_batches` cores for internal BiocParallel. The R script `msstats_group_comparison_multi.R` is unchanged.

**Tech Stack:** Python 3.12, asyncio, concurrent.futures.ProcessPoolExecutor, subprocess, os.cpu_count()

---

### Task 1: Settings — Add batch configuration to config.py

**Files:**
- Modify: `backend/app/core/config.py` (after line 108, the `r_group_comparison_timeout` field)
- Test: `Tests/backend/unit/test_msstats_batch_settings.py` (create)

- [ ] **Step 1: Write test for new settings**

```python
# Tests/backend/unit/test_msstats_batch_settings.py
import os
import pytest
from app.core.config import Settings


class TestMsstatsBatchSettings:
    def test_batch_settings_have_defaults(self):
        """Settings should load with production-appropriate defaults."""
        settings = Settings()
        assert settings.msstats_batch_size == 10
        assert settings.msstats_max_workers >= 1
        assert settings.msstats_max_workers <= 64
        assert settings.msstats_n_cores_cap == 32

    def test_batch_size_within_bounds(self):
        """batch_size must be between 1 and 50."""
        settings = Settings()
        assert 1 <= settings.msstats_batch_size <= 50

    def test_max_workers_respects_cpu_count(self):
        """max_workers should default to min(cpu_count // 2, 32)."""
        cpu = os.cpu_count() or 4
        settings = Settings()
        expected = min(cpu // 2, 32)
        assert settings.msstats_max_workers == expected

    @pytest.mark.parametrize("env_val,expected", [
        ("5", 5),
        ("20", 20),
        ("1", 1),
    ])
    def test_batch_size_from_env(self, monkeypatch, env_val, expected):
        """batch_size should be overridable via env var."""
        monkeypatch.setenv("MSSTATS_BATCH_SIZE", env_val)
        settings = Settings()
        assert settings.msstats_batch_size == expected

    @pytest.mark.parametrize("env_val,expected", [
        ("8", 8),
        ("16", 16),
        ("1", 1),
    ])
    def test_max_workers_from_env(self, monkeypatch, env_val, expected):
        """max_workers should be overridable via env var."""
        monkeypatch.setenv("MSSTATS_MAX_WORKERS", env_val)
        settings = Settings()
        assert settings.msstats_max_workers == expected

    def test_n_cores_cap_is_reasonable(self):
        """n_cores_cap should be between 1 and 64."""
        settings = Settings()
        assert 1 <= settings.msstats_n_cores_cap <= 64
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_msstats_batch_settings.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'msstats_batch_size'`

- [ ] **Step 3: Add settings to config.py**

After line 108 (`r_group_comparison_timeout` field), insert:

```python
    # ── MSstats Step 7 batching ─────────────────────────────────────────
    msstats_batch_size: int = Field(
        default=10, ge=1, le=50,
        description="Comparisons per R subprocess batch for Step 7",
    )

    msstats_max_workers: int = Field(
        default=min((os.cpu_count() or 4) // 2, 32), ge=1, le=64,
        description="Max concurrent R subprocesses for Step 7 batching",
    )

    msstats_n_cores_cap: int = Field(
        default=32, ge=1, le=64,
        description="Max BiocParallel cores per R subprocess",
    )
```

Also add `import os` to the top of the file (after existing imports).

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_msstats_batch_settings.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/config.py Tests/backend/unit/test_msstats_batch_settings.py
git commit -m "feat: add MSstats Step 7 batching settings (batch_size, max_workers, n_cores_cap)"
```

---

### Task 2: BaseRWrapper — Add run_batched() method

**Files:**
- Modify: `backend/app/services/base_r_wrapper.py` (new method after `_run_r_script`, around line 381)
- Test: `Tests/backend/unit/test_run_batched.py` (create)

- [ ] **Step 1: Write test for run_batched**

```python
# Tests/backend/unit/test_run_batched.py
import asyncio
import json
import os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.services.base_r_wrapper import BaseRWrapper


class FakeWrapper(BaseRWrapper):
    """Minimal concrete subclass for testing run_batched()."""

    def __init__(self):
        super().__init__(
            cal_prefix="_test_cal",
            benchmark_script="fake_bench.R",
            data_process_script="fake_dp.R",
            gc_script="fake_gc.R",
            verify_script="fake_verify.R",
            dp_timeout=60,
            gc_timeout=60,
        )

    def _build_data_process_config(self, config, n_cores):
        return {}

    def _build_gc_config(self, config, n_cores, **extra):
        return {"numberOfCores": n_cores}


class TestRunBatched:
    @pytest.fixture
    def wrapper(self):
        return FakeWrapper()

    def test_single_batch_when_items_leq_batch_size(self, wrapper):
        """When items <= batch_size, a single batch is executed (no parallelism)."""
        items = [{"a": 1}, {"a": 2}]

        def build_cmd(batch_items, batch_idx):
            return (["echo", json.dumps(batch_items)], 30)

        with patch.object(wrapper, "_run_r_script", new_callable=AsyncMock) as mock_run:
            asyncio.run(wrapper.run_batched(
                items=items,
                batch_size=10,
                max_workers=4,
                n_cores_cap=32,
                build_batch_cmd=build_cmd,
            ))
            assert mock_run.call_count == 1

    def test_splits_into_correct_batches(self, wrapper):
        """15 items with batch_size=10 → 2 batches."""
        items = [{"i": i} for i in range(15)]

        def build_cmd(batch_items, batch_idx):
            return (["echo", json.dumps(batch_items)], 30)

        with patch.object(wrapper, "_run_r_script", new_callable=AsyncMock) as mock_run:
            asyncio.run(wrapper.run_batched(
                items=items,
                batch_size=10,
                max_workers=4,
                n_cores_cap=32,
                build_batch_cmd=build_cmd,
            ))
            assert mock_run.call_count == 2

    def test_batch_indices(self, wrapper):
        """Verify batch_idx passed to build_cmd is sequential."""
        items = [{"i": i} for i in range(25)]  # 10 + 10 + 5
        idx_log = []

        def build_cmd(batch_items, batch_idx):
            idx_log.append(batch_idx)
            return (["echo", "ok"], 30)

        with patch.object(wrapper, "_run_r_script", new_callable=AsyncMock):
            asyncio.run(wrapper.run_batched(
                items=items,
                batch_size=10,
                max_workers=4,
                n_cores_cap=32,
                build_batch_cmd=build_cmd,
            ))
        assert idx_log == [0, 1, 2]

    def test_batch_contents_are_correct_slices(self, wrapper):
        """Each batch receives the correct subset of items."""
        items = [{"i": i} for i in range(15)]
        batch_items_log = []

        def build_cmd(batch_items, batch_idx):
            batch_items_log.append((batch_idx, list(batch_items)))
            return (["echo", "ok"], 30)

        with patch.object(wrapper, "_run_r_script", new_callable=AsyncMock):
            asyncio.run(wrapper.run_batched(
                items=items,
                batch_size=10,
                max_workers=4,
                n_cores_cap=32,
                build_batch_cmd=build_cmd,
            ))

        batch0_items = [b for idx, b in batch_items_log if idx == 0][0]
        batch1_items = [b for idx, b in batch_items_log if idx == 1][0]
        assert batch0_items == [{"i": i} for i in range(10)]
        assert batch1_items == [{"i": i} for i in range(10, 15)]

    def test_error_in_batch_propagates(self, wrapper):
        """If a batch fails, the error is raised."""
        items = [{"i": i} for i in range(25)]

        fail_call_count = 0

        async def mock_run_impl(cmd, script_path, log_callback=None, timeout=None):
            nonlocal fail_call_count
            fail_call_count += 1
            if fail_call_count == 2:
                from app.core.exceptions import RScriptError
                raise RScriptError(message="Batch 1 failed", details={})

        def build_cmd(batch_items, batch_idx):
            return (["echo", "ok"], 30)

        with patch.object(wrapper, "_run_r_script", side_effect=mock_run_impl):
            with pytest.raises(RuntimeError, match="batch"):
                asyncio.run(wrapper.run_batched(
                    items=items,
                    batch_size=10,
                    max_workers=4,
                    n_cores_cap=32,
                    build_batch_cmd=build_batch_cmd,
                ))

    def test_n_cores_per_batch_computation(self, wrapper):
        """n_cores per batch = max(1, min(cpu_count // active_batches, n_cores_cap))."""
        items = [{"i": i} for i in range(30)]  # 3 batches of 10
        cmd_log = []

        def build_cmd(batch_items, batch_idx):
            cmd_log.append((batch_idx, len(batch_items)))
            return (["echo", "ok"], 30)

        with patch.object(wrapper, "_run_r_script", new_callable=AsyncMock):
            asyncio.run(wrapper.run_batched(
                items=items,
                batch_size=10,
                max_workers=4,
                n_cores_cap=32,
                build_batch_cmd=build_cmd,
            ))
        # 3 batches all run, each with correct size
        assert len(cmd_log) == 3
        assert all(size == 10 for _, size in cmd_log)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_run_batched.py -v`
Expected: FAIL — `AttributeError: 'FakeWrapper' object has no attribute 'run_batched'`

- [ ] **Step 3: Implement run_batched() on BaseRWrapper**

Add this method to `base_r_wrapper.py` after the `_run_r_script` method (after line 381):

```python
    # ------------------------------------------------------------------
    # Batched subprocess execution
    # ------------------------------------------------------------------

    async def run_batched(
        self,
        *,
        items: list[dict],
        batch_size: int,
        max_workers: int,
        n_cores_cap: int,
        build_batch_cmd,
        log_callback=None,
    ):
        """Split items into batches and execute concurrently via ProcessPoolExecutor.

        When len(items) <= batch_size, runs a single batch — no parallelism
        overhead. Used by MSstats Step 7 to parallelize groupComparison
        across many comparisons.
        """
        import concurrent.futures
        import time

        n_total = len(items)

        if n_total <= batch_size:
            logger.info("Batch mode: %d comparisons, single batch (no parallelism)", n_total)
            cmd, timeout = build_batch_cmd(items, 0)
            await self._run_r_script(cmd, self.scripts_dir / self._gc_script_name,
                                     log_callback=log_callback, timeout=timeout)
            return

        # Split into batches
        batches: list[list[dict]] = []
        for i in range(0, n_total, batch_size):
            batches.append(items[i:i + batch_size])

        n_batches = len(batches)
        total_cores = os.cpu_count() or 4
        effective_workers = min(n_batches, max_workers)
        n_cores_per = max(1, min(total_cores // effective_workers, n_cores_cap))

        logger.info(
            "Batch mode: %d comparisons → %d batches (size=%d), %d concurrent, %d cores/process",
            n_total, n_batches, batch_size, effective_workers, n_cores_per,
        )
        if log_callback:
            await _safe_log(
                log_callback, "info",
                f"Splitting {n_total} comparisons into {n_batches} batches "
                f"({n_cores_per} cores each, {effective_workers} concurrent)",
            )

        failures: list[tuple[int, str]] = []

        def _run_one_batch(batch_items: list[dict], batch_idx: int):
            """Run a single batch in a thread (called from ProcessPoolExecutor)."""
            cmd, timeout = build_batch_cmd(batch_items, batch_idx)
            t0 = time.time()
            try:
                subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=timeout,
                    check=False,
                )
                elapsed = time.time() - t0
                return {"batch_idx": batch_idx, "ok": True, "elapsed": elapsed}
            except subprocess.TimeoutExpired:
                elapsed = time.time() - t0
                return {"batch_idx": batch_idx, "ok": False, "elapsed": elapsed,
                        "error": "timeout"}

        loop = asyncio.get_running_loop()

        with concurrent.futures.ProcessPoolExecutor(
            max_workers=effective_workers,
        ) as executor:
            futures = []
            for idx, batch_items in enumerate(batches):
                fut = loop.run_in_executor(
                    executor, _run_one_batch, batch_items, idx,
                )
                futures.append((idx, fut))

            for idx, fut in futures:
                try:
                    result = await fut
                    batch_num = idx + 1
                    if result["ok"]:
                        msg = f"Batch {batch_num}/{n_batches} complete ({result['elapsed']:.0f}s)"
                        logger.info(msg)
                        if log_callback:
                            await _safe_log(log_callback, "info", msg)
                    else:
                        msg = f"Batch {batch_num}/{n_batches} FAILED: {result.get('error', 'unknown')}"
                        logger.error(msg)
                        failures.append((idx, result.get("error", "unknown")))
                except Exception as e:
                    msg = f"Batch {idx + 1}/{n_batches} FAILED: {e}"
                    logger.error(msg)
                    failures.append((idx, str(e)))

        if failures:
            batch_nums = [str(i + 1) for i, _ in failures]
            raise RuntimeError(
                f"Step 7 batching failed: batches {', '.join(batch_nums)} failed. "
                f"Partial results for other batches are available in the output directory."
            )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_run_batched.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/base_r_wrapper.py Tests/backend/unit/test_run_batched.py
git commit -m "feat: add run_batched() method to BaseRWrapper for parallel R subprocess execution"
```

---

### Task 3: MsstatsWrapper — Add group_comparison_batched()

**Files:**
- Modify: `backend/app/services/msstats_wrapper.py` (add method + override)
- Test: `Tests/backend/unit/test_msstats_batched.py` (create)

- [ ] **Step 1: Write test for group_comparison_batched**

```python
# Tests/backend/unit/test_msstats_batched.py
import asyncio
import json
import os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.services.msstats_wrapper import MsstatsWrapper


class TestGroupComparisonBatched:
    @pytest.fixture
    def wrapper(self):
        return MsstatsWrapper()

    def test_batched_path_splits_comparisons(self, wrapper):
        """20 comparisons with batch_size=10 → 2 batches."""
        comparisons = [
            {"group1": {"Condition": f"A{i}"}, "group2": {"Condition": f"B{i}"}}
            for i in range(20)
        ]

        with patch.object(wrapper, "run_batched", new_callable=AsyncMock) as mock_batched:
            asyncio.run(wrapper.group_comparison_batched(
                rds_file=Path("/tmp/test.rds"),
                output_dir=Path("/tmp/out"),
                comparisons=comparisons,
                gene_mapping_file=None,
                covariates={},
                batch_size=10,
                max_workers=4,
                n_cores_cap=32,
                log_callback=None,
            ))
            mock_batched.assert_called_once()
            call_kwargs = mock_batched.call_args.kwargs
            assert call_kwargs["batch_size"] == 10
            assert call_kwargs["max_workers"] == 4
            assert len(call_kwargs["items"]) == 20

    def test_single_path_when_below_threshold(self, wrapper):
        """4 comparisons with batch_size=10 → single R process (run_batched handles this)."""
        comparisons = [
            {"group1": {"Condition": f"A{i}"}, "group2": {"Condition": f"B{i}"}}
            for i in range(4)
        ]

        with patch.object(wrapper, "run_batched", new_callable=AsyncMock) as mock_batched:
            asyncio.run(wrapper.group_comparison_batched(
                rds_file=Path("/tmp/test.rds"),
                output_dir=Path("/tmp/out"),
                comparisons=comparisons,
                gene_mapping_file=None,
                covariates={},
                batch_size=10,
                max_workers=4,
                n_cores_cap=32,
                log_callback=None,
            ))
            mock_batched.assert_called_once()
            # run_batched handles the "below threshold → single batch" logic internally
            call_kwargs = mock_batched.call_args.kwargs
            assert len(call_kwargs["items"]) == 4

    def test_build_batch_cmd_includes_comparisons_json(self, wrapper):
        """Each batch command must include the correct subset comparison JSON."""
        comparisons = [
            {"group1": {"Condition": "Drug"}, "group2": {"Condition": "Control"}},
            {"group1": {"Condition": "DrugB"}, "group2": {"Condition": "Control"}},
        ]

        captured_cmds = []

        async def capture_batched(**kwargs):
            build_cmd = kwargs["build_batch_cmd"]
            # Simulate what run_batched does: call build_cmd for each batch
            for idx in range(2):
                cmd, to = build_cmd([comparisons[idx]], idx)
                captured_cmds.append((idx, cmd))
            return None

        with patch.object(wrapper, "run_batched", side_effect=capture_batched):
            asyncio.run(wrapper.group_comparison_batched(
                rds_file=Path("/tmp/test.rds"),
                output_dir=Path("/tmp/out"),
                comparisons=comparisons,
                gene_mapping_file=None,
                covariates={},
                batch_size=1,
                max_workers=4,
                n_cores_cap=32,
                log_callback=None,
            ))

        assert len(captured_cmds) == 2
        # Verify R script path is correct
        for idx, cmd in captured_cmds:
            assert "msstats_group_comparison_multi.R" in str(cmd[1])  # script path
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_msstats_batched.py -v`
Expected: FAIL — `AttributeError: 'MsstatsWrapper' object has no attribute 'group_comparison_batched'`

- [ ] **Step 3: Implement group_comparison_batched() and _build_cmd_extras()**

In `msstats_wrapper.py`, add `_build_cmd_extras` override to the `MsstatsWrapper` class (replaces the need for it in the caller):

```python
    def _build_cmd_extras(self, **extra) -> list[str]:
        """Insert covariates_json as the 4th positional arg for the R script."""
        import json
        covariates = extra.get("covariates")
        return [json.dumps(covariates or {})]
```

Add `group_comparison_batched` method after `_build_gc_config`:

```python
    async def group_comparison_batched(
        self,
        rds_file: Path,
        output_dir: Path,
        comparisons: list[dict],
        gene_mapping_file: Path | None = None,
        covariates: dict | None = None,
        batch_size: int = 10,
        max_workers: int = 4,
        n_cores_cap: int = 32,
        log_callback=None,
        timeout: int | None = None,
        **extra,
    ) -> Path:
        """Step 7 (batched): Run groupComparison in parallel batches.

        Splits comparisons into batches of batch_size and runs each
        in its own R subprocess. Below batch_size, falls back to a
        single R process (no parallelism overhead).
        """
        import json

        script_path = self.scripts_dir / self._gc_script_name

        if not script_path.exists():
            from app.core.exceptions import RScriptError
            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)},
            )

        cov_data = covariates or {}
        gm_file = str(gene_mapping_file) if gene_mapping_file else ""
        total_cores = os.cpu_count() or 4

        def build_batch_cmd(batch_items: list[dict], batch_idx: int):
            comparisons_json = json.dumps(batch_items)
            cfg = {
                "log_base": extra.get("log_base", 2),
                "save_fitted_models": extra.get("save_fitted_models", True),
            }
            # Distribute cores across concurrent batches
            n_batches = (len(comparisons) + batch_size - 1) // batch_size
            active = min(n_batches, max_workers)
            cfg["numberOfCores"] = max(1, min(total_cores // active, n_cores_cap))

            config_json = json.dumps(cfg)
            cov_json = json.dumps(cov_data)

            cmd = [
                self.r_executable,
                str(script_path),
                str(rds_file),
                str(output_dir),
                comparisons_json,
                cov_json,
                gm_file,
                config_json,
            ]
            batch_timeout = (timeout if timeout is not None else self._gc_timeout)
            return cmd, batch_timeout

        await self.run_batched(
            items=comparisons,
            batch_size=batch_size,
            max_workers=max_workers,
            n_cores_cap=n_cores_cap,
            build_batch_cmd=build_batch_cmd,
            log_callback=log_callback,
        )

        logger.info("Step 7 (batched) complete: %d comparisons across batches",
                     len(comparisons))
        return output_dir
```

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_msstats_batched.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/msstats_wrapper.py Tests/backend/unit/test_msstats_batched.py
git commit -m "feat: add group_comparison_batched() to MsstatsWrapper with per-batch n_cores distribution"
```

---

### Task 4: Step Handler — Wire batching into step_msstats_group_comparison

**Files:**
- Modify: `backend/app/services/steps/group_comparison_multi.py` (the `step_msstats_group_comparison` function, lines 66-139)
- Test: `Tests/backend/unit/test_step_msstats_batched.py` (create)

- [ ] **Step 1: Write test for the step handler branching**

```python
# Tests/backend/unit/test_step_msstats_batched.py
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.services.steps.group_comparison_multi import step_msstats_group_comparison
from app.services.pipeline_engine import StepContext


class FakeConfig:
    """Minimal config for testing step handler branching."""
    def __init__(self, comparisons, organism="Human", treatment=None, control=None,
                 msstats_log_base=2, msstats_save_fitted_models=True,
                 pvalue_threshold=0.05):
        self.comparisons = comparisons
        self.organism = organism
        self.treatment = treatment
        self.control = control
        self.msstats_log_base = msstats_log_base
        self.msstats_save_fitted_models = msstats_save_fitted_models
        self.pvalue_threshold = pvalue_threshold
        self.metadata = {}
        self.covariate_columns = None


class TestStepMsstatsGroupComparisonBatched:
    def make_ctx(self, config):
        """Create a minimal StepContext."""
        ctx = MagicMock(spec=StepContext)
        ctx.config = config
        ctx.results_dir = Path("/tmp/test_results")
        ctx.timeout_multiplier = 1
        ctx.step_outputs = {}
        ctx.result = MagicMock()
        ctx.result.diff_expression_path = None
        ctx.result.significant_proteins = 0
        ctx.state = MagicMock()
        return ctx

    @pytest.fixture
    def mock_msstats(self):
        with patch(
            "app.services.steps.group_comparison_multi.msstats_wrapper"
        ) as mock:
            mock.group_comparison_multi = AsyncMock()
            mock.group_comparison_batched = AsyncMock()
            yield mock

    def test_uses_batched_path_when_above_threshold(self, mock_msstats):
        """When comparisons > msstats_batch_size, use group_comparison_batched."""
        with patch(
            "app.services.steps.group_comparison_multi.settings"
        ) as mock_settings:
            mock_settings.msstats_batch_size = 10
            mock_settings.msstats_max_workers = 4
            mock_settings.msstats_n_cores_cap = 32

            comparisons = [
                {"group1": {"Condition": f"A{i}"}, "group2": {"Condition": f"B{i}"}}
                for i in range(15)
            ]
            config = FakeConfig(comparisons=comparisons)
            ctx = self.make_ctx(config)

            asyncio.run(step_msstats_group_comparison(ctx))

            mock_msstats.group_comparison_batched.assert_called_once()
            mock_msstats.group_comparison_multi.assert_not_called()

    def test_uses_single_path_when_below_threshold(self, mock_msstats):
        """When comparisons <= msstats_batch_size, use group_comparison_multi."""
        with patch(
            "app.services.steps.group_comparison_multi.settings"
        ) as mock_settings:
            mock_settings.msstats_batch_size = 10  # threshold

            comparisons = [
                {"group1": {"Condition": f"A{i}"}, "group2": {"Condition": f"B{i}"}}
                for i in range(4)
            ]
            config = FakeConfig(comparisons=comparisons)
            ctx = self.make_ctx(config)

            asyncio.run(step_msstats_group_comparison(ctx))

            mock_msstats.group_comparison_multi.assert_called_once()
            mock_msstats.group_comparison_batched.assert_not_called()

    def test_uses_single_path_at_threshold_boundary(self, mock_msstats):
        """When comparisons == msstats_batch_size, use group_comparison_multi."""
        with patch(
            "app.services.steps.group_comparison_multi.settings"
        ) as mock_settings:
            mock_settings.msstats_batch_size = 10

            comparisons = [
                {"group1": {"Condition": f"A{i}"}, "group2": {"Condition": f"B{i}"}}
                for i in range(10)
            ]
            config = FakeConfig(comparisons=comparisons)
            ctx = self.make_ctx(config)

            asyncio.run(step_msstats_group_comparison(ctx))

            mock_msstats.group_comparison_multi.assert_called_once()
            mock_msstats.group_comparison_batched.assert_not_called()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_step_msstats_batched.py -v`
Expected: FAIL — `assert_called_once()` fails because `group_comparison_batched` is never called

- [ ] **Step 3: Wire batching into step_msstats_group_comparison**

In `group_comparison_multi.py`, replace the entire body of `step_msstats_group_comparison` after the `logger.info(...)` line (line 88) with:

```python
    # Build covariates data (shared by both paths)
    covariate_data = ctx.config.metadata or {}
    if getattr(ctx.config, "covariate_columns", None):
        selected_cols = set(ctx.config.covariate_columns)
        covariate_data = {
            fn: {k: v for k, v in cols.items() if k in selected_cols}
            for fn, cols in covariate_data.items()
        }

    gene_mapping = get_gene_mapping(ctx.config.organism)

    if len(comparisons) > settings.msstats_batch_size:
        # Batched path: parallel R subprocesses
        await msstats_wrapper.group_comparison_batched(
            rds_file=rds_input,
            output_dir=ctx.results_dir,
            comparisons=comparisons,
            gene_mapping_file=gene_mapping,
            covariates=covariate_data,
            batch_size=settings.msstats_batch_size,
            max_workers=settings.msstats_max_workers,
            n_cores_cap=settings.msstats_n_cores_cap,
            log_base=ctx.config.msstats_log_base if ctx.config.msstats_log_base else 2,
            save_fitted_models=ctx.config.msstats_save_fitted_models,
            log_callback=create_log_callback(ctx, step=7),
            timeout_multiplier=ctx.timeout_multiplier,
        )
    else:
        # Single-process path (unchanged from current behavior)
        await msstats_wrapper.group_comparison_multi(
            rds_file=rds_input,
            output_dir=ctx.results_dir,
            comparisons=comparisons,
            gene_mapping_file=gene_mapping,
            config=ctx.config,
            covariates=covariate_data,
            log_base=ctx.config.msstats_log_base if ctx.config.msstats_log_base else 2,
            save_fitted_models=ctx.config.msstats_save_fitted_models,
            log_callback=create_log_callback(ctx, step=7),
            timeout_multiplier=ctx.timeout_multiplier,
        )
```

Also add the `settings` import at the top of the file:

```python
from app.core.config import settings
```

The rest of the function (recording results, counting significant proteins) remains unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_step_msstats_batched.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Run full unit test suite**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v`
Expected: all tests pass (existing + new)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/steps/group_comparison_multi.py Tests/backend/unit/test_step_msstats_batched.py
git commit -m "feat: wire batched execution into MSstats Step 7 with threshold gating"
```

---

## Execution Order

Tasks must run in order: 1 → 2 → 3 → 4 (each depends on the previous).

| Task | Depends On | Verifies |
|------|-----------|----------|
| 1. Settings | — | New settings load with correct defaults |
| 2. BaseRWrapper.run_batched() | Task 1 | Batching logic, error handling |
| 3. MsstatsWrapper | Tasks 1, 2 | group_comparison_batched wiring |
| 4. Step handler | Tasks 1, 2, 3 | Batched vs single path branching |

## Final Verification

After all tasks complete:

```bash
# All unit tests
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v

# Verify imports work
backend/.venv/Scripts/python.exe -c "from app.services.msstats_wrapper import msstats_wrapper; print('OK')"

# Verify settings
backend/.venv/Scripts/python.exe -c "from app.core.config import Settings; s=Settings(); print(f'batch_size={s.msstats_batch_size}, max_workers={s.msstats_max_workers}, n_cores_cap={s.msstats_n_cores_cap}')"
```
