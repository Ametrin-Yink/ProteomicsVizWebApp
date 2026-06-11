"""Pipeline registry — maps template names to pipeline definitions."""

from app.models.analysis import PipelineTool
from app.services.pipeline_engine import PipelineDefinition, PipelineStep
from app.services.steps import (
    step_combine_replicates_msqrob2,
    step_combine_replicates_msstats,
    step_filter_criteria_default,
    step_generate_unique_psm_msqrob2,
    step_generate_unique_psm_msstats,
    step_msstats_group_comparison,
    step_msstats_protein_abundance,
    step_multi_condition_de,
    step_protein_abundance_msqrob2,
    step_qc_metrics,
    step_qc_metrics_msqrob2,
    step_remove_low_quality_default,
    step_remove_razor,
)

PIPELINES: dict[str, PipelineDefinition] = {}

DEFAULT_PIPELINE: str = PipelineTool.MSQROB2


def register(template: str, steps: list[PipelineStep]) -> None:
    PIPELINES[template] = PipelineDefinition(template, steps)


def get_pipeline(template: str) -> PipelineDefinition:
    """Return the PipelineDefinition for the given template key."""
    return PIPELINES[template]


def list_pipelines() -> dict[str, PipelineDefinition]:
    """Return all registered pipeline definitions."""
    return dict(PIPELINES)


def reset_registry() -> None:
    """Clear PIPELINES and re-register default pipelines.

    Used by test fixtures to isolate tests from each other.
    """
    PIPELINES.clear()
    _register_msqrob2()
    _register_msstats()


def _register_msqrob2() -> None:
    """Register the msqrob2 consolidated pipeline (5 steps)."""
    register(
        PipelineTool.MSQROB2,
        [
            PipelineStep(
                1, "combine_replicates", "Combining Replicates", step_combine_replicates_msqrob2
            ),
            PipelineStep(
                2, "generate_unique_psm", "Generate Unique PSM", step_generate_unique_psm_msqrob2
            ),
            PipelineStep(
                3,
                "protein_abundance",
                "Protein Abundance (msqrob2/QFeatures)",
                step_protein_abundance_msqrob2,
            ),
            PipelineStep(
                4,
                "differential_expression",
                "Differential Expression (msqrob2)",
                step_multi_condition_de,
            ),
            PipelineStep(5, "qc_metrics", "QC Metrics", step_qc_metrics_msqrob2),
        ],
    )


def _register_msstats() -> None:
    """Register the MSstats multi-condition pipeline (8 steps)."""
    register(
        PipelineTool.MSSTATS,
        [
            PipelineStep(
                1, "combine_replicates", "Combining Replicates", step_combine_replicates_msstats
            ),
            PipelineStep(
                2, "generate_unique_psm", "Generate Unique PSM", step_generate_unique_psm_msstats
            ),
            PipelineStep(3, "remove_razor", "Remove Razor Peptides", step_remove_razor),
            PipelineStep(
                4,
                "remove_low_quality",
                "Remove Low Quality",
                step_remove_low_quality_default,
            ),
            PipelineStep(5, "filter", "Filter by Criteria", step_filter_criteria_default),
            PipelineStep(
                6,
                "protein_abundance",
                "Protein Abundance (MSstats)",
                step_msstats_protein_abundance,
            ),
            PipelineStep(
                7,
                "differential_expression",
                "Differential Expression (MSstats)",
                step_msstats_group_comparison,
            ),
            PipelineStep(8, "qc_metrics", "QC Metrics", step_qc_metrics),
        ],
    )


# Register defaults at import time
_register_msqrob2()
_register_msstats()
