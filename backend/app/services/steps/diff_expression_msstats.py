"""Step 7: Differential expression analysis (MSstats)."""

import asyncio
import logging

import pandas as pd

from app.services.msstats_wrapper import msstats_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import create_log_callback, get_gene_mapping

logger = logging.getLogger("proteomics")


async def step_diff_expression_msstats(ctx: StepContext) -> None:
    de_output = ctx.results_dir / "Diff_Expression.tsv"
    rds_input = ctx.results_dir / "MSstats_Processed.rds"
    gene_mapping = get_gene_mapping(ctx.config.organism)

    await msstats_wrapper.group_comparison(
        rds_file=rds_input,
        output_file=de_output,
        treatment=ctx.config.treatment,
        control=ctx.config.control,
        gene_mapping_file=gene_mapping,
        log_callback=create_log_callback(ctx, step=7),
    )

    ctx.result.diff_expression_path = str(de_output)
    ctx.step_outputs[7] = de_output

    de_df = await asyncio.to_thread(pd.read_csv, de_output, sep="\t")
    sig_df = de_df[de_df["adjPval"] < ctx.config.pvalue_threshold]
    ctx.result.significant_proteins = len(sig_df)
