"""Tests for AnalysisConfig defaults, validation, and model constants."""

import pytest
from app.models.analysis import (
    STEP_DISPLAY_NAMES,
    AnalysisConfig,
    AnalysisResult,
    DatabaseType,
    PipelineTool,
    ProcessingProgress,
)


class TestAnalysisConfigDefaults:
    def test_pipeline_defaults_to_msqrob2(self):
        config = AnalysisConfig()
        assert config.pipeline == PipelineTool.MSQROB2

    def test_msqrob2_ridge_false_by_default(self):
        config = AnalysisConfig()
        assert config.msqrob2_ridge is False

    def test_logfc_threshold_default(self):
        config = AnalysisConfig()
        assert config.logfc_threshold == 1.0

    def test_pvalue_threshold_default(self):
        config = AnalysisConfig()
        assert config.pvalue_threshold == 0.05


class TestAnalysisConfigLegacyMigration:
    def test_migrates_remove_razor(self):
        config = AnalysisConfig.model_validate(
            {"remove_razor": True, "pipeline": "msqrob2"}
        )
        assert config.resolve_shared_peptides is True

    def test_migrates_strict_filtering(self):
        config = AnalysisConfig.model_validate(
            {"strict_filtering": True, "pipeline": "msqrob2"}
        )
        assert config.max_missing_fraction_per_condition == 0.20
        assert config.min_psms_per_protein >= 2


class TestAnalysisResult:
    def test_minimal_construction(self):
        result = AnalysisResult(session_id="test-id")
        assert result.session_id == "test-id"

    def test_completed_at_defaults(self):
        result = AnalysisResult(session_id="test-id")
        assert result.completed_at is not None


class TestProcessingProgress:
    def test_valid_construction(self):
        progress = ProcessingProgress(
            step=1,
            step_name="Input",
            status="started",
            progress=0,
            overall_progress=0,
            message="Starting",
        )
        assert progress.step == 1

    def test_rejects_invalid_status(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ProcessingProgress(
                step=1,
                step_name="Test",
                status="invalid_status",
                progress=0,
                overall_progress=0,
                message="",
            )


class TestStepDisplayNames:
    def test_has_all_pipelines(self):
        assert PipelineTool.MSQROB2 in STEP_DISPLAY_NAMES
        assert PipelineTool.MSSTATS in STEP_DISPLAY_NAMES
        assert PipelineTool.PTM in STEP_DISPLAY_NAMES

    def test_each_has_six_steps(self):
        for pipeline in [PipelineTool.MSQROB2, PipelineTool.MSSTATS,
                          PipelineTool.PTM]:
            steps = STEP_DISPLAY_NAMES[pipeline]
            assert len(steps) == 6, f"{pipeline} has {len(steps)} steps"
            for i in range(1, 7):
                assert i in steps, f"{pipeline} missing step {i}"


class TestDatabaseType:
    def test_enum_values(self):
        assert DatabaseType.GO_BP.value == "go_bp"
        assert DatabaseType.KEGG.value == "kegg"
        assert DatabaseType.REACTOME.value == "reactome"
