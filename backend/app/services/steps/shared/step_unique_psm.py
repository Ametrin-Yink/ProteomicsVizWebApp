"""Step 2: Unique PSM identifier (no-op — DuckDB already handled it).

DuckDB streaming in Steps 1-2 generates Unique_PSM inline as part
of the COPY query. This handler records step completion without
any processing.
"""

import logging

from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_unique_psm(ctx: StepContext) -> None:
    """Step 2: DuckDB already handled Unique_PSM generation.

    Marks step output and continues. The parquet file at
    ctx.psm_file_path already contains the Unique_PSM column
    from the DuckDB streaming query.
    """
    current_step = ctx.current_step_number or 2
    ctx.step_outputs[current_step] = ctx.psm_file_path
    logger.info(
        "Step %d: Unique_PSM already in parquet (DuckDB Steps 1-2)",
        current_step,
    )
