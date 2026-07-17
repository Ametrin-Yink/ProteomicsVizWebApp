"""
R/MSstats integration via subprocess.

Handles multi-condition differential expression analysis
using R's MSstats package through subprocess calls (NEVER rpy2).
"""

import logging
from pathlib import Path

from app.core.config import settings
from app.models.analysis import AnalysisConfig
from app.services.base_r_wrapper import BaseRWrapper

logger = logging.getLogger("proteomics")


def _build_msstats_batch_cmd(
    rds_file_str: str,
    output_dir_str: str,
    gene_mapping_str: str,
    cov_json_str: str,
    log_base: int,
    save_fitted_models: bool,
    r_executable: str,
    script_path_str: str,
    gc_timeout: int,
    batch_items: list[dict],
    batch_idx: int,
    n_cores_per: int,
) -> tuple[list[str], int]:
    """Build an R subprocess command for a batch of MSstats comparisons.

    All config values are passed as simple types (str, int, bool) for pickling.
    Module-level function (not a closure) required for ProcessPoolExecutor pickling.
    Called by BaseRWrapper.run_batched() via functools.partial.

    The R script receives positional args:
      1. rds_file
      2. output_dir
      3. comparisons_json
      4. covariates_json
      5. gene_mapping_file
      6. config_json
    """
    import json

    comparisons_json = json.dumps(batch_items)
    cfg = {
        "log_base": log_base,
        "save_fitted_models": save_fitted_models,
        "numberOfCores": n_cores_per,
    }
    config_json = json.dumps(cfg)
    cmd = [
        r_executable,
        script_path_str,
        rds_file_str,
        output_dir_str,
        comparisons_json,
        cov_json_str,
        gene_mapping_str,
        config_json,
    ]
    return cmd, gc_timeout


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
            dp_timeout=settings.r_data_process_timeout,
            gc_timeout=settings.r_group_comparison_timeout,
        )

    @property
    def _n_cores_config_attr(self) -> str:
        return "msstats_n_cores"

    # ------------------------------------------------------------------
    # Abstract method implementations
    # ------------------------------------------------------------------

    def _build_data_process_config(self, config: AnalysisConfig, n_cores: int) -> dict:
        return {
            "normalization": config.msstats_normalization,
            "logTrans": config.msstats_log_base,
            "summaryMethod": config.msstats_summary_method,
            "MBimpute": config.msstats_impute,
            "featureSubset": config.msstats_feature_selection,
            "n_top_feature": config.msstats_n_top_feature,
            "censoredInt": config.msstats_censored_int,
            "maxQuantileforCensored": config.msstats_max_quantile,
            "min_feature_count": config.msstats_min_feature_count,
            "remove_uninformative_feature_outlier": config.msstats_remove_uninformative_feature_outlier,
            "equalFeatureVar": config.msstats_equal_feature_var,
            "nameStandards": config.msstats_name_standards,
            "numberOfCores": n_cores,
        }

    def _build_gc_config(self, config: AnalysisConfig, n_cores: int, **extra) -> dict:
        return {
            "log_base": extra.get("log_base", 2),
            "save_fitted_models": extra.get("save_fitted_models", True),
            "numberOfCores": n_cores,
        }

    def _build_cmd_extras(self, **extra) -> list[str]:
        covariates = extra.get("covariates")
        import json

        return [json.dumps(covariates or {})]

    async def group_comparison_batched(
        self,
        rds_file: Path,
        output_dir: Path,
        comparisons: list[dict],
        gene_mapping_file: Path | None = None,
        covariates: dict | None = None,
        batch_size: int = 10,
        max_workers: int = 4,
        n_cores_cap: int = 32,
        log_callback=None,
        timeout: int | None = None,
        **extra,
    ) -> Path:
        """Step 7 (batched): Run groupComparison in parallel batches.

        Splits comparisons into batches of batch_size and runs each
        in its own R subprocess via ProcessPoolExecutor. Below batch_size,
        run_batched falls back to a single R process.
        """
        import functools
        import json

        script_path = self.scripts_dir / self._gc_script_name

        if not script_path.exists():
            from app.core.exceptions import RScriptError

            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)},
            )

        build_batch_cmd = functools.partial(
            _build_msstats_batch_cmd,
            str(rds_file),
            str(output_dir),
            str(gene_mapping_file) if gene_mapping_file else "",
            json.dumps(covariates or {}),
            extra.get("log_base", 2),
            extra.get("save_fitted_models", True),
            self.r_executable,
            str(script_path),
            timeout if timeout is not None else self._gc_timeout,
        )

        await self.run_batched(
            items=comparisons,
            batch_size=batch_size,
            max_workers=max_workers,
            n_cores_cap=n_cores_cap,
            build_batch_cmd=build_batch_cmd,
            log_callback=log_callback,
        )

        logger.info(
            "Step 7 (batched) complete: %d comparisons across batches",
            len(comparisons),
        )
        return output_dir


# Global wrapper instance
msstats_wrapper = MsstatsWrapper()
