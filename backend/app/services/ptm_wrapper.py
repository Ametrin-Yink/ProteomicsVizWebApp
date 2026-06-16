"""
R/MSstatsPTM integration via subprocess.

Handles PTM summarization and group comparison through subprocess calls
(NEVER rpy2). Implements steps 2-3 of the PTM pipeline.
"""

from app.core.config import settings
from app.models.analysis import AnalysisConfig
from app.services.base_r_wrapper import BaseRWrapper


class PTMWrapper(BaseRWrapper):
    """Wrapper for R/MSstatsPTM functionality via subprocess.

    Implements steps 2 and 3 of the PTM pipeline:
    - Step 2: PTM Summarization via MSstatsPTM (data_process)
    - Step 3: PTM Group Comparison via MSstatsPTM (group_comparison)
    """

    def __init__(self) -> None:
        super().__init__(
            cal_prefix="_ptm_cal",
            benchmark_script="ptm_summarization.R",
            data_process_script="ptm_summarization.R",
            gc_script="ptm_group_comparison.R",
            verify_script="verify_msstatsptm.R",
            dp_timeout=settings.r_ptm_summarization_timeout,
            gc_timeout=settings.r_ptm_group_comparison_timeout,
        )

    # ------------------------------------------------------------------
    # Abstract method implementations
    # ------------------------------------------------------------------

    def _build_data_process_config(self, config: AnalysisConfig, n_cores: int) -> dict:
        """Build config JSON for step 2 (PTM summarization via MSstatsPTM)."""
        return {
            "normalization": config.ptm_normalization,
            "summaryMethod": config.ptm_summary_method,
            "MBimpute": config.ptm_mbimpute,
            "labeling_type": config.ptm_labeling_type,
            "mod_id": config.ptm_mod_ids,
            "which_proteinid": config.ptm_which_proteinid,
            "which_quantification": config.ptm_which_quantification,
            "numberOfCores": n_cores,
        }

    def _build_gc_config(self, config: AnalysisConfig, n_cores: int, **extra: object) -> dict:
        """Build config JSON for step 3 (PTM group comparison via MSstatsPTM)."""
        return {
            "ptm_label_type": extra.get("ptm_label_type", config.ptm_labeling_type),
            "protein_label_type": extra.get("protein_label_type", config.ptm_labeling_type),
            "adj_method": "BH",
            "moderated": True,
            "numberOfCores": n_cores,
        }


# Global wrapper instance
ptm_wrapper = PTMWrapper()
