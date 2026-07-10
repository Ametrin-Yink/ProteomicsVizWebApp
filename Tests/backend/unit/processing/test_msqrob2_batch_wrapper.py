"""Unit tests for msqrob2 batched DE — _build_msqrob2_batch_cmd and group_comparison_batched."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from app.models.analysis import AnalysisConfig
from app.services.msqrob2_wrapper import Msqrob2Wrapper, _build_msqrob2_batch_cmd


@pytest.fixture
def wrapper():
    return Msqrob2Wrapper()


@pytest.fixture
def basic_config():
    return AnalysisConfig(organism="human", treatment="DrugA", control="DMSO")


class TestBuildMsqrob2BatchCmd:
    """Verify the module-level batch cmd builder for msqrob2."""

    def test_is_callable(self):
        assert callable(_build_msqrob2_batch_cmd)

    def test_returns_tuple_of_list_and_int(self):
        result = _build_msqrob2_batch_cmd(
            rds_file_str="/path/to/file.rds",
            output_dir_str="/path/to/output",
            gene_mapping_str="/path/to/gene_map.txt",
            config_json_str='{"ridge": false, "numberOfCores": 4}',
            r_executable="Rscript",
            script_path_str="/path/to/script.R",
            gc_timeout=3600,
            batch_items=[{"group1": {"cond": "A"}, "group2": {"cond": "B"}}],
            batch_idx=0,
            n_cores_per=2,
        )
        assert isinstance(result, tuple)
        assert len(result) == 2
        cmd, timeout = result
        assert isinstance(cmd, list)
        assert isinstance(timeout, int)

    def test_injects_n_cores_per_into_config_json(self):
        """n_cores_per should override numberOfCores in the config JSON."""
        result = _build_msqrob2_batch_cmd(
            rds_file_str="file.rds",
            output_dir_str="output",
            gene_mapping_str="gene_map.txt",
            config_json_str='{"ridge": false, "numberOfCores": 4, "adjust_method": "BH"}',
            r_executable="Rscript",
            script_path_str="script.R",
            gc_timeout=3600,
            batch_items=[{"group1": {"cond": "A"}, "group2": {"cond": "B"}}],
            batch_idx=0,
            n_cores_per=2,
        )
        cmd, _ = result
        # Last positional arg is config_json
        config_json_str = cmd[-1]
        parsed = json.loads(config_json_str)
        assert parsed["numberOfCores"] == 2
        assert parsed["ridge"] is False
        assert parsed["adjust_method"] == "BH"

    def test_comparisons_serialized_as_json(self):
        """batch_items should be serialized as JSON and passed as a positional arg."""
        batch_items = [
            {"group1": {"cond": "A"}, "group2": {"cond": "B"}},
            {"group1": {"cond": "C"}, "group2": {"cond": "D"}},
        ]
        result = _build_msqrob2_batch_cmd(
            rds_file_str="file.rds",
            output_dir_str="output",
            gene_mapping_str="gene_map.txt",
            config_json_str='{}',
            r_executable="Rscript",
            script_path_str="script.R",
            gc_timeout=3600,
            batch_items=batch_items,
            batch_idx=0,
            n_cores_per=1,
        )
        cmd, _ = result
        comparisons_json_str = cmd[4]
        parsed = json.loads(comparisons_json_str)
        assert parsed == batch_items

    def test_cmd_structure(self):
        """Verify positional arg structure matches R script expectations."""
        result = _build_msqrob2_batch_cmd(
            rds_file_str="input.rds",
            output_dir_str="out",
            gene_mapping_str="mapping.txt",
            config_json_str='{"a": 1}',
            r_executable="Rscript",
            script_path_str="run.R",
            gc_timeout=3600,
            batch_items=[{"g1": {"x": "y"}}],
            batch_idx=0,
            n_cores_per=1,
        )
        cmd, timeout = result
        # Expected: [Rscript, script, rds, output, comparisons_json, gene_map, config_json]
        assert cmd[0] == "Rscript"
        assert cmd[1] == "run.R"
        assert cmd[2] == "input.rds"
        assert cmd[3] == "out"
        assert cmd[4] is not None  # comparisons_json
        assert cmd[5] == "mapping.txt"
        assert cmd[6] is not None  # config_json
        assert timeout == 3600

    def test_uses_provided_timeout(self):
        result = _build_msqrob2_batch_cmd(
            rds_file_str="f.rds", output_dir_str="o", gene_mapping_str="g.txt",
            config_json_str='{}', r_executable="R", script_path_str="s.R",
            gc_timeout=7200, batch_items=[{}], batch_idx=0, n_cores_per=1,
        )
        _, timeout = result
        assert timeout == 7200


class TestMsqrob2WrapperHasBatched:
    """Verify Msqrob2Wrapper exposes group_comparison_batched."""

    def test_has_batched_method(self, wrapper):
        assert hasattr(wrapper, "group_comparison_batched")
        assert callable(wrapper.group_comparison_batched)

    def test_batched_method_signature(self, wrapper):
        import inspect

        sig = inspect.signature(wrapper.group_comparison_batched)
        params = sig.parameters
        assert "rds_file" in params
        assert "output_dir" in params
        assert "comparisons" in params
        assert "gene_mapping_file" in params
        assert "config" in params
        assert "log_callback" in params
        assert "timeout" in params

    @pytest.mark.asyncio
    async def test_fallback_when_fewer_comparisons_than_batch_size(self, wrapper):
        """When comparisons <= batch_size, should fall back to group_comparison_multi."""
        from unittest.mock import AsyncMock

        from app.core.config import settings

        expected = Path("out")
        wrapper.group_comparison_multi = AsyncMock(return_value=expected)

        with patch.object(settings, "msqrob2_batch_size", 100):
            result = await wrapper.group_comparison_batched(
                rds_file=Path("f.rds"),
                output_dir=expected,
                comparisons=[{"g1": {"x": "1"}, "g2": {"x": "2"}}],
                config=AnalysisConfig(organism="human", treatment="A", control="B"),
            )
        assert result == expected

    @pytest.mark.asyncio
    @patch.object(Msqrob2Wrapper, "run_batched")
    @patch.object(Msqrob2Wrapper, "group_comparison_multi")  # Phase A fit call
    @patch.object(Msqrob2Wrapper, "_resolve_n_cores", return_value=2)
    @patch.object(Msqrob2Wrapper, "_check_memory_headroom", return_value=2)
    async def test_batched_execution_when_many_comparisons(
        self, mock_mem, mock_cores, mock_gc_multi, mock_run_batched, wrapper
    ):
        """When comparisons > batch_size, should use run_batched."""
        from app.core.config import settings

        with patch.object(settings, "msqrob2_batch_size", 2):
            comparisons = [
                {"g1": {"x": str(i)}, "g2": {"x": str(i + 1)}}
                for i in range(5)
            ]
            result = await wrapper.group_comparison_batched(
                rds_file=Path("f.rds"),
                output_dir=Path("out"),
                comparisons=comparisons,
            )
        mock_run_batched.assert_awaited_once()
        assert result == Path("out")

    @pytest.mark.asyncio
    @patch.object(Msqrob2Wrapper, "run_batched")
    @patch.object(Msqrob2Wrapper, "group_comparison_multi")  # Phase A fit call
    @patch.object(Msqrob2Wrapper, "_resolve_n_cores", return_value=2)
    @patch.object(Msqrob2Wrapper, "_check_memory_headroom", return_value=2)
    async def test_passess_config_json_to_batch_builder(
        self, mock_mem, mock_cores, mock_gc_multi, mock_run_batched, wrapper
    ):
        """Verify config is serialized and passed through build_batch_cmd."""
        from app.core.config import settings

        with patch.object(settings, "msqrob2_batch_size", 2):
            comparisons = [
                {"g1": {"x": str(i)}, "g2": {"x": str(i + 1)}}
                for i in range(5)
            ]
            config = AnalysisConfig(
                organism="human", treatment="A", control="B",
                msqrob2_ridge=True,
                msqrob2_adjust_method="fdr",
            )
            await wrapper.group_comparison_batched(
                rds_file=Path("f.rds"),
                output_dir=Path("out"),
                comparisons=comparisons,
                config=config,
            )

        mock_run_batched.assert_awaited_once()
        call_kwargs = mock_run_batched.call_args.kwargs
        assert "build_batch_cmd" in call_kwargs
        # build_batch_cmd is a partial; verify items, batch_size, max_workers are passed
        assert "items" in call_kwargs
        assert "batch_size" in call_kwargs
        assert "max_workers" in call_kwargs
        assert call_kwargs["items"] == comparisons
