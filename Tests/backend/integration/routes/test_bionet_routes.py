"""Integration tests for BioNet API state and persisted results."""

import json
import uuid

from app.core.config import settings

NONEXISTENT_SESSION = str(uuid.uuid4())


def _create_session(client) -> str:
    response = client.post(
        "/api/sessions",
        json={"name": "BioNet contract", "template": "multi_condition_comparison"},
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_missing_session_returns_404(client):
    for method, path in [
        ("get", "bionet/status"),
        ("get", "bionet/subnetwork"),
    ]:
        response = getattr(client, method)(
            f"/api/sessions/{NONEXISTENT_SESSION}/{path}"
        )
        assert response.status_code == 404, path


def test_status_is_idle_before_a_run(client):
    session_id = _create_session(client)
    response = client.get(f"/api/sessions/{session_id}/bionet/status")
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "idle"


def test_run_requires_current_visualization_artifacts(client):
    session_id = _create_session(client)
    response = client.post(
        f"/api/sessions/{session_id}/bionet/run",
        json={"comparison": "Drug_vs_Control"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Visualization artifacts require reprocessing"


def test_subnetwork_returns_persisted_result(client):
    session_id = _create_session(client)
    result = {
        "comparison": "Drug_vs_Control",
        "nodes": [{"id": "P1", "logFC": 2.0}],
        "edges": [],
    }
    result_dir = settings.sessions_dir / session_id / "bionet"
    result_dir.mkdir(parents=True)
    (result_dir / "bionet_subnetwork.json").write_text(
        json.dumps(result), encoding="utf-8"
    )

    response = client.get(f"/api/sessions/{session_id}/bionet/subnetwork")
    assert response.status_code == 200
    assert response.json()["data"] == result
