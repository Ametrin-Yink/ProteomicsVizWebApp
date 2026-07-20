"""PTM stage 2: resolve shared peptide groups in both input roles."""

import asyncio

from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext


async def step_ptm_resolve_shared_peptides(ctx: StepContext) -> None:
    if not ctx.config.resolve_shared_peptides:
        ctx.step_outputs[ctx.current_step_number] = ctx.step_outputs["ptm_long_path"]
        ctx.state.add_log(
            "info",
            "Shared-peptide resolution disabled; retained protein groups",
            step=ctx.current_step_number,
        )
        return

    processor = DataProcessor(ProcessingConfig(resolve_shared_peptides=True))
    for key in ("ptm_long_path", "protein_long_path"):
        input_path = ctx.step_outputs.get(key)
        if input_path is None:
            continue
        output_path = input_path.with_name(f"{input_path.stem}_resolved.parquet")
        await asyncio.to_thread(
            processor.step2_resolve_shared_peptides_duckdb,
            input_path,
            output_path,
        )
        ctx.step_outputs[key] = output_path
        if key == "ptm_long_path":
            ctx.psm_file_path = output_path

    ctx.step_outputs[ctx.current_step_number] = ctx.step_outputs["ptm_long_path"]
    ctx.state.add_log(
        "info",
        "Resolved shared peptides without duplicating reporter intensity",
        step=ctx.current_step_number,
    )
