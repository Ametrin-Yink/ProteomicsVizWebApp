"""Step 2: Generate unique PSM identifiers (shared, both pipelines).

Unified handler that merges unique_psm_msqrob2 and unique_psm_msstats.
Adds Unique_PSM column, re-saves parquet. Does NOT free ctx.df
(memory management is handled by the pipeline engine).
"""

import asyncio

from app.core.config import settings
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext


async def step_unique_psm(ctx: StepContext) -> None:
    """Generate Unique_PSM and re-save parquet.

    Calls DataProcessor.step2_generate_unique_psm() to add Unique_PSM column.
    Re-saves at ctx.psm_file_path. Does NOT free ctx.df.
    Uses ctx.current_step_number for step_outputs.
    """
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )
    ctx.df = await asyncio.to_thread(processor.step2_generate_unique_psm, ctx.df)

    # Re-save with Unique_PSM column
    psm_path = ctx.psm_file_path
    await asyncio.to_thread(
        ctx.df.to_parquet,
        psm_path,
        engine="pyarrow",
        compression=settings.parquet_compression,
        index=False,
    )
    ctx.step_outputs[ctx.current_step_number or 2] = psm_path
