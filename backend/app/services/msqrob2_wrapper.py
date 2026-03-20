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
        
        try:
            # Run R script asynchronously
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=self.timeout
            )
            
            if process.returncode != 0:
                error_msg = stderr.decode() if stderr else "Unknown error"
                raise RScriptError(
                    message=f"Protein abundance calculation failed: {error_msg}",
                    details={
                        "returncode": process.returncode,
                        "stderr": error_msg[:500],
                        "script": str(script_path)
                    }
                )
            
            logger.info(
                "Step 6 complete: Protein abundance calculated",
                extra={"output": str(output_file)}
            )
            
            return output_file
            
        except asyncio.TimeoutError:
            raise RScriptError(
                message=f"Protein abundance calculation timed out after {self.timeout}s",
                details={"timeout": self.timeout}
            )
        except Exception as e:
            raise RScriptError(
                message=f"Protein abundance calculation failed: {str(e)}",
                details={"error": str(e)}
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
            # Run R script asynchronously
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=self.timeout
            )
            
            if process.returncode != 0:
                error_msg = stderr.decode() if stderr else "Unknown error"
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
            
        except asyncio.TimeoutError:
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
            process = await asyncio.create_subprocess_exec(
                self.r_executable,
                str(script_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=60
            )
            
            stdout_str = stdout.decode() if stdout else ""
            stderr_str = stderr.decode() if stderr else ""
            
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
                
        except asyncio.TimeoutError:
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
