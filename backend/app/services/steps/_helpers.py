"""Shared utilities for pipeline step handlers."""

import asyncio
import logging
from pathlib import Path
from typing import Callable

from app.core.config import settings
from app.models.analysis import Organism
from app.core.exceptions import ProcessingError

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


def get_psm_input(ctx) -> Path:
    """Get the PSM input file path for R steps."""
    if not ctx.psm_file_path:
        raise ProcessingError("PSM file not saved", step=5)
    return ctx.psm_file_path


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
