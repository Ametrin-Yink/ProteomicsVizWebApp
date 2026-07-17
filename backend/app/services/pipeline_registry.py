"""Pipeline registry — maps pipeline tools to step lists.

Each step is declared once as its name, display name, and handler.
Step numbering is positional — PipelineDefinition assigns step.number = index + 1.
"""

from collections.abc import Awaitable, Callable

from app.models.analysis import PipelineTool
from app.services.pipeline_engine import (
    PipelineDefinition,
    PipelineStep,
    StepContext,
)

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

PipelineStepSpec = tuple[
    str,
    str,
    Callable[[StepContext], Awaitable[None]],
]

TMT_PROTEIN_STEPS: list[PipelineStepSpec] = [
    ("input_tmt", "Combine Replicates", step_input_tmt),
    ("unique_psm", "Generate Unique PSM", step_unique_psm),
    ("remove_razor", "Remove Razor Peptides", step_remove_razor),
    ("remove_low_quality", "Remove Low Quality", step_remove_low_quality_default),
    ("filter_criteria", "Filter by Criteria", step_filter_criteria_default),
    (
        "protein_abundance_msstats",
        "Protein Abundance (MSstats)",
        step_msstats_protein_abundance,
    ),
    (
        "de_msstats",
        "Differential Expression (MSstats)",
        step_msstats_group_comparison,
    ),
    ("qc_metrics", "QC Metrics", step_qc_metrics),
]

DIA_PROTEIN_STEPS: list[PipelineStepSpec] = [
    ("input_dia", "Combine Replicates", step_input_dia),
    ("unique_psm", "Generate Unique PSM", step_unique_psm),
    ("remove_razor", "Remove Razor Peptides", step_remove_razor),
    ("remove_low_quality", "Remove Low Quality", step_remove_low_quality_default),
    ("filter_criteria", "Filter by Criteria", step_filter_criteria_default),
    (
        "protein_abundance_msqrob2",
        "Protein Abundance (msqrob2/QFeatures)",
        step_protein_abundance_msqrob2,
    ),
    (
        "de_msqrob2",
        "Differential Expression (msqrob2)",
        step_multi_condition_de,
    ),
    ("qc_metrics", "QC Metrics", step_qc_metrics),
]

PTM_STEPS: list[PipelineStepSpec] = [
    ("prepare_ptm_data", "Prepare PTM Data", step_ptm_prepare_data),
    (
        "ptm_summarization",
        "PTM Summarization (MSstatsPTM)",
        step_ptm_summarization,
    ),
    (
        "ptm_group_comparison",
        "PTM Group Comparison (MSstatsPTM)",
        step_ptm_group_comparison,
    ),
    ("ptm_qc_metrics", "PTM QC Metrics", step_ptm_qc_metrics),
]


def _build_pipeline(step_specs: list[PipelineStepSpec]) -> list[PipelineStep]:
    """Build list of PipelineStep with positional numbering."""
    return [
        PipelineStep(number, name, display_name, handler)
        for number, (name, display_name, handler) in enumerate(step_specs, start=1)
    ]


PIPELINES: dict[str, PipelineDefinition] = {
    PipelineTool.MSSTATS: PipelineDefinition(
        PipelineTool.MSSTATS,
        _build_pipeline(TMT_PROTEIN_STEPS),
    ),
    PipelineTool.MSQROB2: PipelineDefinition(
        PipelineTool.MSQROB2,
        _build_pipeline(DIA_PROTEIN_STEPS),
    ),
    PipelineTool.PTM: PipelineDefinition(
        PipelineTool.PTM,
        _build_pipeline(PTM_STEPS),
    ),
}

DEFAULT_PIPELINE: str = PipelineTool.MSQROB2


def get_pipeline(template: str) -> PipelineDefinition:
    """Return the PipelineDefinition for the given template key."""
    return PIPELINES[template]


def list_pipelines() -> dict[str, PipelineDefinition]:
    """Return all registered pipeline definitions."""
    return dict(PIPELINES)
