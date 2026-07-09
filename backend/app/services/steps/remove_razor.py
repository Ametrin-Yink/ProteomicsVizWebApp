"""Step 3: Remove razor peptides."""

import asyncio
import logging

from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_remove_razor(ctx: StepContext) -> None:
    """Remove razor peptides.

    When ctx.df is None (DuckDB mode), reads the parquet file at
    ctx.psm_file_path in chunks, processes, and replaces the file.
    Otherwise uses the existing in-memory ctx.df path.
    """
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )

    if ctx.df is None:
        # DuckDB mode: use chunked Parquet I/O
        temp_path = ctx.psm_file_path.with_name(
            f"{ctx.psm_file_path.stem}.step3_temp.parquet"
        )
        await asyncio.to_thread(
            processor.step3_remove_razor_chunked,
            ctx.psm_file_path,
            temp_path,
        )
        temp_path.replace(ctx.psm_file_path)
        ctx.step_outputs[ctx.current_step_number] = ctx.psm_file_path
        logger.info("Step 3 (chunked): Replaced %s", ctx.psm_file_path.name)
    else:
        # Existing in-memory pandas path
        ctx.df = await asyncio.to_thread(processor.step3_remove_razor, ctx.df)
