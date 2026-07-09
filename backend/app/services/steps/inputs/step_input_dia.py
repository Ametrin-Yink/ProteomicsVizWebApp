"""Step 1 (DIA): Read N DIA files, apply per-file metadata, save parquet.

See docs/specs/pipeline-reform-tmt-dia.md Section 8.3 for full spec.
"""

import asyncio
import logging

from app.core.config import settings
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_input_dia(ctx: StepContext) -> None:
    """DIA input handler: read N files, apply metadata, save parquet.

    Delegates processing to DataProcessor.step1_combine_replicates_dia(),
    then saves the result as parquet and updates ctx fields.
    """
    if not ctx.file_paths:
        raise ValueError("No file paths provided for DIA input")

    if not ctx.config.metadata:
        raise ValueError("metadata is required for DIA input")

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

    logger.info(f"DIA input complete: {len(result)} rows, "
                f"{result['Condition'].nunique()} conditions")
