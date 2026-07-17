"""
Integration tests for report API routes (post-redesign).
"""

import json
import shutil
import uuid
from pathlib import Path

import numpy as np
import pytest
from app.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    """Create a test client with temp directories."""
    sessions_dir = tmp_path / "sessions"
    reports_dir = tmp_path / "reports"
    sessions_dir.mkdir(parents=True)
    reports_dir.mkdir(parents=True)

    from app.core import config

    monkeypatch.setattr(config.settings, "base_dir", tmp_path)
    monkeypatch.setattr(config.settings, "sessions_dir", sessions_dir)

    from app.db.session_store import SessionStore
    from app.services.session_manager import session_manager

    # Always recreate the store so it uses this test's temp sessions_dir.
    # The session_manager is a singleton on app.state; without this,
    # stale sessions_dir from a prior test pollutes subsequent tests.
    store = SessionStore(sessions_dir)
    app.state.session_store = store
    session_manager.session_store = store
    app.state.session_manager = session_manager

    import app.services.report_store as report_store

    monkeypatch.setattr(report_store, "REPORTS_DIR", reports_dir)

    from fastapi.testclient import TestClient

    return TestClient(app)


def make_completed_session_with_files(sessions_dir: Path, session_id: str):
    """Create a completed session with result files for export testing."""
    session_dir = sessions_dir / session_id
    session_dir.mkdir(parents=True)

    (session_dir / "session.json").write_text(
        json.dumps(
            {
                "id": session_id,
                "name": "Test Experiment",
                "state": "completed",
                "config": {
                    "experiment_name": "Test Experiment",
                    "comparisons": [{"group1": {"C": "Trt"}, "group2": {"C": "Ctrl"}}],
                },
                "markers": {},
                "volcano_filters": {
                    "foldChange": 1,
                    "pValue": 0.05,
                    "adjPValue": 1,
                    "s0": 0.1,
                },
            }
        )
    )

    results_dir = session_dir / "results"
    results_dir.mkdir(parents=True)
    (results_dir / "Diff_Expression_Trt_vs_Ctrl.tsv").write_text(
        "Master_Protein_Accessions\tGene_Name\tlogFC\tpval\tadjPval\tPSM_Count\n"
        "P12345\tGENE1\t2.5\t0.001\t0.01\t10\n"
    )
    (results_dir / "Protein_Abundances.tsv").write_text(
        "Master_Protein_Accessions\tGene_Name\tPSM_Count\tS1\tS2\n"
        "P12345\tGENE1\t10\t15.2\t14.8\n"
    )
    (results_dir / "QC_Results.json").write_text('{"pca": {"pc1": [1,2,3]}}')
    (results_dir / "PSM_Abundances.tsv").write_text(
        "Sequence\tS1\tS2\nPEPTIDE\t100\t200\n"
    )

    gsea_dir = results_dir / "gsea" / "Trt_vs_Ctrl"
    gsea_dir.mkdir(parents=True)
    (gsea_dir / "GSEA_Results.json").write_text(
        '{"go_bp": [{"Term": "test", "P-value": 0.01}]}'
    )

    bionet_dir = session_dir / "bionet"
    bionet_dir.mkdir(parents=True)
    (bionet_dir / "bionet_subnetwork.json").write_text('{"nodes": [], "edges": []}')
    (bionet_dir / "bionet_status.json").write_text('{"status": "completed"}')

    (session_dir / "gsea_run_status.json").write_text('{"Trt_vs_Ctrl": "completed"}')


def test_list_reports_empty(client):
    response = client.get("/api/reports")
    assert response.status_code == 200
    assert response.json() == {"reports": []}


def test_generate_and_view_report(client):
    """End-to-end: create session, generate report, view all endpoints."""
    sessions_dir = client.app.state.session_manager.session_store.sessions_dir

    session_id = str(uuid.uuid4())
    make_completed_session_with_files(sessions_dir, session_id)

    response = client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "Integration Test Report"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "report_id" in data
    report_id = data["report_id"]
    assert report_id.startswith("rpt_")

    # GET report metadata
    response = client.get(f"/api/reports/{report_id}")
    assert response.status_code == 200
    meta = response.json()
    assert meta["_report"]["name"] == "Integration Test Report"
    assert "config" in meta  # session fields at top level

    # GET results
    response = client.get(f"/api/reports/{report_id}/results")
    assert response.status_code == 200

    # GET QC
    response = client.get(f"/api/reports/{report_id}/qc/plots")
    assert response.status_code == 200

    # GET GSEA status
    response = client.get(f"/api/reports/{report_id}/gsea/status")
    assert response.status_code == 200

    # GET GSEA data
    response = client.get(f"/api/reports/{report_id}/gsea/go_bp")
    assert response.status_code == 200

    # GET protein abundance
    response = client.get(f"/api/reports/{report_id}/protein/P12345/abundance")
    assert response.status_code == 200

    # GET bionet subnetwork
    response = client.get(f"/api/reports/{report_id}/bionet/subnetwork")
    assert response.status_code == 200

    # PATCH visualization state
    response = client.patch(
        f"/api/reports/{report_id}/visualization-state",
        json={"markers": {"Trt_vs_Ctrl": ["P12345"]}},
    )
    assert response.status_code == 200

    # DELETE report
    response = client.delete(f"/api/reports/{report_id}")
    assert response.status_code == 200
    response = client.get(f"/api/reports/{report_id}")
    assert response.status_code == 404


def test_generate_rejects_non_completed_session(client):
    sessions_dir = client.app.state.session_manager.session_store.sessions_dir
    session_id = str(uuid.uuid4())
    session_dir = sessions_dir / session_id
    session_dir.mkdir(parents=True)
    (session_dir / "session.json").write_text('{"id": "x", "state": "processing"}')

    response = client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "Should Fail"},
    )
    assert response.status_code == 400


def test_report_survives_session_deletion(client):
    sessions_dir = client.app.state.session_manager.session_store.sessions_dir

    session_id = str(uuid.uuid4())
    make_completed_session_with_files(sessions_dir, session_id)

    response = client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "Persistent Report"},
    )
    assert response.status_code == 200
    report_id = response.json()["report_id"]

    # Delete original session
    shutil.rmtree(sessions_dir / session_id)

    # Report should still work
    response = client.get(f"/api/reports/{report_id}")
    assert response.status_code == 200
    response = client.get(f"/api/reports/{report_id}/results")
    assert response.status_code == 200
    response = client.get(f"/api/reports/{report_id}/protein/P12345/abundance")
    assert response.status_code == 200


def test_report_not_found(client):
    response = client.get("/api/reports/rpt_nonexistent")
    assert response.status_code == 404


def test_delete_nonexistent_report(client):
    response = client.delete("/api/reports/rpt_nonexistent")
    assert response.status_code == 404


def test_report_protein_correlation_uses_exact_accession_matching(
    tmp_path, monkeypatch
):
    """Report correlation must not select P10 when the query is P1."""
    from app.api.routes.reports import _run_report_protein_correlation
    from app.services import compare_service

    report_dir = tmp_path / "report"
    (report_dir / "results" / "compare").mkdir(parents=True)
    for comparison in ("A_vs_B", "C_vs_D"):
        (report_dir / "results" / f"Diff_Expression_{comparison}.tsv").touch()

    matrix = np.array([[10.0, 11.0], [1.0, 2.0]])
    monkeypatch.setattr(
        compare_service,
        "build_fold_change_matrix",
        lambda *_args: (matrix, ["P10", "P2; P1"], ["Wrong", "Right"]),
    )
    monkeypatch.setattr(
        compare_service,
        "load_pvalues_for_protein",
        lambda _directory, comparisons, protein_id: {
            comparison: {"pval": 0.01, "adj_pval": 0.02}
            for comparison in comparisons
            if protein_id == "P1"
        },
    )
    monkeypatch.setattr(
        compare_service, "compute_protein_similarities", lambda *_args: []
    )
    monkeypatch.setattr(
        compare_service,
        "run_cluster",
        lambda *_args: (np.array([[0.0, 0.0], [1.0, 1.0]]), [0.6, 0.4]),
    )

    _run_report_protein_correlation(report_dir, {"protein_id": "P1"})

    result = json.loads(
        (
            report_dir / "results" / "compare" / "protein-correlation_result.json"
        ).read_text()
    )
    assert [point["log_fc"] for point in result["selected_protein_fc"]] == [1.0, 2.0]
