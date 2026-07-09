"""Step 5: Filter by criteria, save to file, free memory."""

import asyncio
import gc
import logging

from app.core.config import settings
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_filter_criteria_default(ctx: StepContext) -> None:
    """Filter PSMs, save to Parquet file, free memory for R steps.

    When ctx.df is None (DuckDB mode), reads the parquet file at
    ctx.psm_file_path in chunks, filters, and writes directly to
    PSM_Abundances.parquet. Otherwise uses the existing in-memory
    ctx.df path and saves as before.
    """
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )

    psm_path = ctx.results_dir / "PSM_Abundances.parquet"

    if ctx.df is None:
        # DuckDB mode: use chunked Parquet I/O
        await asyncio.to_thread(
            processor.step5_filter_by_criteria_chunked,
            ctx.psm_file_path,
            psm_path,
        )
        ctx.psm_file_path = psm_path
        ctx.step_outputs[ctx.current_step_number] = psm_path
        # ctx.df is already None — no memory to free
        logger.info("Step 5 (chunked): Wrote %s", psm_path.name)
    else:
        # Existing in-memory pandas path
        ctx.df = await asyncio.to_thread(
            processor.step5_filter_by_criteria, ctx.df
        )

        # Save to Parquet
        await asyncio.to_thread(
            ctx.df.to_parquet,
            psm_path,
            engine="pyarrow",
            compression=settings.parquet_compression,
            index=False,
        )

        ctx.psm_file_path = psm_path
        ctx.step_outputs[ctx.current_step_number] = psm_path

        # Free memory before R steps
        del ctx.df
        ctx.df = None
        await asyncio.to_thread(gc.collect)
