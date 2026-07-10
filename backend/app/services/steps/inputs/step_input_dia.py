"""Step 1 (DIA): DuckDB streaming CSV -> Parquet for Steps 1-2.

Reads N DIA files, joins with per-file metadata on filename basename,
renames Quan_Value → Abundance, generates Unique_PSM, applies
low-quality filters — all in a single streaming DuckDB COPY query.

After streaming: ctx.df = None (Steps 3-5 use DuckDB SQL).
"""

import asyncio
import logging

import pyarrow.parquet as pq

from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_input_dia(ctx: StepContext) -> None:
    """DIA input: read N files, apply metadata, save PSM_Combined.parquet.

    Delegates to DataProcessor.step1_2_duckdb_dia() for a single-pass
    streaming pipeline handling Steps 1-2 (read + metadata join +
    Unique_PSM + low-quality filters).
    """
    if not ctx.file_paths:
        raise ValueError("No file paths provided for DIA input")

    if not ctx.config.metadata:
        raise ValueError("metadata is required for DIA input")

    psm_path = ctx.results_dir / "PSM_Combined.parquet"

    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )
    await asyncio.to_thread(
        processor.step1_2_duckdb_dia,
        ctx.file_paths,
        ctx.config.metadata,
        psm_path,
    )
    ctx.df = None  # Signal: DuckDB handled Steps 1-2
    ctx.psm_file_path = psm_path
    ctx.step_outputs[ctx.current_step_number or 1] = psm_path
    ctx.step_outputs[2] = psm_path  # Step 2 also done
    ctx.result.total_psms = pq.ParquetFile(psm_path).metadata.num_rows
    logger.info("DIA input complete (DuckDB): %d rows", ctx.result.total_psms)
