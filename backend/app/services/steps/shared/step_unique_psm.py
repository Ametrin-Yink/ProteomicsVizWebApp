"""Step 2: Generate unique PSM identifiers (shared, both pipelines).

Unified handler that merges unique_psm_msqrob2 and unique_psm_msstats.
Adds Unique_PSM column, re-saves parquet. Does NOT free ctx.df
(memory management is handled by the pipeline engine).

When DuckDB streaming has already performed Steps 1-2, this handler
loads the pre-computed parquet into ctx.df and skips the redundant
Unique_PSM generation (the column already exists).
"""

import asyncio
import logging

import pandas as pd

from app.core.config import settings
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_unique_psm(ctx: StepContext) -> None:
    """Generate Unique_PSM and re-save parquet.

    Calls DataProcessor.step2_generate_unique_psm() to add Unique_PSM column.
    Re-saves at ctx.psm_file_path. Does NOT free ctx.df.
    Uses ctx.current_step_number for step_outputs.

    If ctx.df is None and ctx.psm_file_path exists, DuckDB streaming
    already handled Steps 1-2. Load the parquet into ctx.df so
    downstream shared steps can operate.
    """
    current_step = ctx.current_step_number or 2
    if ctx.df is None and ctx.psm_file_path and ctx.psm_file_path.exists():
        logger.info(
            "Step %d: DuckDB already handled Steps 1-2, loading parquet for downstream",
            current_step,
        )
        ctx.df = await asyncio.to_thread(
            pd.read_parquet, ctx.psm_file_path, engine="pyarrow",
        )
        ctx.step_outputs[current_step] = ctx.psm_file_path
        return

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
    ctx.step_outputs[current_step] = psm_path
