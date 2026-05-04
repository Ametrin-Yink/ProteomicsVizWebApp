"""Step 4: Remove low quality PSMs."""

import asyncio
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext


async def step_remove_low_quality_default(ctx: StepContext) -> None:
    """Default: remove contaminants, No Value, Abundance < 1."""
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )
    ctx.df = await asyncio.to_thread(processor.step4_remove_low_quality, ctx.df)
