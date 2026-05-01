"""Step 1: Combine replicates."""
import asyncio
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext


async def step_combine_replicates(ctx: StepContext) -> None:
    processor = DataProcessor(ProcessingConfig(
        remove_razor=ctx.config.remove_razor,
        strict_filtering=ctx.config.strict_filtering,
    ))
    ctx.df = await asyncio.to_thread(processor.step1_combine_replicates, ctx.file_paths)
    ctx.result.total_psms = len(ctx.df)
