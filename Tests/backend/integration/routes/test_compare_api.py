"""Integration tests for Compare API behavior."""

import json
import uuid
from unittest.mock import AsyncMock, patch

import pandas as pd

NONEXISTENT_SESSION = str(uuid.uuid4())


def _create_session(client) -> str:
    response = client.post(
        "/api/sessions",
        json={"name": "Compare contract", "template": "multi_condition_comparison"},
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_missing_session_endpoints_return_404(client):
    paths = [
        "compare/protein-correlation/status",
        "compare/comparison-correlation/status",
        "compare/proteins",
    ]
    for path in paths:
        response = client.get(f"/api/sessions/{NONEXISTENT_SESSION}/{path}")
        assert response.status_code == 404, path


def test_venn_rejects_comparison_count_for_existing_session(client):
    session_id = _create_session(client)
    response = client.post(
        f"/api/sessions/{session_id}/compare/venn",
        json={
            "comparisons": ["single"],
            "pvalue_threshold": 0.05,
            "logfc_threshold": 1.0,
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Venn requires 2 or 3 comparisons"


def test_venn_returns_computed_sets(client):
    session_id = _create_session(client)
    expected = {
        "comparisons": ["a", "b"],
        "sets": {"a": ["P1"], "b": ["P1", "P2"]},
        "intersections": {"a&b": ["P1"]},
    }
    with patch(
        "app.api.routes.compare.task_manager.submit",
        new=AsyncMock(return_value=expected),
    ) as submit:
        response = client.post(
            f"/api/sessions/{session_id}/compare/venn",
            json={
                "comparisons": ["a", "b"],
                "pvalue_threshold": 0.05,
                "logfc_threshold": 1.0,
            },
        )

    assert response.status_code == 200
    assert response.json() == expected
    assert submit.await_count == 1


def test_list_proteins_returns_empty_without_comparisons(client):
    session_id = _create_session(client)
    response = client.get(f"/api/sessions/{session_id}/compare/proteins")
    assert response.status_code == 200
    assert response.json() == []


def test_comparison_heatmap_ignores_ptm_site_markers(tmp_path, monkeypatch):
    from app.api.routes import compare as compare_routes

    session_id = "ptm-session"
    results_dir = tmp_path / session_id / "results"
    results_dir.mkdir(parents=True)
    for comparison, fold_changes in (
        ("A_vs_Control", [2.0, 0.5, -0.2]),
        ("B_vs_Control", [1.5, 0.4, -0.1]),
    ):
        pd.DataFrame(
            {
                "Master_Protein_Accessions": ["P1", "P2", "P3"],
                "Gene_Name": ["G1", "G2", "G3"],
                "logFC": fold_changes,
                "pval": [0.001, 0.5, 0.8],
                "adjPval": [0.01, 0.6, 0.9],
            }
        ).to_csv(
            results_dir / f"Diff_Expression_{comparison}.tsv",
            sep="\t",
            index=False,
        )
    monkeypatch.setattr(compare_routes.settings, "sessions_dir", tmp_path)
    request = compare_routes.ComparisonCorrelationRequest(
        primary_comparison="A_vs_Control",
        selected_comparisons=["A_vs_Control", "B_vs_Control"],
        marked_proteins={"A_vs_Control::ptm": ["P1_C10"]},
        cluster_method="pca",
    )

    compare_routes._run_comparison_correlation(session_id, request)

    result_path = results_dir / "compare" / "comparison-correlation_result.json"
    result = json.loads(result_path.read_text(encoding="utf-8"))
    assert result["heatmap_data"]["proteins"] == [
        {"accession": "P1", "gene_name": "G1"}
    ]
