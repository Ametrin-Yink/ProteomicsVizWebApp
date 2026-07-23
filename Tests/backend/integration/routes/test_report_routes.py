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
    (results_dir / "Differential_Results_Long.tsv").write_text(
        "Label\tMaster_Protein_Accessions\tGene_Name\tlogFC\tpval\tadjPval\tPSM_Count\n"
        "Trt_vs_Ctrl\tP12345\tGENE1\t2.5\t0.001\t0.01\t10\n"
    )
    (results_dir / "Protein_Abundances.tsv").write_text(
        "Master_Protein_Accessions\tGene_Name\tPSM_Count\tS1\tS2\n"
        "P12345\tGENE1\t10\t15.2\t14.8\n"
    )
    (results_dir / "QC_Results.json").write_text('{"pca": {"pc1": [1,2,3]}}')
    (results_dir / "PSM_Abundances.tsv").write_text(
        "Sequence\tS1\tS2\nPEPTIDE\t100\t200\n"
    )

    from app.models.analysis import AnalysisConfig, PipelineTool
    from app.services.visualization_artifacts import (
        materialize_visualization_artifacts,
    )

    materialize_visualization_artifacts(
        results_dir,
        config=AnalysisConfig(
            pipeline=PipelineTool.MSQROB2,
            comparisons=[{"group1": {"C": "Trt"}, "group2": {"C": "Ctrl"}}],
            metadata={
                "S1": {"C": "Ctrl", "replicate": "1"},
                "S2": {"C": "Trt", "replicate": "1"},
            },
        ),
        pipeline="msqrob2",
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


def make_completed_ptm_session(sessions_dir: Path, session_id: str):
    session_dir = sessions_dir / session_id
    results_dir = session_dir / "results"
    results_dir.mkdir(parents=True)
    (session_dir / "session.json").write_text(
        json.dumps(
            {
                "id": session_id,
                "name": "PTM Experiment",
                "state": "completed",
                "pipeline": "ptm",
                "config": {
                    "comparisons": [
                        {
                            "group1": {"Condition": "Drug"},
                            "group2": {"Condition": "DMSO"},
                        }
                    ]
                },
                "markers": {},
                "ptm_volcano_filters": {
                    "Drug_vs_DMSO": {
                        "foldChange": 1,
                        "pValue": 0.05,
                        "adjPValue": 1,
                        "s0": 0.1,
                    }
                },
            }
        )
    )
    result_header = (
        "Comparison\tProtein\tSiteLabel\tProteinAccession\tGene\t"
        "LocalizationStatus\tlog2FC\tpvalue\tadj.pvalue\n"
    )
    (results_dir / "ptm_site_results.tsv").write_text(
        result_header
        + "Drug_vs_DMSO\tP1_C10\tP1 C10\tP1\tGENE1\tConfident\t2\t0.001\t0.01\n"
    )
    (results_dir / "protein_results.tsv").write_text(
        result_header + "Drug_vs_DMSO\tP1\tP1\tP1\tGENE1\t\t1\t0.01\t0.02\n"
    )
    (results_dir / "adjusted_ptm_results.tsv").write_text(
        result_header
        + "Drug_vs_DMSO\tP1_C10\tP1 C10\tP1\tGENE1\tConfident\t1\t0.01\t0.02\n"
    )
    (results_dir / "ptm_site_metadata.tsv").write_text(
        "ProteinName\tSiteLabel\nP1_C10\tP1 C10\n"
    )
    (results_dir / "ptm_localization_evidence.tsv").write_text(
        "ProteinName\tLocalizationStatus\nP1_C10\tConfident\n"
    )
    (results_dir / "ptm_peptidoforms.tsv").write_text(
        "ProteinName\tPeptidoform\nP1_C10\tACDC\n"
    )
    (results_dir / "ptm_site_summarized.tsv").write_text(
        "Protein\tChannel\tCondition\tReplicate\tAbundance\n"
        "P1_C10\t126\tDrug\t1\t10\n"
    )
    (results_dir / "ptm_qc.json").write_text(
        json.dumps(
            {
                "preprocessing": {"passing_site_count": 1},
                "results": {"protein_layer_available": True},
                "plots": {"total_psms": 1, "total_proteins": 1},
                "protein_plots": {"total_psms": 1, "total_proteins": 1},
            }
        )
    )
    (results_dir / "ptm_results.zip").write_bytes(b"ptm archive")


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
    assert "share_token" in data
    report_id = data["report_id"]
    share_token = data["share_token"]
    assert report_id.startswith("rpt_")

    # GET report metadata
    response = client.get(f"/api/shared-reports/{share_token}")
    assert response.status_code == 200
    meta = response.json()
    assert meta["_report"]["name"] == "Integration Test Report"
    assert "session_id" not in meta["_report"]
    assert "config" in meta  # session fields at top level

    # GET results
    response = client.get(f"/api/shared-reports/{share_token}/results")
    assert response.status_code == 200

    # GET QC
    response = client.get(f"/api/shared-reports/{share_token}/qc/plots")
    assert response.status_code == 200

    # GET GSEA status
    response = client.get(f"/api/shared-reports/{share_token}/gsea/status")
    assert response.status_code == 200

    # GET GSEA data
    response = client.get(f"/api/shared-reports/{share_token}/gsea/go_bp")
    assert response.status_code == 200

    # GET protein abundance
    response = client.get(f"/api/shared-reports/{share_token}/protein/P12345/abundance")
    assert response.status_code == 200

    # GET bionet subnetwork
    response = client.get(f"/api/shared-reports/{share_token}/bionet/subnetwork")
    assert response.status_code == 200

    # Shared links cannot persist another viewer's visualization state.
    response = client.patch(
        f"/api/shared-reports/{share_token}/visualization-state",
        json={"markers": {"Trt_vs_Ctrl": ["P12345"]}},
    )
    assert response.status_code in {404, 405}

    # Internal IDs are management-only and do not render report data.
    response = client.get(f"/api/reports/{report_id}")
    assert response.status_code == 405

    # DELETE report
    response = client.delete(f"/api/reports/{report_id}")
    assert response.status_code == 200
    response = client.get(f"/api/shared-reports/{share_token}")
    assert response.status_code == 404


def test_generate_and_view_ptm_report(client):
    sessions_dir = client.app.state.session_manager.session_store.sessions_dir
    session_id = str(uuid.uuid4())
    make_completed_ptm_session(sessions_dir, session_id)

    generated = client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "PTM Report"},
    )
    assert generated.status_code == 200
    prefix = f"/api/shared-reports/{generated.json()['share_token']}"

    metadata = client.get(prefix)
    assert metadata.status_code == 200
    assert metadata.json()["pipeline"] == "ptm"
    assert metadata.json()["ptm_volcano_filters"]["Drug_vs_DMSO"]["pValue"] == 0.05

    manifest = client.get(f"{prefix}/visualization/manifest")
    assert manifest.status_code == 200
    assert manifest.json()["data"]["pipeline"] == "ptm"

    results = client.get(
        f"{prefix}/ptm/results",
        params={"comparison": "Drug_vs_DMSO", "layer": "ptm"},
    )
    assert results.status_code == 200
    assert (
        results.json()["data"]["comparisons"][0]["ptm_model"][0]["Protein"] == "P1_C10"
    )

    summary = client.get(f"{prefix}/ptm/compare", params={"layer": "ptm"})
    assert summary.status_code == 200
    assert summary.json()["data"]["comparisons"] == ["Drug_vs_DMSO"]

    details = client.get(f"{prefix}/ptm/site/P1_C10")
    assert details.status_code == 200
    assert details.json()["data"]["site"]["ProteinName"] == "P1_C10"

    abundance = client.get(f"{prefix}/ptm/site/P1_C10/abundance")
    assert abundance.status_code == 200
    assert abundance.json()["data"]["samples"][0]["Channel"] == 126

    qc = client.get(f"{prefix}/ptm/qc/plots")
    assert qc.status_code == 200
    assert qc.json()["data"]["preprocessing"]["passing_site_count"] == 1

    download = client.get(f"{prefix}/ptm/results/download")
    assert download.status_code == 200
    assert download.content == b"ptm archive"


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
    assert client.get("/api/reports").json() == {"reports": []}


def test_shared_compute_requests_are_bounded_and_report_scoped(client):
    sessions_dir = client.app.state.session_manager.session_store.sessions_dir
    session_id = str(uuid.uuid4())
    make_completed_session_with_files(sessions_dir, session_id)
    generated = client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "Bounded Report"},
    ).json()
    share_token = generated["share_token"]
    prefix = f"/api/shared-reports/{share_token}"

    response = client.post(
        f"{prefix}/gsea/run",
        json={
            "comparison": "Trt_vs_Ctrl",
            "databases": ["go_bp"],
            "permutations": 100_000,
        },
    )
    assert response.status_code == 422

    response = client.post(
        f"{prefix}/bionet/run",
        json={"comparison": "Another_Report_Comparison"},
    )
    assert response.status_code == 400

    response = client.post(
        f"{prefix}/compare/venn",
        json={
            "comparisons": ["Trt_vs_Ctrl", "Another_Report_Comparison"],
            "pvalue_threshold": 0.05,
            "logfc_threshold": 1,
        },
    )
    assert response.status_code == 400


def test_non_ptm_report_does_not_fallback_to_legacy_comparison_json(client):
    from app.services.report_store import get_report_dir

    sessions_dir = client.app.state.session_manager.session_store.sessions_dir
    session_id = str(uuid.uuid4())
    make_completed_session_with_files(sessions_dir, session_id)
    generated = client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "Canonical Compare Report"},
    ).json()
    report_dir = get_report_dir(generated["report_id"])
    assert report_dir is not None
    compare_dir = report_dir / "results" / "compare"
    compare_dir.mkdir(parents=True, exist_ok=True)
    (compare_dir / "comparison-correlation_result.json").write_text(
        '{"legacy": true}', encoding="utf-8"
    )

    response = client.get(
        f"/api/shared-reports/{generated['share_token']}"
        "/compare/comparison-correlation"
    )

    assert response.status_code == 404


def test_ptm_report_keeps_existing_comparison_workflow(client):
    from app.services.report_store import get_report_dir

    sessions_dir = client.app.state.session_manager.session_store.sessions_dir
    session_id = str(uuid.uuid4())
    make_completed_ptm_session(sessions_dir, session_id)
    generated = client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "PTM Compare Report"},
    ).json()
    report_dir = get_report_dir(generated["report_id"])
    assert report_dir is not None
    compare_dir = report_dir / "results" / "compare"
    compare_dir.mkdir(parents=True, exist_ok=True)
    (compare_dir / "comparison-correlation_result.json").write_text(
        '{"workflow": "ptm"}', encoding="utf-8"
    )

    response = client.get(
        f"/api/shared-reports/{generated['share_token']}"
        "/compare/comparison-correlation"
    )

    assert response.status_code == 200
    assert response.json() == {"workflow": "ptm"}


def test_report_survives_session_deletion(client):
    sessions_dir = client.app.state.session_manager.session_store.sessions_dir

    session_id = str(uuid.uuid4())
    make_completed_session_with_files(sessions_dir, session_id)

    response = client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "Persistent Report"},
    )
    assert response.status_code == 200
    share_token = response.json()["share_token"]

    # Delete original session
    shutil.rmtree(sessions_dir / session_id)

    # Report should still work
    response = client.get(f"/api/shared-reports/{share_token}")
    assert response.status_code == 200
    response = client.get(f"/api/shared-reports/{share_token}/results")
    assert response.status_code == 200
    response = client.get(f"/api/shared-reports/{share_token}/protein/P12345/abundance")
    assert response.status_code == 200


def test_report_not_found(client):
    response = client.get(
        "/api/shared-reports/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    )
    assert response.status_code == 404


def test_delete_nonexistent_report(client):
    response = client.delete("/api/reports/rpt_nonexistent")
    assert response.status_code == 404


def test_rotate_share_token_revokes_old_link(client):
    sessions_dir = client.app.state.session_manager.session_store.sessions_dir
    session_id = str(uuid.uuid4())
    make_completed_session_with_files(sessions_dir, session_id)

    generated = client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "Rotatable Report"},
    ).json()
    report_id = generated["report_id"]
    old_token = generated["share_token"]

    response = client.post(f"/api/reports/{report_id}/share-token/rotate")
    assert response.status_code == 200
    new_token = response.json()["share_token"]
    assert new_token != old_token

    assert client.get(f"/api/shared-reports/{old_token}").status_code == 404
    assert client.get(f"/api/shared-reports/{new_token}").status_code == 200


def test_shared_surface_has_no_listing_or_delete(client):
    assert client.get("/api/shared-reports").status_code in {404, 405}
    token = "A" * 43
    assert client.delete(f"/api/shared-reports/{token}").status_code == 405


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
