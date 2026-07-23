"""Filesystem transaction helpers for in-place session reprocessing."""

from __future__ import annotations

import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Any


def directory_size(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def preflight_reprocess_space(session_dir: Path) -> None:
    """Require enough free space for old and staged results to coexist."""
    results_dir = session_dir / "results"
    current_size = directory_size(results_dir) if results_dir.is_dir() else 0
    required = int(current_size * 1.1)
    available = shutil.disk_usage(session_dir).free
    if available < required:
        raise ValueError(
            f"Insufficient free space for reprocessing: {required} bytes required, "
            f"{available} bytes available"
        )


def commit_staged_results(session_dir: Path, staged_results: Path) -> None:
    """Publish validated staged results and restore the old directory on failure."""
    session_dir = session_dir.resolve()
    staged_results = staged_results.resolve()
    if session_dir not in staged_results.parents:
        raise ValueError("Staged results must remain inside the session directory")
    if not staged_results.is_dir():
        raise ValueError("Staged results directory does not exist")
    current_results = session_dir / "results"
    backup = session_dir / f".results-backup-{uuid.uuid4().hex}"
    if current_results.exists():
        os.replace(current_results, backup)
    try:
        os.replace(staged_results, current_results)
    except Exception:
        if backup.exists():
            os.replace(backup, current_results)
        raise
    else:
        if backup.exists():
            shutil.rmtree(backup)


def clear_saved_analysis_state(session_dir: Path) -> None:
    """Remove saved on-demand outputs only after new pipeline results commit."""
    status_file = session_dir / "gsea_run_status.json"
    status_file.unlink(missing_ok=True)
    bionet_dir = session_dir / "bionet"
    if bionet_dir.is_dir():
        shutil.rmtree(bionet_dir)


def write_reprocess_status(session_dir: Path, data: dict[str, Any]) -> None:
    path = session_dir / "reprocess_status.json"
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
