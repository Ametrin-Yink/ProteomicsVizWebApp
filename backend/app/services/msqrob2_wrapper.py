"""
R/msqrob2 integration via subprocess.

Handles protein abundance calculation and differential expression analysis
using R's msqrob2 package through subprocess calls (NEVER rpy2).
"""

import asyncio
import logging
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
    
    async def step6_protein_abundance(
        self,
        input_file: Path,
        output_file: Path,
        gene_mapping_file: Optional[Path] = None
    ) -> Path:
        """
        Step 6: Calculate protein abundance using msqrob2.
        
        Uses R's aggregateFeatures function to aggregate peptide-level
        data to protein level.
        
        Args:
            input_file: Path to PSM_Abundances.tsv
            output_file: Path for Protein_Abundances.tsv output
            gene_mapping_file: Optional protein to gene mapping file
            
        Returns:
            Path to output file
            
        Raises:
            RScriptError: If R script fails
        """
        logger.info(
            "Step 6: Calculating protein abundance with msqrob2",
            extra={"session_id": "unknown", "input": str(input_file)}
        )
        logger.info(f"Step 6: gene_mapping_file parameter = {gene_mapping_file}")
        logger.info(f"Step 6: STARTING wrapper execution")

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
            logger.info(f"Gene mapping file added: {gene_mapping_file}")
        else:
            logger.info(f"Gene mapping file is None or falsy: {gene_mapping_file}")

        # Debug: write to file (with error handling)
        try:
            debug_path = Path(output_file).parent / "wrapper_debug.log"
            debug_path.parent.mkdir(parents=True, exist_ok=True)
            with open(debug_path, "w") as f:
                f.write(f"gene_mapping_file: {gene_mapping_file}\n")
                f.write(f"gene_mapping_file bool: {bool(gene_mapping_file)}\n")
                f.write(f"cmd: {' '.join(cmd)}\n")
            logger.info(f"Debug log written to: {debug_path}")
        except Exception as e:
            logger.error(f"Failed to write debug log: {e}")

        logger.info(f"R command: {' '.join(cmd)}")

        try:
            # Run R script asynchronously using subprocess.run in a thread
            # This is Windows-compatible (asyncio.create_subprocess_exec doesn't work on Windows)
            import subprocess

            def run_r_script():
                return subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    encoding='utf-8',
                    timeout=self.timeout
                )

            process = await asyncio.to_thread(run_r_script)

            # Log R script output for debugging
            stdout_str = process.stdout if process.stdout else ""
            stderr_str = process.stderr if process.stderr else ""
            if stdout_str:
                logger.info(f"R script stdout: {stdout_str[:2000]}")
            if stderr_str:
                logger.info(f"R script stderr: {stderr_str[:2000]}")

            if process.returncode != 0:
                error_msg = stderr_str if stderr_str else "Unknown error (no stderr)"
                logger.error(f"R script failed with return code {process.returncode}: {error_msg}")
                raise RScriptError(
                    message=f"Protein abundance calculation failed: {error_msg}",
                    details={
                        "returncode": process.returncode,
                        "stderr": error_msg[:500],
                        "stdout": stdout_str[:500],
                        "script": str(script_path)
                    }
                )

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
        except Exception as e:
            import traceback
            logger.error(f"Step 6: Exception caught in wrapper: {type(e).__name__}: {e}")
            logger.error(f"Step 6: Traceback: {traceback.format_exc()}")
            raise RScriptError(
                message=f"Protein abundance calculation failed: {str(e)}",
                details={"error": str(e), "traceback": traceback.format_exc()}
            )
    
    async def step7_differential_expression(
        self,
        input_file: Path,
        output_file: Path,
        treatment: str,
        control: str
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
        
        try:
            # Run R script asynchronously using subprocess.run in a thread
            # This is Windows-compatible (asyncio.create_subprocess_exec doesn't work on Windows)
            import subprocess

            def run_r_script():
                return subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    encoding='utf-8',
                    timeout=self.timeout
                )

            process = await asyncio.to_thread(run_r_script)

            # Log R script output for debugging
            stdout_str = process.stdout if process.stdout else ""
            stderr_str = process.stderr if process.stderr else ""
            if stdout_str:
                logger.info(f"R script stdout: {stdout_str[:2000]}")
            if stderr_str:
                logger.info(f"R script stderr: {stderr_str[:2000]}")

            if process.returncode != 0:
                error_msg = stderr_str if stderr_str else "Unknown error"
                raise RScriptError(
                    message=f"Differential expression analysis failed: {error_msg}",
                    details={
                        "returncode": process.returncode,
                        "stderr": error_msg[:500],
                        "script": str(script_path)
                    }
                )

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
        except Exception as e:
            raise RScriptError(
                message=f"Differential expression analysis failed: {str(e)}",
                details={"error": str(e)}
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
            import subprocess

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
