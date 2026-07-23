import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from app.services.msstats_wrapper import (
    MsstatsWrapper,
    _build_msstats_batch_cmd,
)


class TestBuildMsstatsBatchCmd:
    def test_build_cmd_includes_comparisons_json(self):
        """The R command must include comparisons JSON as positional arg."""
        batch_items = [
            {"group1": {"Condition": "Drug"}, "group2": {"Condition": "Control"}},
        ]
        cmd, _timeout = _build_msstats_batch_cmd(
            rds_file_str="/tmp/test.rds",
            output_dir_str="/tmp/out",
            gene_mapping_str="",
            cov_json_str="{}",
            log_base=2,
            save_fitted_models=True,
            r_executable="Rscript",
            script_path_str="/scripts/msstats_group_comparison_multi.R",
            gc_timeout=3600,
            batch_items=batch_items,
            batch_idx=0,
            n_cores_per=8,
        )
        assert cmd[0] == "Rscript"
        assert "msstats_group_comparison_multi.R" in cmd[1]
        assert cmd[2] == "/tmp/test.rds"
        assert cmd[3] == "/tmp/out"
        # comparisons JSON
        parsed = json.loads(cmd[4])
        assert len(parsed) == 1
        assert parsed[0]["group1"]["Condition"] == "Drug"

    def test_build_cmd_includes_n_cores(self):
        """The config JSON must include numberOfCores."""
        batch_items = [
            {"group1": {"Condition": "A"}, "group2": {"Condition": "B"}},
        ]
        cmd, _timeout = _build_msstats_batch_cmd(
            rds_file_str="/tmp/test.rds",
            output_dir_str="/tmp/out",
            gene_mapping_str="/tmp/gene.map",
            cov_json_str='{"f1.csv": {"Batch": "1"}}',
            log_base=2,
            save_fitted_models=False,
            r_executable="Rscript",
            script_path_str="/scripts/msstats_group_comparison_multi.R",
            gc_timeout=3600,
            batch_items=batch_items,
            batch_idx=0,
            n_cores_per=16,
        )
        config = json.loads(cmd[7])
        assert config["numberOfCores"] == 16
        assert config["log_base"] == 2
        assert config["save_fitted_models"] is False
        assert config["output_shard"] == 0

    def test_build_cmd_includes_covariates(self):
        """Covariates JSON is passed as positional arg."""
        batch_items = [{"group1": {"Condition": "X"}, "group2": {"Condition": "Y"}}]
        cmd, _timeout = _build_msstats_batch_cmd(
            rds_file_str="/tmp/test.rds",
            output_dir_str="/tmp/out",
            gene_mapping_str="",
            cov_json_str='{"f1.csv": {"Batch": "1"}}',
            log_base=2,
            save_fitted_models=True,
            r_executable="Rscript",
            script_path_str="/scripts/msstats_group_comparison_multi.R",
            gc_timeout=3600,
            batch_items=batch_items,
            batch_idx=0,
            n_cores_per=4,
        )
        assert cmd[5] == '{"f1.csv": {"Batch": "1"}}'


class TestGroupComparisonBatched:
    @pytest.fixture
    def wrapper(self):
        return MsstatsWrapper()

    def test_delegates_to_run_batched(self, wrapper):
        """group_comparison_batched should call run_batched with correct items."""
        comparisons = [
            {"group1": {"Condition": f"A{i}"}, "group2": {"Condition": f"B{i}"}}
            for i in range(15)
        ]

        with patch.object(wrapper, "run_batched", new_callable=AsyncMock) as mock_rb:
            asyncio.run(
                wrapper.group_comparison_batched(
                    rds_file=Path("/tmp/test.rds"),
                    output_dir=Path("/tmp/out"),
                    comparisons=comparisons,
                    batch_size=10,
                    max_workers=4,
                    n_cores_cap=32,
                )
            )

        mock_rb.assert_called_once()
        call_kwargs = mock_rb.call_args.kwargs
        assert call_kwargs["batch_size"] == 10
        assert call_kwargs["max_workers"] == 4
        assert call_kwargs["n_cores_cap"] == 32
        assert len(call_kwargs["items"]) == 15
        # build_batch_cmd should be a functools.partial
        assert callable(call_kwargs["build_batch_cmd"])

    def test_returns_output_dir(self, wrapper):
        """Should return the output_dir Path."""
        comparisons = [{"group1": {"Condition": "A"}, "group2": {"Condition": "B"}}]

        with patch.object(wrapper, "run_batched", new_callable=AsyncMock):
            result = asyncio.run(
                wrapper.group_comparison_batched(
                    rds_file=Path("/tmp/test.rds"),
                    output_dir=Path("/tmp/out"),
                    comparisons=comparisons,
                )
            )
        assert result == Path("/tmp/out")
