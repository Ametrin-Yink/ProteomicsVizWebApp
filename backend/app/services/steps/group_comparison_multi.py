"""Step 6+7: MSstats multi-condition pipeline — protein abundance + differential expression."""

import asyncio
import logging

import pandas as pd

from app.services.msstats_wrapper import msstats_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import (
    create_log_callback,
    get_gene_mapping,
    get_psm_input,
)

logger = logging.getLogger("proteomics")


async def step_group_comparison_multi(ctx: StepContext) -> None:
    """Run MSstats dataProcess (step 6) + groupComparison (step 7) for all contrasts.

    Combines protein abundance calculation and multi-condition differential expression
    into a single pipeline step for the MSstats multi-condition pipeline.
    """
    gene_mapping = get_gene_mapping(ctx.config.organism)

    # --- Sub-step 6: dataProcess (protein abundance) ---
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"
    rds_output = ctx.results_dir / "MSstats_Processed.rds"

    logger.info("Step 6 (MSstats dataProcess): Calculating protein abundance")

    await msstats_wrapper.data_process(
        input_file=get_psm_input(ctx),
        output_file=protein_output,
        rds_output=rds_output,
        gene_mapping_file=gene_mapping,
        config=ctx.config,
        log_callback=create_log_callback(ctx, step=6),
    )

    ctx.result.protein_abundances_path = str(protein_output)
    protein_df = await asyncio.to_thread(pd.read_csv, protein_output, sep="\t")
    ctx.result.total_proteins = len(protein_df)

    # --- Sub-step 7: groupComparison (multi-condition) ---
    rds_input = ctx.results_dir / "MSstats_Processed.rds"
    de_output_dir = ctx.results_dir

    comparisons = ctx.config.comparisons if ctx.config.comparisons else []
    if not comparisons:
        if ctx.config.treatment and ctx.config.control:
            comparisons = [
                {"treatment": ctx.config.treatment, "control": ctx.config.control}
            ]
        else:
            raise ValueError("No comparisons specified for multi-condition analysis")

    logger.info(f"Step 7 (MSstats multi): Running {len(comparisons)} comparisons")

    await msstats_wrapper.group_comparison_multi(
        rds_file=rds_input,
        output_dir=de_output_dir,
        comparisons=comparisons,
        gene_mapping_file=gene_mapping,
        log_callback=create_log_callback(ctx, step=7),
    )

    # Record the first comparison result as the primary diff_expression_path
    if comparisons:
        first = comparisons[0]
        label = f"{first['treatment']}_vs_{first['control']}"
        ctx.result.diff_expression_path = str(
            de_output_dir / f"Diff_Expression_{label}.tsv"
        )

    # Count total significant proteins across all comparisons
    total_sig = 0
    for comp in comparisons:
        label = f"{comp['treatment']}_vs_{comp['control']}"
        de_file = de_output_dir / f"Diff_Expression_{label}.tsv"
        if de_file.exists():
            de_df = await asyncio.to_thread(pd.read_csv, de_file, sep="\t")
            sig_count = len(de_df[de_df["adjPval"] < ctx.config.pvalue_threshold])
            total_sig += sig_count

    ctx.result.significant_proteins = total_sig
