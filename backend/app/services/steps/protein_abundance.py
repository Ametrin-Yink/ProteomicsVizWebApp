"""Step 6: Protein abundance calculation (msqrob2)."""
import asyncio
import logging
import pandas as pd
from app.services.msqrob2_wrapper import msqrob2_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import create_log_callback, get_gene_mapping, get_psm_input

logger = logging.getLogger("proteomics")


async def step_protein_abundance_msqrob2(ctx: StepContext) -> None:
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"
    gene_mapping = get_gene_mapping(ctx.config.organism)

    logger.info(
        f"Step 6: About to run protein abundance. "
        f"Input file exists: {get_psm_input(ctx).exists()}, path: {get_psm_input(ctx)}"
    )

    await msqrob2_wrapper.step6_protein_abundance(
        input_file=get_psm_input(ctx),
        output_file=protein_output,
        gene_mapping_file=gene_mapping,
        log_callback=create_log_callback(ctx, step=6),
    )

    ctx.result.protein_abundances_path = str(protein_output)
    ctx.step_outputs[6] = protein_output

    protein_df = await asyncio.to_thread(pd.read_csv, protein_output, sep="\t")
    ctx.result.total_proteins = len(protein_df)
