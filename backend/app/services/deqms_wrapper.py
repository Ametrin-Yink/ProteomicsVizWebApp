"""
R/DEqMS integration via subprocess.

Handles protein abundance calculation and differential expression analysis
using R's DEqMS package through subprocess calls (NEVER rpy2).
"""

import asyncio
import logging
import os
import subprocess
import threading
from pathlib import Path
from typing import Optional

from app.core.config import settings
from app.core.exceptions import RScriptError

logger = logging.getLogger("proteomics")


class DeqmsWrapper:
    """
    Wrapper for R/DEqMS functionality via subprocess.

    Implements steps 6 and 7 of the DEqMS pipeline:
    - Step 6: Protein Abundance (medianSweeping)
    - Step 7: Differential Expression (spectraCounteBayes)
    """

    def __init__(self):
        """Initialize wrapper with R executable path."""
        self.r_executable = settings.r_executable
        self.timeout = settings.r_script_timeout
        self.scripts_dir = Path(__file__).parent.parent.parent / "scripts"

    async def _run_r_script(
        self,
        cmd: list[str],
        script_path: Path,
        log_callback: Optional[callable] = None
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

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='replace',
            bufsize=1,
            env={**os.environ, "R_NCORES": str(settings.r_n_cores)}
        )

        stdout_lines: list[str] = []
        stderr_lines: list[str] = []

        def stream_output(pipe, lines_list, log_prefix, log_level="info", log_cb=None, event_loop=None):
            """Stream output from pipe and log immediately."""
            try:
                for line in iter(pipe.readline, ''):
                    if not line:
                        break
                    line = line.rstrip('\n\r')
                    lines_list.append(line)
                    logger.info(f"{log_prefix}: {line}")
                    if log_cb and event_loop:
                        try:
                            asyncio.run_coroutine_threadsafe(
                                log_cb(log_level, line),
                                event_loop
                            )
                        except Exception:
                            pass
                pipe.close()
            except Exception as e:
                logger.error(f"Error reading {log_prefix}: {e}")

        stdout_thread = threading.Thread(
            target=stream_output,
            args=(process.stdout, stdout_lines, "R", "info", log_callback, loop)
        )
        stderr_thread = threading.Thread(
            target=stream_output,
            args=(process.stderr, stderr_lines, "R-err", "warning", log_callback, loop)
        )
        stdout_thread.start()
        stderr_thread.start()

        try:
            await asyncio.to_thread(process.wait, timeout=self.timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            await asyncio.to_thread(process.wait)
            await asyncio.to_thread(stdout_thread.join, timeout=5)
            await asyncio.to_thread(stderr_thread.join, timeout=5)
            raise

        await asyncio.to_thread(stdout_thread.join)
        await asyncio.to_thread(stderr_thread.join)

        stdout_str = '\n'.join(stdout_lines)
        stderr_str = '\n'.join(stderr_lines)

        if process.returncode != 0:
            error_msg = stderr_str if stderr_str else "Unknown error"
            logger.error(f"R script failed with return code {process.returncode}: {error_msg}")
            raise RScriptError(
                message=error_msg,
                details={
                    "returncode": process.returncode,
                    "stderr": error_msg[:500],
                    "stdout": stdout_str[:500],
                    "script": str(script_path)
                }
            )

    async def step6_protein_abundance(
        self,
        input_file: Path,
        output_file: Path,
        gene_mapping_file: Optional[Path] = None,
        log_callback: Optional[callable] = None
    ) -> Path:
        """
        Step 6: Calculate protein abundance using DEqMS medianSweeping.

        Args:
            input_file: Path to PSM_Abundances.tsv/parquet
            output_file: Path for Protein_Abundances.tsv output
            gene_mapping_file: Optional protein to gene mapping file
            log_callback: Optional callback for real-time log messages

        Returns:
            Path to output file
        """
        logger.info("Step 6: Calculating protein abundance with DEqMS")

        script_path = self.scripts_dir / "deqms_protein.R"

        if not script_path.exists():
            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)}
            )

        cmd = [
            self.r_executable,
            str(script_path),
            str(input_file),
            str(output_file),
            str(gene_mapping_file) if gene_mapping_file else "",
        ]

        logger.info(f"R command: {' '.join(cmd)}")

        try:
            await self._run_r_script(cmd, script_path, log_callback)
            logger.info(f"Step 6 complete: Protein abundance calculated, output: {output_file}")
            return output_file
        except subprocess.TimeoutExpired:
            raise RScriptError(
                message=f"Protein abundance calculation timed out after {self.timeout}s",
                details={"timeout": self.timeout}
            )
        except RScriptError:
            raise
        except Exception as e:
            import traceback
            raise RScriptError(
                message=f"Protein abundance calculation failed: {str(e)}",
                details={"error": str(e), "traceback": traceback.format_exc()}
            )

    async def step7_differential_expression(
        self,
        input_file: Path,
        output_file: Path,
        treatment: str,
        control: str,
        fit_method: str = "loess",
        log_callback: Optional[callable] = None
    ) -> Path:
        """
        Step 7: Differential expression analysis using DEqMS spectraCounteBayes.

        Args:
            input_file: Path to Protein_Abundances.tsv
            output_file: Path for Diff_Expression.tsv output
            treatment: Treatment condition name
            control: Control condition name
            fit_method: DEqMS fit method (loess, nls, spline)
            log_callback: Optional callback for real-time log messages

        Returns:
            Path to output file
        """
        logger.info("Step 7: Running differential expression analysis with DEqMS")

        script_path = self.scripts_dir / "deqms_de.R"

        if not script_path.exists():
            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)}
            )

        cmd = [
            self.r_executable,
            str(script_path),
            str(input_file),
            str(output_file),
            treatment,
            control,
            str(fit_method),
        ]

        logger.info(f"R command: {' '.join(cmd)}")

        try:
            await self._run_r_script(cmd, script_path, log_callback)
            logger.info(f"Step 7 complete: Differential expression calculated, output: {output_file}")
            return output_file
        except subprocess.TimeoutExpired:
            raise RScriptError(
                message=f"Differential expression analysis timed out after {self.timeout}s",
                details={"timeout": self.timeout}
            )
        except RScriptError:
            raise
        except Exception as e:
            import traceback
            raise RScriptError(
                message=f"Differential expression analysis failed: {str(e)}",
                details={"error": str(e), "traceback": traceback.format_exc()}
            )

    async def verify_r_packages(self) -> dict:
        """
        Verify that required R packages are installed.

        Returns:
            Dictionary with verification results
        """
        try:
            def run_verify():
                return subprocess.run(
                    [self.r_executable, "-e",
                     "library(DEqMS); library(limma); library(ggplot2); cat('DEqMS packages OK\n')"],
                    capture_output=True,
                    text=True,
                    encoding='utf-8',
                    timeout=60
                )

            process = await asyncio.to_thread(run_verify)

            if process.returncode == 0:
                return {"success": True, "output": process.stdout}
            else:
                return {
                    "success": False,
                    "error": process.stderr or "Unknown error",
                    "output": process.stdout
                }
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Verification timed out"}
        except Exception as e:
            return {"success": False, "error": str(e)}


# Global wrapper instance
deqms_wrapper = DeqmsWrapper()
