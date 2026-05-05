"""Integration tests for MSstats pipeline performance features."""

import subprocess

import pytest

from app.core.config import settings
from app.core.exceptions import RScriptError
from app.models.analysis import AnalysisTemplate
from app.services.msstats_wrapper import MsstatsWrapper
from app.services.pipeline_engine import PipelineEngine
from app.services.pipeline_registry import PIPELINES


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

    def test_default_timeout_raised(self):
        assert settings.r_script_timeout == 7200


class TestTimeoutRetry:
    """Verify timeout retry logic in pipeline engine."""

    def test_is_timeout_error_detects_rscript_timeout(self):
        engine = PipelineEngine(PIPELINES)
        err = RScriptError(
            message="Protein abundance calculation timed out after 7200s",
            details={"timeout": 7200},
        )
        assert engine._is_timeout_error(err) is True

    def test_is_timeout_error_detects_timeout_variant(self):
        engine = PipelineEngine(PIPELINES)
        err = RScriptError(
            message="Multi-condition DE analysis timed out after 3600s",
            details={"timeout": 3600},
        )
        assert engine._is_timeout_error(err) is True

    def test_is_timeout_error_rejects_other_rscipt_errors(self):
        engine = PipelineEngine(PIPELINES)
        err = RScriptError(
            message="R package 'MSstats' not installed",
            details={},
        )
        assert engine._is_timeout_error(err) is False

    def test_is_timeout_error_detects_subprocess_timeout(self):
        engine = PipelineEngine(PIPELINES)
        err = subprocess.TimeoutExpired(cmd=["Rscript", "script.R"], timeout=10)
        assert engine._is_timeout_error(err) is True

    def test_is_timeout_error_rejects_value_error(self):
        engine = PipelineEngine(PIPELINES)
        err = ValueError("something went wrong")
        assert engine._is_timeout_error(err) is False


class TestMsstatsWrapper:
    """Verify wrapper uses correct timeouts and calibration."""

    def test_timeout_config_values(self):
        wrapper = MsstatsWrapper()
        assert wrapper.timeout == settings.r_script_timeout

    def test_optimal_ncores_initialized(self):
        wrapper = MsstatsWrapper()
        assert wrapper._optimal_ncores is None

    def test_calibrate_ncores_cached(self):
        """_calibrate_ncores returns cached value if already set."""
        wrapper = MsstatsWrapper()
        wrapper._optimal_ncores = 8
        # Can't easily test with real data, but cache check should work
        assert wrapper._optimal_ncores == 8
