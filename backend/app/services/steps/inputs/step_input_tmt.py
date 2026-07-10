"""Step 1 (TMT): DuckDB UNPIVOT streaming for Steps 1-2.

Reads TMT file(s), melts wide-format channels via DuckDB UNPIVOT,
joins with channel mapping for condition/replicate assignment,
generates Unique_PSM, applies low-quality filters — all in a
single streaming DuckDB COPY query.

After streaming: ctx.df = None (Steps 3-5 use DuckDB SQL).
"""

import asyncio
import logging

import pyarrow.parquet as pq

from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_input_tmt(ctx: StepContext) -> None:
    """TMT input: melt channels, map conditions, save PSM_Combined.parquet.

    Delegates to DataProcessor.step1_2_duckdb_tmt() which handles
    Steps 1-2 (read + UNPIVOT + metadata + Unique_PSM + filters)
    in a single streaming query.
    """
    if not ctx.file_paths:
        raise ValueError("No file paths provided for TMT input")

    if not ctx.config.tmt_channel_mapping:
        raise ValueError("tmt_channel_mapping is required for TMT input")

    psm_path = ctx.results_dir / "PSM_Combined.parquet"

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
    ctx.df = None  # Signal: DuckDB handled Steps 1-2, Steps 3-5 use DuckDB SQL
    ctx.psm_file_path = psm_path
    ctx.step_outputs[ctx.current_step_number or 1] = psm_path
    ctx.step_outputs[2] = psm_path  # Step 2 also done (Unique_PSM inlined)
    ctx.result.total_psms = pq.ParquetFile(psm_path).metadata.num_rows
    logger.info(
        "TMT input complete (DuckDB): %d rows", ctx.result.total_psms
    )
