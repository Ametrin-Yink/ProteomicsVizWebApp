"""
Unit tests for report_store service (post-redesign).
"""

import json
from pathlib import Path

import pytest


@pytest.fixture
def temp_reports_dir(monkeypatch, tmp_path):
    """Redirect reports dir to a temp path."""
    from app.core import config

    monkeypatch.setattr(config.settings, "base_dir", tmp_path)
    import app.services.report_store as store

    monkeypatch.setattr(store, "REPORTS_DIR", tmp_path / "reports")
    yield tmp_path / "reports"


def seed_session_json(
    report_dir: Path, session_id="ses_123", session_name="Experiment A"
):
    """Write a session.json into the report directory (simulating export copy)."""
    report_dir.mkdir(parents=True, exist_ok=True)

    session_json = {
        "id": session_id,
        "name": session_name,
        "template": "multi_condition_comparison",
        "state": "completed",
        "config": {
            "experiment_name": session_name,
            "conditions": ["Treatment", "Control"],
            "comparisons": [
                {
                    "group1": {"Condition": "Treatment"},
                    "group2": {"Condition": "Control"},
                }
            ],
        },
        "markers": {},
        "volcano_filters": {"foldChange": 1, "pValue": 0.05, "adjPValue": 1, "s0": 0.1},
    }
    (report_dir / "session.json").write_text(json.dumps(session_json, indent=2))


def test_create_report_writes_metadata(temp_reports_dir):
    """create_report writes report.json and returns metadata dict."""
    from app.services.report_store import create_report, list_reports

    meta = create_report(
        name="My Report",
        session_id="ses_abc",
        session_name="Experiment X",
    )

    assert meta["name"] == "My Report"
    assert meta["session_id"] == "ses_abc"
    assert meta["report_id"].startswith("rpt_")
    assert len(meta["report_id"]) == 36
    assert len(meta["share_token"]) == 43
    assert "created_at" in meta

    # New reports remain hidden in staging until publication is complete.
    report_dir = temp_reports_dir / f'.{meta["report_id"]}.staging'
    assert report_dir.is_dir()
    assert (report_dir / "report.json").exists()

    stored = json.loads((report_dir / "report.json").read_text())
    assert stored["name"] == "My Report"
    assert list_reports() == []


def test_list_reports_empty(temp_reports_dir):
    from app.services.report_store import list_reports

    assert list_reports() == []


def test_list_reports_sorted(temp_reports_dir):
    import time

    from app.services.report_store import create_report, list_reports, publish_report

    m1 = create_report("A", "s1", "E1")
    publish_report(m1["report_id"])
    time.sleep(0.1)
    m2 = create_report("B", "s2", "E2")
    publish_report(m2["report_id"])

    reports = list_reports()
    assert len(reports) == 2
    assert reports[0]["report_id"] == m2["report_id"]  # newest first


def test_get_report_dir(temp_reports_dir):
    from app.services.report_store import create_report, get_report_dir, publish_report

    meta = create_report("R", "s1", "E1")
    publish_report(meta["report_id"])
    rd = get_report_dir(meta["report_id"])
    assert rd is not None
    assert rd.is_dir()


def test_get_report_dir_nonexistent(temp_reports_dir):
    from app.services.report_store import get_report_dir

    assert get_report_dir("rpt_nonexistent") is None


def test_delete_report(temp_reports_dir):
    from app.services.report_store import (
        create_report,
        delete_report,
        get_report_dir,
        publish_report,
    )

    meta = create_report("R", "s1", "E1")
    publish_report(meta["report_id"])
    assert delete_report(meta["report_id"]) is True
    assert get_report_dir(meta["report_id"]) is None


def test_delete_nonexistent(temp_reports_dir):
    from app.services.report_store import delete_report

    assert delete_report("rpt_nonexistent") is False


def test_get_report_metadata(temp_reports_dir):
    from app.services.report_store import (
        create_report,
        get_report_metadata,
        publish_report,
    )

    meta = create_report("R", "s1", "E1")
    publish_report(meta["report_id"])
    stored = get_report_metadata(meta["report_id"])
    assert stored == meta


def test_patch_report_state_writes_to_session_json(temp_reports_dir):
    """PATCH visualization-state updates markers in the report's session.json."""
    from app.services.report_store import (
        create_report,
        get_report_staging_dir,
        patch_report_state,
        publish_report,
    )

    meta = create_report("R", "ses_src", "Exp")
    report_dir = get_report_staging_dir(meta["report_id"])
    # Simulate export: write a session.json into the report
    seed_session_json(report_dir, session_id="ses_src")
    publish_report(meta["report_id"])
    report_dir = temp_reports_dir / meta["report_id"]

    patch_report_state(meta["report_id"], markers={"comp_a": ["P12345"]})
    session_json = json.loads((report_dir / "session.json").read_text())
    assert session_json["markers"] == {"comp_a": ["P12345"]}


def test_patch_report_state_volcano_filters(temp_reports_dir):
    from app.services.report_store import (
        create_report,
        get_report_staging_dir,
        patch_report_state,
        publish_report,
    )

    meta = create_report("R", "ses_filter_test", "Exp")
    report_dir = get_report_staging_dir(meta["report_id"])
    seed_session_json(report_dir, session_id="ses_filter_test")
    publish_report(meta["report_id"])
    report_dir = temp_reports_dir / meta["report_id"]

    new_filters = {"foldChange": 2, "pValue": 0.01, "adjPValue": 0.05, "s0": 0.2}
    patch_report_state(meta["report_id"], volcano_filters=new_filters)
    session_json = json.loads((report_dir / "session.json").read_text())
    assert session_json["volcano_filters"] == new_filters


def test_get_report_session_json(temp_reports_dir):
    from app.services.report_store import (
        create_report,
        get_report_session,
        get_report_staging_dir,
        publish_report,
    )

    meta = create_report("R", "ses_src", "Exp")
    report_dir = get_report_staging_dir(meta["report_id"])
    seed_session_json(report_dir, session_name="My Experiment")
    publish_report(meta["report_id"])

    session_data = get_report_session(meta["report_id"])
    assert session_data is not None
    assert session_data["config"]["experiment_name"] == "My Experiment"
    assert session_data["config"]["comparisons"] == [
        {"group1": {"Condition": "Treatment"}, "group2": {"Condition": "Control"}}
    ]


def test_get_report_session_nonexistent(temp_reports_dir):
    from app.services.report_store import get_report_session

    assert get_report_session("rpt_nonexistent") is None


def test_get_report_session_missing_file(temp_reports_dir):
    """get_report_session returns None if session.json doesn't exist."""
    from app.services.report_store import (
        create_report,
        get_report_session,
        publish_report,
    )

    meta = create_report("R", "s1", "E1")
    publish_report(meta["report_id"])
    # Don't write session.json - report.json exists but no session data
    session_data = get_report_session(meta["report_id"])
    assert session_data is None


def test_patch_report_state_nonexistent(temp_reports_dir):
    """patch_report_state returns False for nonexistent report."""
    from app.services.report_store import patch_report_state

    assert patch_report_state("rpt_nonexistent", markers={"a": ["P1"]}) is False


def test_patch_report_state_missing_session_json(temp_reports_dir):
    """patch_report_state returns False if session.json doesn't exist."""
    from app.services.report_store import (
        create_report,
        patch_report_state,
        publish_report,
    )

    meta = create_report("R", "s1", "E1")
    publish_report(meta["report_id"])
    # report.json exists but no session.json was written
    assert patch_report_state(meta["report_id"], markers={"a": ["P1"]}) is False


def test_share_token_resolves_and_rotates(temp_reports_dir):
    from app.services.report_store import (
        create_report,
        get_report_by_share_token,
        publish_report,
        rotate_share_token,
    )

    meta = create_report("R", "s1", "E1")
    publish_report(meta["report_id"])

    report_id, _report_dir, stored = get_report_by_share_token(meta["share_token"])
    assert report_id == meta["report_id"]
    assert stored["name"] == "R"

    rotated = rotate_share_token(meta["report_id"])
    assert rotated is not None
    assert rotated != meta["share_token"]
    assert get_report_by_share_token(meta["share_token"]) is None
    assert get_report_by_share_token(rotated)[0] == meta["report_id"]
