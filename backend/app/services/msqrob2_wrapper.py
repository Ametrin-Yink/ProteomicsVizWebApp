"""
R/msqrob2 integration via subprocess.

Handles protein abundance (QFeatures aggregation) and differential expression
(msqrob2 robust regression) through subprocess calls (NEVER rpy2).

Implements steps 6-7 of the MULTI_CONDITION pipeline.
"""

from app.core.config import settings
from app.models.analysis import AnalysisConfig
from app.services.base_r_wrapper import BaseRWrapper


class Msqrob2Wrapper(BaseRWrapper):
    """Wrapper for R/msqrob2+QFeatures functionality via subprocess.

    Implements steps 6 and 7 of the multi-condition pipeline:
    - Step 6: Protein Abundance via QFeatures (data_process)
    - Step 7: Differential Expression via msqrob2 (group_comparison_multi)
    """

    def __init__(self):
        super().__init__(
            cal_prefix="_msqrob2_cal",
            benchmark_script="msqrob2_data_process.R",
            data_process_script="msqrob2_data_process.R",
            gc_script="msqrob2_group_comparison_multi.R",
            verify_script="verify_r_packages.R",
            dp_timeout=settings.r_msqrob2_data_process_timeout,
            gc_timeout=settings.r_msqrob2_group_comparison_timeout,
        )

    # ------------------------------------------------------------------
    # Abstract method implementations
    # ------------------------------------------------------------------

    def _build_data_process_config(
        self, config: AnalysisConfig, n_cores: int
    ) -> dict:
        return {
            "normalization": config.msqrob2_normalization,
            "imputation": config.msqrob2_imputation,
            "aggregation": config.msqrob2_aggregation,
            "min_peptides": config.msqrob2_min_peptides,
            "numberOfCores": n_cores,
        }

    def _build_gc_config(
        self, config: AnalysisConfig, n_cores: int, **extra
    ) -> dict:
        return {
            "model": config.msqrob2_model,
            "robust": config.msqrob2_robust,
            "ridge": config.msqrob2_ridge,
            "adjust_method": config.msqrob2_adjust_method,
            "numberOfCores": n_cores,
        }

    # _n_cores_config_attr = "msqrob2_n_cores"  (matches base default)


# Global wrapper instance
msqrob2_wrapper = Msqrob2Wrapper()
