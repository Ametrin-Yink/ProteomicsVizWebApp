"""Step 1 (TMT): Read TMT file(s), melt channels, map to conditions, save parquet.

When DuckDB streaming is enabled and available, delegates to
DataProcessor.step1_2_duckdb_tmt() for a single-pass streaming
pipeline that handles Steps 1-2 + low-quality filters.

After DuckDB streaming, ctx.df is set to None so downstream
shared steps (remove_razor, filter_criteria) use chunked Parquet I/O.
"""

import asyncio
import logging

import pandas as pd
import pyarrow.parquet as pq

from app.core.config import settings
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_input_tmt(ctx: StepContext) -> None:
    """TMT input handler: melt channel-level data, map to conditions, save parquet.

    When DuckDB streaming is enabled and available, delegates to
    DataProcessor.step1_2_duckdb_tmt() which handles Steps 1-2
    (read + metadata + Unique_PSM + low-quality filters) in a
    single streaming query.
    """
    if not ctx.file_paths:
        raise ValueError("No file paths provided for TMT input")

    if not ctx.config.tmt_channel_mapping:
        raise ValueError("tmt_channel_mapping is required for TMT input")

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
            processor.step1_2_duckdb_tmt,
            ctx.file_paths,
            ctx.config.tmt_channel_mapping,
            psm_path,
        )
        # Load parquet back into memory for fast in-memory Steps 3-5.
        # Chunked Parquet I/O is optimized for DIA's 10K+ file scale;
        # TMT's single-file data fits in memory and runs 5× faster in-memory.
        ctx.df = pd.read_parquet(psm_path, engine="pyarrow")
        ctx.psm_file_path = psm_path
        ctx.step_outputs[ctx.current_step_number or 1] = psm_path
        ctx.step_outputs[2] = psm_path  # Step 2 also done
        ctx.result.total_psms = pq.ParquetFile(psm_path).metadata.num_rows
        logger.info(
            "TMT input complete (DuckDB): %d rows", ctx.result.total_psms
        )
        return

    # Pandas fallback path (unchanged)
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )

    result = await asyncio.to_thread(
        processor.step1_combine_replicates_tmt,
        ctx.file_paths,
        ctx.config.tmt_channel_mapping,
    )

    # Save to PSM_Combined.parquet
    psm_path = ctx.results_dir / "PSM_Combined.parquet"
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
        f"TMT input complete: {len(result)} rows, "
        f"{result['Condition'].nunique()} conditions, "
        f"{result['Replicate'].nunique()} replicates"
    )
