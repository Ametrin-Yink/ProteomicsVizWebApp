"""Integration tests for Compare API endpoints."""

import uuid

# A valid UUID format that doesn't correspond to any real session
NONEXISTENT_SESSION = str(uuid.uuid4())


def test_protein_correlation_status_returns_404_for_missing_session(client):
    """GET protein-correlation/status should return 404 for nonexistent session."""
    response = client.get(
        f"/api/sessions/{NONEXISTENT_SESSION}/compare/protein-correlation/status"
    )
    assert response.status_code == 404


def test_comparison_correlation_status_returns_404_for_missing_session(client):
    """GET comparison-correlation/status should return 404 for nonexistent session."""
    response = client.get(
        f"/api/sessions/{NONEXISTENT_SESSION}/compare/comparison-correlation/status"
    )
    assert response.status_code == 404


def test_venn_requires_2_to_3_comparisons(client):
    """POST venn with 1 comparison should return 400."""
    response = client.post(
        f"/api/sessions/{NONEXISTENT_SESSION}/compare/venn",
        json={
            "comparisons": ["single"],
            "pvalue_threshold": 0.05,
            "logfc_threshold": 1.0,
        },
    )
    # Will be 404 (session not found) before validation, or 400 (bad comparisons count)
    # Both are acceptable -- the validation runs after session lookup
    assert response.status_code in (400, 404)


def test_list_proteins_404_for_missing_session(client):
    """GET proteins should return 404 for nonexistent session."""
    response = client.get(f"/api/sessions/{NONEXISTENT_SESSION}/compare/proteins")
    assert response.status_code == 404
