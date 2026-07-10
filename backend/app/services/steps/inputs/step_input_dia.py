"""Step 1 (DIA): Read N DIA files, apply per-file metadata, save parquet.

See docs/specs/pipeline-reform-tmt-dia.md Section 8.3 for full spec.

When DuckDB streaming is enabled and available, delegates to
DataProcessor.step1_2_duckdb_dia() for a single-pass streaming
pipeline that handles Steps 1-2 (read + metadata + Unique_PSM).

After DuckDB streaming, the parquet is loaded back into ctx.df so
downstream shared steps (remove_razor, filter_criteria) can operate.
"""

import asyncio
import logging

import pyarrow.parquet as pq

from app.core.config import settings
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_input_dia(ctx: StepContext) -> None:
    """DIA input handler: read N files, apply metadata, save parquet.

    Delegates processing to DataProcessor.step1_combine_replicates_dia(),
    then saves the result as parquet and updates ctx fields.

    When DuckDB streaming is enabled and available, delegates to
    DataProcessor.step1_2_duckdb_dia() for a single-pass streaming
    pipeline that handles Steps 1-2 (read + metadata + Unique_PSM).
    """
    if not ctx.file_paths:
        raise ValueError("No file paths provided for DIA input")

    if not ctx.config.metadata:
        raise ValueError("metadata is required for DIA input")

    psm_path = ctx.results_dir / "PSM_Combined.parquet"

    use_duckdb = settings.use_duckdb_streaming
    if use_duckdb:
        try:
            import duckdb  # noqa: F401
        except ImportError:
            logger.info("DuckDB not installed, falling back to pandas")
            use_duckdb = False

    if use_duckdb:
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
        # Count rows from parquet metadata (cheap, no load)
        ctx.result.total_psms = pq.ParquetFile(psm_path).metadata.num_rows
        logger.info("DIA input complete (DuckDB): %d rows", ctx.result.total_psms)
        return

    # Pandas fallback path (unchanged)
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )

    result = await asyncio.to_thread(
        processor.step1_combine_replicates_dia,
        ctx.file_paths,
        ctx.config.metadata,
    )

    await asyncio.to_thread(
        result.to_parquet,
        psm_path,
        engine="pyarrow",
        compression=settings.parquet_compression,
        index=False,
    )

    ctx.df = result
    ctx.psm_file_path = psm_path
    ctx.result.total_psms = len(result)
    ctx.step_outputs[ctx.current_step_number or 1] = psm_path

    logger.info(
        "DIA input complete (pandas): %d rows, %d conditions",
        len(result),
        result["Condition"].nunique(),
    )
