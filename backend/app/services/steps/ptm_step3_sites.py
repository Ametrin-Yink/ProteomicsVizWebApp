"""PTM stage 3: create site-centric MSstatsPTM inputs."""

import asyncio

from app.services.pipeline_engine import StepContext
from app.services.ptm_tmt_processor import build_ptm_site_inputs


async def step_ptm_build_sites(ctx: StepContext) -> None:
    target = ctx.config.ptm_target_modification
    if not target:
        raise ValueError("Target modification is required")

    outputs = await asyncio.to_thread(
        build_ptm_site_inputs,
        ctx.step_outputs["ptm_long_path"],
        ctx.results_dir,
        target_modification=target,
        fasta_path=ctx.step_outputs["fasta_path"],
        channel_mapping=ctx.config.tmt_channel_mapping,
        normalization_method=ctx.config.ptm_normalization_method,
        max_missing_fraction=ctx.config.max_missing_fraction_per_condition,
        protein_long_path=ctx.step_outputs.get("protein_long_path"),
    )
    ctx.step_outputs.update(outputs)
    ctx.step_outputs[ctx.current_step_number] = outputs["ptm_input_path"]
    ctx.result.total_proteins = int(outputs["passing_site_count"])
    ctx.state.add_log(
        "info",
        f"Built {outputs['passing_site_count']} PTM site features",
        step=ctx.current_step_number,
    )
