"""Integration tests for BioNet API routes."""

import uuid

NONEXISTENT_SESSION = str(uuid.uuid4())


def test_bionet_status_404_for_missing_session(client):
    """GET /bionet/status should return 404 for nonexistent session."""
    response = client.get(f"/api/sessions/{NONEXISTENT_SESSION}/bionet/status")
    assert response.status_code == 404


def test_bionet_run_404_for_missing_session(client):
    """POST /bionet/run should 404 for non-existent session."""
    response = client.post(
        f"/api/sessions/{NONEXISTENT_SESSION}/bionet/run",
        json={"comparison": "test_vs_ctrl"},
    )
    assert response.status_code == 404


def test_bionet_subnetwork_404_when_not_computed(client):
    """GET /bionet/subnetwork should 404 when no subnetwork exists.

    Even with a valid session UUID format, no session data exists
    so we get 404 (session not found).
    """
    response = client.get(
        f"/api/sessions/{NONEXISTENT_SESSION}/bionet/subnetwork"
    )
    assert response.status_code == 404
