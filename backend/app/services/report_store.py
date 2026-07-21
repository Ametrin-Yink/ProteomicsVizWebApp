"""
Report storage service.

Manages a global reports directory independent of session lifecycle.
Reports are self-contained directories with session data + metadata.
"""

import json
import logging
import os
import re
import secrets
import shutil
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger("proteomics")

REPORTS_DIR = settings.reports_dir
REPORT_ID_RE = re.compile(r"^rpt_(?:[0-9a-f]{12}|[0-9a-f]{32})$")
SHARE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")


def _atomic_write_json(path: Path, data: dict) -> None:
    """Write JSON atomically in the destination directory."""
    temp_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temp_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        os.replace(temp_path, path)
    finally:
        temp_path.unlink(missing_ok=True)


def _new_share_token() -> str:
    """Return a 256-bit URL-safe report capability token."""
    return secrets.token_urlsafe(32)


def _reports_dir() -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return REPORTS_DIR


def create_report(name: str, session_id: str, session_name: str) -> dict:
    """Create a staged report directory with metadata.

    Does NOT copy session files — that's done by report_generator.
    """
    report_id = f"rpt_{uuid.uuid4().hex}"
    report_dir = get_report_staging_dir(report_id)
    report_dir.mkdir(parents=True, exist_ok=True)

    metadata = {
        "report_id": report_id,
        "name": name,
        "session_id": session_id,
        "session_name": session_name,
        "created_at": datetime.now(UTC).isoformat(),
        "share_token": _new_share_token(),
    }
    _atomic_write_json(report_dir / "report.json", metadata)

    logger.info(f"Report created: {report_id} ({name})")
    return metadata


def list_reports() -> list[dict]:
    """List all reports sorted by creation time (newest first)."""
    rd = _reports_dir()
    if not rd.exists():
        return []

    reports = []
    for report_dir in rd.iterdir():
        if not report_dir.is_dir() or not REPORT_ID_RE.fullmatch(report_dir.name):
            continue
        meta_path = report_dir / "report.json"
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                if not SHARE_TOKEN_RE.fullmatch(meta.get("share_token", "")):
                    meta["share_token"] = _new_share_token()
                    _atomic_write_json(meta_path, meta)
                reports.append(meta)
            except Exception:
                logger.warning(f"Corrupt report metadata: {meta_path}")

    reports.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return reports


def get_report_dir(report_id: str) -> Path | None:
    """Get report directory path, validating it exists."""
    if not REPORT_ID_RE.fullmatch(report_id):
        return None
    rd = _reports_dir()
    report_dir = rd / report_id
    if report_dir.is_dir() and (report_dir / "report.json").exists():
        return report_dir
    return None


def get_report_staging_dir(report_id: str) -> Path:
    """Return the unpublished staging directory for a valid report ID."""
    if not REPORT_ID_RE.fullmatch(report_id):
        raise ValueError("Invalid report ID")
    return _reports_dir() / f".{report_id}.staging"


def publish_report(report_id: str) -> Path:
    """Atomically publish a fully generated report."""
    staging_dir = get_report_staging_dir(report_id)
    report_dir = _reports_dir() / report_id
    if not staging_dir.is_dir():
        raise ValueError(f"Staged report not found: {report_id}")
    if report_dir.exists():
        raise FileExistsError(f"Report already exists: {report_id}")
    # Windows file scanners can briefly hold a newly written directory open.
    # Linux normally succeeds on the first attempt.
    for attempt in range(5):
        try:
            os.replace(staging_dir, report_dir)
            break
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.05)
    return report_dir


def discard_staged_report(report_id: str) -> None:
    """Remove an incomplete staged report."""
    staging_dir = get_report_staging_dir(report_id)
    if staging_dir.exists():
        shutil.rmtree(staging_dir)


def get_report_by_share_token(share_token: str) -> tuple[str, Path, dict] | None:
    """Resolve a share capability without exposing internal report listing."""
    if not SHARE_TOKEN_RE.fullmatch(share_token):
        return None
    for report_dir in _reports_dir().iterdir():
        if not report_dir.is_dir() or not REPORT_ID_RE.fullmatch(report_dir.name):
            continue
        meta_path = report_dir / "report.json"
        if not meta_path.exists():
            continue
        try:
            metadata = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        stored_token = metadata.get("share_token", "")
        if isinstance(stored_token, str) and secrets.compare_digest(
            stored_token, share_token
        ):
            return report_dir.name, report_dir, metadata
    return None


def rotate_share_token(report_id: str) -> str | None:
    """Replace a report's share capability and return the new token."""
    report_dir = get_report_dir(report_id)
    if report_dir is None:
        return None
    meta_path = report_dir / "report.json"
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    metadata["share_token"] = _new_share_token()
    _atomic_write_json(meta_path, metadata)
    return metadata["share_token"]


def get_report_metadata(report_id: str) -> dict | None:
    """Get report metadata dict."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return None
    return json.loads((report_dir / "report.json").read_text(encoding="utf-8"))


def get_report_session(report_id: str) -> dict | None:
    """Get the report's session.json content (config, markers, filters)."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return None
    session_path = report_dir / "session.json"
    if not session_path.exists():
        return None
    try:
        return json.loads(session_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        logger.warning(f"Corrupt session.json in report: {report_id}")
        return None


def patch_report_state(
    report_id: str,
    markers: dict | None = None,
    volcano_filters: dict | None = None,
) -> bool:
    """Update markers and/or volcano_filters in the report's session.json."""
    if markers is None and volcano_filters is None:
        return False
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return False
    session_path = report_dir / "session.json"
    if not session_path.exists():
        return False
    try:
        session_data = json.loads(session_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        logger.warning(f"Corrupt session.json in report: {report_id}")
        return False
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
