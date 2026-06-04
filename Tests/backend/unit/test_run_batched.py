import asyncio
import json
import sys
from functools import partial
from pathlib import Path
from unittest.mock import AsyncMock, patch

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


# ---------------------------------------------------------------------------
# Module-level build_batch_cmd callbacks
#
# These must be module-level (or partial-wrapped module-level functions) so
# they can be pickled by ProcessPoolExecutor.
# ---------------------------------------------------------------------------


def _build_success_cmd(batch_items, batch_idx, n_cores_per):
    """Return a command that always succeeds."""
    return ([sys.executable, "-c", ""], 30)


def _build_failure_cmd(batch_items, batch_idx, n_cores_per):
    """Return a command that always fails."""
    return ([sys.executable, "-c", "import sys; sys.exit(1)"], 30)


def _build_log_cmd(tmp_dir, batch_items, batch_idx, n_cores_per):
    """Record batch info to a temp file for verification."""
    info_file = Path(tmp_dir) / f"batch_{batch_idx}.json"
    info_file.write_text(
        json.dumps(
            {
                "idx": batch_idx,
                "n_items": len(batch_items),
                "items": batch_items,
            }
        ),
        encoding="utf-8",
    )
    return ([sys.executable, "-c", ""], 30)


class TestRunBatched:
    @pytest.fixture
    def wrapper(self):
        return FakeWrapper()

    # ------------------------------------------------------------------
    # Single-batch path (items <= batch_size)
    #
    # The single-batch path still calls _run_r_script (no
    # ProcessPoolExecutor), so we can mock it as before.
    # ------------------------------------------------------------------

    def test_single_batch_when_items_leq_batch_size(self, wrapper):
        """When items <= batch_size, a single batch is executed (no parallelism)."""
        items = [{"a": 1}, {"a": 2}]

        def build_cmd(batch_items, batch_idx, n_cores_per):
            return (["echo", json.dumps(batch_items)], 30)

        with patch.object(wrapper, "_run_r_script", new_callable=AsyncMock) as mock_run:
            asyncio.run(
                wrapper.run_batched(
                    items=items,
                    batch_size=10,
                    max_workers=4,
                    n_cores_cap=32,
                    build_batch_cmd=build_cmd,
                )
            )
            assert mock_run.call_count == 1

    # ------------------------------------------------------------------
    # Multi-batch path (items > batch_size)
    #
    # These go through ProcessPoolExecutor + subprocess.run, so we use
    # real commands and module-level callbacks.
    # ------------------------------------------------------------------

    def test_splits_into_correct_batches(self, wrapper):
        """15 items with batch_size=10 -> 2 batches via ProcessPoolExecutor."""
        items = [{"i": i} for i in range(15)]
        asyncio.run(
            wrapper.run_batched(
                items=items,
                batch_size=10,
                max_workers=4,
                n_cores_cap=32,
                build_batch_cmd=_build_success_cmd,
            )
        )

    def test_batch_indices(self, wrapper, tmp_path):
        """Verify batch_idx values passed to build_cmd are sequential."""
        items = [{"i": i} for i in range(25)]  # 10 + 10 + 5 = 3 batches
        build_cmd = partial(_build_log_cmd, str(tmp_path))
        asyncio.run(
            wrapper.run_batched(
                items=items,
                batch_size=10,
                max_workers=4,
                n_cores_cap=32,
                build_batch_cmd=build_cmd,
            )
        )
        batch_files = sorted(
            tmp_path.glob("batch_*.json"),
            key=lambda p: int(p.stem.split("_")[1]),
        )
        assert len(batch_files) == 3
        for i, f in enumerate(batch_files):
            data = json.loads(f.read_text(encoding="utf-8"))
            assert data["idx"] == i

    def test_batch_contents_are_correct_slices(self, wrapper, tmp_path):
        """Each batch receives the correct subset of items."""
        items = [{"i": i} for i in range(15)]
        build_cmd = partial(_build_log_cmd, str(tmp_path))
        asyncio.run(
            wrapper.run_batched(
                items=items,
                batch_size=10,
                max_workers=4,
                n_cores_cap=32,
                build_batch_cmd=build_cmd,
            )
        )
        batch_files = sorted(
            tmp_path.glob("batch_*.json"),
            key=lambda p: int(p.stem.split("_")[1]),
        )
        assert len(batch_files) == 2
        data0 = json.loads(batch_files[0].read_text(encoding="utf-8"))
        data1 = json.loads(batch_files[1].read_text(encoding="utf-8"))
        assert data0["items"] == [{"i": i} for i in range(10)]
        assert data1["items"] == [{"i": i} for i in range(10, 15)]

    def test_error_in_batch_propagates(self, wrapper):
        """If a batch fails, the error is raised as RuntimeError."""
        items = [{"i": i} for i in range(25)]
        with pytest.raises(RuntimeError, match="batch"):
            asyncio.run(
                wrapper.run_batched(
                    items=items,
                    batch_size=10,
                    max_workers=4,
                    n_cores_cap=32,
                    build_batch_cmd=_build_failure_cmd,
                )
            )
