"""Step 4: Remove low quality PSMs."""

import asyncio
import logging

from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_remove_low_quality_default(ctx: StepContext) -> None:
    """Default: remove contaminants, No Value, Abundance < 1.

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
            f"{ctx.psm_file_path.stem}.step4_temp.parquet"
        )
        await asyncio.to_thread(
            processor.step4_remove_low_quality_chunked,
            ctx.psm_file_path,
            temp_path,
        )
        temp_path.replace(ctx.psm_file_path)
        ctx.step_outputs[ctx.current_step_number] = ctx.psm_file_path
        logger.info("Step 4 (chunked): Replaced %s", ctx.psm_file_path.name)
    else:
        # Existing in-memory pandas path
        ctx.df = await asyncio.to_thread(
            processor.step4_remove_low_quality, ctx.df
        )
