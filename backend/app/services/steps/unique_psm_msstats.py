"""Step 2 (MSstats): Generate unique PSM identifiers, re-save to parquet.

Keeps the DataFrame in memory — MSstats step 3+ are still Python steps that
need ctx.df, so we do NOT free it.
"""

import asyncio

from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext


async def step_generate_unique_psm_msstats(ctx: StepContext) -> None:
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )
    ctx.df = await asyncio.to_thread(processor.step2_generate_unique_psm, ctx.df)

    # Re-save with Unique_PSM column for downstream Python steps (3-5)
    psm_path = ctx.psm_file_path
    await asyncio.to_thread(
        ctx.df.to_parquet,
        psm_path,
        engine="pyarrow",
        compression="snappy",
        index=False,
    )
    ctx.step_outputs[2] = psm_path
