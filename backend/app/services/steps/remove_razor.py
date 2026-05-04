"""Step 3: Remove razor peptides."""

import asyncio
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext


async def step_remove_razor(ctx: StepContext) -> None:
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )
    ctx.df = await asyncio.to_thread(processor.step3_remove_razor, ctx.df)
