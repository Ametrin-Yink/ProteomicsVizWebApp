"""
Unit tests for report_generator service.
"""

import json
from pathlib import Path

import pytest


@pytest.fixture
def temp_dirs(monkeypatch, tmp_path):
    """Set up temp session and report directories."""
    sessions_dir = tmp_path / "sessions"
    reports_dir = tmp_path / "reports"

    from app.core import config

    monkeypatch.setattr(config.settings, "base_dir", tmp_path)
    monkeypatch.setattr(config.settings, "sessions_dir", sessions_dir)

    import app.services.report_store as store

    monkeypatch.setattr(store, "REPORTS_DIR", reports_dir)

    return sessions_dir, reports_dir


def make_completed_session(sessions_dir: Path, session_id: str) -> Path:
    """Create a minimal completed session directory with result files."""
    session_dir = sessions_dir / session_id
    results_dir = session_dir / "results"
    results_dir.mkdir(parents=True, exist_ok=True)

    session_json = {
        "id": session_id,
        "name": "Test Experiment",
        "state": "completed",
        "config": {
            "experiment_name": "Test Experiment",
            "conditions": ["Treatment", "Control"],
            "comparisons": [
                {
                    "group1": {"Condition": "Treatment"},
                    "group2": {"Condition": "Control"},
                }
            ],
        },
        "markers": {"Treatment_vs_Control": ["P12345"]},
        "volcano_filters": {"foldChange": 1, "pValue": 0.05, "adjPValue": 1, "s0": 0.1},
    }
    (session_dir / "session.json").write_text(json.dumps(session_json, indent=2))

    # pipeline_state.json (should be excluded)
    (session_dir / "pipeline_state.json").write_text(
        '{"current_step": 9, "state": "completed"}'
    )

    # results files
    (results_dir / "Diff_Expression_Treatment_vs_Control.tsv").write_text(
        "Master_Protein_Accessions\tGene_Name\tlogFC\tpval\tadjPval\tPSM_Count\n"
        "P12345\tGENE1\t2.5\t0.001\t0.01\t10\n"
    )
    (results_dir / "Protein_Abundances.tsv").write_text(
        "Master_Protein_Accessions\tGene_Name\tPSM_Count\tSample1\tSample2\n"
        "P12345\tGENE1\t10\t15.2\t14.8\n"
    )
    (results_dir / "QC_Results.json").write_text('{"pca": {"pc1": [1,2,3]}}')
    (results_dir / "PSM_Abundances.parquet").write_bytes(b"fake_parquet")

    # GSEA results
    gsea_dir = results_dir / "gsea" / "Treatment_vs_Control"
    gsea_dir.mkdir(parents=True)
    (gsea_dir / "GSEA_Results.json").write_text('{"go_bp": []}')

    # Compare results
    compare_dir = results_dir / "compare"
    compare_dir.mkdir(parents=True)
    (compare_dir / "comparison-correlation_status.json").write_text(
        '{"status": "completed"}'
    )

    # BioNet
    bionet_dir = session_dir / "bionet"
    bionet_dir.mkdir(parents=True)
    (bionet_dir / "bionet_subnetwork.json").write_text('{"nodes": [], "edges": []}')

    # gsea_run_status.json
    (session_dir / "gsea_run_status.json").write_text(
        '{"Treatment_vs_Control": "completed"}'
    )

    # uploads (should be excluded)
    uploads_dir = session_dir / "uploads"
    uploads_dir.mkdir(parents=True)
    (uploads_dir / "large_file.csv").write_text("big,data,here\n" * 1000)

    return session_dir


def test_generate_copies_all_expected_files(temp_dirs):
    from app.services.report_generator import generate_report
    from app.services.report_store import create_report, get_report_staging_dir

    sessions_dir, _reports_dir = temp_dirs
    session_id = "abc-123-def"
    make_completed_session(sessions_dir, session_id)

    meta = create_report("My Report", session_id, "Test Experiment")
    report_dir = get_report_staging_dir(meta["report_id"])

    generate_report(session_id, meta["report_id"])

    assert (report_dir / "session.json").exists()
    assert (
        report_dir / "results" / "Diff_Expression_Treatment_vs_Control.tsv"
    ).exists()
    assert (report_dir / "results" / "Protein_Abundances.tsv").exists()
    assert (report_dir / "results" / "QC_Results.json").exists()
    assert (report_dir / "results" / "PSM_Abundances.parquet").exists()
    assert (
        report_dir / "results" / "gsea" / "Treatment_vs_Control" / "GSEA_Results.json"
    ).exists()
    assert (
        report_dir / "results" / "compare" / "comparison-correlation_status.json"
    ).exists()
    assert (report_dir / "bionet" / "bionet_subnetwork.json").exists()
    assert (report_dir / "gsea_run_status.json").exists()


def test_generate_excludes_uploads_and_pipeline_state(temp_dirs):
    from app.services.report_generator import generate_report
    from app.services.report_store import create_report, get_report_staging_dir

    sessions_dir, _reports_dir = temp_dirs
    session_id = "abc-456"
    make_completed_session(sessions_dir, session_id)

    meta = create_report("R", session_id, "E")
    report_dir = get_report_staging_dir(meta["report_id"])

    generate_report(session_id, meta["report_id"])

    assert not (report_dir / "uploads").exists()
    assert not (report_dir / "pipeline_state.json").exists()


def test_generate_rejects_non_completed_session(temp_dirs):
    from app.services.report_generator import generate_report

    sessions_dir, _reports_dir = temp_dirs
    session_id = "incomplete-session"
    session_dir = sessions_dir / session_id
    session_dir.mkdir(parents=True)
    (session_dir / "session.json").write_text(
        '{"id": "incomplete", "state": "processing"}'
    )

    with pytest.raises(ValueError, match="not completed"):
        generate_report(session_id, "rpt_whatever")


def test_refresh_reports_replaces_contents_and_preserves_capability(temp_dirs):
    from app.services.report_generator import (
        generate_report,
        refresh_reports_for_session,
    )
    from app.services.report_store import (
        create_report,
        get_report_dir,
        publish_report,
    )

    sessions_dir, _reports_dir = temp_dirs
    session_id = "refresh-session"
    session_dir = make_completed_session(sessions_dir, session_id)
    metadata = create_report("Stable report", session_id, "Test Experiment")
    generate_report(session_id, metadata["report_id"])
    publish_report(metadata["report_id"])

    result_path = session_dir / "results" / "QC_Results.json"
    result_path.write_text('{"version": "new"}', encoding="utf-8")

    failures = refresh_reports_for_session(session_id)

    assert failures == []
    report_dir = get_report_dir(metadata["report_id"])
    refreshed = json.loads((report_dir / "report.json").read_text(encoding="utf-8"))
    assert refreshed["report_id"] == metadata["report_id"]
    assert refreshed["name"] == metadata["name"]
    assert refreshed["created_at"] == metadata["created_at"]
    assert refreshed["share_token"] == metadata["share_token"]
    assert "refreshed_at" in refreshed
    assert json.loads(
        (report_dir / "results" / "QC_Results.json").read_text(encoding="utf-8")
    ) == {"version": "new"}
