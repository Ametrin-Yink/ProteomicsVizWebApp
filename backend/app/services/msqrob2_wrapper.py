"""
R/msqrob2 integration via subprocess.

Handles protein abundance (QFeatures aggregation) and differential expression
(msqrob2 robust regression) through subprocess calls (NEVER rpy2).

Implements steps 6-7 of the MULTI_CONDITION pipeline.
"""

from app.core.config import settings
from app.models.analysis import AnalysisConfig
from app.services.base_r_wrapper import BaseRWrapper

# Reserved metadata keys — NOT condition groups (not translated to condition_N)
_RESERVED_KEYS = {"experiment", "replicate", "batch", "file_type"}


def _translate_metadata(metadata: dict | None) -> dict | None:
    """Translate user-defined condition group names to condition_N for R scripts.

    The msqrob2 R scripts require condition keys starting with 'condition_'.
    User-defined group names (drug, time, etc.) are mapped to condition_1,
    condition_2, etc. Reserved keys (experiment, replicate, batch) pass through.

    Example: {'drug': 'DMSO', 'time': '24h', 'batch': 'A'}
          → {'condition_1': 'DMSO', 'condition_2': '24h', 'batch': 'A'}
    """
    if not metadata:
        return metadata
    translated = {}
    for filename, entry in metadata.items():
        new_entry = {}
        cond_idx = 1
        for key, value in entry.items():
            if key in _RESERVED_KEYS:
                new_entry[key] = value
            else:
                new_entry[f"condition_{cond_idx}"] = value
                cond_idx += 1
        translated[filename] = new_entry
    return translated


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
            dp_timeout=settings.r_msqrob2_data_process_timeout,
            gc_timeout=settings.r_msqrob2_group_comparison_timeout,
        )

    # ------------------------------------------------------------------
    # Abstract method implementations
    # ------------------------------------------------------------------

    def _build_data_process_config(self, config: AnalysisConfig, n_cores: int) -> dict:
        """Build config JSON for step 3 (protein abundance via QFeatures)."""
        return {
            "normalization": config.msqrob2_normalization,
            "imputation": config.msqrob2_imputation,
            "aggregation": config.msqrob2_aggregation,
            "min_peptides": config.msqrob2_min_peptides,
            "remove_razor": config.remove_razor,
            "strict_filtering": config.strict_filtering,
            "numberOfCores": n_cores,
            "batch_column": config.msqrob2_batch_column,
            "metadata": _translate_metadata(config.metadata),
        }

    def _build_gc_config(self, config: AnalysisConfig, n_cores: int, **extra) -> dict:
        """Build config JSON for step 4 (differential expression via msqrob v1.16 API)."""
        return {
            "ridge": config.msqrob2_ridge,
            "maxitRob": 10,
            "adjust_method": config.msqrob2_adjust_method,
            "numberOfCores": n_cores,
            "batch_column": config.msqrob2_batch_column,
            "metadata": _translate_metadata(config.metadata),
        }

    # _n_cores_config_attr = "msqrob2_n_cores"  (matches base default)


# Global wrapper instance
msqrob2_wrapper = Msqrob2Wrapper()
