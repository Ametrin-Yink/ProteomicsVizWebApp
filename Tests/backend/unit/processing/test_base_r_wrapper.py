"""Unit tests for BaseRWrapper — subprocess execution, encoding, timeout, errors."""
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from app.core.exceptions import RScriptError
from app.services.base_r_wrapper import BaseRWrapper


class FakeRWrapper(BaseRWrapper):
    """Concrete subclass for testing BaseRWrapper."""
    def _build_data_process_config(self, config, n_cores):
        return {"treatment": getattr(config, "treatment", ""), "n_cores": n_cores}

    def _build_gc_config(self, config, n_cores, **extra):
        return {"comparisons": [], "n_cores": n_cores}

    def __init__(self):
        super().__init__(
            cal_prefix="test_cal",
            benchmark_script="benchmark.R",
            data_process_script="data_process.R",
            gc_script="group_comparison.R",
            dp_timeout=3600,
            gc_timeout=3600,
        )


@pytest.fixture
def wrapper():
    return FakeRWrapper()


class TestRunRScript:
    @pytest.mark.asyncio
    async def test_successful_run(self, wrapper):
        with patch("subprocess.Popen") as mock_popen:
            process = MagicMock()
            process.returncode = 0
            process.stdout.readline.side_effect = ["line1\n", ""]
            process.stderr.readline.side_effect = [""]
            mock_popen.return_value = process

            await wrapper._run_r_script(
                cmd=["Rscript", "test.R"],
                script_path=Path("test.R"),
                timeout=10,
            )

    @pytest.mark.asyncio
    async def test_nonzero_exit_raises_rscript_error(self, wrapper):
        with patch("subprocess.Popen") as mock_popen:
            process = MagicMock()
            process.returncode = 1
            process.stdout.readline.side_effect = ["output line\n", ""]
            process.stderr.readline.side_effect = ["Error: package not found\n", ""]
            mock_popen.return_value = process

            with pytest.raises(RScriptError, match="package not found"):
                await wrapper._run_r_script(
                    cmd=["Rscript", "test.R"],
                    script_path=Path("test.R"),
                    timeout=10,
                )

    @pytest.mark.asyncio
    async def test_stderr_without_stdout_message(self, wrapper):
        with patch("subprocess.Popen") as mock_popen:
            process = MagicMock()
            process.returncode = 1
            process.stdout.readline.side_effect = [""]
            process.stderr.readline.side_effect = [""]
            mock_popen.return_value = process

            with pytest.raises(RScriptError):
                await wrapper._run_r_script(
                    cmd=["Rscript", "test.R"],
                    script_path=Path("test.R"),
                    timeout=10,
                )


class TestDataProcess:
    @pytest.mark.asyncio
    async def test_returns_output_path(self, wrapper):
        with patch.object(wrapper, "_run_r_script") as mock_run:
            with patch.object(Path, "exists", return_value=True):
                mock_run.return_value = None
                result = await wrapper.data_process(
                    input_file=Path("/tmp/input.parquet"),
                    output_file=Path("/tmp/output.tsv"),
                    rds_output=Path("/tmp/output.rds"),
                )
                assert result == Path("/tmp/output.tsv")
                mock_run.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_missing_script_raises_error(self, wrapper):
        wrapper._data_process_script_name = "nonexistent.R"
        with pytest.raises(RScriptError, match="R script not found"):
            await wrapper.data_process(
                input_file=Path("/tmp/in.parquet"),
                output_file=Path("/tmp/out.tsv"),
                rds_output=Path("/tmp/out.rds"),
            )


class TestNCoreResolution:
    @pytest.mark.asyncio
    async def test_no_explicit_ncores_runs_calibration(self, wrapper):
        from app.models.analysis import AnalysisConfig
        config = AnalysisConfig(organism="human", treatment="A", control="B")
        with patch.object(wrapper, "_calibrate_ncores") as mock_cal:
            mock_cal.return_value = 4
            n = await wrapper._resolve_n_cores(
                config, "msqrob2_n_cores", Path("in.parquet")
            )
            assert n == 4
            mock_cal.assert_called_once()

    @pytest.mark.asyncio
    async def test_cached_ncores_skips_calibration(self, wrapper):
        wrapper._optimal_ncores = 8
        from app.models.analysis import AnalysisConfig
        config = AnalysisConfig(organism="human", treatment="A", control="B")
        with patch.object(wrapper, "_calibrate_ncores") as mock_cal:
            n = await wrapper._resolve_n_cores(
                config, "msqrob2_n_cores", Path("in.parquet")
            )
            assert n == 8
            mock_cal.assert_not_called()
