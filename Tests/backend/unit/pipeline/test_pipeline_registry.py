"""Unit tests for pipeline registry — step definitions, ordering, and composition.

Tests the new composable step library architecture with 8-step symmetric
pipelines. Validates step ordering, positional numbering, and PTM preservation.
"""

from app.models.analysis import PipelineTool
from app.services.pipeline_registry import PIPELINES


class TestPipelineComposition:
    """Verify pipeline compositions have correct step count and order."""

    def test_pipeline_composition_tmt(self):
        """TMT_PROTEIN (MSstats) has 8 steps in correct order."""
        pipeline = PIPELINES[PipelineTool.MSSTATS]
        assert len(pipeline.steps) == 8

        expected_names = [
            "input_tmt",
            "unique_psm",
            "remove_razor",
            "remove_low_quality",
            "filter_criteria",
            "protein_abundance_msstats",
            "de_msstats",
            "qc_metrics",
        ]
        actual_names = [s.name for s in pipeline.steps]
        assert (
            actual_names == expected_names
        ), f"Expected {expected_names}, got {actual_names}"

    def test_pipeline_composition_dia(self):
        """DIA_PROTEIN (msqrob2) has 8 steps in correct order."""
        pipeline = PIPELINES[PipelineTool.MSQROB2]
        assert len(pipeline.steps) == 8

        expected_names = [
            "input_dia",
            "unique_psm",
            "remove_razor",
            "remove_low_quality",
            "filter_criteria",
            "protein_abundance_msqrob2",
            "de_msqrob2",
            "qc_metrics",
        ]
        actual_names = [s.name for s in pipeline.steps]
        assert (
            actual_names == expected_names
        ), f"Expected {expected_names}, got {actual_names}"

    def test_pipeline_step_numbering(self):
        """step.number matches list position (index + 1)."""
        for tool in [PipelineTool.MSQROB2, PipelineTool.MSSTATS]:
            pipeline = PIPELINES[tool]
            for i, step in enumerate(pipeline.steps, start=1):
                assert (
                    step.number == i
                ), f"Pipeline '{tool}' step '{step.name}' should be #{i}, got #{step.number}"

    def test_pipeline_ptm_preserved(self):
        """PTM_PIPELINE has 4 steps preserved unchanged."""
        pipeline = PIPELINES[PipelineTool.PTM]
        assert len(pipeline.steps) == 4

        expected_names = [
            "prepare_ptm_data",
            "ptm_summarization",
            "ptm_group_comparison",
            "ptm_qc_metrics",
        ]
        actual_names = [s.name for s in pipeline.steps]
        assert actual_names == expected_names

    def test_pipelines_registered(self):
        """All 3 pipelines are registered in PIPELINES dict."""
        assert PipelineTool.MSQROB2 in PIPELINES
        assert PipelineTool.MSSTATS in PIPELINES
        assert PipelineTool.PTM in PIPELINES
        assert len(PIPELINES) == 3


class TestPipelineStepDetails:
    """Verify individual step metadata."""

    def test_all_steps_have_handlers(self):
        for tool, pipeline in PIPELINES.items():
            for step in pipeline.steps:
                assert (
                    step.handler is not None
                ), f"Pipeline '{tool}' step '{step.name}' missing handler"

    def test_all_steps_have_display_names(self):
        for tool, pipeline in PIPELINES.items():
            for step in pipeline.steps:
                assert (
                    step.display_name
                ), f"Pipeline '{tool}' step '{step.name}' missing display_name"

    def test_step_names_are_unique_per_pipeline(self):
        for tool, pipeline in PIPELINES.items():
            names = [s.name for s in pipeline.steps]
            assert len(names) == len(
                set(names)
            ), f"Pipeline '{tool}' has duplicate step names: {names}"
