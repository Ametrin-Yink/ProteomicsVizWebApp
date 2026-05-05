"""
R/msqrob2 integration via subprocess.

Handles protein abundance (QFeatures aggregation) and differential expression
(msqrob2 robust regression) through subprocess calls (NEVER rpy2).

Implements steps 6-7 of the MULTI_CONDITION pipeline with full operational parity
to the MSstats wrapper: heartbeat logging, RDS checkpointing, per-step timeouts,
SnowParam core calibration, and automatic timeout retry.
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


class Msqrob2Wrapper:
    """
    Wrapper for R/msqrob2+QFeatures functionality via subprocess.

    Implements steps 6 and 7 of the multi-condition pipeline:
    - Step 6: Protein Abundance via QFeatures (data_process)
    - Step 7: Differential Expression via msqrob2 (group_comparison_multi)
    """

    def __init__(self):
        """Initialize wrapper with R executable path."""
        self.r_executable = settings.r_executable
        self._optimal_ncores: int | None = None
        self.timeout = settings.r_script_timeout
        self.scripts_dir = Path(__file__).parent.parent.parent / "scripts"

    async def _calibrate_ncores(self, input_file: Path) -> int:
        """Benchmark SnowParam worker counts on a data slice, return optimal ncores.

        Runs aggregation on first 100K rows with worker counts [1, 4, 8, 16, 32],
        picks the fastest. Result cached for backend process lifetime.
        """
        if self._optimal_ncores is not None:
            return self._optimal_ncores

        logger.info("Calibrating optimal SnowParam worker count...")
        candidate_counts = [1, 4, 8, 16, 32]
        best_n = 4
        best_time = float("inf")

        for n in candidate_counts:
            try:
                elapsed = await self._benchmark_ncores(input_file, n)
                logger.info(f"  n_cores={n}: {elapsed:.1f}s")
                if elapsed < best_time:
                    best_time = elapsed
                    best_n = n
            except Exception as e:
                logger.warning(f"  n_cores={n}: calibration failed ({e})")

        self._optimal_ncores = best_n
        logger.info(f"Calibration complete: optimal n_cores={best_n} ({best_time:.1f}s)")
        return best_n

    async def _benchmark_ncores(self, input_file: Path, n_cores: int) -> float:
        """Run a quick aggregation benchmark with n_cores on a data slice."""
        import time

        slice_file = input_file.parent / f"_msqrob2_calibration_slice_{n_cores}.parquet"
        rds_file = input_file.parent / f"_msqrob2_calibration_{n_cores}.rds"
        out_file = input_file.parent / f"_msqrob2_calibration_output_{n_cores}.tsv"

        try:
            import pandas as pd
            df = pd.read_parquet(input_file)
            slice_df = df.head(100000)
            slice_df.to_parquet(slice_file)

            bench_config = {
                "normalization": "center.median",
                "imputation": "none",
                "aggregation": "robustSummary",
                "min_peptides": 1,
                "numberOfCores": n_cores,
            }

            script_path = self.scripts_dir / "msqrob2_data_process.R"
            config_json = json.dumps(bench_config)
            cmd = [
                self.r_executable, str(script_path),
                str(slice_file), str(out_file), str(rds_file), "", config_json,
            ]

            start = time.time()
            await self._run_r_script(cmd, script_path, timeout=120)
            return time.time() - start
        finally:
            for f in [slice_file, rds_file, out_file]:
                if f.exists():
                    f.unlink(missing_ok=True)

    async def _run_r_script(
        self, cmd: list[str], script_path: Path,
        log_callback: Optional[callable] = None,
        timeout: int | None = None,
    ) -> None:
        """
        Run an R script via subprocess with real-time output streaming and heartbeat.

        Args:
            cmd: Full command list (executable + script + args)
            script_path: Path to R script (for error messages)
            log_callback: Optional async callback (level, message) for real-time logging
            timeout: Per-call timeout override

        Raises:
            RScriptError: If script fails or times out
        """
        effective_timeout = timeout if timeout is not None else self.timeout
        logger.info(f"Starting R script with timeout {effective_timeout}s")

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env={**os.environ, "R_NCORES": str(settings.r_n_cores)},
        )

        stdout_lines: list[str] = []
        stderr_lines: list[str] = []

        def stream_output(pipe, lines_list, log_prefix, log_level="info", log_cb=None, event_loop=None):
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

        # Heartbeat thread: logs every 60s while process runs
        heartbeat_stop = threading.Event()

        def heartbeat():
            count = 0
            while not heartbeat_stop.is_set():
                if heartbeat_stop.wait(60):
                    break
                count += 1
                msg = f"Still working... ({count * 60}s elapsed)"
                logger.info(f"Heartbeat: {msg}")
                if log_callback and loop:
                    try:
                        asyncio.run_coroutine_threadsafe(
                            log_callback("info", msg), loop
                        )
                    except Exception:
                        pass

        heartbeat_thread = threading.Thread(target=heartbeat, daemon=True)
        heartbeat_thread.start()

        try:
            await asyncio.to_thread(process.wait, timeout=effective_timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            await asyncio.to_thread(process.wait)
            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)
            raise
        finally:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=1)

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
        config: Optional[AnalysisConfig] = None,
        log_callback: Optional[callable] = None,
        timeout: int | None = None,
        timeout_multiplier: int = 1,
    ) -> Path:
        """
        Step 6: Calculate protein abundance using QFeatures preprocessing.

        Transforms PSM-level data to protein-level abundance using the QFeatures
        framework: logTransform -> normalize -> impute -> aggregateFeatures.

        Args:
            input_file: Path to PSM_Abundances.{tsv|parquet}
            output_file: Path for Protein_Abundances.tsv output
            rds_output: Path for MSqRob2_Processed.rds (intermediate checkpoint)
            gene_mapping_file: Optional protein to gene mapping file
            config: AnalysisConfig with msqrob2 parameters
            log_callback: Optional callback for real-time log messages (level, message)
            timeout: Per-call timeout override
            timeout_multiplier: Multiplier for timeout (2x on retry)

        Returns:
            Path to output file

        Raises:
            RScriptError: If R script fails or times out
        """
        logger.info(
            "Step 6: Calculating protein abundance with msqrob2/QFeatures",
            extra={"session_id": "unknown", "input": str(input_file)},
        )

        script_path = self.scripts_dir / "msqrob2_data_process.R"

        if not script_path.exists():
            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)},
            )

        cfg = config if config else AnalysisConfig()

        # Calibrate n_cores if user hasn't overridden
        n_cores = cfg.msqrob2_n_cores
        if n_cores is None or n_cores == 32:
            try:
                if self._optimal_ncores is not None:
                    n_cores = self._optimal_ncores
                else:
                    n_cores = await self._calibrate_ncores(input_file)
            except Exception:
                n_cores = 4

        r_config = {
            "normalization": cfg.msqrob2_normalization,
            "imputation": cfg.msqrob2_imputation,
            "aggregation": cfg.msqrob2_aggregation,
            "min_peptides": cfg.msqrob2_min_peptides,
            "numberOfCores": n_cores,
        }

        config_json = json.dumps(r_config)

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
            effective_timeout = (timeout if timeout is not None else settings.r_msqrob2_data_process_timeout) * timeout_multiplier
            await self._run_r_script(cmd, script_path, log_callback, timeout=effective_timeout)

            logger.info(
                "Step 6 complete: Protein abundance calculated",
                extra={"output": str(output_file)},
            )

            return output_file

        except subprocess.TimeoutExpired:
            raise RScriptError(
                message=f"Protein abundance calculation timed out after {effective_timeout}s",
                details={"timeout": effective_timeout},
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
        comparisons: list[dict],
        gene_mapping_file: Optional[Path] = None,
        config: Optional[AnalysisConfig] = None,
        log_callback: Optional[callable] = None,
        timeout: int | None = None,
        timeout_multiplier: int = 1,
    ) -> Path:
        """
        Step 7 (multi-condition): Run msqrob2-native DE for all contrasts.

        Args:
            rds_file: Path to MSqRob2_Processed.rds from data_process step
            output_dir: Directory for per-comparison Diff_Expression_*.tsv files
            comparisons: List of {group1: {Condition: "X"}, group2: {Condition: "Y"}} dicts
            gene_mapping_file: Optional protein to gene mapping file (API compat)
            config: AnalysisConfig with msqrob2 parameters
            log_callback: Optional callback for real-time log messages
            timeout: Per-call timeout override
            timeout_multiplier: Multiplier for timeout (2x on retry)

        Returns:
            Path to output directory

        Raises:
            RScriptError: If R script fails or times out
        """
        logger.info(
            "Step 7 (multi): Running msqrob2-native multi-condition DE",
            extra={"input": str(rds_file), "comparisons": len(comparisons)},
        )

        script_path = self.scripts_dir / "msqrob2_group_comparison_multi.R"

        if not script_path.exists():
            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)},
            )

        comparisons_json = json.dumps(comparisons)

        cfg = config if config else AnalysisConfig()

        # Build config for DE parameters from AnalysisConfig msqrob2 fields
        gc_config = {
            "model": cfg.msqrob2_model,
            "robust": cfg.msqrob2_robust,
            "ridge": cfg.msqrob2_ridge,
            "adjust_method": cfg.msqrob2_adjust_method,
        }
        config_json = json.dumps(gc_config)

        cmd = [
            self.r_executable,
            str(script_path),
            str(rds_file),
            str(output_dir),
            comparisons_json,
            str(gene_mapping_file) if gene_mapping_file else "",
            config_json,
        ]

        logger.info(f"R command: {' '.join(cmd[:5])}...")

        try:
            effective_timeout = (timeout if timeout is not None else settings.r_msqrob2_group_comparison_timeout) * timeout_multiplier
            await self._run_r_script(cmd, script_path, log_callback, timeout=effective_timeout)

            logger.info(
                "Step 7 (multi) complete: msqrob2 multi-condition DE calculated",
                extra={"output_dir": str(output_dir)},
            )

            return output_dir

        except subprocess.TimeoutExpired:
            raise RScriptError(
                message=f"msqrob2 DE analysis timed out after {effective_timeout}s",
                details={"timeout": effective_timeout},
            )
        except RScriptError:
            raise
        except Exception as e:
            import traceback
            raise RScriptError(
                message=f"msqrob2 DE analysis failed: {str(e)}",
                details={"error": str(e), "traceback": traceback.format_exc()},
            )

    async def verify_r_packages(self) -> dict:
        """
        Verify that required R packages are installed.

        Returns:
            Dictionary with verification results
        """
        script_path = self.scripts_dir / "verify_r_packages.R"

        if not script_path.exists():
            return {
                "success": False,
                "error": f"Verification script not found: {script_path}",
            }

        try:
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
msqrob2_wrapper = Msqrob2Wrapper()
