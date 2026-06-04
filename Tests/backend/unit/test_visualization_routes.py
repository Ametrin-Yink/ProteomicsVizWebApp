"""Unit tests for visualization API routes — results, QC, protein data, tasks."""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from app.models.session import Session, SessionConfig, SessionFiles, SessionState
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    from datetime import UTC, datetime

    from app.core import config
    monkeypatch.setattr(config.settings, "sessions_dir", tmp_path)

    results_dir = tmp_path / "550e8400-e29b-41d4-a716-446655440000" / "results"
    results_dir.mkdir(parents=True)

    de_df = pd.DataFrame({
        "Master_Protein_Accessions": ["P001", "P002", "P003"],
        "Gene_Name": ["GENE1", "GENE2", "GENE3"],
        "logFC": [2.5, -1.8, 0.3],
        "pval": [0.001, 0.01, 0.5],
        "adjPval": [0.005, 0.05, 0.6],
        "PSM_Count": [10, 5, 2],
        "se": [0.1, 0.2, 0.3],
        "t": [25.0, -9.0, 1.0],
    })
    de_df.to_csv(results_dir / "Diff_Expression.tsv", sep="\t", index=False)

    session = Session(
        id="550e8400-e29b-41d4-a716-446655440000",
        name="Test", template="multi_condition_comparison",
        pipeline="msqrob2", state=SessionState.COMPLETED,
        config=SessionConfig(
            treatment="DrugA", control="DMSO", organism="human",
            comparisons=[{"group1": {"C": "DrugA"}, "group2": {"C": "DMSO"}}],
        ),
        files=SessionFiles(),
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    )

    mock_store = AsyncMock()
    mock_store.get = AsyncMock(return_value=session)
    mock_store.load_pipeline_state = AsyncMock(return_value=None)

    from app.api.deps import get_session_store
    app.dependency_overrides[get_session_store] = lambda: mock_store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


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
