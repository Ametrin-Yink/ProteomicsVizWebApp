"""Step 7: Differential expression analysis (msqrob2/limma)."""
import asyncio
import pandas as pd
from app.services.msqrob2_wrapper import msqrob2_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import create_log_callback


async def step_diff_expression_msqrob2(ctx: StepContext) -> None:
    de_output = ctx.results_dir / "Diff_Expression.tsv"
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"

    await msqrob2_wrapper.step7_differential_expression(
        input_file=protein_output,
        output_file=de_output,
        treatment=ctx.config.treatment,
        control=ctx.config.control,
        log_callback=create_log_callback(ctx, step=7),
    )

    ctx.result.diff_expression_path = str(de_output)
    ctx.step_outputs[7] = de_output

    de_df = await asyncio.to_thread(pd.read_csv, de_output, sep="\t")
    sig_df = de_df[de_df["adjPval"] < ctx.config.pvalue_threshold]
    ctx.result.significant_proteins = len(sig_df)
