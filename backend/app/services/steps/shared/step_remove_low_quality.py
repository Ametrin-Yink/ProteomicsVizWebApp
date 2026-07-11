"""Step 4: Remove low quality PSMs."""

import asyncio
import logging

from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_remove_low_quality_default(ctx: StepContext) -> None:
    """Remove low quality PSMs via DuckDB SQL (Spec Section 5.1).

    Reads parquet at ctx.psm_file_path, applies contaminant/Quan_Info/
    Abundance filters via single DuckDB COPY query, replaces the file
    atomically. Handles optional Quan_Info column for DIA files.
    """
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )

    temp_path = ctx.psm_file_path.with_name(
        f"{ctx.psm_file_path.stem}.step4_temp.parquet"
    )
    await asyncio.to_thread(
        processor.step4_remove_low_quality_duckdb,
        ctx.psm_file_path,
        temp_path,
    )
    temp_path.replace(ctx.psm_file_path)
    ctx.step_outputs[ctx.current_step_number] = ctx.psm_file_path
    logger.info("Step 4 (DuckDB): Replaced %s", ctx.psm_file_path.name)
