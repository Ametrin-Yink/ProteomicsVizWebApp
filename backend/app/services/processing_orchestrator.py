"""Processing Pipeline Orchestrator.

Coordinates the 9-step data processing pipeline with WebSocket status updates.
Manages state persistence and error recovery.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

import pandas as pd

from app.core.config import settings
from app.core.exceptions import ProcessingError, RScriptError
from app.models.analysis import (
    AnalysisConfig,
    AnalysisResult,
    ProcessingProgress,
    STEP_DISPLAY_NAMES,
    STEP_NAMES,
)
from app.models.data import QCData
from app.models.session import SessionState as SessionStateEnum
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.gsea_service import gsea_service
from app.services.msqrob2_wrapper import msqrob2_wrapper
from app.services.qc_calculator import qc_calculator
from app.services.session_manager import session_manager

logger = logging.getLogger("proteomics")


class PipelineState:
    """Track pipeline execution state."""

    def __init__(self, session_id: str):
        """Initialize pipeline state.

        Args:
            session_id: Session ID
        """
        self.session_id = session_id
        self.state_file = settings.sessions_dir / session_id / "pipeline_state.json"
        self.data = self._load()

    def _load(self) -> dict:
        """Load state from disk."""
        if self.state_file.exists():
            try:
                with open(self.state_file, encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Failed to load pipeline state: {e}")

        return {
            "current_step": 0,
            "completed_steps": [],
            "failed_step": None,
            "error": None,
            "outputs": {},
            "started_at": None,
            "completed_at": None,
            "logs": [],  # Store logs in state
        }

    def save(self) -> None:
        """Save state to disk."""
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.state_file, "w", encoding='utf-8') as f:
            json.dump(self.data, f, indent=2)

    def add_log(self, level: str, message: str, step: int = None) -> None:
        """Add a log entry to state.

        Args:
            level: Log level (info, warning, error)
            message: Log message
            step: Optional step number
        """
        if "logs" not in self.data:
            self.data["logs"] = []
        self.data["logs"].append({
            "level": level,
            "message": message,
            "step": step,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        self.save()

    def get_logs(self) -> list:
        """Get all stored logs."""
        return self.data.get("logs", [])

    def mark_started(self) -> None:
        """Mark pipeline as started."""
        self.data["started_at"] = datetime.now(timezone.utc).isoformat()
        self.save()

    def mark_step_started(self, step: int) -> None:
        """Mark step as started.

        Args:
            step: Step number (1-9)
        """
        self.data["current_step"] = step
        self.save()

    def mark_step_completed(self, step: int, output_path: Optional[Path] = None) -> None:
        """Mark step as completed.

        Args:
            step: Step number (1-9)
            output_path: Optional output file path
        """
        if step not in self.data["completed_steps"]:
            self.data["completed_steps"].append(step)

        if output_path:
            self.data["outputs"][f"step_{step}"] = str(output_path)

        self.save()

    def mark_failed(self, step: int, error: str) -> None:
        """Mark step as failed.

        Args:
            step: Step number (1-9)
            error: Error message
        """
        self.data["failed_step"] = step
        self.data["error"] = error
        self.save()

    def mark_completed(self) -> None:
        """Mark pipeline as completed."""
        self.data["completed_at"] = datetime.now(timezone.utc).isoformat()
        self.save()

    def can_resume(self) -> bool:
        """Check if pipeline can be resumed from a failed step."""
        return (
            self.data["failed_step"] is not None
            and self.data["current_step"] == self.data["failed_step"]
        )

    def get_last_completed_step(self) -> int:
        """Get the last completed step number."""
        if self.data["completed_steps"]:
            return max(self.data["completed_steps"])
        return 0


class ProcessingOrchestrator:
    """Orchestrates the 9-step processing pipeline."""

    def __init__(self):
        """Initialize orchestrator."""
        self.progress_callbacks: list[Callable[[ProcessingProgress], None]] = []
        self._current_session_id: Optional[str] = None
        self._pipeline_state: Optional[PipelineState] = None
        # Batching state for progress updates
        self._pending_progress: Optional[ProcessingProgress] = None
        self._last_send_time: float = 0
        self._min_interval: float = 1.0  # Minimum 1 second between updates
        self._flush_task: Optional[asyncio.Task] = None

    def register_progress_callback(
        self, callback: Callable[[ProcessingProgress], None]
    ) -> None:
        """Register a callback for progress updates.

        Args:
            callback: Function to call with progress updates
        """
        self.progress_callbacks.append(callback)

    async def _send_progress(self, progress: ProcessingProgress) -> None:
        """Send progress update to all registered callbacks with batching.

        Args:
            progress: Progress update
        """
        # Store as pending
        self._pending_progress = progress

        # Check if we should send now
        current_time = asyncio.get_event_loop().time()
        time_since_last = current_time - self._last_send_time

        if time_since_last >= self._min_interval:
            # Send immediately
            if self._flush_task:
                self._flush_task.cancel()
                self._flush_task = None
            await self._flush_progress()
        else:
            # Schedule flush after remaining interval
            delay = self._min_interval - time_since_last
            if self._flush_task:
                self._flush_task.cancel()
            self._flush_task = asyncio.create_task(self._delayed_flush(delay))

    async def _delayed_flush(self, delay: float) -> None:
        """Flush progress after delay, unless superseded."""
        try:
            await asyncio.sleep(delay)
            await self._flush_progress()
        except asyncio.CancelledError:
            pass

    async def _flush_progress(self) -> None:
        """Send pending progress update to all registered callbacks."""
        if self._pending_progress is None:
            return

        progress = self._pending_progress
        self._pending_progress = None
        self._last_send_time = asyncio.get_event_loop().time()

        logger.info(f"_send_progress: step {progress.step}, status {progress.status}, callbacks={len(self.progress_callbacks)}")

        # Also send as log message for activity log
        self._send_log(
            level="info",
            message=f"Step {progress.step}: {progress.step_name} - {progress.status}",
            step=progress.step
        )

        for callback in self.progress_callbacks:
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback(progress)
                else:
                    callback(progress)
                logger.info(f"_send_progress: callback succeeded for step {progress.step}")
            except Exception as e:
                logger.warning(f"Progress callback failed: {e}", exc_info=True)

    def _send_log(self, level: str, message: str, step: int = None) -> None:
        """Send log message to WebSocket and store in state.

        This method is designed to be called from synchronous code (like R script callbacks).
        It schedules the async WebSocket sending using asyncio.create_task().

        Args:
            level: Log level (info, warning, error)
            message: Log message
            step: Optional step number
        """
        try:
            # Store log in pipeline state using the existing instance
            if not self._current_session_id:
                logger.warning(f"_send_log: No current session ID, cannot save log: {message}")
                return

            if self._pipeline_state:
                logger.debug(f"_send_log: Saving log to session {self._current_session_id}: {message[:50]}...")
                self._pipeline_state.add_log(level, message, step)
            else:
                logger.warning(f"_send_log: No pipeline state, cannot save log: {message}")

            # Schedule async WebSocket sending
            if hasattr(session_manager, 'send_log_message'):
                try:
                    # Get the current event loop and schedule the async task
                    loop = asyncio.get_event_loop()
                    loop.create_task(
                        session_manager.send_log_message(
                            session_id=self._current_session_id,
                            level=level,
                            message=message,
                            step=step
                        )
                    )
                except RuntimeError as e:
                    logger.debug(f"_send_log: No event loop running, can't send WebSocket: {e}")
        except Exception as e:
            logger.error(f"_send_log: Failed to send log message: {e}", exc_info=True)

    def _create_progress(
        self,
        step: int,
        status: str,
        progress_pct: int,
        message: Optional[str] = None,
    ) -> ProcessingProgress:
        """Create a progress update.

        Args:
            step: Step number (1-9)
            status: Status (started, in_progress, completed, failed)
            progress_pct: Progress percentage (0-100)
            message: Optional message

        Returns:
            ProcessingProgress object
        """
        # Validate step to prevent errors
        if step < 1:
            logger.error(f"Invalid step number: {step}. Must be >= 1")
            step = 1
        if step > 9:
            step = 9
            
        overall_progress = int(((step - 1) * 100 + progress_pct) / 9)
        
        # Ensure overall_progress is within valid range
        overall_progress = max(0, min(100, overall_progress))
        
        logger.debug(f"Creating progress: step={step}, status={status}, progress={progress_pct}, overall={overall_progress}")

        return ProcessingProgress(
            step=step,
            step_name=STEP_DISPLAY_NAMES.get(step, f"Step {step}"),
            status=status,
            progress=progress_pct,
            message=message,
            overall_progress=overall_progress,
        )

    async def process_session(
        self,
        session_id: str,
        config: AnalysisConfig,
        websocket_callback: Optional[Callable[[ProcessingProgress], None]] = None,
    ) -> AnalysisResult:
        """Process a session through all 9 steps.

        Args:
            session_id: Session ID
            config: Analysis configuration
            websocket_callback: Optional WebSocket callback for progress updates

        Returns:
            AnalysisResult with all outputs

        Raises:
            ProcessingError: If processing fails
        """
        import traceback

        logger.info(
            f"=== ENTERING process_session for session {session_id} ===",
            extra={"session_id": session_id, "config": config.model_dump()},
        )

        # Store session_id and pipeline state for log messages
        self._current_session_id = session_id

        # Register WebSocket callback
        if websocket_callback:
            self.register_progress_callback(websocket_callback)
            logger.info(f"WebSocket callback registered for session {session_id}")

        # Initialize state - MUST be done before setting _pipeline_state
        state = PipelineState(session_id)
        self._pipeline_state = state
        logger.info(f"PipelineState initialized: current_step={state.data['current_step']}, completed={state.data['completed_steps']}")

        try:
            state.mark_started()
            logger.info(f"Pipeline marked as started for session {session_id}")

            # Get session directories
            uploads_dir = await session_manager.get_uploads_dir(session_id)
            results_dir = await session_manager.get_results_dir(session_id)

            # Initialize result
            result = AnalysisResult(session_id=session_id)

            # Update session state
            await session_manager.update_session_state(
                session_id, SessionStateEnum.PROCESSING
            )

            # Get proteomics files
            session = await session_manager.get_session(session_id)
            if not session.files or not session.files.proteomics:
                raise ProcessingError(
                    message="No proteomics files found",
                    step=1,
                    recoverable=False,
                )

            file_paths = [
                uploads_dir / f.filename for f in session.files.proteomics
            ]

            # Step 1-5: Data Processing (Python) - Individual steps with progress updates
            psm_output = results_dir / "PSM_Abundances.tsv"

            processing_config = ProcessingConfig(
                remove_razor=config.remove_razor,
                strict_filtering=config.strict_filtering,
            )
            processor = DataProcessor(processing_config)

            # Step 1: Combine Replicates
            await self._send_progress(
                self._create_progress(1, "started", 0, "Combining replicates...")
            )
            
            psm_df = processor.step1_combine_replicates(file_paths)
            
            state.mark_step_completed(1, psm_output)
            result.psm_abundances_path = str(psm_output)
            result.total_psms = len(psm_df)

            await self._send_progress(
                self._create_progress(
                    1, "completed", 100, f"Combined {len(psm_df)} PSMs"
                )
            )

            # Step 2: Generate Unique PSM
            await self._send_progress(
                self._create_progress(2, "started", 0, "Generating unique PSM identifiers...")
            )
            
            psm_df = processor.step2_generate_unique_psm(psm_df)
            
            state.mark_step_completed(2)

            await self._send_progress(
                self._create_progress(
                    2, "completed", 100, f"Generated {len(psm_df)} unique PSMs"
                )
            )

            # Step 3: Remove Razor (optional)
            await self._send_progress(
                self._create_progress(3, "started", 0, "Removing razor peptides..." if config.remove_razor else "Skipping razor removal...")
            )
            
            psm_df = processor.step3_remove_razor(psm_df)
            
            state.mark_step_completed(3)

            await self._send_progress(
                self._create_progress(
                    3, "completed", 100, f"Razor removal {'complete' if config.remove_razor else 'skipped'}, {len(psm_df)} PSMs remaining"
                )
            )

            # Step 4: Remove Low Quality
            logger.info(f"Step 4: Starting with DataFrame shape: {psm_df.shape}, columns: {list(psm_df.columns)}")
            logger.info(f"Step 4: Sample Abundance values (first 5): {psm_df['Abundance'].head().tolist()}")
            logger.info(f"Step 4: Sample Quan_Info values (unique): {psm_df['Quan_Info'].unique()[:10]}")

            await self._send_progress(
                self._create_progress(4, "started", 0, "Removing low quality PSMs...")
            )

            psm_df = processor.step4_remove_low_quality(psm_df)

            logger.info(f"Step 4: Completed with DataFrame shape: {psm_df.shape}")
            if len(psm_df) == 0:
                logger.error("Step 4: DataFrame is EMPTY after filtering!")

            state.mark_step_completed(4)

            await self._send_progress(
                self._create_progress(
                    4, "completed", 100, f"Quality filtering complete, {len(psm_df)} PSMs remaining"
                )
            )

            # Step 5: Filter by Criteria
            logger.info(f"Step 5: Starting with DataFrame shape: {psm_df.shape}, columns: {list(psm_df.columns)}")

            await self._send_progress(
                self._create_progress(5, "started", 0, f"Applying {'strict' if config.strict_filtering else 'lenient'} filtering criteria...")
            )
            
            psm_df = processor.step5_filter_by_criteria(psm_df)

            # Save output after Step 5
            # Determine file format based on config (Parquet for speed, TSV for compatibility)
            use_parquet = settings.use_parquet
            if use_parquet:
                psm_output_parquet = results_dir / "PSM_Abundances.parquet"
                psm_input_for_r = psm_output_parquet
                psm_df.to_parquet(
                    psm_output_parquet,
                    engine='pyarrow',
                    compression=settings.parquet_compression,
                    index=False
                )
                logger.info(f"Step 5: Saved Parquet file at {psm_output_parquet}, size: {psm_output_parquet.stat().st_size} bytes")
            else:
                psm_input_for_r = psm_output
                psm_df.to_csv(psm_output, sep='\t', index=False, encoding='utf-8')
                logger.info(f"Step 5: Saved TSV file at {psm_output}, size: {psm_output.stat().st_size} bytes")

            # Save TSV only when Parquet is not being used (compatibility fallback)
            if not use_parquet:
                psm_df.to_csv(psm_output, sep='\t', index=False, encoding='utf-8')
                if not psm_output.exists():
                    logger.error(f"Step 5: CRITICAL - File does not exist after save attempt: {psm_output}")
                    raise ProcessingError(
                        message=f"Failed to save PSM_Abundances.tsv to {psm_output}",
                        step=5,
                        recoverable=False
                    )

            state.mark_step_completed(5, psm_output)

            await self._send_progress(
                self._create_progress(
                    5, "completed", 100, f"Filtering complete, {len(psm_df)} PSMs remaining"
                )
            )

            # Step 6: Protein Abundance (R)
            protein_output = results_dir / "Protein_Abundances.tsv"

            logger.info(f"Step 6: About to run protein abundance. Input file exists: {psm_input_for_r.exists()}, path: {psm_input_for_r}")
            if psm_input_for_r.exists():
                logger.info(f"Step 6: Input file size: {psm_input_for_r.stat().st_size} bytes")
                # Log first few lines of input file for debugging
                try:
                    with open(psm_output, 'r') as f:
                        header = f.readline().strip()
                        first_data = f.readline().strip()
                        logger.info(f"Step 6: Input file header: {header[:200]}...")
                        logger.info(f"Step 6: First data row: {first_data[:200]}...")
                except Exception as e:
                    logger.warning(f"Step 6: Could not read input file preview: {e}")

            await self._send_progress(
                self._create_progress(
                    6, "started", 0, "Calculating protein abundance with msqrob2..."
                )
            )

            try:
                # Determine gene mapping file based on organism
                organism = getattr(config, 'organism', 'human').lower()
                gene_mapping_file = None
                if organism == 'human':
                    gene_mapping_file = settings.protein_database_dir / "Human_GeneName.tsv"
                elif organism == 'mouse':
                    gene_mapping_file = settings.protein_database_dir / "Mouse_GeneName.tsv"

                # Debug logging to file
                try:
                    debug_log_path = results_dir / "step6_debug.log"
                    with open(debug_log_path, "w") as f:
                        f.write(f"Organism: {organism}\n")
                        f.write(f"Protein database dir: {settings.protein_database_dir}\n")
                        f.write(f"Gene mapping file path: {gene_mapping_file}\n")
                        f.write(f"File exists: {gene_mapping_file.exists() if gene_mapping_file else 'N/A'}\n")
                        f.write(f"Config organism: {getattr(config, 'organism', 'NOT_FOUND')}\n")
                except Exception as e:
                    logger.error(f"Failed to write debug log: {e}")

                if gene_mapping_file and gene_mapping_file.exists():
                    logger.info(f"Step 6: Using gene mapping file: {gene_mapping_file}")
                else:
                    logger.warning(f"Step 6: No gene mapping file found for organism: {organism}")
                    gene_mapping_file = None

                await msqrob2_wrapper.step6_protein_abundance(
                    input_file=psm_input_for_r,
                    output_file=protein_output,
                    gene_mapping_file=gene_mapping_file,
                    log_callback=lambda level, msg: self._send_log(level, msg, step=6)
                )
                logger.info(f"Step 6: msqrob2_wrapper completed successfully")
            except Exception as e:
                logger.error(f"Step 6: msqrob2_wrapper failed with error: {type(e).__name__}: {e}")
                raise

            state.mark_step_completed(6, protein_output)
            result.protein_abundances_path = str(protein_output)

            # Count proteins
            protein_df = await asyncio.to_thread(pd.read_csv, protein_output, sep="\t")
            result.total_proteins = len(protein_df)

            await self._send_progress(
                self._create_progress(
                    6, "completed", 100, f"Calculated {len(protein_df)} protein abundances"
                )
            )

            # Step 7: Differential Expression (R)
            de_output = results_dir / "Diff_Expression.tsv"

            await self._send_progress(
                self._create_progress(
                    7, "started", 0, "Running differential expression analysis..."
                )
            )

            await msqrob2_wrapper.step7_differential_expression(
                input_file=protein_output,
                output_file=de_output,
                treatment=config.treatment,
                control=config.control,
                log_callback=lambda level, msg: self._send_log(level, msg, step=7)
            )

            state.mark_step_completed(7, de_output)
            result.diff_expression_path = str(de_output)

            # Count significant proteins
            de_df = await asyncio.to_thread(pd.read_csv, de_output, sep="\t")
            significant = de_df[de_df["adjPval"] < config.pvalue_threshold]
            result.significant_proteins = len(significant)

            await self._send_progress(
                self._create_progress(
                    7,
                    "completed",
                    100,
                    f"Found {len(significant)} significant proteins",
                )
            )

            # Step 8: QC Metrics (Python) - use Parquet if available for faster I/O
            qc_output = results_dir / "QC_Results.json"

            await self._send_progress(
                self._create_progress(8, "started", 0, "Calculating QC metrics...")
            )

            psm_qc_path = psm_input_for_r  # Use Parquet if available
            qc_data = await qc_calculator.calculate_all_metrics(
                protein_abundances_path=protein_output,
                diff_expression_path=de_output,
                psm_abundances_path=psm_qc_path,
            )

            qc_calculator.save_qc_data(qc_output)

            state.mark_step_completed(8, qc_output)
            result.qc_results_path = str(qc_output)

            await self._send_progress(
                self._create_progress(8, "completed", 100, "QC metrics calculated")
            )

            # Step 9: GSEA Analysis (Python)
            gsea_output = results_dir / "GSEA_Results.json"

            await self._send_progress(
                self._create_progress(9, "started", 0, "Running GSEA analysis...")
            )

            gsea_results = await gsea_service.run_gsea_analysis(
                diff_expression_path=de_output,
                output_dir=results_dir / "gsea",
                protein_abundance_path=protein_output if protein_output.exists() else None
            )

            gsea_service.save_results(gsea_output)

            state.mark_step_completed(9, gsea_output)
            result.gsea_results_path = str(gsea_output)

            total_pathways = sum(
                r.significant_pathways for r in gsea_results.values()
            )
            await self._send_progress(
                self._create_progress(
                    9, "completed", 100, f"Found {total_pathways} significant pathways"
                )
            )

            # Mark pipeline as completed
            state.mark_completed()
            await session_manager.update_session_state(
                session_id, SessionStateEnum.COMPLETED
            )

            # Calculate processing time
            if state.data["started_at"]:
                start_time = datetime.fromisoformat(state.data["started_at"])
                result.processing_time_seconds = (
                    datetime.now(timezone.utc) - start_time
                ).total_seconds()

            result.steps_completed = state.data["completed_steps"]

            logger.info(
                f"Processing pipeline completed for session {session_id}",
                extra={
                    "session_id": session_id,
                    "total_psms": result.total_psms,
                    "total_proteins": result.total_proteins,
                    "significant_proteins": result.significant_proteins,
                },
            )

            # Clear session_id before returning
            self._current_session_id = None
            self._pipeline_state = None
            return result

        except Exception as e:
            # Clear session_id on error
            self._current_session_id = None
            self._pipeline_state = None

            # Mark step as failed
            current_step = state.data["current_step"]
            error_msg = str(e)
            error_trace = traceback.format_exc()

            logger.error(
                f"Processing failed at step {current_step}: {error_msg}",
                extra={
                    "session_id": session_id,
                    "step": current_step,
                    "error": error_msg,
                    "traceback": error_trace,
                }
            )

            state.mark_failed(current_step, error_msg)

            # Update session state
            await session_manager.update_session_state(
                session_id, SessionStateEnum.ERROR, error_msg
            )

            # Send failure progress
            await self._send_progress(
                self._create_progress(
                    current_step, "failed", 0, f"Processing failed: {error_msg}"
                )
            )

            # Raise processing error
            if isinstance(e, ProcessingError):
                raise
            else:
                raise ProcessingError(
                    message=f"Processing failed: {error_msg}",
                    step=current_step,
                    recoverable=True,
                    details={"error": error_msg, "traceback": error_trace},
                )

    async def resume_processing(
        self,
        session_id: str,
        config: AnalysisConfig,
        websocket_callback: Optional[Callable[[ProcessingProgress], None]] = None,
    ) -> AnalysisResult:
        """Resume processing from last failed step.

        Args:
            session_id: Session ID
            config: Analysis configuration
            websocket_callback: Optional WebSocket callback

        Returns:
            AnalysisResult
        """
        state = PipelineState(session_id)

        if not state.can_resume():
            raise ProcessingError(
                message="Cannot resume: no failed step to resume from",
                step=0,
                recoverable=False,
            )

        failed_step = state.data["failed_step"]
        logger.info(
            f"Resuming processing from step {failed_step}",
            extra={"session_id": session_id, "step": failed_step},
        )

        # Clear failed state
        state.data["failed_step"] = None
        state.data["error"] = None
        state.save()

        # Re-run processing (will skip completed steps if implemented)
        return await self.process_session(session_id, config, websocket_callback)


# Global orchestrator instance
processing_orchestrator = ProcessingOrchestrator()
