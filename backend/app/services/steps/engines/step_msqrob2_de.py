"""Step 7 (msqrob2): Differential expression analysis (msqrob2 v1.16 API).

Moved from steps/multi_condition_de.py — unchanged behavior.
"""

import asyncio
import logging

from app.core.config import settings
from app.services.msqrob2_wrapper import msqrob2_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import (
    count_significant_differential,
    create_log_callback,
    differential_output_paths,
    get_gene_mapping,
    primary_differential_output,
)

logger = logging.getLogger("proteomics")


async def step_multi_condition_de(ctx: StepContext) -> None:
    """Step 7 (msqrob2): Multi-condition DE using msqrob2 native QFeatures API.

    Loads MSqRob2_Processed.rds (QFeatures object) from step 6, runs
    msqrob() + makeContrast() + hypothesisTest() for all contrasts,
    writes consolidated differential-result TSV shards.

    Batches comparisons when exceeding settings.msqrob2_batch_size.
    """
    current_step = ctx.current_step_number or 7
    rds_input = ctx.results_dir / "MSqRob2_Processed.rds"
    if not rds_input.exists():
        raise FileNotFoundError(
            f"MSqRob2_Processed.rds not found at {rds_input}. "
            "Step 6 (protein abundance) must complete first."
        )

    comparisons = ctx.config.comparisons if ctx.config.comparisons else []
    if not comparisons:
        raise ValueError("No comparisons specified for multi-condition analysis")

    logger.info(
        f"Step {current_step} (msqrob2 DE): Running {len(comparisons)} comparisons"
    )

    gene_mapping = get_gene_mapping(ctx.config.organism)

    is_batched = len(comparisons) > settings.msqrob2_batch_size
    if is_batched:
        logger.info(
            "Step %d: Using batched DE for %d comparisons",
            current_step,
            len(comparisons),
        )
        await msqrob2_wrapper.group_comparison_batched(
            rds_file=rds_input,
            output_dir=ctx.results_dir,
            comparisons=comparisons,
            gene_mapping_file=gene_mapping,
            config=ctx.config,
            log_callback=create_log_callback(ctx, step=current_step),
        )
    else:
        await msqrob2_wrapper.group_comparison_multi(
            rds_file=rds_input,
            output_dir=ctx.results_dir,
            comparisons=comparisons,
            gene_mapping_file=gene_mapping,
            config=ctx.config,
            log_callback=create_log_callback(ctx, step=current_step),
            timeout_multiplier=ctx.timeout_multiplier,
        )

    ctx.result.diff_expression_path = str(
        primary_differential_output(ctx.results_dir, batched=is_batched)
    )

    ctx.step_outputs[current_step] = ctx.results_dir

    de_paths = differential_output_paths(ctx.results_dir)
    ctx.result.significant_proteins = await asyncio.to_thread(
        count_significant_differential,
        de_paths,
        ctx.config.pvalue_threshold,
    )
