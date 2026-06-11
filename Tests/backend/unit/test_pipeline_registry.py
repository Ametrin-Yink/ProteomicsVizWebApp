"""Unit tests for pipeline registry — step definitions and ordering."""
import pytest
from app.services.pipeline_registry import get_pipeline, list_pipelines, DEFAULT_PIPELINE


class TestMsqrob2Pipeline:
    @pytest.fixture
    def pipeline(self):
        return get_pipeline("msqrob2")

    def test_has_five_steps(self, pipeline):
        assert len(pipeline.steps) == 5

    def test_step_order_is_correct(self, pipeline):
        step_names = [s.name for s in pipeline.steps]
        assert step_names == [
            "combine_replicates",
            "generate_unique_psm",
            "protein_abundance",
            "differential_expression",
            "qc_metrics",
        ]

    def test_step_numbers_are_sequential(self, pipeline):
        for i, step in enumerate(pipeline.steps, start=1):
            assert step.number == i, f"Step '{step.name}' should be #{i}"

    def test_all_steps_have_display_names(self, pipeline):
        for step in pipeline.steps:
            assert step.display_name, f"Step '{step.name}' missing display_name"

    def test_all_steps_have_handlers(self, pipeline):
        for step in pipeline.steps:
            assert step.handler is not None, f"Step '{step.name}' missing handler"


class TestMSstatsPipeline:
    @pytest.fixture
    def pipeline(self):
        return get_pipeline("msstats")

    def test_has_eight_steps(self, pipeline):
        assert len(pipeline.steps) == 8

    def test_step_order_is_correct(self, pipeline):
        step_names = [s.name for s in pipeline.steps]
        assert step_names == [
            "combine_replicates",
            "generate_unique_psm",
            "remove_razor",
            "remove_low_quality",
            "filter",
            "protein_abundance",
            "differential_expression",
            "qc_metrics",
        ]

    def test_step_numbers_are_sequential(self, pipeline):
        for i, step in enumerate(pipeline.steps, start=1):
            assert step.number == i

    def test_all_steps_have_handlers(self, pipeline):
        for step in pipeline.steps:
            assert step.handler is not None


class TestPipelineUniqueness:
    def test_msqrob2_and_msstats_are_different(self):
        msqrob2 = get_pipeline("msqrob2")
        msstats = get_pipeline("msstats")
        assert len(msqrob2.steps) != len(msstats.steps)

    def test_step_handlers_are_pipeline_specific(self):
        """Steps 1-2 have pipeline-specific handlers so modifications
        to one pipeline never affect the other."""
        msqrob2 = get_pipeline("msqrob2")
        msstats = get_pipeline("msstats")
        # Step 1: each pipeline has its own handler
        assert msqrob2.steps[0].handler is not None
        assert msstats.steps[0].handler is not None
        assert msqrob2.steps[0].handler != msstats.steps[0].handler
        # Step 2: each pipeline has its own handler
        assert msqrob2.steps[1].handler is not None
        assert msstats.steps[1].handler is not None
        assert msqrob2.steps[1].handler != msstats.steps[1].handler


class TestListPipelines:
    def test_returns_dict_with_both_pipelines(self):
        pipelines = list_pipelines()
        assert isinstance(pipelines, dict)
        assert "msqrob2" in pipelines
        assert "msstats" in pipelines

    def test_each_pipeline_has_steps(self):
        for template, pipeline in list_pipelines().items():
            assert len(pipeline.steps) > 0, f"Pipeline '{template}' has no steps"


class TestDefaultPipeline:
    def test_default_is_msqrob2(self):
        assert DEFAULT_PIPELINE == "msqrob2"

    def test_default_pipeline_exists(self):
        assert DEFAULT_PIPELINE in list_pipelines()
