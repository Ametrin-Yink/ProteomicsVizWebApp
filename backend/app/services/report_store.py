"""
Report storage service.

Manages a global reports directory independent of session lifecycle.
Each report is a self-contained directory with index.html, assets/, and metadata.
"""

import json
import logging
import shutil
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.core.config import settings

logger = logging.getLogger("proteomics")

REPORTS_DIR = settings.base_dir / "reports"


def _reports_dir() -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return REPORTS_DIR


def create_report(name: str, session_id: str, session_name: str, zip_data: bytes) -> dict:
    """Extract uploaded zip to a new report directory and return metadata."""
    report_id = f"rpt_{uuid.uuid4().hex[:12]}"
    report_dir = _reports_dir() / report_id
    report_dir.mkdir(parents=True, exist_ok=True)

    # Save original zip for download
    zip_path = report_dir / "export.zip"
    zip_path.write_bytes(zip_data)

    # Extract for weblink serving
    try:
        import io
        with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
            # Security: validate no path traversal
            for member in zf.namelist():
                if member.startswith("/") or ".." in member:
                    raise ValueError(f"Unsafe zip entry: {member}")
            zf.extractall(report_dir)

        # Verify index.html exists
        if not (report_dir / "index.html").exists():
            raise ValueError("ZIP missing index.html at root")
    except Exception:
        # Cleanup on failure
        shutil.rmtree(report_dir, ignore_errors=True)
        raise

    # Write metadata
    metadata = {
        "report_id": report_id,
        "name": name,
        "session_id": session_id,
        "session_name": session_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (report_dir / "report.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    logger.info(f"Report created: {report_id} ({name})")
    return metadata


def list_reports() -> list[dict]:
    """List all reports sorted by creation time (newest first)."""
    rd = _reports_dir()
    if not rd.exists():
        return []

    reports = []
    for report_dir in rd.iterdir():
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


def delete_report(report_id: str) -> bool:
    """Delete a report directory. Returns True if deleted, False if not found."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return False
    shutil.rmtree(report_dir)
    logger.info(f"Report deleted: {report_id}")
    return True
