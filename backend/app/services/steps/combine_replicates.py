"""Step 1: Combine replicates — concatenate PSM CSV files, save to parquet."""

import asyncio
from app.core.config import settings
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext


async def step_combine_replicates(ctx: StepContext) -> None:
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )
    ctx.df = await asyncio.to_thread(processor.step1_combine_replicates, ctx.file_paths)
    ctx.result.total_psms = len(ctx.df)

    # Save combined PSM file for downstream steps
    psm_path = ctx.results_dir / "PSM_Combined.parquet"
    await asyncio.to_thread(
        ctx.df.to_parquet,
        psm_path,
        engine="pyarrow",
        compression=settings.parquet_compression,
        index=False,
    )
    ctx.psm_file_path = psm_path
    ctx.step_outputs[1] = psm_path
