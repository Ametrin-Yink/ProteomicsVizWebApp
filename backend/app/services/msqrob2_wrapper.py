"""
R/msqrob2 integration via subprocess.

Handles protein abundance (QFeatures aggregation) and differential expression
(msqrob2 robust regression) through subprocess calls (NEVER rpy2).

Implements steps 6-7 of the MULTI_CONDITION pipeline.
"""

import json as _json
import logging
from pathlib import Path

from app.core.config import settings
from app.models.analysis import AnalysisConfig
from app.services.base_r_wrapper import BaseRWrapper

logger = logging.getLogger("proteomics")


def _build_msqrob2_batch_cmd(
    rds_file_str: str,
    output_dir_str: str,
    gene_mapping_str: str,
    config_json_str: str,
    r_executable: str,
    script_path_str: str,
    gc_timeout: int,
    batch_items: list[dict],
    batch_idx: int,
    n_cores_per: int,
) -> tuple[list[str], int]:
    """Build an R subprocess command for a batch of msqrob2 comparisons.

    The R script loads a pre-fitted QFeatures RDS (with msqrob() already run)
    and executes makeContrast() + hypothesisTest() for batch_items only.

    Module-level function (not a closure) required for ProcessPoolExecutor pickling.
    Called by BaseRWrapper.run_batched() via functools.partial.

    The R script receives positional args:
      1. rds_file
      2. output_dir
      3. comparisons_json
      4. gene_mapping_file
      5. config_json
    """
    import json as _json

    comparisons_json = _json.dumps(batch_items)
    cfg = _json.loads(config_json_str)
    cfg["numberOfCores"] = n_cores_per
    config_json = _json.dumps(cfg)
    cmd = [
        r_executable,
        script_path_str,
        rds_file_str,
        output_dir_str,
        comparisons_json,
        gene_mapping_str,
        config_json,
    ]
    return cmd, gc_timeout

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
            "keep_intermediate_assays": getattr(config, "msqrob2_keep_intermediate_assays", False),
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
            "skip_fit": extra.get("skip_fit", False),
            "save_fitted_rds": extra.get("save_fitted_rds", False),
        }

    async def group_comparison_batched(
        self,
        rds_file: Path,
        output_dir: Path,
        comparisons: list[dict],
        gene_mapping_file: Path | None = None,
        config: "AnalysisConfig | None" = None,
        log_callback=None,
        timeout: int | None = None,
    ) -> Path:
        """Step 7 (batched): Run DE in parallel batches.

        Splits comparisons into batches of settings.msqrob2_batch_size
        and runs each in its own R subprocess via ProcessPoolExecutor.
        When comparisons <= batch_size, falls back to group_comparison_multi.

        Two-phase execution for batching:
          Phase A — Fit the msqrob() model once, save fitted RDS.
          Phase B — Batched comparisons using pre-fitted RDS (skip msqrob()).
        """
        import functools

        n_total = len(comparisons)
        batch_size = settings.msqrob2_batch_size

        if n_total <= batch_size:
            return await self.group_comparison_multi(
                rds_file=rds_file, output_dir=output_dir,
                comparisons=comparisons, gene_mapping_file=gene_mapping_file,
                config=config, log_callback=log_callback, timeout=timeout,
            )

        # Phase A: Fit the model once (if not already cached)
        fitted_rds_path = output_dir / "MSqRob2_Fitted.rds"
        if not fitted_rds_path.exists():
            logger.info("Phase A: Fitting msqrob model (save_fitted_rds mode)")
            await self.group_comparison_multi(
                rds_file=rds_file,
                output_dir=output_dir,
                comparisons=comparisons[:1],
                gene_mapping_file=gene_mapping_file,
                config=config,
                log_callback=log_callback,
                timeout=timeout,
                save_fitted_rds=True,
            )
            logger.info("Phase A complete: fitted RDS saved to %s", fitted_rds_path)

        # Phase B: Batched comparisons using pre-fitted RDS
        script_path = self.scripts_dir / self._gc_script_name
        cfg = config if config else AnalysisConfig()
        n_cores = await self._resolve_n_cores(cfg, self._n_cores_config_attr, rds_file, log_callback)
        if n_cores > 1:
            n_cores = await self._check_memory_headroom(rds_file, n_cores, log_callback)
        gc_config = self._build_gc_config(cfg, n_cores, skip_fit=True)
        config_json = _json.dumps(gc_config)

        build_batch_cmd = functools.partial(
            _build_msqrob2_batch_cmd,
            str(fitted_rds_path),  # Use fitted RDS — skips msqrob() in R script
            str(output_dir),
            str(gene_mapping_file) if gene_mapping_file else "",
            config_json,
            self.r_executable, str(script_path),
            timeout if timeout is not None else self._gc_timeout,
        )

        await self.run_batched(
            items=comparisons,
            batch_size=batch_size,
            max_workers=settings.msqrob2_max_workers,
            n_cores_cap=settings.msqrob2_n_cores_cap,
            build_batch_cmd=build_batch_cmd,
            log_callback=log_callback,
        )
        return output_dir

    # _n_cores_config_attr = "msqrob2_n_cores"  (matches base default)


# Global wrapper instance
msqrob2_wrapper = Msqrob2Wrapper()
