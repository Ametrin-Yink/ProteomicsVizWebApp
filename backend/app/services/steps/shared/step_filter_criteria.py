"""Step 3: Filter PSM coverage and protein eligibility."""

import asyncio
import logging

from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


def _expected_replicates(ctx: StepContext) -> dict[str, int]:
    """Build exact condition replicate counts from the experiment design."""
    mapping = ctx.config.tmt_channel_mapping
    reserved = {"experiment", "batch", "replicate"}
    if mapping:
        rows = list(mapping.values())
        group_cols = [key for key in rows[0] if key != "replicate"]
    elif ctx.config.metadata:
        rows = list(ctx.config.metadata.values())
        group_cols = [key for key in rows[0] if key not in reserved]
    else:
        raise ValueError(
            "Experiment design metadata is required for coverage filtering"
        )

    replicates: dict[str, set[int]] = {}
    for row in rows:
        condition = "_".join(str(row[column]) for column in group_cols)
        replicates.setdefault(condition, set()).add(int(row.get("replicate", 1)))
    return {condition: len(values) for condition, values in replicates.items()}


async def step_filter_criteria_default(ctx: StepContext) -> None:
    """Filter PSMs by explicit missingness and distinct-PSM criteria."""
    processor = DataProcessor(
        ProcessingConfig(
            max_missing_fraction_per_condition=(
                ctx.config.max_missing_fraction_per_condition
            ),
            min_psms_per_protein=ctx.config.min_psms_per_protein,
            expected_replicates_by_condition=_expected_replicates(ctx),
        )
    )

    psm_path = ctx.results_dir / "PSM_Abundances.parquet"
    await asyncio.to_thread(
        processor.step3_filter_by_criteria_duckdb,
        ctx.psm_file_path,
        psm_path,
    )

    ctx.psm_file_path = psm_path
    ctx.step_outputs[ctx.current_step_number] = psm_path
    logger.info("Coverage and protein eligibility filters wrote %s", psm_path.name)
