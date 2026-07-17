"""Step 4 (PTM): PTM QC metrics calculation.

Reads per-comparison DE TSVs from step 3, computes basic QC statistics
(sites tested, significant hits with up/down counts), and persists them
as ptm_qc.json.
"""

import asyncio
import json
import logging

import pandas as pd

from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


async def step_ptm_qc_metrics(ctx: StepContext) -> None:
    """Step 4: PTM QC metrics — count sites tested, significant hits, up/down.

    Reads per-comparison Diff_Expression TSVs from step 3 outputs,
    computes basic QC statistics (total PTM sites tested, significant
    hits below the p-value threshold, counts of up-/down-regulated
    sites), and writes the results to ptm_qc.json in ctx.results_dir.

    Args:
        ctx: Pipeline step context with step_outputs set by step 3.

    Raises:
        ValueError: If no DE result files are available from step 3.
    """
    de_paths: list = ctx.step_outputs.get("de_paths", [])
    if not de_paths:
        # Fall back to scanning the comparison directory
        comparison_dir = ctx.results_dir / "ptm_comparisons"
        if comparison_dir.exists():
            de_paths = sorted(comparison_dir.glob("Diff_Expression_*.tsv"))
        if not de_paths:
            raise ValueError("No DE result files from step 3 (PTM group comparison)")

    total_sites = 0
    total_significant = 0
    total_up = 0
    total_down = 0

    for de_file in de_paths:
        df = await asyncio.to_thread(pd.read_csv, de_file, sep="\t")
        total_sites += len(df)

        # Determine p-value and logFC column names
        # (MSstatsPTM may use R-style adj.pvalue or MSstats-style adjPval)
        pval_col = "adj.pvalue" if "adj.pvalue" in df.columns else "adjPval"
        if pval_col not in df.columns:
            logger.warning(
                "No p-value column found in %s (checked adj.pvalue, adjPval), skipping",
                de_file,
            )
            continue
        logfc_col = "log2FC" if "log2FC" in df.columns else "logFC"
        if logfc_col not in df.columns:
            logger.warning(
                "No logFC column found in %s, skipping significant up/down counts",
                de_file,
            )

        significant = df[df[pval_col] < ctx.config.pvalue_threshold]
        total_significant += len(significant)

        if logfc_col in significant.columns:
            total_up += int((significant[logfc_col] > 0).sum())
            total_down += int((significant[logfc_col] < 0).sum())

    qc_data = {
        "total_ptm_sites_tested": total_sites,
        "total_significant": total_significant,
        "significant_up": total_up,
        "significant_down": total_down,
        "pvalue_threshold": ctx.config.pvalue_threshold,
        "logfc_threshold": ctx.config.logfc_threshold,
    }

    qc_output = ctx.results_dir / "ptm_qc.json"

    def _write_qc() -> None:
        qc_output.write_text(json.dumps(qc_data, indent=2), encoding="utf-8")

    await asyncio.to_thread(_write_qc)

    ctx.step_outputs["qc_path"] = qc_output
    ctx.state.add_log("info", "PTM QC metrics complete", step=4)
