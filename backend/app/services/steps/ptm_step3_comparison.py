"""Step 3 (PTM): PTM group comparison via MSstatsPTM.

Reads the summarised RDS from step 2, runs MSstatsPTM group comparison
for all specified contrasts, and records per-comparison output file paths.
"""

import asyncio
import logging

import pandas as pd

from app.services.pipeline_engine import StepContext
from app.services.ptm_wrapper import ptm_wrapper
from app.services.steps._helpers import create_log_callback

logger = logging.getLogger("proteomics")


async def step_ptm_group_comparison(ctx: StepContext) -> None:
    """Step 3: PTM group comparison via MSstatsPTM group_comparison.

    Reads the summarised RDS from step 2 (ctx.step_outputs["rds_file"]),
    reads comparison pairs from ctx.config.comparisons, and calls the
    PTM wrapper's group_comparison_multi. Output TSVs are written to
    ctx.results_dir / "ptm_comparisons" / Diff_Expression_*.tsv.

    Args:
        ctx: Pipeline step context with step_outputs set by step 2.

    Raises:
        ValueError: If step 2 RDS is missing or no comparisons configured.
    """
    # Read RDS file from step 2 output
    rds_file = ctx.step_outputs.get("rds_file")
    if not rds_file:
        raise ValueError("No RDS file from step 2 (PTM summarization)")

    # Read comparisons from config
    comparisons = ctx.config.comparisons if ctx.config.comparisons else []
    if not comparisons:
        raise ValueError("No comparisons specified for PTM group comparison")

    logger.info(
        "Step 3 (PTM group comparison): Running %d comparisons",
        len(comparisons),
    )

    # Output directory for per-comparison TSV files
    output_dir = ctx.results_dir / "ptm_comparisons"
    await asyncio.to_thread(output_dir.mkdir, parents=True, exist_ok=True)

    # Build extra config values from AnalysisConfig for the R script
    label_type = ctx.config.ptm_labeling_type
    adj_method = getattr(ctx.config, "msqrob2_adjust_method", "BH")

    log_cb = create_log_callback(ctx, step=3)

    await ptm_wrapper.group_comparison_multi(
        rds_file=rds_file,
        output_dir=output_dir,
        comparisons=comparisons,
        log_callback=log_cb,
        timeout_multiplier=ctx.timeout_multiplier,
        config=ctx.config,
        ptm_label_type=label_type,
        protein_label_type=label_type,
        adj_method=adj_method,
    )

    # Parse output TSVs and store paths in step_outputs
    def build_label(group: dict) -> str:
        return "+".join(str(v) for v in group.values())

    de_paths: list = []
    total_sig = 0
    for comp in comparisons:
        label = f"{build_label(comp['group1'])}_vs_{build_label(comp['group2'])}"
        de_file = output_dir / f"Diff_Expression_{label}.tsv"
        if de_file.exists():
            de_paths.append(de_file)
            de_df = await asyncio.to_thread(pd.read_csv, de_file, sep="\t")
            pval_col = "adj.pvalue" if "adj.pvalue" in de_df.columns else "adjPval"
            sig_count = len(de_df[de_df[pval_col] < ctx.config.pvalue_threshold])
            total_sig += sig_count

    ctx.step_outputs["comparison_dir"] = output_dir
    ctx.step_outputs["de_paths"] = de_paths
    ctx.result.significant_proteins = total_sig

    ctx.state.add_log("PTM group comparison complete")
