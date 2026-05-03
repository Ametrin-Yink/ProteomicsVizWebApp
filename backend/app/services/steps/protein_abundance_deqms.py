"""Step 6: Protein abundance calculation (DEqMS)."""

import asyncio
import logging

import pandas as pd

from app.services.deqms_wrapper import deqms_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import create_log_callback, get_gene_mapping, get_psm_input

logger = logging.getLogger("proteomics")


async def step_protein_abundance_deqms(ctx: StepContext) -> None:
    """Step 6: Calculate protein abundance using DEqMS medianSweeping."""
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"
    gene_mapping = get_gene_mapping(ctx.config.organism)

    await deqms_wrapper.step6_protein_abundance(
        input_file=get_psm_input(ctx),
        output_file=protein_output,
        gene_mapping_file=gene_mapping,
        log_callback=create_log_callback(ctx, step=6),
    )

    ctx.result.protein_abundances_path = str(protein_output)
    ctx.step_outputs[6] = protein_output

    protein_df = await asyncio.to_thread(pd.read_csv, protein_output, sep="\t")
    ctx.result.total_proteins = len(protein_df)
