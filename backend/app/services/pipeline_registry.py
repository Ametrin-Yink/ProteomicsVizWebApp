"""Pipeline registry — maps template names to pipeline definitions."""

from app.models.analysis import AnalysisTemplate
from app.services.pipeline_engine import PipelineDefinition, PipelineStep
from app.services.steps import (
    step_combine_replicates,
    step_generate_unique_psm,
    step_remove_razor,
    step_remove_low_quality_default,
    step_filter_criteria_default,
    step_protein_abundance_msqrob2,
    step_diff_expression_msqrob2,
    step_qc_metrics,
    step_gsea_analysis,
    step_protein_abundance_msstats,
    step_diff_expression_msstats,
    step_protein_abundance_deqms,
    step_diff_expression_deqms,
    step_generate_unique_psm_deqms,
    step_group_comparison_multi,
)

PIPELINES: dict[str, PipelineDefinition] = {}


def register(template: str, steps: list[PipelineStep]) -> None:
    PIPELINES[template] = PipelineDefinition(template, steps)


# Register msqrob2 pipeline
register(
    AnalysisTemplate.PROTEIN_PAIRWISE,
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
            "Protein Abundance (msqrob2)",
            step_protein_abundance_msqrob2,
        ),
        PipelineStep(
            7,
            "diff_expression",
            "Differential Expression (limma)",
            step_diff_expression_msqrob2,
        ),
        PipelineStep(8, "qc_metrics", "QC Metrics", step_qc_metrics),
        PipelineStep(9, "gsea", "GSEA Analysis", step_gsea_analysis),
    ],
)

# Register MSstats pipeline
register(
    AnalysisTemplate.MSSTATS_PAIRWISE,
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
            step_protein_abundance_msstats,
        ),
        PipelineStep(
            7,
            "diff_expression",
            "Differential Expression (MSstats)",
            step_diff_expression_msstats,
        ),
        PipelineStep(8, "qc_metrics", "QC Metrics", step_qc_metrics),
        PipelineStep(9, "gsea", "GSEA Analysis", step_gsea_analysis),
    ],
)

# Register DEqMS pipeline
register(
    AnalysisTemplate.DEQMS_PAIRWISE,
    [
        PipelineStep(
            1, "combine_replicates", "Combining Replicates", step_combine_replicates
        ),
        PipelineStep(
            2,
            "generate_unique_psm",
            "Generate Unique PSM (DEqMS)",
            step_generate_unique_psm_deqms,
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
            "Protein Abundance (DEqMS)",
            step_protein_abundance_deqms,
        ),
        PipelineStep(
            7,
            "diff_expression",
            "Differential Expression (DEqMS)",
            step_diff_expression_deqms,
        ),
        PipelineStep(8, "qc_metrics", "QC Metrics", step_qc_metrics),
        PipelineStep(9, "gsea", "GSEA Analysis", step_gsea_analysis),
    ],
)

# Register MSstats Multi-Condition pipeline (no GSEA step — on-demand)
register(
    AnalysisTemplate.MULTI_CONDITION,
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
            step_protein_abundance_msstats,
        ),
        PipelineStep(
            7,
            "diff_expression_multi",
            "Differential Expression (MSstats Multi-Condition)",
            step_group_comparison_multi,
        ),
        PipelineStep(8, "qc_metrics", "QC Metrics", step_qc_metrics),
    ],
)
