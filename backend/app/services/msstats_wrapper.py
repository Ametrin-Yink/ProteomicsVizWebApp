"""
R/MSstats integration via subprocess.

Handles multi-condition differential expression analysis
using R's MSstats package through subprocess calls (NEVER rpy2).
"""

from app.core.config import settings
from app.models.analysis import AnalysisConfig
from app.services.base_r_wrapper import BaseRWrapper


class MsstatsWrapper(BaseRWrapper):
    """Wrapper for R/MSstats functionality via subprocess.

    Implements steps 6 and 7 of the MSstats multi-condition pipeline:
    - Step 6: Protein Abundance (dataProcess)
    - Step 7: Differential Expression (groupComparison for multiple contrasts)
    """

    def __init__(self):
        super().__init__(
            cal_prefix="_msstats_cal",
            benchmark_script="msstats_data_process.R",
            data_process_script="msstats_data_process.R",
            gc_script="msstats_group_comparison_multi.R",
            verify_script="verify_msstats.R",
            dp_timeout=settings.r_data_process_timeout,
            gc_timeout=settings.r_group_comparison_timeout,
        )

    @property
    def _n_cores_config_attr(self) -> str:
        return "msstats_n_cores"

    # ------------------------------------------------------------------
    # Abstract method implementations
    # ------------------------------------------------------------------

    def _build_data_process_config(
        self, config: AnalysisConfig, n_cores: int
    ) -> dict:
        return {
            "normalization": config.msstats_normalization,
            "logTrans": config.msstats_log_base,
            "summaryMethod": config.msstats_summary_method,
            "MBimpute": config.msstats_impute,
            "featureSubset": config.msstats_feature_selection,
            "n_top_feature": config.msstats_n_top_feature,
            "censoredInt": config.msstats_censored_int,
            "maxQuantileforCensored": config.msstats_max_quantile,
            "remove50missing": config.msstats_remove50missing,
            "min_feature_count": config.msstats_min_feature_count,
            "remove_uninformative_feature_outlier": config.msstats_remove_uninformative_feature_outlier,
            "equalFeatureVar": config.msstats_equal_feature_var,
            "nameStandards": config.msstats_name_standards,
            "min_peptides": config.min_peptides_per_protein if config.min_peptides_per_protein else 1,
            "numberOfCores": n_cores,
        }

    def _build_gc_config(
        self, config: AnalysisConfig, n_cores: int, **extra
    ) -> dict:
        return {
            "log_base": extra.get("log_base", 2),
            "save_fitted_models": extra.get("save_fitted_models", True),
            "numberOfCores": n_cores,
        }

    def _build_cmd_extras(self, **extra) -> list[str]:
        covariates = extra.get("covariates")
        import json
        return [json.dumps(covariates or {})]


# Global wrapper instance
msstats_wrapper = MsstatsWrapper()
