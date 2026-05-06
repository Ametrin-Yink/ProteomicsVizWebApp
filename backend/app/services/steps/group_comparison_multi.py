"""Step handlers for MSstats multi-condition pipeline — protein abundance + DE."""

import asyncio
import logging

import pandas as pd

from app.core.config import settings
from app.services.msstats_wrapper import msstats_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import (
    create_log_callback,
    get_gene_mapping,
    get_psm_input,
)

logger = logging.getLogger("proteomics")


async def step_msstats_protein_abundance(ctx: StepContext) -> None:
    """Step 6 (MSstats): Protein abundance via MSstats dataProcess.

    Writes Protein_Abundances.tsv and MSstats_Processed.rds.
    Skips if a valid RDS checkpoint exists (newer than the input PSM file).
    """
    gene_mapping = get_gene_mapping(ctx.config.organism)
    psm_input = get_psm_input(ctx)

    protein_output = ctx.results_dir / "Protein_Abundances.tsv"
    rds_output = ctx.results_dir / "MSstats_Processed.rds"

    # Checkpoint: skip dataProcess if valid RDS exists
    if rds_output.exists() and psm_input.exists():
        rds_mtime = rds_output.stat().st_mtime
        psm_mtime = psm_input.stat().st_mtime
        if rds_mtime > psm_mtime:
            logger.info(
                "RDS checkpoint found (newer than input), skipping dataProcess",
                extra={"rds": str(rds_output), "rds_mtime": rds_mtime, "psm_mtime": psm_mtime},
            )
            ctx.state.add_log("info", "Checkpoint found — skipping protein abundance", step=6)
            if protein_output.exists():
                protein_df = await asyncio.to_thread(pd.read_csv, protein_output, sep="\t")
                ctx.result.total_proteins = len(protein_df)
            ctx.result.protein_abundances_path = str(protein_output)
            ctx.step_outputs[6] = protein_output
            return

    logger.info("Step 6 (MSstats dataProcess): Calculating protein abundance")

    await msstats_wrapper.data_process(
        input_file=psm_input,
        output_file=protein_output,
        rds_output=rds_output,
        gene_mapping_file=gene_mapping,
        config=ctx.config,
        log_callback=create_log_callback(ctx, step=6),
        timeout_multiplier=ctx.timeout_multiplier,
    )

    ctx.result.protein_abundances_path = str(protein_output)
    protein_df = await asyncio.to_thread(pd.read_csv, protein_output, sep="\t")
    ctx.result.total_proteins = len(protein_df)
    ctx.step_outputs[6] = protein_output


async def step_msstats_group_comparison(ctx: StepContext) -> None:
    """Step 7 (MSstats): Multi-condition DE via MSstats groupComparison.

    Loads MSstats_Processed.rds from step 6, runs groupComparison for all
    contrasts, writes per-comparison Diff_Expression_*.tsv files.
    """
    rds_input = ctx.results_dir / "MSstats_Processed.rds"
    if not rds_input.exists():
        raise FileNotFoundError(
            f"MSstats_Processed.rds not found at {rds_input}. "
            "Step 6 (dataProcess) must complete first."
        )

    comparisons = ctx.config.comparisons if ctx.config.comparisons else []
    if not comparisons:
        if ctx.config.treatment and ctx.config.control:
            comparisons = [
                {"treatment": ctx.config.treatment, "control": ctx.config.control}
            ]
        else:
            raise ValueError("No comparisons specified for multi-condition analysis")

    logger.info(f"Step 7 (MSstats groupComparison): Running {len(comparisons)} comparisons")

    # Filter metadata to only include columns selected as covariates
    covariate_data = ctx.config.metadata or {}
    if getattr(ctx.config, "covariate_columns", None):
        selected_cols = set(ctx.config.covariate_columns)
        covariate_data = {
            fn: {k: v for k, v in cols.items() if k in selected_cols}
            for fn, cols in covariate_data.items()
        }

    gene_mapping = get_gene_mapping(ctx.config.organism)

    if len(comparisons) > settings.msstats_batch_size:
        # Batched path: parallel R subprocesses via ProcessPoolExecutor
        await msstats_wrapper.group_comparison_batched(
            rds_file=rds_input,
            output_dir=ctx.results_dir,
            comparisons=comparisons,
            gene_mapping_file=gene_mapping,
            covariates=covariate_data,
            batch_size=settings.msstats_batch_size,
            max_workers=settings.msstats_max_workers,
            n_cores_cap=settings.msstats_n_cores_cap,
            log_base=ctx.config.msstats_log_base if ctx.config.msstats_log_base else 2,
            save_fitted_models=ctx.config.msstats_save_fitted_models,
            log_callback=create_log_callback(ctx, step=7),
            timeout_multiplier=ctx.timeout_multiplier,
        )
    else:
        # Single-process path (unchanged from current behavior)
        await msstats_wrapper.group_comparison_multi(
            rds_file=rds_input,
            output_dir=ctx.results_dir,
            comparisons=comparisons,
            gene_mapping_file=gene_mapping,
            config=ctx.config,
            covariates=covariate_data,
            log_base=ctx.config.msstats_log_base if ctx.config.msstats_log_base else 2,
            save_fitted_models=ctx.config.msstats_save_fitted_models,
            log_callback=create_log_callback(ctx, step=7),
            timeout_multiplier=ctx.timeout_multiplier,
        )

    # Record the first comparison result as the primary diff_expression_path
    if comparisons:
        first = comparisons[0]

        def build_label(group: dict) -> str:
            return "+".join(str(v) for v in group.values())

        label = f"{build_label(first['group1'])}_vs_{build_label(first['group2'])}"
        ctx.result.diff_expression_path = str(
            ctx.results_dir / f"Diff_Expression_{label}.tsv"
        )

    # Count total significant proteins across all comparisons
    total_sig = 0
    for comp in comparisons:
        g1_label = "+".join(str(v) for v in comp["group1"].values())
        g2_label = "+".join(str(v) for v in comp["group2"].values())
        label = f"{g1_label}_vs_{g2_label}"
        de_file = ctx.results_dir / f"Diff_Expression_{label}.tsv"
        if de_file.exists():
            de_df = await asyncio.to_thread(pd.read_csv, de_file, sep="\t")
            sig_count = len(de_df[de_df["adjPval"] < ctx.config.pvalue_threshold])
            total_sig += sig_count

    ctx.result.significant_proteins = total_sig
    ctx.step_outputs[7] = ctx.results_dir
