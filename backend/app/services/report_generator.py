"""
Report generator service.

Copies session files into a report directory at export time.
Uses a blacklist approach: session directory is copied in full,
excluding only uploads/ and pipeline_state.json.
"""

import json
import logging
import shutil
from pathlib import Path

from app.core.config import settings
from app.services.report_store import get_report_staging_dir

logger = logging.getLogger("proteomics")

EXCLUDED_NAMES = {"uploads", "pipeline_state.json"}


def _copytree_blacklist(src: Path, dst: Path) -> None:
    """Recursively copy src to dst, skipping EXCLUDED_NAMES."""
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        if item.name in EXCLUDED_NAMES:
            logger.debug(f"Skipping excluded: {item}")
            continue
        dest = dst / item.name
        if item.is_dir():
            _copytree_blacklist(item, dest)
        else:
            shutil.copy2(item, dest)


def generate_report(session_id: str, report_id: str) -> None:
    """Copy session files into the report directory.

    Reads session state from session.json to verify the session is completed.
    Copies everything except uploads/ and pipeline_state.json.

    Raises:
        ValueError: if session is not found or not completed.
    """
    session_dir = settings.sessions_dir / session_id
    if not session_dir.is_dir():
        raise ValueError(f"Session not found: {session_id}")

    session_json_path = session_dir / "session.json"
    if not session_json_path.exists():
        raise ValueError(f"Session {session_id} has no session.json")

    session_data = json.loads(session_json_path.read_text(encoding="utf-8"))
    state = session_data.get("state", "")
    if state != "completed":
        raise ValueError(
            f"Session {session_id} is not completed (state={state}). "
            "Only completed sessions can be exported."
        )

    report_dir = get_report_staging_dir(report_id)
    if not report_dir.is_dir():
        raise ValueError(f"Report directory not found: {report_id}")

    logger.info(f"Copying session {session_id} to report {report_id}")

    _copytree_blacklist(session_dir, report_dir)

    logger.info(f"Report {report_id} populated with session data")
