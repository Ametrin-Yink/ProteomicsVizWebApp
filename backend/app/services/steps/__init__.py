"""Pipeline step handlers.

This module re-exports all step handler functions from their organized locations:
- inputs/: Input-specific step handlers (TMT, DIA)
- shared/: Step handlers used by all pipelines
- engines/: Engine-specific R step handlers
- Root level: Existing step handlers and PTM handlers
"""

# ── Shared utilities ────────────────────────────────────────────────────
from ._helpers import create_log_callback, get_gene_mapping, get_psm_input

# ── Engine-specific step handlers ───────────────────────────────────────
from .engines.step_msqrob2_abundance import step_protein_abundance_msqrob2
from .engines.step_msqrob2_de import step_multi_condition_de
from .engines.step_msstats_abundance import step_msstats_protein_abundance
from .engines.step_msstats_de import step_msstats_group_comparison

# ── Input handlers ──────────────────────────────────────────────────────
from .inputs.step_input_dia import step_input_dia
from .inputs.step_input_tmt import step_input_tmt

# ── PTM step handlers (preserved) ───────────────────────────────────────
from .ptm_step1_prepare import step_ptm_prepare_data
from .ptm_step2_summarization import step_ptm_summarization
from .ptm_step3_comparison import step_ptm_group_comparison
from .ptm_step4_qc import step_ptm_qc_metrics

# ── Shared step handlers ────────────────────────────────────────────────
from .shared.step_filter_criteria import step_filter_criteria_default
from .shared.step_qc_metrics import step_qc_metrics
from .shared.step_resolve_shared_peptides import step_resolve_shared_peptides

__all__ = [
    "create_log_callback",
    "get_gene_mapping",
    "get_psm_input",
    "step_filter_criteria_default",
    "step_input_dia",
    "step_input_tmt",
    "step_msstats_group_comparison",
    "step_msstats_protein_abundance",
    "step_multi_condition_de",
    "step_protein_abundance_msqrob2",
    "step_ptm_group_comparison",
    "step_ptm_prepare_data",
    "step_ptm_qc_metrics",
    "step_ptm_summarization",
    "step_qc_metrics",
    "step_resolve_shared_peptides",
]
