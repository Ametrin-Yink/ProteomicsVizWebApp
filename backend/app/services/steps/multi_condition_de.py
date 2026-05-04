"""Step 7: Multi-condition differential expression analysis (msqrob2/limma)."""

import asyncio
import logging

import pandas as pd

from app.services.msqrob2_wrapper import msqrob2_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import (
    create_log_callback,
    get_gene_mapping,
)

logger = logging.getLogger("proteomics")


async def step_multi_condition_de(ctx: StepContext) -> None:
    """Step 7: Multi-condition DE using msqrob2/limma.

    Handles N conditions with M arbitrary contrasts. Reads comparisons from
    ctx.config.comparisons, falling back to a single treatment-vs-control
    comparison if not specified.
    """
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"
    de_output_dir = ctx.results_dir
    gene_mapping = get_gene_mapping(ctx.config.organism)

    # Determine comparisons: use config.comparisons or fall back to single pair
    comparisons = ctx.config.comparisons if ctx.config.comparisons else []
    if not comparisons:
        if ctx.config.treatment and ctx.config.control:
            comparisons = [
                {"treatment": ctx.config.treatment, "control": ctx.config.control}
            ]
        else:
            raise ValueError("No comparisons specified for multi-condition analysis")

    logger.info(f"Step 7 (msqrob2 multi): Running {len(comparisons)} comparisons")

    await msqrob2_wrapper.step7_differential_expression_multi(
        input_file=protein_output,
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

    ctx.step_outputs[7] = de_output_dir

    # Count total significant proteins across all comparison files
    total_sig = 0
    for comp in comparisons:
        label = f"{comp['treatment']}_vs_{comp['control']}"
        de_file = de_output_dir / f"Diff_Expression_{label}.tsv"
        if de_file.exists():
            de_df = await asyncio.to_thread(pd.read_csv, de_file, sep="\t")
            sig_count = len(de_df[de_df["adjPval"] < ctx.config.pvalue_threshold])
            total_sig += sig_count

    ctx.result.significant_proteins = total_sig
