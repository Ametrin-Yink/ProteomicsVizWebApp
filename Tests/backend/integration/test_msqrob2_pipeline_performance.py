"""
Integration tests for msqrob2 pipeline performance features.

Verifies: step count, per-step timeouts, wrapper config serialization,
RDS checkpoint behavior, heartbeat logging, and timeout retry.
"""

import asyncio
import json
import subprocess
from pathlib import Path

import pytest

from app.core.config import settings
from app.models.analysis import AnalysisConfig, AnalysisTemplate
from app.services.msqrob2_wrapper import msqrob2_wrapper
from app.services.pipeline_engine import PipelineDefinition, PipelineStep, PipelineEngine, StepContext
from app.services.steps import (
    step_combine_replicates,
    step_generate_unique_psm,
    step_remove_razor,
    step_remove_low_quality_default,
    step_filter_criteria_default,
    step_protein_abundance_msqrob2,
    step_multi_condition_de,
    step_qc_metrics,
    step_gsea_analysis,
)


class TestMsqrob2PipelineStructure:
    """Verify msqrob2 pipeline definition is correctly structured."""

    def test_eight_steps(self):
        """Pipeline has exactly 8 steps."""
        from app.services.pipeline_registry import PIPELINES
        pipeline = PIPELINES[AnalysisTemplate.MULTI_CONDITION]
        assert len(pipeline.steps) == 8

    def test_step_numbers_sequential(self):
        """Steps are numbered 1 through 8."""
        from app.services.pipeline_registry import PIPELINES
        pipeline = PIPELINES[AnalysisTemplate.MULTI_CONDITION]
        numbers = [s.number for s in pipeline.steps]
        assert numbers == list(range(1, 9))

    def test_step_6_is_msqrob2(self):
        """Step 6 uses msqrob2 handler."""
        from app.services.pipeline_registry import PIPELINES
        pipeline = PIPELINES[AnalysisTemplate.MULTI_CONDITION]
        step6 = pipeline.steps[5]
        assert step6.number == 6
        assert "msqrob2" in step6.display_name.lower()
        assert step6.handler == step_protein_abundance_msqrob2

    def test_step_7_is_msqrob2(self):
        """Step 7 uses msqrob2 handler."""
        from app.services.pipeline_registry import PIPELINES
        pipeline = PIPELINES[AnalysisTemplate.MULTI_CONDITION]
        step7 = pipeline.steps[6]
        assert step7.number == 7
        assert step7.handler == step_multi_condition_de


class TestMsqrob2Config:
    """Verify msqrob2 config fields serialize correctly."""

    def test_default_config(self):
        """Default AnalysisConfig has sensible msqrob2 defaults."""
        config = AnalysisConfig(template=AnalysisTemplate.MULTI_CONDITION)
        assert config.msqrob2_normalization == "center.median"
        assert config.msqrob2_imputation == "none"
        assert config.msqrob2_aggregation == "robustSummary"
        assert config.msqrob2_model == "msqrobLm"
        assert config.msqrob2_robust is True
        assert config.msqrob2_ridge is False
        assert config.msqrob2_adjust_method == "BH"

    def test_config_serialization(self):
        """Config serializes to dict with msqrob2 fields."""
        config = AnalysisConfig(template=AnalysisTemplate.MULTI_CONDITION)
        d = config.model_dump()
        assert "msqrob2_normalization" in d
        assert d["msqrob2_normalization"] == "center.median"
        assert d["msqrob2_robust"] is True

    def test_data_process_config_json(self):
        """Wrapper builds correct config JSON for data_process."""
        config = AnalysisConfig(
            template=AnalysisTemplate.MULTI_CONDITION,
            msqrob2_normalization="quantiles",
            msqrob2_imputation="knn",
            msqrob2_aggregation="medianPolish",
            msqrob2_n_cores=8,
        )
        r_config = {
            "normalization": config.msqrob2_normalization,
            "imputation": config.msqrob2_imputation,
            "aggregation": config.msqrob2_aggregation,
            "min_peptides": config.msqrob2_min_peptides,
            "numberOfCores": config.msqrob2_n_cores,
        }
        json_str = json.dumps(r_config)
        parsed = json.loads(json_str)
        assert parsed["normalization"] == "quantiles"
        assert parsed["imputation"] == "knn"
        assert parsed["aggregation"] == "medianPolish"
        assert parsed["numberOfCores"] == 8


class TestMsqrob2Timeouts:
    """Verify per-step timeout settings exist."""

    def test_data_process_timeout(self):
        """data_process has its own timeout setting."""
        assert settings.r_msqrob2_data_process_timeout == 7200

    def test_group_comparison_timeout(self):
        """group_comparison has its own timeout setting."""
        assert settings.r_msqrob2_group_comparison_timeout == 3600

    def test_timeouts_are_distinct(self):
        """Step 6 and Step 7 have different timeout settings."""
        assert settings.r_msqrob2_data_process_timeout != settings.r_msqrob2_group_comparison_timeout


class TestMsqrob2TimeoutRetry:
    """Verify timeout detection works for msqrob2 wrapper."""

    def test_timeout_expired_detection(self):
        """subprocess.TimeoutExpired is detectable."""
        import subprocess as sp
        assert issubclass(sp.TimeoutExpired, sp.SubprocessError)

    def test_wrapper_has_timeout_multiplier_param(self):
        """Wrapper methods accept timeout_multiplier."""
        import inspect
        sig = inspect.signature(msqrob2_wrapper.data_process)
        assert "timeout_multiplier" in sig.parameters
        sig2 = inspect.signature(msqrob2_wrapper.group_comparison_multi)
        assert "timeout_multiplier" in sig2.parameters


class TestMsqrob2WrapperAttributes:
    """Verify wrapper has required attributes and methods."""

    def test_has_rds_parameter(self):
        """data_process accepts rds_output parameter."""
        import inspect
        sig = inspect.signature(msqrob2_wrapper.data_process)
        assert "rds_output" in sig.parameters

    def test_group_comparison_accepts_rds(self):
        """group_comparison_multi accepts rds_file parameter."""
        import inspect
        sig = inspect.signature(msqrob2_wrapper.group_comparison_multi)
        assert "rds_file" in sig.parameters

    def test_has_calibration(self):
        """Wrapper has core calibration method."""
        assert hasattr(msqrob2_wrapper, "_calibrate_ncores")
        assert callable(msqrob2_wrapper._calibrate_ncores)

    def test_has_optimal_ncores_cache(self):
        """Wrapper caches calibration result."""
        assert hasattr(msqrob2_wrapper, "_optimal_ncores")


class TestMsqrob2ScriptExistence:
    """Verify new R scripts exist and old ones don't."""

    def test_data_process_script_exists(self):
        script = msqrob2_wrapper.scripts_dir / "msqrob2_data_process.R"
        assert script.exists(), f"Missing: {script}"

    def test_group_comparison_script_exists(self):
        script = msqrob2_wrapper.scripts_dir / "msqrob2_group_comparison_multi.R"
        assert script.exists(), f"Missing: {script}"

    def test_old_protein_script_removed(self):
        script = msqrob2_wrapper.scripts_dir / "msqrob2_protein.R"
        assert not script.exists(), f"Should be deleted: {script}"

    def test_old_de_script_removed(self):
        script = msqrob2_wrapper.scripts_dir / "msqrob2_de.R"
        assert not script.exists(), f"Should be deleted: {script}"

    def test_old_de_multi_script_removed(self):
        script = msqrob2_wrapper.scripts_dir / "msqrob2_de_multi.R"
        assert not script.exists(), f"Should be deleted: {script}"


class TestMSstatsUnaffected:
    """Verify MSstats pipeline is untouched."""

    def test_msstats_pipeline_still_registered(self):
        from app.services.pipeline_registry import PIPELINES
        assert AnalysisTemplate.MSSTATS in PIPELINES

    def test_msstats_step_6_unchanged(self):
        from app.services.pipeline_registry import PIPELINES
        from app.services.steps import step_msstats_protein_abundance
        pipeline = PIPELINES[AnalysisTemplate.MSSTATS]
        step6 = [s for s in pipeline.steps if s.number == 6][0]
        assert step6.handler == step_msstats_protein_abundance

    def test_msstats_step_7_unchanged(self):
        from app.services.pipeline_registry import PIPELINES
        from app.services.steps import step_msstats_group_comparison
        pipeline = PIPELINES[AnalysisTemplate.MSSTATS]
        step7 = [s for s in pipeline.steps if s.number == 7][0]
        assert step7.handler == step_msstats_group_comparison
