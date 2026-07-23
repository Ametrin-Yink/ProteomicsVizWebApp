"""Shared utilities for pipeline step handlers."""

import asyncio
import logging
from collections.abc import Callable
from pathlib import Path

import duckdb

from app.core.config import settings
from app.core.exceptions import ProcessingError
from app.models.analysis import Organism

logger = logging.getLogger("proteomics")


def get_gene_mapping(organism: Organism | None) -> Path | None:
    """Get gene mapping file for organism."""
    if not organism or not settings.protein_database_dir:
        return None
    if organism == Organism.HUMAN:
        return settings.protein_database_dir / "Human_GeneName.tsv"
    elif organism == Organism.MOUSE:
        return settings.protein_database_dir / "Mouse_GeneName.tsv"
    return None


def get_psm_input(ctx, step: int = 5) -> Path:
    """Get the PSM input file path for R steps."""
    if not ctx.psm_file_path:
        raise ProcessingError("PSM file not saved", step=step)
    return ctx.psm_file_path


def build_comparison_label(group: dict) -> str:
    """Build a comparison label from a group dict like {'Condition': 'Treated'}.

    Used by DE step handlers to construct Diff_Expression_{label}.tsv filenames.
    """
    return "+".join(str(v) for v in group.values())


def build_comparison_pair_label(comparison: dict) -> str:
    """Build a filename label for current and legacy comparison formats."""
    if "group1" in comparison and "group2" in comparison:
        return (
            f"{build_comparison_label(comparison['group1'])}_vs_"
            f"{build_comparison_label(comparison['group2'])}"
        )
    if "treatment" in comparison and "control" in comparison:
        return f"{comparison['treatment']}_vs_{comparison['control']}"
    raise ValueError("Comparison must define group1/group2 or treatment/control")


def differential_output_paths(results_dir: Path) -> list[Path]:
    """Return the consolidated differential outputs produced by current R jobs."""
    return sorted(results_dir.glob("Differential_Results_*.tsv"))


def primary_differential_output(results_dir: Path, *, batched: bool) -> Path:
    filename = (
        "Differential_Results_Shard_00000.tsv"
        if batched
        else "Differential_Results_Long.tsv"
    )
    return results_dir / filename


def count_significant_differential(paths: list[Path], threshold: float) -> int:
    """Count significant rows without materializing differential tables in Python."""
    if not paths:
        return 0
    connection = duckdb.connect()
    try:
        row = connection.execute(
            "SELECT count(*) FROM read_csv_auto(?, delim='\\t', header=true, "
            "union_by_name=true, nullstr=['NA', 'NaN']) WHERE adjPval < ?",
            [[str(path) for path in paths], threshold],
        ).fetchone()
    finally:
        connection.close()
    return int(row[0]) if row else 0


def create_log_callback(ctx, step: int) -> Callable:
    """Create a log callback for R script stdout/stderr streaming.

    Returns a SYNC function safe for background thread calls.
    Uses call_soon_threadsafe to schedule WebSocket sends on the event loop.
    """

    def _log_callback(level: str, message: str) -> None:
        # Sync: write to pipeline state file
        if ctx.state:
            ctx.state.add_log(level, message, step)

        # Async: schedule WebSocket send on the running event loop
        from app.services.session_manager import session_manager

        try:
            loop = asyncio.get_running_loop()
            loop.call_soon_threadsafe(
                lambda: asyncio.create_task(
                    session_manager.send_log_message(
                        session_id=ctx.session_id,
                        level=level,
                        message=message,
                        step=step,
                    )
                )
            )
        except RuntimeError:
            pass

    return _log_callback
