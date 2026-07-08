"""Pipeline registry — maps pipeline tools to step lists.

Uses plain list composition for pipeline definitions.
Step numbering is positional — PipelineDefinition assigns step.number = index + 1.
"""

from app.models.analysis import PipelineTool
from app.services.pipeline_engine import PipelineDefinition, PipelineStep

# ── PTM step handlers (preserved) ───────────────────────────────────────
from app.services.steps import (
    step_ptm_group_comparison,
    step_ptm_prepare_data,
    step_ptm_qc_metrics,
    step_ptm_summarization,
)

# ── Engine-specific step handlers ───────────────────────────────────────
from app.services.steps.engines.step_msqrob2_abundance import (
    step_protein_abundance_msqrob2,
)
from app.services.steps.engines.step_msqrob2_de import step_multi_condition_de
from app.services.steps.engines.step_msstats_abundance import (
    step_msstats_protein_abundance,
)
from app.services.steps.engines.step_msstats_de import step_msstats_group_comparison

# ── Input handlers ──────────────────────────────────────────────────────
from app.services.steps.inputs.step_input_dia import step_input_dia
from app.services.steps.inputs.step_input_tmt import step_input_tmt

# ── Shared step handlers ────────────────────────────────────────────────
from app.services.steps.shared.step_filter_criteria import step_filter_criteria_default
from app.services.steps.shared.step_qc_metrics import step_qc_metrics
from app.services.steps.shared.step_remove_low_quality import (
    step_remove_low_quality_default,
)
from app.services.steps.shared.step_remove_razor import step_remove_razor
from app.services.steps.shared.step_unique_psm import step_unique_psm

TMT_PROTEIN_HANDLERS = [
    step_input_tmt,
    step_unique_psm,
    step_remove_razor,
    step_remove_low_quality_default,
    step_filter_criteria_default,
    step_msstats_protein_abundance,
    step_msstats_group_comparison,
    step_qc_metrics,
]
TMT_PROTEIN_NAMES = [
    "input_tmt",
    "unique_psm",
    "remove_razor",
    "remove_low_quality",
    "filter_criteria",
    "protein_abundance_msstats",
    "de_msstats",
    "qc_metrics",
]
TMT_PROTEIN_DISPLAY = [
    "Combine Replicates",
    "Generate Unique PSM",
    "Remove Razor Peptides",
    "Remove Low Quality",
    "Filter by Criteria",
    "Protein Abundance (MSstats)",
    "Differential Expression (MSstats)",
    "QC Metrics",
]

DIA_PROTEIN_HANDLERS = [
    step_input_dia,
    step_unique_psm,
    step_remove_razor,
    step_remove_low_quality_default,
    step_filter_criteria_default,
    step_protein_abundance_msqrob2,
    step_multi_condition_de,
    step_qc_metrics,
]
DIA_PROTEIN_NAMES = [
    "input_dia",
    "unique_psm",
    "remove_razor",
    "remove_low_quality",
    "filter_criteria",
    "protein_abundance_msqrob2",
    "de_msqrob2",
    "qc_metrics",
]
DIA_PROTEIN_DISPLAY = [
    "Combine Replicates",
    "Generate Unique PSM",
    "Remove Razor Peptides",
    "Remove Low Quality",
    "Filter by Criteria",
    "Protein Abundance (msqrob2/QFeatures)",
    "Differential Expression (msqrob2)",
    "QC Metrics",
]

PTM_HANDLERS = [
    step_ptm_prepare_data,
    step_ptm_summarization,
    step_ptm_group_comparison,
    step_ptm_qc_metrics,
]
PTM_NAMES = [
    "prepare_ptm_data",
    "ptm_summarization",
    "ptm_group_comparison",
    "ptm_qc_metrics",
]
PTM_DISPLAY = [
    "Prepare PTM Data",
    "PTM Summarization (MSstatsPTM)",
    "PTM Group Comparison (MSstatsPTM)",
    "PTM QC Metrics",
]


def _build_pipeline(
    handlers: list, names: list[str], display_names: list[str]
) -> list[PipelineStep]:
    """Build list of PipelineStep with positional numbering."""
    return [
        PipelineStep(i + 1, names[i], display_names[i], handlers[i])
        for i in range(len(handlers))
    ]


PIPELINES: dict[str, PipelineDefinition] = {
    PipelineTool.MSSTATS: PipelineDefinition(
        PipelineTool.MSSTATS,
        _build_pipeline(TMT_PROTEIN_HANDLERS, TMT_PROTEIN_NAMES, TMT_PROTEIN_DISPLAY),
    ),
    PipelineTool.MSQROB2: PipelineDefinition(
        PipelineTool.MSQROB2,
        _build_pipeline(DIA_PROTEIN_HANDLERS, DIA_PROTEIN_NAMES, DIA_PROTEIN_DISPLAY),
    ),
    PipelineTool.PTM: PipelineDefinition(
        PipelineTool.PTM,
        _build_pipeline(PTM_HANDLERS, PTM_NAMES, PTM_DISPLAY),
    ),
}

DEFAULT_PIPELINE: str = PipelineTool.MSQROB2


def get_pipeline(template: str) -> PipelineDefinition:
    """Return the PipelineDefinition for the given template key."""
    return PIPELINES[template]


def list_pipelines() -> dict[str, PipelineDefinition]:
    """Return all registered pipeline definitions."""
    return dict(PIPELINES)


def reset_registry() -> None:
    """Reset PIPELINES dict (no-op — PIPELINES is immutable).

    Kept for backward compatibility with test fixtures.
    """
    pass
