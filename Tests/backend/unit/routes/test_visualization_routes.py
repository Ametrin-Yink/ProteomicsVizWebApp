"""Unit tests for visualization API routes — results, QC, protein data, tasks."""

import io
import zipfile
from unittest.mock import AsyncMock

import pandas as pd
import pytest
from app.main import app
from app.models.session import Session, SessionConfig, SessionFiles, SessionState
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    from datetime import UTC, datetime

    from app.core import config

    monkeypatch.setattr(config.settings, "sessions_dir", tmp_path)

    results_dir = tmp_path / "550e8400-e29b-41d4-a716-446655440000" / "results"
    results_dir.mkdir(parents=True)

    de_df = pd.DataFrame(
        {
            "Master_Protein_Accessions": ["P001", "P002", "P003"],
            "Gene_Name": ["GENE1", "GENE2", "GENE3"],
            "logFC": [2.5, -1.8, 0.3],
            "pval": [0.001, 0.01, 0.5],
            "adjPval": [0.005, 0.05, 0.6],
            "PSM_Count": [10, 5, 2],
            "se": [0.1, 0.2, 0.3],
            "t": [25.0, -9.0, 1.0],
        }
    )
    de_df.to_csv(results_dir / "Diff_Expression.tsv", sep="\t", index=False)

    pd.DataFrame(
        {
            "Protein": ["P1_C10", "P2_candidate_C20|C30"],
            "Comparison": ["Drug_vs_DMSO", "Drug_vs_DMSO"],
            "log2FC": [1.2, 0.4],
            "pvalue": [0.01, 0.2],
            "adj.pvalue": [0.02, 0.3],
            "ProteinName": ["P1_C10", "P2_candidate_C20|C30"],
            "ProteinAccession": ["P1", "P2"],
            "SiteLabel": ["P1 · C10", "P2 · candidate positions C20|C30"],
            "LocalizationStatus": ["Confident", "Ambiguous"],
            "issue": [None, None],
            "UnusedMetadata": ["large metadata value", "large metadata value"],
        }
    ).to_csv(results_dir / "ptm_site_results.tsv", sep="\t", index=False)
    pd.DataFrame(
        {
            "Protein": ["P1"],
            "Comparison": ["Drug_vs_DMSO"],
            "log2FC": [0.1],
            "pvalue": [0.5],
            "adj.pvalue": [0.5],
            "issue": [None],
            "UnusedMetadata": ["large metadata value"],
        }
    ).to_csv(results_dir / "protein_results.tsv", sep="\t", index=False)
    pd.DataFrame(
        {
            "Protein": ["P1_C10"],
            "Comparison": ["Drug_vs_DMSO"],
            "GlobalProtein": ["P1"],
            "Adjusted": [True],
            "log2FC": [1.1],
            "pvalue": [0.02],
            "adj.pvalue": [0.03],
        }
    ).to_csv(results_dir / "adjusted_ptm_results.tsv", sep="\t", index=False)
    pd.DataFrame(
        {
            "ProteinName": ["P1_C10"],
            "ProteinAccession": ["P1"],
            "SiteLabel": ["P1 · C10"],
            "LocalizationStatus": ["Confident"],
            "MappingStatus": ["FASTA mapped"],
            "LocalizationSource": [None],
        }
    ).to_csv(results_dir / "ptm_site_metadata.tsv", sep="\t", index=False)
    pd.DataFrame(
        {
            "ProteinName": ["P1_C10"],
            "PeptideSequence": ["ACDK"],
            "LocalizationStatus": ["Confident"],
        }
    ).to_csv(results_dir / "ptm_localization_evidence.tsv", sep="\t", index=False)
    pd.DataFrame(
        {"ProteinName": ["P1_C10"], "Peptidoform": ["ACDK|C2(DBIA)"], "PSMCount": [2]}
    ).to_csv(results_dir / "ptm_peptidoforms.tsv", sep="\t", index=False)
    pd.DataFrame(
        {
            "Protein": ["P1_C10"],
            "Channel": ["126"],
            "Condition": ["Drug"],
            "Abundance": [12.5],
        }
    ).to_csv(results_dir / "ptm_site_summarized.tsv", sep="\t", index=False)
    with zipfile.ZipFile(results_dir / "ptm_results.zip", "w") as archive:
        archive.writestr("ptm_site_results.tsv", "Protein\tlog2FC\nP1_C10\t1.2\n")

    session = Session(
        id="550e8400-e29b-41d4-a716-446655440000",
        name="Test",
        template="multi_condition_comparison",
        pipeline="msqrob2",
        state=SessionState.COMPLETED,
        config=SessionConfig(
            treatment="DrugA",
            control="DMSO",
            organism="human",
            comparisons=[{"group1": {"C": "DrugA"}, "group2": {"C": "DMSO"}}],
        ),
        files=SessionFiles(),
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )

    mock_store = AsyncMock()
    mock_store.get = AsyncMock(return_value=session)
    mock_store.load_pipeline_state = AsyncMock(return_value=None)

    from app.api.deps import get_session_store

    app.dependency_overrides[get_session_store] = lambda: mock_store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_modular_visualization_routes_are_registered_once():
    expected = {
        "/api/sessions/{session_id}/visualization/manifest",
        "/api/sessions/{session_id}/protein/{protein_id}/abundance",
        "/api/sessions/{session_id}/protein/{protein_id}/peptide",
        "/api/sessions/{session_id}/ptm/results",
        "/api/sessions/{session_id}/ptm/results/download",
        "/api/sessions/{session_id}/ptm/compare",
        "/api/sessions/{session_id}/ptm/qc/plots",
    }
    registered = [route.path for route in app.routes if route.path in expected]

    assert sorted(registered) == sorted(expected)


class TestGetResults:
    def test_returns_paginated_results(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/results"
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 3
        assert len(data["results"]) == 3
        assert data["page"] == 1

    def test_significant_only_filter(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/results",
            params={"significant_only": "true"},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        # Only P001 has adjPval < 0.05 (0.005); P002 has adjPval == 0.05 (not < 0.05)
        assert data["total"] == 1

    def test_search_by_gene_name(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/results",
            params={"search": "GENE1"},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 1

    def test_sort_by_logfc_desc(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/results",
            params={"sort_by": "log_fc", "sort_order": "desc"},
        )
        assert response.status_code == 200
        results = response.json()["data"]["results"]
        assert results[0]["log_fc"] == 2.5

    def test_pagination(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/results",
            params={"page_size": 1, "page": 2},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert len(data["results"]) == 1
        assert data["page"] == 2

    def test_includes_statistics(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/results"
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert "total_proteins" in data
        assert "significant_proteins" in data
        assert "upregulated" in data
        assert "downregulated" in data

    def test_session_not_found(self, client):
        # Override the mock store to return None for this test
        from app.api.deps import get_session_store

        none_store = AsyncMock()
        none_store.get = AsyncMock(return_value=None)
        app.dependency_overrides[get_session_store] = lambda: none_store
        try:
            response = client.get(
                "/api/sessions/660e8400-e29b-41d4-a716-446655440001/results"
            )
            assert response.status_code == 404
        finally:
            # Restore original mock
            from app.api.deps import get_session_store

            mock_store2 = AsyncMock()
            mock_store2.get = AsyncMock(return_value=None)
            app.dependency_overrides.clear()


class TestGetQCPlots:
    def test_returns_defaults_when_no_qc_file(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/qc/plots"
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert "pca" in data
        assert "pvalue_distribution" in data


class TestVisualizationManifest:
    def test_standard_pipeline_preserves_all_modules(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/visualization/manifest"
        )

        assert response.status_code == 200
        manifest = response.json()["data"]
        assert manifest["pipeline"] == "msqrob2"
        assert [module["id"] for module in manifest["modules"]] == [
            "volcano",
            "qc",
            "gsea",
            "compare",
            "bionet",
        ]
        assert all(module["visible"] for module in manifest["modules"])
        assert all(module["enabled"] for module in manifest["modules"])

    def test_ptm_pipeline_reports_result_layers_and_compare_requirement(self, client):
        from app.api.deps import get_session_store

        ptm_session = Session(
            id="550e8400-e29b-41d4-a716-446655440000",
            name="PTM Test",
            template="multi_condition_comparison",
            pipeline="ptm",
            state=SessionState.COMPLETED,
            config=SessionConfig(
                comparisons=[
                    {"group1": {"Condition": "Drug"}, "group2": {"Condition": "DMSO"}}
                ]
            ),
            files=SessionFiles(),
        )
        mock_store = AsyncMock()
        mock_store.get = AsyncMock(return_value=ptm_session)
        previous_override = app.dependency_overrides[get_session_store]
        app.dependency_overrides[get_session_store] = lambda: mock_store

        try:
            response = client.get(
                "/api/sessions/550e8400-e29b-41d4-a716-446655440000/visualization/manifest"
            )
        finally:
            app.dependency_overrides[get_session_store] = previous_override

        assert response.status_code == 200
        modules = {
            module["id"]: module for module in response.json()["data"]["modules"]
        }
        assert modules["volcano"]["data_scopes"] == [
            "ptm",
            "protein",
            "adjusted_ptm",
        ]
        assert modules["compare"]["visible"] is True
        assert modules["compare"]["enabled"] is False
        assert modules["compare"]["disabled_reason"] == (
            "At least two comparisons are required"
        )
        assert modules["gsea"]["visible"] is True
        assert modules["bionet"]["visible"] is True

    def test_ptm_pipeline_hides_protein_modules_without_protein_results(self, tmp_path):
        from app.api.routes.visualization_manifest import build_visualization_manifest

        results_dir = tmp_path / "results"
        results_dir.mkdir()
        pd.DataFrame(
            {
                "Comparison": ["Drug_vs_DMSO", "Drug2_vs_DMSO"],
                "Protein": ["P1_C1", "P1_C1"],
            }
        ).to_csv(results_dir / "ptm_site_results.tsv", sep="\t", index=False)
        session = Session(
            id="ptm-without-protein",
            name="PTM without protein",
            pipeline="ptm",
            config=SessionConfig(
                comparisons=[
                    {"group1": {"Condition": "Drug"}, "group2": {"Condition": "DMSO"}},
                    {"group1": {"Condition": "Drug2"}, "group2": {"Condition": "DMSO"}},
                ]
            ),
        )

        manifest = build_visualization_manifest(session, results_dir)
        modules = {module["id"]: module for module in manifest["modules"]}

        assert modules["compare"]["enabled"] is True
        assert modules["gsea"]["visible"] is False
        assert modules["bionet"]["visible"] is False
        assert modules["qc"]["data_scopes"] == ["ptm"]

    def test_ptm_compare_capability_uses_produced_results(self, tmp_path):
        from app.api.routes.visualization_manifest import build_visualization_manifest

        results_dir = tmp_path / "results"
        results_dir.mkdir()
        pd.DataFrame({"Comparison": ["Drug_vs_DMSO"], "Protein": ["P1_C1"]}).to_csv(
            results_dir / "ptm_site_results.tsv", sep="\t", index=False
        )
        session = Session(
            id="ptm-stale-config",
            name="PTM stale config",
            pipeline="ptm",
            config=SessionConfig(
                comparisons=[
                    {"group1": {"Condition": "Drug"}, "group2": {"Condition": "DMSO"}},
                    {"group1": {"Condition": "Drug2"}, "group2": {"Condition": "DMSO"}},
                ]
            ),
        )

        manifest = build_visualization_manifest(session, results_dir)
        compare = next(
            module for module in manifest["modules"] if module["id"] == "compare"
        )

        assert compare["enabled"] is False
        assert compare["disabled_reason"] == "At least two comparisons are required"


class TestPTMVisualization:
    def test_stable_results_include_all_available_layers(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/ptm/results"
        )
        assert response.status_code == 200
        comparisons = response.json()["data"]["comparisons"]
        assert len(comparisons) == 1
        assert len(comparisons[0]["ptm_model"]) == 2
        assert len(comparisons[0]["protein_model"]) == 1
        assert [row["Protein"] for row in comparisons[0]["adjusted_model"]] == [
            "P1_C10"
        ]
        assert comparisons[0]["ptm_model"][1]["LocalizationStatus"] == "Ambiguous"
        assert comparisons[0]["ptm_model"][0]["issue"] is None
        assert comparisons[0]["protein_model"][0]["issue"] is None

    def test_results_can_project_one_comparison_and_layer(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/ptm/results",
            params={"comparison": "Drug_vs_DMSO", "layer": "protein"},
        )

        assert response.status_code == 200
        comparisons = response.json()["data"]["comparisons"]
        assert len(comparisons) == 1
        assert comparisons[0]["ptm_model"] == []
        assert len(comparisons[0]["protein_model"]) == 1
        assert comparisons[0]["adjusted_model"] == []
        assert "Comparison" not in comparisons[0]["protein_model"][0]
        assert "UnusedMetadata" not in comparisons[0]["protein_model"][0]

    def test_invalid_result_layer_is_rejected(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/ptm/results",
            params={"layer": "invalid"},
        )

        assert response.status_code == 422

    def test_compare_summary_is_calculated_without_returning_result_rows(self, client):
        from app.core.config import settings

        results_dir = (
            settings.sessions_dir / "550e8400-e29b-41d4-a716-446655440000" / "results"
        )
        frame = pd.read_csv(results_dir / "ptm_site_results.tsv", sep="\t")
        second = frame.copy()
        second["Comparison"] = "Drug2_vs_DMSO"
        second["log2FC"] = [2.4, 0.8]
        pd.concat([frame, second], ignore_index=True).to_csv(
            results_dir / "ptm_site_results.tsv", sep="\t", index=False
        )

        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/ptm/compare",
            params={"layer": "ptm"},
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["comparisons"] == ["Drug_vs_DMSO", "Drug2_vs_DMSO"]
        assert data["pairs"][0]["left"] == "Drug_vs_DMSO"
        assert data["pairs"][0]["right"] == "Drug2_vs_DMSO"
        assert data["pairs"][0]["matched"] == 2
        assert data["pairs"][0]["correlation"] == pytest.approx(1.0)
        assert "ptm_model" not in response.text

    def test_downloads_existing_ptm_result_archive(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/ptm/results/download"
        )

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            assert archive.namelist() == ["ptm_site_results.tsv"]

    def test_corrupt_ptm_qc_is_an_error(self, client):
        from app.core.config import settings

        qc_file = (
            settings.sessions_dir
            / "550e8400-e29b-41d4-a716-446655440000"
            / "results"
            / "ptm_qc.json"
        )
        qc_file.write_text("not json", encoding="utf-8")

        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/ptm/qc/plots"
        )

        assert response.status_code == 500

    def test_site_details_and_abundance_are_site_centric(self, client):
        details = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/ptm/site/P1_C10"
        )
        abundance = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/ptm/site/P1_C10/abundance"
        )
        assert details.status_code == 200
        assert details.json()["data"]["site"]["LocalizationStatus"] == "Confident"
        assert details.json()["data"]["site"]["LocalizationSource"] is None
        assert details.json()["data"]["peptidoforms"][0]["PSMCount"] == 2
        assert abundance.status_code == 200
        assert abundance.json()["data"]["samples"][0]["Abundance"] == 12.5


@pytest.mark.asyncio
async def test_protein_abundance_uses_exact_accession_match(tmp_path):
    from app.api.routes.visualization_proteins import load_protein_abundance

    pd.DataFrame(
        {
            "Master_Protein_Accessions": ["P10", "P2; P1"],
            "Gene_Name": ["Wrong", "Right"],
            "Sample1": [9.0, 3.0],
        }
    ).to_csv(tmp_path / "Protein_Abundances.tsv", sep="\t", index=False)

    result = await load_protein_abundance(tmp_path, "P1", session_id=str(tmp_path))

    assert result["abundances"] == [8.0]


@pytest.mark.asyncio
async def test_peptide_abundance_uses_exact_accession_match(tmp_path):
    from app.api.routes.visualization_proteins import load_peptide_abundance

    pd.DataFrame(
        {
            "Master_Protein_Accessions": ["P10", "P2; P1"],
            "Sequence": ["WRONG", "RIGHT"],
            "Sample_Origination": ["Sample1", "Sample1"],
            "Abundance": [100.0, 5.0],
        }
    ).to_csv(tmp_path / "PSM_Abundances.tsv", sep="\t", index=False)

    result = await load_peptide_abundance(tmp_path, "P1", session_id=str(tmp_path))

    assert [peptide["sequence"] for peptide in result["peptides"]] == ["RIGHT"]
