"""Step 5: Filter by criteria, save to file, free memory."""

import asyncio

import logging

from app.core.config import settings
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_filter_criteria_default(ctx: StepContext) -> None:
    """Filter PSMs by criteria via DuckDB SQL CTE (Spec Section 5.3).

    Reads parquet at ctx.psm_file_path, applies missing-value threshold
    filtering via CTE chain, writes PSM_Abundances.parquet.
    ctx.df is None (no in-memory DataFrame to free).
    """
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )

    psm_path = ctx.results_dir / "PSM_Abundances.parquet"

    await asyncio.to_thread(
        processor.step5_filter_by_criteria_duckdb,
        ctx.psm_file_path,
        psm_path,
    )

    ctx.psm_file_path = psm_path
    ctx.step_outputs[ctx.current_step_number] = psm_path
    logger.info("Step 5 (DuckDB): Wrote %s", psm_path.name)
