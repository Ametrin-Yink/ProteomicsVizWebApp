"""
R/MSstats integration via subprocess.

Handles multi-condition differential expression analysis
using R's MSstats package through subprocess calls (NEVER rpy2).
"""

import asyncio
import json
import logging
import os
import subprocess
import threading
from pathlib import Path
from typing import Optional

from app.core.config import settings
from app.core.exceptions import RScriptError
from app.models.analysis import AnalysisConfig

logger = logging.getLogger("proteomics")


class MsstatsWrapper:
    """
    Wrapper for R/MSstats functionality via subprocess.

    Implements step 7 of the MSstats multi-condition pipeline:
    - Step 7: Differential Expression (groupComparison for multiple contrasts)
    """

    def __init__(self):
        """Initialize wrapper with R executable path."""
        self.r_executable = settings.r_executable
        self.timeout = settings.r_script_timeout
        self.scripts_dir = Path(__file__).parent.parent.parent / "scripts"

    async def _run_r_script(
        self, cmd: list[str], script_path: Path, log_callback: Optional[callable] = None
    ) -> None:
        """
        Run an R script via subprocess with real-time output streaming.

        Args:
            cmd: Full command list (executable + script + args)
            script_path: Path to R script (for error messages)
            log_callback: Optional async callback (level, message) for real-time logging

        Raises:
            RScriptError: If script fails or times out
        """
        logger.info(f"Starting R script with timeout {self.timeout}s")

        # Get the running event loop for callback scheduling
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        # Use Popen for streaming output
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,  # Line buffered
            env={**os.environ, "R_NCORES": str(settings.r_n_cores)},
        )

        stdout_lines: list[str] = []
        stderr_lines: list[str] = []

        def stream_output(
            pipe, lines_list, log_prefix, log_level="info", log_cb=None, event_loop=None
        ):
            """Stream output from pipe and log immediately."""
            try:
                for line in iter(pipe.readline, ""):
                    if not line:
                        break
                    line = line.rstrip("\n\r")
                    lines_list.append(line)
                    logger.info(f"{log_prefix}: {line}")
                    if log_cb and event_loop:
                        try:
                            asyncio.run_coroutine_threadsafe(
                                log_cb(log_level, line), event_loop
                            )
                        except Exception:
                            pass
                pipe.close()
            except Exception as e:
                logger.error(f"Error reading {log_prefix}: {e}")

        # Start threads to read stdout and stderr
        stdout_thread = threading.Thread(
            target=stream_output,
            args=(process.stdout, stdout_lines, "R", "info", log_callback, loop),
            daemon=True,
        )
        stderr_thread = threading.Thread(
            target=stream_output,
            args=(process.stderr, stderr_lines, "R-err", "warning", log_callback, loop),
            daemon=True,
        )
        stdout_thread.start()
        stderr_thread.start()

        # Wait for process to complete with timeout (non-blocking)
        try:
            await asyncio.to_thread(process.wait, timeout=self.timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            await asyncio.to_thread(process.wait)  # Reap zombie on Windows
            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)
            raise

        # Wait for output threads to finish (with timeout to prevent hangs)
        stdout_thread.join(timeout=30)
        stderr_thread.join(timeout=30)

        stdout_str = "\n".join(stdout_lines)
        stderr_str = "\n".join(stderr_lines)

        if process.returncode != 0:
            error_msg = stderr_str if stderr_str else "Unknown error"
            logger.error(
                f"R script failed with return code {process.returncode}: {error_msg}"
            )
            raise RScriptError(
                message=error_msg,
                details={
                    "returncode": process.returncode,
                    "stderr": error_msg[:500],
                    "stdout": stdout_str[:500],
                    "script": str(script_path),
                },
            )

    async def data_process(
        self,
        input_file: Path,
        output_file: Path,
        rds_output: Path,
        gene_mapping_file: Optional[Path] = None,
        config: Optional[object] = None,
        log_callback: Optional[callable] = None,
    ) -> Path:
        """
        Step 6: Calculate protein abundance using MSstats dataProcess.

        Transforms PSM-level data to protein-level abundance using MSstats.
        Used by the multi-condition pipeline.

        Args:
            input_file: Path to PSM_Abundances.tsv/parquet
            output_file: Path for Protein_Abundances.tsv output
            rds_output: Path for MSstats_Processed.rds (intermediate RDS)
            gene_mapping_file: Optional protein to gene mapping file
            config: AnalysisConfig with MSstats parameters
            log_callback: Optional callback function for real-time log messages (level, message)

        Returns:
            Path to output file

        Raises:
            RScriptError: If R script fails
        """
        logger.info(
            "Step 6: Calculating protein abundance with MSstats",
            extra={"session_id": "unknown", "input": str(input_file)},
        )

        script_path = self.scripts_dir / "msstats_data_process.R"

        if not script_path.exists():
            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)},
            )

        # Build JSON config dict with MSstats-native parameter names
        cfg = config if config else AnalysisConfig()
        r_config = {
            "normalization": cfg.msstats_normalization,
            "logTrans": cfg.msstats_log_base,
            "summaryMethod": cfg.msstats_summary_method,
            "MBimpute": cfg.msstats_impute,
            "featureSubset": cfg.msstats_feature_selection,
            "n_top_feature": cfg.msstats_n_top_feature,
            "censoredInt": cfg.msstats_censored_int,
            "maxQuantileforCensored": cfg.msstats_max_quantile,
            "remove50missing": cfg.msstats_remove50missing,
            "min_feature_count": cfg.msstats_min_feature_count,
            "remove_uninformative_feature_outlier": cfg.msstats_remove_uninformative_feature_outlier,
            "equalFeatureVar": cfg.msstats_equal_feature_var,
            "nameStandards": cfg.msstats_name_standards,
            "min_peptides": cfg.min_peptides_per_protein if cfg.min_peptides_per_protein else 1,
            "numberOfCores": cfg.msstats_n_cores if cfg.msstats_n_cores else settings.r_n_cores,
        }

        config_json = json.dumps(r_config)

        # Build command: Rscript expects <input> <output> <rds> <gene_map> <config_json>
        cmd = [
            self.r_executable,
            str(script_path),
            str(input_file),
            str(output_file),
            str(rds_output),
            str(gene_mapping_file) if gene_mapping_file else "",
            config_json,
        ]

        logger.info(f"R command: {' '.join(cmd)}")

        try:
            await self._run_r_script(cmd, script_path, log_callback)

            logger.info(
                "Step 6 complete: Protein abundance calculated",
                extra={"output": str(output_file)},
            )

            return output_file

        except subprocess.TimeoutExpired:
            raise RScriptError(
                message=f"Protein abundance calculation timed out after {self.timeout}s",
                details={"timeout": self.timeout},
            )
        except RScriptError:
            raise
        except Exception as e:
            import traceback

            raise RScriptError(
                message=f"Protein abundance calculation failed: {str(e)}",
                details={"error": str(e), "traceback": traceback.format_exc()},
            )

    async def group_comparison_multi(
        self,
        rds_file: Path,
        output_dir: Path,
        comparisons: list[dict[str, str]],
        gene_mapping_file: Optional[Path] = None,
        covariates: Optional[dict] = None,
        log_base: int = 2,
        save_fitted_models: bool = True,
        n_cores: int = 32,
        log_callback: Optional[callable] = None,
    ) -> Path:
        """
        Step 7 (multi-condition): Run MSstats groupComparison for all contrasts.

        Args:
            rds_file: Path to MSstats_Processed.rds from dataProcess step
            output_dir: Directory for per-comparison Diff_Expression_*.tsv files
            comparisons: List of {treatment, control} dicts
            gene_mapping_file: Optional protein to gene mapping file
            covariates: Optional dict of per-sample covariates (filename -> {column -> value})
            log_base: Log base for fold change calculation (default 2)
            log_callback: Optional callback function for real-time log messages

        Returns:
            Path to output directory

        Raises:
            RScriptError: If R script fails
        """
        logger.info(
            "Step 7 (multi): Running multi-condition differential expression with MSstats",
            extra={"input": str(rds_file), "comparisons": len(comparisons)},
        )

        script_path = self.scripts_dir / "msstats_group_comparison_multi.R"

        if not script_path.exists():
            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)},
            )

        comparisons_json = json.dumps(comparisons)
        covariates_json = json.dumps(covariates or {})

        # Build JSON config for group comparison
        gc_config = {
            "log_base": log_base,
            "save_fitted_models": save_fitted_models,
            "numberOfCores": n_cores,
        }
        config_json = json.dumps(gc_config)

        # Build command: Rscript expects <rds_file> <output_dir> <comparisons_json>
        #                <covariates_json> <gene_mapping_file> <config_json>
        cmd = [
            self.r_executable,
            str(script_path),
            str(rds_file),
            str(output_dir),
            comparisons_json,
            covariates_json,
            str(gene_mapping_file) if gene_mapping_file else "",
            config_json,
        ]

        logger.info(f"R command: {' '.join(cmd[:5])}...")

        try:
            await self._run_r_script(cmd, script_path, log_callback)

            logger.info(
                "Step 7 (multi) complete: Multi-condition differential expression calculated",
                extra={"output_dir": str(output_dir)},
            )

            return output_dir

        except subprocess.TimeoutExpired:
            raise RScriptError(
                message=f"Multi-condition differential expression analysis timed out after {self.timeout}s",
                details={"timeout": self.timeout},
            )
        except RScriptError:
            raise
        except Exception as e:
            import traceback

            raise RScriptError(
                message=f"Multi-condition differential expression analysis failed: {str(e)}",
                details={"error": str(e), "traceback": traceback.format_exc()},
            )

    async def verify_r_packages(self) -> dict:
        """
        Verify that required R packages are installed.

        Returns:
            Dictionary with verification results
        """
        script_path = self.scripts_dir / "verify_msstats.R"

        if not script_path.exists():
            return {
                "success": False,
                "error": f"Verification script not found: {script_path}",
            }

        try:
            # Run R script using subprocess.run in a thread (Windows-compatible)
            def run_verify():
                return subprocess.run(
                    [self.r_executable, str(script_path)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    timeout=60,
                )

            process = await asyncio.to_thread(run_verify)

            stdout_str = process.stdout if process.stdout else ""
            stderr_str = process.stderr if process.stderr else ""

            if process.returncode == 0:
                return {"success": True, "output": stdout_str}
            else:
                return {
                    "success": False,
                    "error": stderr_str or "Unknown error",
                    "output": stdout_str,
                }

        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Verification timed out"}
        except Exception as e:
            return {"success": False, "error": str(e)}


# Global wrapper instance
msstats_wrapper = MsstatsWrapper()
