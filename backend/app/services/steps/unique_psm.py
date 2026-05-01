"""Step 2: Generate unique PSM identifiers."""
import asyncio
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext


async def step_generate_unique_psm(ctx: StepContext) -> None:
    processor = DataProcessor(ProcessingConfig(
        remove_razor=ctx.config.remove_razor,
        strict_filtering=ctx.config.strict_filtering,
    ))
    ctx.df = await asyncio.to_thread(processor.step2_generate_unique_psm, ctx.df)
