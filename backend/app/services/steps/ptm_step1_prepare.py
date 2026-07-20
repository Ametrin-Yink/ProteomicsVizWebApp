"""PTM stage 1: filter and melt real PD TMT PSM exports."""

import asyncio
import json

from app.core.config import settings
from app.db.session_store import SessionStore
from app.services.pipeline_engine import StepContext
from app.services.ptm_tmt_processor import prepare_pd_tmt_long


async def step_ptm_prepare_data(ctx: StepContext) -> None:
    if len(ctx.file_paths) != 1:
        raise ValueError("PTM analysis requires exactly one enriched PTM file")
    if not ctx.config.tmt_channel_mapping:
        raise ValueError("TMT channel metadata is required for PTM analysis")

    store = SessionStore(settings.sessions_dir)
    session = await store.get(ctx.session_id)
    if session is None:
        raise ValueError(f"Session {ctx.session_id} not found")

    ptm_long = ctx.results_dir / "ptm_filtered_long.parquet"
    ptm_metrics = await asyncio.to_thread(
        prepare_pd_tmt_long,
        ctx.file_paths[0],
        ptm_long,
        ctx.config.tmt_channel_mapping,
        role="ptm",
    )

    protein_long = None
    protein_metrics = None
    if session.files.global_proteome:
        protein_path = ctx.uploads_dir / session.files.global_proteome[0].filename
        protein_long = ctx.results_dir / "protein_filtered_long.parquet"
        protein_metrics = await asyncio.to_thread(
            prepare_pd_tmt_long,
            protein_path,
            protein_long,
            ctx.config.tmt_channel_mapping,
            role="protein",
        )

    fasta_source = ctx.config.ptm_fasta_source
    if fasta_source == "custom":
        if not session.files.fasta:
            raise ValueError("Custom FASTA file is missing")
        fasta_path = ctx.uploads_dir / session.files.fasta[0].filename
    else:
        filename = (
            "Human_Sequence.fasta"
            if fasta_source == "human"
            else "Mouse_Sequence.fasta"
        )
        fasta_path = settings.protein_database_dir / filename
    if not fasta_path.exists():
        raise ValueError(f"FASTA file not found: {fasta_path}")

    metrics_path = ctx.results_dir / "ptm_filter_metrics.json"
    metrics_path.write_text(
        json.dumps({"ptm": ptm_metrics, "protein": protein_metrics}, indent=2),
        encoding="utf-8",
    )
    ctx.psm_file_path = ptm_long
    ctx.result.total_psms = int(ptm_metrics["quality_filtered_psms"])
    ctx.step_outputs.update(
        {
            "ptm_long_path": ptm_long,
            "protein_long_path": protein_long,
            "fasta_path": fasta_path,
            "filter_metrics_path": metrics_path,
            ctx.current_step_number: ptm_long,
        }
    )
    ctx.state.add_log(
        "info",
        f"PTM quality filtering retained {ptm_metrics['quality_filtered_psms']} PSMs",
        step=ctx.current_step_number,
    )
