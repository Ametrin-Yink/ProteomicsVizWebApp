"""Step 1 (TMT): Read TMT file(s), melt channels, map to conditions, save parquet.

See docs/specs/pipeline-reform-tmt-dia.md Section 8.2 for full spec.
"""

import asyncio
import logging

from app.core.config import settings
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_input_tmt(ctx: StepContext) -> None:
    """TMT input handler: melt channel-level data, map to conditions, save parquet.

    Delegates processing to DataProcessor.step1_combine_replicates_tmt(),
    then saves the result as parquet and updates ctx fields.
    """
    if not ctx.file_paths:
        raise ValueError("No file paths provided for TMT input")

    if not ctx.config.tmt_channel_mapping:
        raise ValueError("tmt_channel_mapping is required for TMT input")

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
