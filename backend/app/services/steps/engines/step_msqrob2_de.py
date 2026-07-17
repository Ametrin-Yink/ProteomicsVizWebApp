"""Step 7 (msqrob2): Differential expression analysis (msqrob2 v1.16 API).

Moved from steps/multi_condition_de.py — unchanged behavior.
"""

import asyncio
import logging

import pandas as pd

from app.core.config import settings
from app.services.msqrob2_wrapper import msqrob2_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import (
    build_comparison_pair_label,
    create_log_callback,
    get_gene_mapping,
)

logger = logging.getLogger("proteomics")


async def step_multi_condition_de(ctx: StepContext) -> None:
    """Step 7 (msqrob2): Multi-condition DE using msqrob2 native QFeatures API.

    Loads MSqRob2_Processed.rds (QFeatures object) from step 6, runs
    msqrob() + makeContrast() + hypothesisTest() for all contrasts,
    writes per-comparison Diff_Expression_*.tsv files.

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

    if len(comparisons) > settings.msqrob2_batch_size:
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

    if comparisons:
        first = comparisons[0]
        label = build_comparison_pair_label(first)
        ctx.result.diff_expression_path = str(
            ctx.results_dir / f"Diff_Expression_{label}.tsv"
        )

    ctx.step_outputs[current_step] = ctx.results_dir

    total_sig = 0
    for comp in comparisons:
        label = build_comparison_pair_label(comp)
        de_file = ctx.results_dir / f"Diff_Expression_{label}.tsv"
        if de_file.exists():
            de_df = await asyncio.to_thread(pd.read_csv, de_file, sep="\t")
            sig_count = len(de_df[de_df["adjPval"] < ctx.config.pvalue_threshold])
            total_sig += sig_count

    ctx.result.significant_proteins = total_sig
