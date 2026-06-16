"""Step 2 (PTM): PTM summarization via MSstatsPTM dataProcess.

Combines PTM enrichment input files (if more than one), builds a config JSON
with PTM analysis parameters, and runs ptm_summarization.R which performs
PD-to-MSstatsPTM format conversion followed by data summarization.
"""

import asyncio
import json
import logging
import subprocess

import pandas as pd

from app.core.config import settings
from app.core.exceptions import RScriptError
from app.services.pipeline_engine import StepContext
from app.services.ptm_wrapper import ptm_wrapper
from app.services.steps._helpers import create_log_callback

logger = logging.getLogger("proteomics")


async def step_ptm_summarization(ctx: StepContext) -> None:
    """Step 2: PTM summarization via MSstatsPTM.

    Reads PTM enrichment file paths and annotation from step 1 outputs,
    optionally combines multiple PTM inputs into a single TSV, builds
    the PTM config from AnalysisConfig, and runs the R summarization script.

    Args:
        ctx: Pipeline step context with step_outputs set by step 1.

    Raises:
        ValueError: If required step 1 outputs are missing.
        RScriptError: If the R subprocess fails or the output RDS is not created.
    """
    # --- Read file paths from step 1 outputs ---
    ptm_inputs: list = ctx.step_outputs.get("ptm_input_path", [])
    if not ptm_inputs:
        raise ValueError("No PTM input files from step 1")

    annotation_csv = ctx.step_outputs.get("annotation_csv")
    if not annotation_csv:
        raise ValueError("No annotation CSV from step 1")

    fasta_path = ctx.step_outputs.get("fasta_path")
    if not fasta_path:
        raise ValueError("No FASTA path from step 1")

    mod_ids: list[str] = ctx.step_outputs.get("mod_ids", ["Phospho"])
    protein_inputs: list = ctx.step_outputs.get("protein_input_path", [])

    # --- Output paths ---
    output_rds = ctx.results_dir / "ptm_summarized.rds"

    # Checkpoint: skip if valid RDS exists (faster re-runs)
    if output_rds.exists():
        logger.info("RDS checkpoint found for PTM summarization, skipping")
        ctx.state.add_log("info", "Checkpoint found -- skipping PTM summarization")
        ctx.step_outputs["rds_file"] = output_rds
        return

    # --- Combine multiple PTM input files into a single TSV ---
    if len(ptm_inputs) == 1:
        ptm_input_csv = ptm_inputs[0]
    else:
        combined_ptm_tsv = ctx.results_dir / "ptm_combined.tsv"
        logger.info("Combining %d PTM input files into %s", len(ptm_inputs), combined_ptm_tsv)
        dfs = []
        for f in ptm_inputs:
            df = await asyncio.to_thread(pd.read_csv, f, sep="\t")
            dfs.append(df)
        combined = pd.concat(dfs, ignore_index=True)
        await asyncio.to_thread(combined.to_csv, str(combined_ptm_tsv), sep="\t", index=False)
        ptm_input_csv = combined_ptm_tsv

    # --- Build config dict ---
    config_data = {
        "labeling_type": ctx.config.ptm_labeling_type,
        "mod_id": mod_ids[0] if isinstance(mod_ids, list) else mod_ids,
        "which_proteinid": ctx.config.ptm_which_proteinid,
        "which_quantification": ctx.config.ptm_which_quantification,
        "normalization": ctx.config.ptm_normalization,
        "summaryMethod": ctx.config.ptm_summary_method,
        "MBimpute": ctx.config.ptm_mbimpute,
    }
    config_json = json.dumps(config_data)

    # --- Build R command ---
    # ptm_summarization.R positional args:
    #   1  ptm_input_csv
    #   2  annotation_csv
    #   3  fasta_path
    #   4  config_json
    #   5  output_rds
    #   6  protein_input_csv  (optional)
    #   7  protein_annotation_csv  (optional)
    script_path = ptm_wrapper.scripts_dir / "ptm_summarization.R"
    cmd = [
        ptm_wrapper.r_executable,
        str(script_path),
        str(ptm_input_csv),
        str(annotation_csv),
        str(fasta_path),
        config_json,
        str(output_rds),
    ]

    # Append optional global proteome args (when available)
    if protein_inputs:
        # Combine protein files if multiple
        if len(protein_inputs) == 1:
            protein_input_csv = protein_inputs[0]
        else:
            protein_combined = ctx.results_dir / "protein_combined.tsv"
            logger.info(
                "Combining %d global proteome files into %s",
                len(protein_inputs), protein_combined,
            )
            dfs = []
            for f in protein_inputs:
                df = await asyncio.to_thread(pd.read_csv, f, sep="\t")
                dfs.append(df)
            combined = pd.concat(dfs, ignore_index=True)
            await asyncio.to_thread(combined.to_csv, str(protein_combined), sep="\t", index=False)
            protein_input_csv = protein_combined

        cmd.append(str(protein_input_csv))
        cmd.append(str(annotation_csv))  # reuse same annotation

    # --- Run R script ---
    log_callback = create_log_callback(ctx, step=2)

    try:
        result = await asyncio.to_thread(
            subprocess.run,
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=settings.r_ptm_summarization_timeout * ctx.timeout_multiplier,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise RScriptError(
            message=f"PTM summarization timed out after "
                    f"{settings.r_ptm_summarization_timeout * ctx.timeout_multiplier}s",
            details={
                "timeout": settings.r_ptm_summarization_timeout,
                "multiplier": ctx.timeout_multiplier,
            },
        ) from None

    # Log R stdout/stderr via the pipeline log callback
    if result.stdout:
        for line in result.stdout.splitlines():
            log_callback("info", line)
    if result.stderr:
        for line in result.stderr.splitlines():
            log_callback("error", line)

    # Check exit code and output file
    if result.returncode != 0:
        raise RScriptError(
            message="PTM summarization R script failed",
            details={
                "returncode": result.returncode,
                "stderr": result.stderr[:1000] if result.stderr else "",
            },
        )

    if not output_rds.exists():
        raise RScriptError(
            message="PTM summarization RDS file not created",
            details={"expected": str(output_rds)},
        )

    # --- Store outputs ---
    ctx.state.add_log("info", "PTM summarization complete")
    ctx.step_outputs["rds_file"] = output_rds
