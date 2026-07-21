"""Step 1 (TMT): prepare and filter PSMs with DuckDB streaming.

Reads TMT file(s), melts wide-format channels via DuckDB UNPIVOT,
joins with channel mapping for condition/replicate assignment,
generates Unique_PSM, applies low-quality filters — all in a
single streaming DuckDB COPY query.

After streaming: ctx.df = None (subsequent filters use DuckDB SQL).
"""

import asyncio
import logging

import pyarrow.parquet as pq

from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_input_tmt(ctx: StepContext) -> None:
    """TMT input: melt channels, map conditions, save PSM_Combined.parquet.

    Delegates to DataProcessor.step1_2_duckdb_tmt() for raw PSM QC,
    UNPIVOT, metadata mapping, and Unique_PSM generation in one query.
    """
    if not ctx.file_paths:
        raise ValueError("No file paths provided for TMT input")

    if not ctx.config.tmt_channel_mapping:
        raise ValueError("tmt_channel_mapping is required for TMT input")

    psm_path = ctx.results_dir / "PSM_Combined.parquet"

    # Session configuration stores mappings by file and reporter channel
    # ("filename::126"). The DuckDB processor receives the reporter label.
    source_filenames = {path.name for path in ctx.file_paths}
    channel_mapping: dict[str, dict] = {}
    for mapping_key, metadata in ctx.config.tmt_channel_mapping.items():
        filename, separator, channel = mapping_key.rpartition("::")
        if separator:
            if filename not in source_filenames:
                continue
        else:
            channel = mapping_key

        existing = channel_mapping.get(channel)
        if existing is not None and existing != metadata:
            raise ValueError(f"Conflicting TMT mappings for reporter channel {channel}")
        channel_mapping[channel] = metadata

    processor = DataProcessor(ProcessingConfig())
    await asyncio.to_thread(
        processor.step1_2_duckdb_tmt,
        ctx.file_paths,
        channel_mapping,
        psm_path,
    )
    ctx.df = None
    ctx.psm_file_path = psm_path
    ctx.step_outputs[ctx.current_step_number or 1] = psm_path
    ctx.result.total_psms = pq.ParquetFile(psm_path).metadata.num_rows
    logger.info(
        "TMT input preparation complete (DuckDB): %d rows", ctx.result.total_psms
    )
