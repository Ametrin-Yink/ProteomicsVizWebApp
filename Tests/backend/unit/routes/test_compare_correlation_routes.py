"""Route tests for bounded large-DIA comparison-correlation reads."""

import asyncio
from datetime import UTC, datetime

import pandas as pd
import pytest
from app.db.session_store import SessionStore
from app.models.session import Session, SessionState
from app.services.comparison_correlation import (
    build_comparison_correlation_artifact,
)
from fastapi.testclient import TestClient

_SESSION_ID = "550e8400-e29b-41d4-a716-446655440000"


def _build_correlation_fixture(results_dir):
    """Create comparison catalog, differential results, and correlation artifact."""
    comparisons = ["A_vs_B", "C_vs_B"]
    pd.DataFrame(
        {"comparison_id": comparisons, "comparison_order": [0, 1]}
    ).to_parquet(results_dir / "comparison_catalog.parquet", index=False)

    rows = []
    for index in range(100):
        for comparison, value in (
            ("A_vs_B", float(index)),
            ("C_vs_B", float(index * 2)),
        ):
            rows.append(
                {
                    "comparison_id": comparison,
                    "protein_accession": f"P{index}",
                    "gene_name": f"G{index}",
                    "log2_fold_change": value,
                    "p_value": 0.05,
                    "adjusted_p_value": 0.1,
                    "standard_error": None,
                    "statistic": None,
                    "result_layer": "protein",
                    "pipeline": "msqrob2",
                }
            )
    pd.DataFrame(rows).to_parquet(
        results_dir / "differential_results.parquet", index=False
    )
    build_comparison_correlation_artifact(results_dir, block_size=1, tile_size=2)


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app.api.deps import get_session_store
    from app.core import config
    from app.main import app

    monkeypatch.setattr(config.settings, "sessions_dir", tmp_path)
    store = SessionStore(sessions_dir=tmp_path)

    session = Session(
        id=_SESSION_ID, name="DIA", pipeline="msqrob2",
        state=SessionState.COMPLETED,
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    )
    asyncio.run(store.create(session))

    results_dir = store.get_session_results_dir(_SESSION_ID)
    _build_correlation_fixture(results_dir)

    app.dependency_overrides[get_session_store] = lambda: store
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_metadata_omits_unbounded_comparison_list(client):
    response = client.get(
        f"/api/sessions/{_SESSION_ID}/compare/comparison-correlation"
    )

    assert response.status_code == 200
    assert response.json()["comparison_count"] == 2
    assert "comparison_ids" not in response.json()


def test_tile_and_reference_lookup_are_bounded(client):
    prefix = (
        f"/api/sessions/{_SESSION_ID}/compare/comparison-correlation"
    )
    tile = client.get(f"{prefix}/tile?level=0&row=0&column=0")
    lookup = client.get(f"{prefix}/lookup?comparison=A_vs_B&limit=1")

    assert tile.status_code == 200
    assert len(tile.json()["correlations"]) == 2
    assert lookup.status_code == 200
    assert lookup.json()["nearest"] == [
        {"comparison_id": "C_vs_B", "correlation": 1.0, "support_count": 100}
    ]
