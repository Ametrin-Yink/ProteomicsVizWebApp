"""Step 7: Multi-condition differential expression analysis (MSstats)."""

import asyncio
import logging

from app.services.msstats_wrapper import msstats_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import create_log_callback, get_gene_mapping

logger = logging.getLogger("proteomics")


async def step_group_comparison_multi(ctx: StepContext) -> None:
    """Run MSstats group comparison for all enabled pairwise contrasts."""
    de_output_dir = ctx.results_dir
    rds_input = ctx.results_dir / "MSstats_Processed.rds"
    gene_mapping = get_gene_mapping(ctx.config.organism)

    # Build comparisons list from config
    comparisons = ctx.config.comparisons if ctx.config.comparisons else []
    if not comparisons:
        # Fallback: use treatment/control if specified
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
        ctx.step_outputs[7] = de_output_dir / f"Diff_Expression_{label}.tsv"

    # Count total significant proteins across all comparisons
    total_sig = 0
    for comp in comparisons:
        label = f"{comp['treatment']}_vs_{comp['control']}"
        de_file = de_output_dir / f"Diff_Expression_{label}.tsv"
        if de_file.exists():
            de_df = await asyncio.to_thread(
                __import__("pandas").read_csv, de_file, sep="\t"
            )
            sig_count = len(de_df[de_df["adjPval"] < ctx.config.pvalue_threshold])
            total_sig += sig_count

    ctx.result.significant_proteins = total_sig
