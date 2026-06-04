"""
Integration tests for report API routes (post-redesign).
"""

import json
import shutil
import uuid
from pathlib import Path

import pytest
from app.main import app
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def client(monkeypatch, tmp_path):
    """Create an async test client with temp directories."""
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

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


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


@pytest.mark.asyncio
async def test_list_reports_empty(client):
    response = await client.get("/api/reports")
    assert response.status_code == 200
    assert response.json() == {"reports": []}


@pytest.mark.asyncio
async def test_generate_and_view_report(client):
    """End-to-end: create session, generate report, view all endpoints."""
    sessions_dir = (
        client._transport.app.state.session_manager.session_store.sessions_dir
    )

    session_id = str(uuid.uuid4())
    make_completed_session_with_files(sessions_dir, session_id)

    response = await client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "Integration Test Report"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "report_id" in data
    report_id = data["report_id"]
    assert report_id.startswith("rpt_")

    # GET report metadata
    response = await client.get(f"/api/reports/{report_id}")
    assert response.status_code == 200
    meta = response.json()
    assert meta["_report"]["name"] == "Integration Test Report"
    assert "config" in meta  # session fields at top level

    # GET results
    response = await client.get(f"/api/reports/{report_id}/results")
    assert response.status_code == 200

    # GET QC
    response = await client.get(f"/api/reports/{report_id}/qc/plots")
    assert response.status_code == 200

    # GET GSEA status
    response = await client.get(f"/api/reports/{report_id}/gsea/status")
    assert response.status_code == 200

    # GET GSEA data
    response = await client.get(f"/api/reports/{report_id}/gsea/go_bp")
    assert response.status_code == 200

    # GET protein abundance
    response = await client.get(f"/api/reports/{report_id}/protein/P12345/abundance")
    assert response.status_code == 200

    # GET bionet subnetwork
    response = await client.get(f"/api/reports/{report_id}/bionet/subnetwork")
    assert response.status_code == 200

    # PATCH visualization state
    response = await client.patch(
        f"/api/reports/{report_id}/visualization-state",
        json={"markers": {"Trt_vs_Ctrl": ["P12345"]}},
    )
    assert response.status_code == 200

    # DELETE report
    response = await client.delete(f"/api/reports/{report_id}")
    assert response.status_code == 200
    response = await client.get(f"/api/reports/{report_id}")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_generate_rejects_non_completed_session(client):
    sessions_dir = (
        client._transport.app.state.session_manager.session_store.sessions_dir
    )
    session_id = str(uuid.uuid4())
    session_dir = sessions_dir / session_id
    session_dir.mkdir(parents=True)
    (session_dir / "session.json").write_text('{"id": "x", "state": "processing"}')

    response = await client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "Should Fail"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_report_survives_session_deletion(client):
    sessions_dir = (
        client._transport.app.state.session_manager.session_store.sessions_dir
    )

    session_id = str(uuid.uuid4())
    make_completed_session_with_files(sessions_dir, session_id)

    response = await client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "Persistent Report"},
    )
    assert response.status_code == 200
    report_id = response.json()["report_id"]

    # Delete original session
    shutil.rmtree(sessions_dir / session_id)

    # Report should still work
    response = await client.get(f"/api/reports/{report_id}")
    assert response.status_code == 200
    response = await client.get(f"/api/reports/{report_id}/results")
    assert response.status_code == 200
    response = await client.get(f"/api/reports/{report_id}/protein/P12345/abundance")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_report_not_found(client):
    response = await client.get("/api/reports/rpt_nonexistent")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_nonexistent_report(client):
    response = await client.delete("/api/reports/rpt_nonexistent")
    assert response.status_code == 404
