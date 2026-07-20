"""PTM stage 4: summarize explicit TMT feature tables with MSstatsPTM."""

import asyncio
import json
import subprocess

from app.core.config import settings
from app.core.exceptions import RScriptError
from app.services.pipeline_engine import StepContext
from app.services.ptm_wrapper import ptm_wrapper
from app.services.steps._helpers import create_log_callback


async def step_ptm_summarization(ctx: StepContext) -> None:
    ptm_input = ctx.step_outputs.get("ptm_input_path")
    if ptm_input is None:
        raise ValueError("No site-level PTM input from stage 3")
    protein_input = ctx.step_outputs.get("protein_input_path")
    output_rds = ctx.results_dir / "ptm_summarized.rds"
    has_reference = any(
        str(values.get("role", values.get("channel_role", "Sample"))).lower()
        in {"reference", "reference/bridge", "bridge", "norm"}
        for values in (ctx.config.tmt_channel_mapping or {}).values()
    )
    config = {
        "imputation": ctx.config.ptm_imputation,
        "has_reference": has_reference,
    }
    command = [
        ptm_wrapper.r_executable,
        str(ptm_wrapper.scripts_dir / "ptm_summarization.R"),
        str(ptm_input),
        str(protein_input) if protein_input else "",
        json.dumps(config),
        str(output_rds),
        str(ctx.results_dir),
    ]
    callback = create_log_callback(ctx, step=ctx.current_step_number)
    try:
        result = await asyncio.to_thread(
            subprocess.run,
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=settings.r_ptm_summarization_timeout * ctx.timeout_multiplier,
            check=False,
        )
    except subprocess.TimeoutExpired as e:
        raise RScriptError(message="PTM summarization timed out") from e
    for line in result.stdout.splitlines():
        callback("info", line)
    for line in result.stderr.splitlines():
        callback("error", line)
    if result.returncode != 0 or not output_rds.exists():
        raise RScriptError(
            message="PTM summarization R script failed",
            details={"returncode": result.returncode, "stderr": result.stderr[-2000:]},
        )
    ctx.step_outputs["rds_file"] = output_rds
    ctx.step_outputs[ctx.current_step_number] = output_rds
    ctx.state.add_log(
        "info", "PTM summarization complete", step=ctx.current_step_number
    )
