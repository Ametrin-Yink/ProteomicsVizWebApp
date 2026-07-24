"""Unit tests for visualization API routes — results, QC, protein data, tasks."""

import asyncio
import io
import json
import zipfile
from datetime import UTC, datetime

import pandas as pd
import pytest
from app.db.session_store import SessionStore
from app.models.analysis import AnalysisConfig, PipelineTool
from app.models.session import Session, SessionConfig, SessionFiles, SessionState
from app.services.visualization_artifacts import (
    VISUALIZATION_SCHEMA_VERSION,
    materialize_visualization_artifacts,
)
from fastapi.testclient import TestClient

_SESSION_ID = "550e8400-e29b-41d4-a716-446655440000"


def _write_supported_visualization_manifest(results_dir, pipeline: str) -> None:
    artifacts = {
        "protein_abundance": "protein_abundance_long.parquet",
        "peptide_abundance": "peptide_abundance_long.parquet",
        "samples": "sample_catalog.parquet",
        "comparisons": "comparison_catalog.parquet",
        "differential_results": "differential_results.parquet",
    }
    for filename in artifacts.values():
        (results_dir / filename).touch()
    (results_dir / "visualization_artifacts.json").write_text(
        json.dumps(
            {
                "schema_version": VISUALIZATION_SCHEMA_VERSION,
                "pipeline": pipeline,
                "normalization_method": "test",
                "imputation_method": "none",
                "abundance_scale": "log2",
                "artifacts": artifacts,
            }
        ),
        encoding="utf-8",
    )


@pytest.fixture
def store(tmp_path, monkeypatch):
    """Real SessionStore with isolated sessions_dir."""
    from app.core import config
    monkeypatch.setattr(config.settings, "sessions_dir", tmp_path)
    return SessionStore(sessions_dir=tmp_path)


@pytest.fixture
def client(tmp_path, monkeypatch, store):
    from app.api.deps import get_session_store
    from app.main import app
    results_dir = store.get_session_results_dir(_SESSION_ID)

    # Write legacy diff expression TSV
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

    # Write canonical differential_results.parquet
    pd.DataFrame(
        {
            "comparison_id": ["DrugA_vs_DMSO"] * 3,
            "protein_accession": ["P001", "P002", "P003"],
            "gene_name": ["GENE1", "GENE2", "GENE3"],
            "log2_fold_change": [2.5, -1.8, 0.3],
            "p_value": [0.001, 0.01, 0.5],
            "adjusted_p_value": [0.005, 0.05, 0.6],
            "standard_error": [0.1, 0.2, 0.3],
            "statistic": [25.0, -9.0, 1.0],
            "psm_count": [10, 5, 2],
            "result_layer": ["protein"] * 3,
            "pipeline": ["msqrob2"] * 3,
        }
    ).to_parquet(results_dir / "differential_results.parquet", index=False)

    # PTM result files
    pd.DataFrame(
        {
            "Protein": ["P1_C10", "P2_candidate_C20|C30"],
            "Comparison": ["Drug_vs_DMSO", "Drug_vs_DMSO"],
            "log2FC": [1.2, 0.4], "pvalue": [0.01, 0.2],
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
            "Protein": ["P1"], "Comparison": ["Drug_vs_DMSO"],
            "log2FC": [0.1], "pvalue": [0.5], "adj.pvalue": [0.5],
            "issue": [None], "UnusedMetadata": ["large metadata value"],
        }
    ).to_csv(results_dir / "protein_results.tsv", sep="\t", index=False)
    pd.DataFrame(
        {
            "Protein": ["P1_C10"], "Comparison": ["Drug_vs_DMSO"],
            "GlobalProtein": ["P1"], "Adjusted": [True],
            "log2FC": [1.1], "pvalue": [0.02], "adj.pvalue": [0.03],
        }
    ).to_csv(results_dir / "adjusted_ptm_results.tsv", sep="\t", index=False)
    pd.DataFrame(
        {
            "ProteinName": ["P1_C10"], "ProteinAccession": ["P1"],
            "SiteLabel": ["P1 · C10"], "LocalizationStatus": ["Confident"],
            "MappingStatus": ["FASTA mapped"], "LocalizationSource": [None],
        }
    ).to_csv(results_dir / "ptm_site_metadata.tsv", sep="\t", index=False)
    pd.DataFrame(
        {
            "ProteinName": ["P1_C10"], "PeptideSequence": ["ACDK"],
            "LocalizationStatus": ["Confident"],
        }
    ).to_csv(results_dir / "ptm_localization_evidence.tsv", sep="\t", index=False)
    pd.DataFrame(
        {"ProteinName": ["P1_C10"], "Peptidoform": ["ACDK|C2(DBIA)"], "PSMCount": [2]}
    ).to_csv(results_dir / "ptm_peptidoforms.tsv", sep="\t", index=False)
    pd.DataFrame(
        {
            "Protein": ["P1_C10"], "Channel": ["126"],
            "Condition": ["Drug"], "Abundance": [12.5],
        }
    ).to_csv(results_dir / "ptm_site_summarized.tsv", sep="\t", index=False)
    with zipfile.ZipFile(results_dir / "ptm_results.zip", "w") as archive:
        archive.writestr("ptm_site_results.tsv", "Protein\tlog2FC\nP1_C10\t1.2\n")

    session = Session(
        id=_SESSION_ID, name="Test",
        template="multi_condition_comparison", pipeline="msqrob2",
        state=SessionState.COMPLETED,
        config=SessionConfig(
            treatment="DrugA", control="DMSO", organism="human",
            comparisons=[{"group1": {"C": "DrugA"}, "group2": {"C": "DMSO"}}],
        ),
        files=SessionFiles(),
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    )
    asyncio.run(store.create(session))

    app.dependency_overrides[get_session_store] = lambda: store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_modular_visualization_routes_are_registered_once():
    from app.main import app

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
        response = client.get(f"/api/sessions/{_SESSION_ID}/results")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 3
        assert len(data["results"]) == 3
        assert data["page"] == 1

    def test_significant_only_filter(self, client):
        response = client.get(
            f"/api/sessions/{_SESSION_ID}/results",
            params={"significant_only": "true"},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 1

    def test_search_by_gene_name(self, client):
        response = client.get(
            f"/api/sessions/{_SESSION_ID}/results",
            params={"search": "GENE1"},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 1

    def test_sort_by_logfc_desc(self, client):
        response = client.get(
            f"/api/sessions/{_SESSION_ID}/results",
            params={"sort_by": "log_fc", "sort_order": "desc"},
        )
        assert response.status_code == 200
        results = response.json()["data"]["results"]
        assert results[0]["log_fc"] == 2.5

    def test_pagination(self, client):
        response = client.get(
            f"/api/sessions/{_SESSION_ID}/results",
            params={"page_size": 1, "page": 2},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert len(data["results"]) == 1
        assert data["page"] == 2

    def test_includes_statistics(self, client):
        response = client.get(f"/api/sessions/{_SESSION_ID}/results")
        assert response.status_code == 200
        data = response.json()["data"]
        assert "total_proteins" in data
        assert "significant_proteins" in data
        assert "upregulated" in data
        assert "downregulated" in data

    def test_session_not_found(self, client):
        response = client.get(
            "/api/sessions/660e8400-e29b-41d4-a716-446655440001/results"
        )
        assert response.status_code == 404


class TestGetQCPlots:
    def test_requires_reprocessing_without_canonical_manifest(self, client):
        response = client.get(
            f"/api/sessions/{_SESSION_ID}/qc/plots"
        )
        assert response.status_code == 409

    def test_returns_only_compact_summary_for_supported_session(self, client, store):
        from app.core.config import settings

        results_dir = store.get_session_results_dir(_SESSION_ID)
        _write_supported_visualization_manifest(results_dir, "msqrob2")
        (results_dir / "QC_Results.json").write_text(
            json.dumps(
                {
                    "pca": {"samples": ["S1"]},
                    "data_completeness": [{"sample": "S1"}],
                    "total_psms": 10,
                    "avg_psms_per_sample": 5.0,
                    "total_proteins": 3,
                    "avg_proteins_per_sample": 2.5,
                    "average_cv": 12.0,
                    "average_protein_cv": 12.0,
                    "average_psm_cv": 14.0,
                    "completeness_rate": 90.0,
                }
            ),
            encoding="utf-8",
        )

        response = client.get(
            f"/api/sessions/{_SESSION_ID}/qc/plots"
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_psms"] == 10
        assert data["completeness_rate"] == 90.0
        assert "pca" not in data
        assert "data_completeness" not in data


class TestCanonicalAbundanceRoutes:
    def test_returns_processed_log2_data_scoped_to_selected_comparison(
        self, client, store
    ):
        results_dir = store.get_session_results_dir(_SESSION_ID)
        pd.DataFrame(
            {
                "Master_Protein_Accessions": ["P1"], "Gene_Name": ["GENE1"],
                "DMSO_1": [10.0], "DrugA_1": [14.0], "Other_1": [30.0],
            }
        ).to_csv(results_dir / "Protein_Abundances.tsv", sep="\t", index=False)
        pd.DataFrame(
            {
                "ProteinAccession": ["P1", "P1"], "GeneName": ["GENE1", "GENE1"],
                "PeptideId": ["PEP", "PEP"],
                "SampleId": ["DMSO_1", "DrugA_1"],
                "Condition": ["DMSO", "DrugA"], "Replicate": ["1", "1"],
                "ProcessedLog2Abundance": [9.0, 13.0],
                "Provenance": ["observed", "imputed"],
                "ResultLayer": ["protein", "protein"],
            }
        ).to_csv(results_dir / "peptide_processed_long.tsv", sep="\t", index=False)
        pd.DataFrame(
            {
                "Master_Protein_Accessions": ["P1"], "Gene_Name": ["GENE1"],
                "logFC": [1.0], "pval": [0.01], "adjPval": [0.02],
            }
        ).to_csv(
            results_dir / "Diff_Expression_DrugA_vs_DMSO.tsv",
            sep="\t", index=False,
        )
        config = AnalysisConfig(
            pipeline=PipelineTool.MSQROB2,
            comparisons=[{"group1": {"C": "DrugA"}, "group2": {"C": "DMSO"}}],
        )
        materialize_visualization_artifacts(
            results_dir, config=config, pipeline="msqrob2"
        )

        protein = client.get(
            f"/api/sessions/{_SESSION_ID}/protein/P1/abundance",
            params={"comparison": "DrugA_vs_DMSO"},
        )
        peptide = client.get(
            f"/api/sessions/{_SESSION_ID}/protein/P1/peptide",
            params={"comparison": "DrugA_vs_DMSO"},
        )

        assert protein.status_code == 200
        assert protein.json()["data"]["scale"] == "log2"
        assert [
            point["sample_id"] for point in protein.json()["data"]["points"]
        ] == ["DrugA_1", "DMSO_1"]
        assert [
            point["processed_log2_abundance"]
            for point in peptide.json()["data"]["points"]
        ] == [13.0, 9.0]

    def test_rejects_legacy_abundance_without_current_artifacts(self, client, store):
        results_dir = store.get_session_results_dir(_SESSION_ID)
        (results_dir / "visualization_artifacts.json").unlink(missing_ok=True)

        response = client.get(
            f"/api/sessions/{_SESSION_ID}/protein/P1/abundance",
            params={"comparison": "DrugA_vs_DMSO"},
        )

        assert response.status_code == 409
        assert "reprocessing" in response.json()["detail"].lower()


class TestVisualizationManifest:
    def test_standard_pipeline_requires_reprocessing_without_current_artifacts(
        self, client
    ):
        response = client.get(
            f"/api/sessions/{_SESSION_ID}/visualization/manifest"
        )

        assert response.status_code == 200
        manifest = response.json()["data"]
        assert manifest["pipeline"] == "msqrob2"
        assert manifest["supported"] is False
        assert manifest["requires_reprocessing"] is True
        assert [module["id"] for module in manifest["modules"]] == [
            "volcano", "qc", "gsea", "compare", "bionet",
        ]
        assert all(module["visible"] for module in manifest["modules"])
        assert not any(module["enabled"] for module in manifest["modules"])
        assert {module["disabled_reason"] for module in manifest["modules"]} == {
            "Results require reprocessing"
        }

    def test_ptm_pipeline_reports_result_layers_and_compare_requirement(
        self, client, store
    ):
        from app.api.deps import get_session_store
        from app.core.config import settings
        from app.main import app

        ptm_session = Session(
            id=_SESSION_ID, name="PTM Test",
            template="multi_condition_comparison", pipeline="ptm",
            state=SessionState.COMPLETED,
            config=SessionConfig(
                comparisons=[
                    {"group1": {"Condition": "Drug"}, "group2": {"Condition": "DMSO"}}
                ]
            ),
            files=SessionFiles(),
        )
        asyncio.run(store.create(ptm_session))

        results_dir = store.get_session_results_dir(_SESSION_ID)
        _write_supported_visualization_manifest(results_dir, "ptm")

        response = client.get(
            f"/api/sessions/{_SESSION_ID}/visualization/manifest"
        )

        assert response.status_code == 200
        modules = {
            module["id"]: module for module in response.json()["data"]["modules"]
        }
        assert modules["volcano"]["data_scopes"] == ["ptm", "protein", "adjusted_ptm"]
        assert modules["compare"]["visible"] is True
        assert modules["compare"]["enabled"] is False
        assert modules["compare"]["disabled_reason"] == (
            "At least two comparisons are required"
        )
        assert modules["gsea"]["visible"] is True
        assert modules["bionet"]["visible"] is True

    def test_ptm_pipeline_hides_protein_modules_without_protein_results(
        self, tmp_path
    ):
        from app.api.routes.visualization_manifest import build_visualization_manifest

        results_dir = tmp_path / "results"
        results_dir.mkdir()
        pd.DataFrame(
            {
                "Comparison": ["Drug_vs_DMSO", "Drug2_vs_DMSO"],
                "Protein": ["P1_C1", "P1_C1"],
            }
        ).to_csv(results_dir / "ptm_site_results.tsv", sep="\t", index=False)
        _write_supported_visualization_manifest(results_dir, "ptm")
        session = Session(
            id="ptm-without-protein", name="PTM without protein", pipeline="ptm",
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
        _write_supported_visualization_manifest(results_dir, "ptm")
        session = Session(
            id="ptm-stale-config", name="PTM stale config", pipeline="ptm",
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
            f"/api/sessions/{_SESSION_ID}/ptm/results"
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
            f"/api/sessions/{_SESSION_ID}/ptm/results",
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
            f"/api/sessions/{_SESSION_ID}/ptm/results",
            params={"layer": "invalid"},
        )

        assert response.status_code == 422

    def test_compare_summary_is_calculated_without_returning_result_rows(
        self, client, store
    ):
        results_dir = store.get_session_results_dir(_SESSION_ID)
        frame = pd.read_csv(results_dir / "ptm_site_results.tsv", sep="\t")
        second = frame.copy()
        second["Comparison"] = "Drug2_vs_DMSO"
        second["log2FC"] = [2.4, 0.8]
        pd.concat([frame, second], ignore_index=True).to_csv(
            results_dir / "ptm_site_results.tsv", sep="\t", index=False
        )

        response = client.get(
            f"/api/sessions/{_SESSION_ID}/ptm/compare",
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
            f"/api/sessions/{_SESSION_ID}/ptm/results/download"
        )

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            assert archive.namelist() == ["ptm_site_results.tsv"]

    def test_corrupt_ptm_qc_is_an_error(self, client, store):
        results_dir = store.get_session_results_dir(_SESSION_ID)
        qc_file = results_dir / "ptm_qc.json"
        qc_file.write_text("not json", encoding="utf-8")

        response = client.get(
            f"/api/sessions/{_SESSION_ID}/ptm/qc/plots"
        )

        assert response.status_code == 500

    def test_site_details_and_abundance_are_site_centric(self, client):
        details = client.get(
            f"/api/sessions/{_SESSION_ID}/ptm/site/P1_C10"
        )
        abundance = client.get(
            f"/api/sessions/{_SESSION_ID}/ptm/site/P1_C10/abundance"
        )
        assert details.status_code == 200
        assert details.json()["data"]["site"]["LocalizationStatus"] == "Confident"
        assert details.json()["data"]["site"]["LocalizationSource"] is None
        assert details.json()["data"]["peptidoforms"][0]["PSMCount"] == 2
        assert abundance.status_code == 200
        assert abundance.json()["data"]["samples"][0]["Abundance"] == 12.5


def test_comparison_sample_filter_uses_complete_condition_groups():
    from app.api.routes.visualization_shared import build_sample_filter

    session = Session(
        id="filter-session", name="Filter",
        config=SessionConfig(
            comparisons=[
                {
                    "group1": {"Treatment": "Drug", "Time": "24h"},
                    "group2": {"Treatment": "DMSO", "Time": "24h"},
                }
            ]
        ),
    )

    assert build_sample_filter(session, "Drug+24h_vs_DMSO+24h") == [
        "Drug_24h", "DMSO_24h",
    ]
