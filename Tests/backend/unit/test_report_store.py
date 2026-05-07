"""
Unit tests for report_store service.
"""

import io
import json
import zipfile
import tempfile
import shutil
from pathlib import Path
import pytest


@pytest.fixture
def temp_reports_dir(monkeypatch, tmp_path):
    """Redirect reports dir to a temp path."""
    from app.core import config
    monkeypatch.setattr(config.settings, "base_dir", tmp_path)
    # Also patch the module-level REPORTS_DIR
    import app.services.report_store as store
    monkeypatch.setattr(store, "REPORTS_DIR", tmp_path / "reports")
    yield tmp_path / "reports"


def make_test_zip() -> bytes:
    """Create a minimal valid report ZIP."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("index.html", "<html><body>Test Report</body></html>")
        zf.writestr("assets/data.json", '{"test": true}')
    return buf.getvalue()


def test_create_report_creates_directory_and_metadata(temp_reports_dir):
    from app.services.report_store import create_report, get_report_metadata

    zip_data = make_test_zip()
    meta = create_report("Test Report", "ses_123", "Experiment A", zip_data)

    assert meta["name"] == "Test Report"
    assert meta["session_id"] == "ses_123"
    assert meta["report_id"].startswith("rpt_")
    assert "created_at" in meta

    # Verify on-disk state
    report_dir = temp_reports_dir / meta["report_id"]
    assert report_dir.is_dir()
    assert (report_dir / "index.html").exists()
    assert (report_dir / "assets" / "data.json").exists()
    assert (report_dir / "export.zip").exists()
    assert (report_dir / "report.json").exists()

    stored = get_report_metadata(meta["report_id"])
    assert stored == meta


def test_create_report_rejects_missing_index_html(temp_reports_dir):
    from app.services.report_store import create_report

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("other.txt", "no index here")
    zip_data = buf.getvalue()

    with pytest.raises(ValueError, match="index.html"):
        create_report("Bad", "ses_x", "Exp", zip_data)


def test_create_report_rejects_path_traversal(temp_reports_dir):
    from app.services.report_store import create_report

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("index.html", "<html></html>")
        zf.writestr("../../../etc/passwd", "malicious")
    zip_data = buf.getvalue()

    with pytest.raises(ValueError, match="Unsafe"):
        create_report("Bad", "ses_x", "Exp", zip_data)


def test_list_reports_empty(temp_reports_dir):
    from app.services.report_store import list_reports
    assert list_reports() == []


def test_list_reports_sorted(temp_reports_dir):
    from app.services.report_store import create_report, list_reports
    import time

    zip_data = make_test_zip()
    m1 = create_report("Report 1", "s1", "E1", zip_data)
    time.sleep(0.1)
    m2 = create_report("Report 2", "s2", "E2", zip_data)

    reports = list_reports()
    assert len(reports) == 2
    assert reports[0]["report_id"] == m2["report_id"]  # newest first


def test_delete_report(temp_reports_dir):
    from app.services.report_store import create_report, delete_report, get_report_dir

    zip_data = make_test_zip()
    meta = create_report("R", "s1", "E1", zip_data)

    assert delete_report(meta["report_id"]) is True
    assert get_report_dir(meta["report_id"]) is None


def test_delete_nonexistent_report(temp_reports_dir):
    from app.services.report_store import delete_report
    assert delete_report("rpt_nonexistent") is False
