"""Step 2: Resolve shared peptides."""

import asyncio
import logging

from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_resolve_shared_peptides(ctx: StepContext) -> None:
    """Assign shared PSMs to the best-supported candidate protein."""
    if not ctx.config.resolve_shared_peptides:
        ctx.step_outputs[ctx.current_step_number] = ctx.psm_file_path
        logger.info("Shared-peptide resolution disabled; original groups preserved")
        return

    processor = DataProcessor(ProcessingConfig(resolve_shared_peptides=True))
    temp_path = ctx.psm_file_path.with_name(
        f"{ctx.psm_file_path.stem}.step2_temp.parquet"
    )
    await asyncio.to_thread(
        processor.step2_resolve_shared_peptides_duckdb,
        ctx.psm_file_path,
        temp_path,
    )
    temp_path.replace(ctx.psm_file_path)
    ctx.step_outputs[ctx.current_step_number] = ctx.psm_file_path
    logger.info("Resolved shared peptides in %s", ctx.psm_file_path.name)
