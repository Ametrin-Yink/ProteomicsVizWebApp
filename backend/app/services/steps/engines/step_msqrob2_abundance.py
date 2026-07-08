"""Step 6 (msqrob2): Protein abundance via QFeatures aggregation.

Moved from steps/protein_abundance.py — unchanged behavior.
"""

import asyncio
import logging

import pandas as pd

from app.services.msqrob2_wrapper import msqrob2_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import (
    create_log_callback,
    get_gene_mapping,
    get_psm_input,
)

logger = logging.getLogger("proteomics")


async def step_protein_abundance_msqrob2(ctx: StepContext) -> None:
    """Step 6 (msqrob2): Protein abundance via QFeatures aggregation.

    Reads PSM_Combined.parquet (with Unique_PSM from step 2), runs the full
    QFeatures pipeline: filter, log2, normalize, impute, aggregate, gene map,
    batch correct. Saves QFeatures RDS for step 7.
    """
    current_step = ctx.current_step_number or 6
    gene_mapping = get_gene_mapping(ctx.config.organism)
    psm_input = get_psm_input(ctx, step=current_step)

    protein_output = ctx.results_dir / "Protein_Abundances.tsv"
    rds_output = ctx.results_dir / "MSqRob2_Processed.rds"

    # Checkpoint: skip data_process if valid RDS exists
    if rds_output.exists() and psm_input.exists():
        rds_mtime = rds_output.stat().st_mtime
        psm_mtime = psm_input.stat().st_mtime
        if rds_mtime > psm_mtime:
            logger.info(
                "RDS checkpoint found (newer than input), skipping data_process"
            )
            ctx.state.add_log(
                "info", "Checkpoint found — skipping protein abundance",
                step=current_step,
            )
            if protein_output.exists():
                protein_df = await asyncio.to_thread(
                    pd.read_csv, protein_output, sep="\t"
                )
                ctx.result.total_proteins = len(protein_df)
            ctx.result.protein_abundances_path = str(protein_output)
            ctx.step_outputs[current_step] = rds_output
            return

    logger.info(f"Step {current_step}: Running protein abundance via QFeatures")

    await msqrob2_wrapper.data_process(
        input_file=psm_input,
        output_file=protein_output,
        rds_output=rds_output,
        gene_mapping_file=gene_mapping,
        config=ctx.config,
        log_callback=create_log_callback(ctx, step=current_step),
        timeout_multiplier=ctx.timeout_multiplier,
    )

    ctx.result.protein_abundances_path = str(protein_output)
    ctx.step_outputs[current_step] = rds_output

    protein_df = await asyncio.to_thread(pd.read_csv, protein_output, sep="\t")
    ctx.result.total_proteins = len(protein_df)
