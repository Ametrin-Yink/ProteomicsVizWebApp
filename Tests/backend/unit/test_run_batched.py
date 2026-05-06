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
        """15 items with batch_size=10 -> 2 batches."""
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
                    build_batch_cmd=build_cmd,
                ))
