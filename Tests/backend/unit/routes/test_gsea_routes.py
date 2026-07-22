"""Unit tests for GSEA API routes — run, status, data, plot, heatmap."""

import json
from unittest.mock import AsyncMock

import pandas as pd
import pytest
from app.main import app
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    from datetime import UTC, datetime

    from app.core import config

    monkeypatch.setattr(config.settings, "sessions_dir", tmp_path)

    from app.models.session import Session, SessionConfig, SessionFiles, SessionState

    session = Session(
        id="550e8400-e29b-41d4-a716-446655440000",
        name="Test",
        template="multi_condition_comparison",
        pipeline="msqrob2",
        state=SessionState.COMPLETED,
        config=SessionConfig(treatment="A", control="B", organism="human"),
        files=SessionFiles(),
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )

    mock_store = AsyncMock()
    mock_store.get = AsyncMock(return_value=session)

    from app.api.deps import get_session_store

    app.dependency_overrides[get_session_store] = lambda: mock_store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


class TestGseaStatus:
    def test_returns_idle_when_no_status(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/status"
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["status"] == "idle"


class TestGseaData:
    def test_returns_results_structure(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/go_bp"
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert "results" in data
        assert "database" in data

    def test_rejects_invalid_database(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/invalid_db"
        )
        assert response.status_code == 400


class TestGseaPlot:
    def test_missing_pathway_returns_404(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/go_bp/plot"
            "?term=nonexistent_pathway"
        )
        assert response.status_code == 404

    def test_invalid_database_returns_400(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/bad_db/plot"
            "?term=test"
        )
        assert response.status_code == 400


class TestGseaHeatmap:
    def test_missing_pathway_returns_404(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/go_bp/heatmap"
            "?term=nonexistent"
        )
        assert response.status_code == 404

    def test_returns_comparison_scoped_processed_heatmap(
        self, client, tmp_path, monkeypatch
    ):
        from app.api.routes import visualization

        results_dir = tmp_path / "550e8400-e29b-41d4-a716-446655440000" / "results"
        results_dir.mkdir(parents=True)
        pd.DataFrame(
            [
                {
                    "protein_accession": "P1",
                    "gene_name": "GENE1",
                    "sample_id": sample,
                    "condition": condition,
                    "replicate": replicate,
                    "batch": None,
                    "processed_log2_abundance": value,
                    "provenance": "model_estimated",
                    "observed_feature_count": 0,
                    "imputed_feature_count": 0,
                    "imputation_fraction": None,
                    "pipeline": "msqrob2",
                    "result_layer": "protein",
                    "sample_order": order,
                    "condition_order": 0 if condition == "A" else 1,
                }
                for order, (sample, condition, replicate, value) in enumerate(
                    [
                        ("A_1", "A", "1", 12.0),
                        ("A_2", "A", "2", 14.0),
                        ("B_1", "B", "1", 10.0),
                    ]
                )
            ]
        ).to_parquet(results_dir / "protein_abundance_long.parquet", index=False)
        pd.DataFrame(
            columns=[
                "protein_accession",
                "gene_name",
                "peptide_id",
                "sample_id",
                "condition",
                "replicate",
                "batch",
                "processed_log2_abundance",
                "provenance",
                "pipeline",
                "result_layer",
                "sample_order",
                "condition_order",
            ]
        ).to_parquet(results_dir / "peptide_abundance_long.parquet", index=False)
        pd.DataFrame(
            {
                "sample_id": ["A_1", "A_2", "B_1"],
                "condition": ["A", "A", "B"],
                "replicate": ["1", "2", "1"],
                "batch": [None, None, None],
                "sample_order": [0, 1, 2],
                "condition_order": [0, 0, 1],
            }
        ).to_parquet(results_dir / "sample_catalog.parquet", index=False)
        pd.DataFrame(
            {
                "comparison_id": ["A_vs_B"],
                "group1_label": ["A"],
                "group2_label": ["B"],
                "comparison_order": [0],
            }
        ).to_parquet(results_dir / "comparison_catalog.parquet", index=False)
        pd.DataFrame(
            {
                "comparison_id": ["A_vs_B"],
                "protein_accession": ["P1"],
                "gene_name": ["GENE1"],
                "log2_fold_change": [2.0],
                "p_value": [0.01],
                "adjusted_p_value": [0.02],
                "standard_error": [0.1],
                "statistic": [4.0],
                "result_layer": ["protein"],
                "pipeline": ["msqrob2"],
            }
        ).to_parquet(results_dir / "differential_results.parquet", index=False)
        (results_dir / "visualization_artifacts.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "abundance_scale": "log2",
                    "normalization_method": "center.median",
                    "imputation_method": "none",
                    "artifacts": {
                        "protein_abundance": "protein_abundance_long.parquet",
                        "peptide_abundance": "peptide_abundance_long.parquet",
                        "samples": "sample_catalog.parquet",
                        "comparisons": "comparison_catalog.parquet",
                        "differential_results": "differential_results.parquet",
                    },
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(
            visualization,
            "load_gsea_results",
            lambda *_args, **_kwargs: {
                "results": [{"term": "pathway", "lead_genes": ["GENE1"]}]
            },
        )

        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/go_bp/heatmap"
            "?term=pathway&comparison=A_vs_B"
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["samples"] == ["A_1", "A_2", "B_1"]
        assert data["conditions"] == ["A", "A", "B"]
        assert data["log2_abundances"] == [[12.0, 14.0, 10.0]]
