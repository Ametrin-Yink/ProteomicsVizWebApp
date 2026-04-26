"""
R/msqrob2 integration via subprocess.

Handles protein abundance calculation and differential expression analysis
using R's msqrob2 package through subprocess calls (NEVER rpy2).
"""

import asyncio
import logging
import subprocess
import threading
from pathlib import Path
from typing import Optional

from app.core.config import settings
from app.core.exceptions import RScriptError, ProcessingError

logger = logging.getLogger("proteomics")


class Msqrob2Wrapper:
    """
    Wrapper for R/msqrob2 functionality via subprocess.

    Implements steps 6 and 7 of the pipeline:
    - Step 6: Protein Abundance (aggregateFeatures)
    - Step 7: Differential Expression (msqrob)
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
            encoding='utf-8',
            bufsize=1  # Line buffered
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

        # Start threads to read stdout and stderr
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

        # Wait for process to complete with timeout
        try:
            process.wait(timeout=self.timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)
            raise

        # Wait for output threads to finish
        stdout_thread.join()
        stderr_thread.join()

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
        Step 6: Calculate protein abundance using msqrob2.

        Uses R's aggregateFeatures function to aggregate peptide-level
        data to protein level.

        Args:
            input_file: Path to PSM_Abundances.tsv
            output_file: Path for Protein_Abundances.tsv output
            gene_mapping_file: Optional protein to gene mapping file
            log_callback: Optional callback function for real-time log messages (level, message)

        Returns:
            Path to output file

        Raises:
            RScriptError: If R script fails
        """
        logger.info(
            "Step 6: Calculating protein abundance with msqrob2",
            extra={"session_id": "unknown", "input": str(input_file)}
        )

        script_path = self.scripts_dir / "msqrob2_protein.R"

        if not script_path.exists():
            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)}
            )

        # Build command
        cmd = [
            self.r_executable,
            str(script_path),
            str(input_file),
            str(output_file)
        ]

        if gene_mapping_file:
            cmd.append(str(gene_mapping_file))

        logger.info(f"R command: {' '.join(cmd)}")

        try:
            await self._run_r_script(cmd, script_path, log_callback)

            logger.info(
                "Step 6 complete: Protein abundance calculated",
                extra={"output": str(output_file)}
            )

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
        log_callback: Optional[callable] = None
    ) -> Path:
        """
        Step 7: Differential expression analysis using msqrob2.

        Uses R's msqrob function to fit robust linear models and
        calculate differential expression statistics.

        Args:
            input_file: Path to Protein_Abundances.tsv
            output_file: Path for Diff_Expression.tsv output
            treatment: Treatment condition name
            control: Control condition name
            log_callback: Optional callback function for real-time log messages

        Returns:
            Path to output file

        Raises:
            RScriptError: If R script fails
        """
        logger.info(
            "Step 7: Running differential expression analysis with msqrob2",
            extra={
                "input": str(input_file),
                "treatment": treatment,
                "control": control
            }
        )

        script_path = self.scripts_dir / "msqrob2_de.R"

        if not script_path.exists():
            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)}
            )

        # Build command
        cmd = [
            self.r_executable,
            str(script_path),
            str(input_file),
            str(output_file),
            treatment,
            control
        ]

        logger.info(f"R command: {' '.join(cmd)}")

        try:
            await self._run_r_script(cmd, script_path, log_callback)

            logger.info(
                "Step 7 complete: Differential expression calculated",
                extra={"output": str(output_file)}
            )

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
        script_path = self.scripts_dir / "verify_r_packages.R"

        if not script_path.exists():
            return {
                "success": False,
                "error": f"Verification script not found: {script_path}"
            }

        try:
            # Run R script using subprocess.run in a thread (Windows-compatible)
            def run_verify():
                return subprocess.run(
                    [self.r_executable, str(script_path)],
                    capture_output=True,
                    text=True,
                    encoding='utf-8',
                    timeout=60
                )

            process = await asyncio.to_thread(run_verify)

            stdout_str = process.stdout if process.stdout else ""
            stderr_str = process.stderr if process.stderr else ""

            if process.returncode == 0:
                return {
                    "success": True,
                    "output": stdout_str
                }
            else:
                return {
                    "success": False,
                    "error": stderr_str or "Unknown error",
                    "output": stdout_str
                }

        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "error": "Verification timed out"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }


# Global wrapper instance
msqrob2_wrapper = Msqrob2Wrapper()
