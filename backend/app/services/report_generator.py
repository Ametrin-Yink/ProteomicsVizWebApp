"""
Report generator service.

Copies session files into a report directory at export time.
Uses a blacklist approach: session directory is copied in full,
excluding only uploads/ and pipeline_state.json.
"""

import json
import logging
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import settings
from app.services.report_store import (
    discard_staged_report,
    get_report_staging_dir,
    list_reports,
    replace_report,
)
from app.services.visualization_artifacts import (
    COMPARISON_CATALOG,
    DIFFERENTIAL_ARTIFACT,
    PEPTIDE_ARTIFACT,
    PROTEIN_ARTIFACT,
    QC_COMPARISON_METRICS,
    QC_GROUP_METRICS,
    QC_PCA,
    QC_SAMPLE_METRICS,
    SAMPLE_CATALOG,
)

logger = logging.getLogger("proteomics")

EXCLUDED_NAMES = {"uploads", "pipeline_state.json"}
IMMUTABLE_RESULT_NAMES = {
    PROTEIN_ARTIFACT,
    PEPTIDE_ARTIFACT,
    SAMPLE_CATALOG,
    COMPARISON_CATALOG,
    DIFFERENTIAL_ARTIFACT,
    QC_SAMPLE_METRICS,
    QC_GROUP_METRICS,
    QC_COMPARISON_METRICS,
    QC_PCA,
}


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
            if item.name in IMMUTABLE_RESULT_NAMES:
                try:
                    os.link(item, dest)
                    continue
                except OSError:
                    pass
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


def refresh_reports_for_session(session_id: str) -> list[dict[str, str]]:
    """Stage and replace all reports sourced from one completed session."""
    failures: list[dict[str, str]] = []
    for metadata in list_reports():
        if metadata.get("session_id") != session_id:
            continue
        report_id = metadata["report_id"]
        try:
            discard_staged_report(report_id)
            staging_dir = get_report_staging_dir(report_id)
            staging_dir.mkdir(parents=True)
            generate_report(session_id, report_id)
            refreshed = dict(metadata)
            refreshed["refreshed_at"] = datetime.now(UTC).isoformat()
            (staging_dir / "report.json").write_text(
                json.dumps(refreshed, indent=2), encoding="utf-8"
            )
            replace_report(report_id)
        except Exception as error:
            discard_staged_report(report_id)
            logger.exception("Failed to refresh report %s", report_id)
            failures.append({"report_id": report_id, "error": str(error)})
    return failures
