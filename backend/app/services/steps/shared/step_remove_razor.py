"""Step 3: Remove razor peptides."""

import asyncio
import logging

from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_remove_razor(ctx: StepContext) -> None:
    """Remove razor peptides via DuckDB SQL (Spec Section 5.2).

    Reads parquet at ctx.psm_file_path, applies two-phase protein
    selection (DuckDB maps → Python _select_best_protein →
    DuckDB apply + COPY), replaces the file atomically.
    """
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )

    temp_path = ctx.psm_file_path.with_name(
        f"{ctx.psm_file_path.stem}.step3_temp.parquet"
    )
    await asyncio.to_thread(
        processor.step3_remove_razor_duckdb,
        ctx.psm_file_path,
        temp_path,
    )
    temp_path.replace(ctx.psm_file_path)
    ctx.step_outputs[ctx.current_step_number] = ctx.psm_file_path
    logger.info("Step 3 (DuckDB): Replaced %s", ctx.psm_file_path.name)
