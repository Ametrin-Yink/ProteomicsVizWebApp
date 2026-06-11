"""Step 2 (msqrob2): Generate unique PSM identifiers, re-save to parquet.

Frees the in-memory DataFrame after saving — msqrob2 step 3+ are R steps that
read from the parquet file, so the DataFrame is no longer needed.
"""

import asyncio
import gc

from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext


async def step_generate_unique_psm_msqrob2(ctx: StepContext) -> None:
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )
    ctx.df = await asyncio.to_thread(processor.step2_generate_unique_psm, ctx.df)

    # Re-save with Unique_PSM column for step 3 (R QFeatures pipeline)
    psm_path = ctx.psm_file_path
    await asyncio.to_thread(
        ctx.df.to_parquet,
        psm_path,
        engine="pyarrow",
        compression="snappy",
        index=False,
    )
    ctx.step_outputs[2] = psm_path

    # Free in-memory DataFrame before R steps (msqrob2 only — step 3+ are R)
    del ctx.df
    ctx.df = None
    await asyncio.to_thread(gc.collect)
