"""Step 5: Filter by criteria, save to file, free memory."""

import asyncio
import gc
from app.core.config import settings
from app.services.data_processor import DataProcessor, ProcessingConfig


async def step_filter_criteria_default(ctx) -> None:
    """Filter PSMs, save to Parquet/TSV, free memory for R steps."""
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )
    ctx.df = await asyncio.to_thread(processor.step5_filter_by_criteria, ctx.df)

    # Save to file (matches current orchestrator behavior)
    use_parquet = settings.use_parquet
    if use_parquet:
        psm_path = ctx.results_dir / "PSM_Abundances.parquet"
        await asyncio.to_thread(
            ctx.df.to_parquet,
            psm_path,
            engine="pyarrow",
            compression=settings.parquet_compression,
            index=False,
        )
    else:
        psm_path = ctx.results_dir / "PSM_Abundances.tsv"
        await asyncio.to_thread(
            ctx.df.to_csv, psm_path, sep="\t", index=False, encoding="utf-8"
        )

    ctx.psm_file_path = psm_path
    ctx.step_outputs[5] = psm_path

    # Free memory before R steps
    del ctx.df
    ctx.df = None
    await asyncio.to_thread(gc.collect)
