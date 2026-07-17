"""Integration tests for Compare API behavior."""

import uuid
from unittest.mock import AsyncMock, patch

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
