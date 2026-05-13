"""Pipeline registry — maps template names to pipeline definitions."""

from app.models.analysis import PipelineTool
from app.services.pipeline_engine import PipelineDefinition, PipelineStep
from app.services.steps import (
    step_combine_replicates,
    step_generate_unique_psm,
    step_remove_razor,
    step_remove_low_quality_default,
    step_filter_criteria_default,
    step_protein_abundance_msqrob2,
    step_multi_condition_de,
    step_msstats_protein_abundance,
    step_msstats_group_comparison,
    step_qc_metrics,
    step_qc_metrics_msqrob2,
)

PIPELINES: dict[str, PipelineDefinition] = {}


def register(template: str, steps: list[PipelineStep]) -> None:
    PIPELINES[template] = PipelineDefinition(template, steps)


# Register msqrob2 consolidated pipeline (5 steps)
register(
    PipelineTool.MSQROB2,
    [
        PipelineStep(
            1, "combine_replicates", "Combining Replicates", step_combine_replicates
        ),
        PipelineStep(
            2, "generate_unique_psm", "Generate Unique PSM", step_generate_unique_psm
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

# Register MSstats multi-condition pipeline (8 steps, unchanged)
register(
    PipelineTool.MSSTATS,
    [
        PipelineStep(
            1, "combine_replicates", "Combining Replicates", step_combine_replicates
        ),
        PipelineStep(
            2, "generate_unique_psm", "Generate Unique PSM", step_generate_unique_psm
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
