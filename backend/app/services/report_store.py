"""
Report storage service.

Manages a global reports directory independent of session lifecycle.
Reports are self-contained directories with session data + metadata.
"""

import json
import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.core.config import settings

logger = logging.getLogger("proteomics")

REPORTS_DIR = settings.base_dir / "reports"


def _reports_dir() -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return REPORTS_DIR


def create_report(name: str, session_id: str, session_name: str) -> dict:
    """Create a report directory with metadata. Returns metadata dict.

    Does NOT copy session files — that's done by report_generator.
    """
    report_id = f"rpt_{uuid.uuid4().hex[:12]}"
    report_dir = _reports_dir() / report_id
    report_dir.mkdir(parents=True, exist_ok=True)

    metadata = {
        "report_id": report_id,
        "name": name,
        "session_id": session_id,
        "session_name": session_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (report_dir / "report.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )

    logger.info(f"Report created: {report_id} ({name})")
    return metadata


def list_reports() -> list[dict]:
    """List all reports sorted by creation time (newest first)."""
    rd = _reports_dir()
    if not rd.exists():
        return []

    reports = []
    for report_dir in sorted(rd.iterdir(), key=lambda p: p.name, reverse=True):
        if not report_dir.is_dir():
            continue
        meta_path = report_dir / "report.json"
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                reports.append(meta)
            except Exception:
                logger.warning(f"Corrupt report metadata: {meta_path}")

    reports.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return reports


def get_report_dir(report_id: str) -> Optional[Path]:
    """Get report directory path, validating it exists."""
    rd = _reports_dir()
    report_dir = rd / report_id
    if report_dir.is_dir() and (report_dir / "report.json").exists():
        return report_dir
    return None


def get_report_metadata(report_id: str) -> Optional[dict]:
    """Get report metadata dict."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return None
    return json.loads((report_dir / "report.json").read_text(encoding="utf-8"))


def get_report_session(report_id: str) -> Optional[dict]:
    """Get the report's session.json content (config, markers, filters)."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return None
    session_path = report_dir / "session.json"
    if not session_path.exists():
        return None
    return json.loads(session_path.read_text(encoding="utf-8"))


def patch_report_state(
    report_id: str,
    markers: Optional[dict] = None,
    volcano_filters: Optional[dict] = None,
) -> bool:
    """Update markers and/or volcano_filters in the report's session.json."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return False
    session_path = report_dir / "session.json"
    if not session_path.exists():
        return False
    session_data = json.loads(session_path.read_text(encoding="utf-8"))
    if markers is not None:
        session_data["markers"] = markers
    if volcano_filters is not None:
        session_data["volcano_filters"] = volcano_filters
    session_path.write_text(json.dumps(session_data, indent=2), encoding="utf-8")
    return True


def delete_report(report_id: str) -> bool:
    """Delete a report directory. Returns True if deleted, False if not found."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return False
    shutil.rmtree(report_dir)
    logger.info(f"Report deleted: {report_id}")
    return True
