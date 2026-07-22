"""Route tests for bounded large-DIA comparison-correlation reads."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pandas as pd
import pytest
from app.main import app
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app.api.deps import get_session_store
    from app.core import config
    from app.models.session import Session, SessionState
    from app.services.comparison_correlation import (
        build_comparison_correlation_artifact,
    )

    session_id = "550e8400-e29b-41d4-a716-446655440000"
    results_dir = tmp_path / session_id / "results"
    results_dir.mkdir(parents=True)
    comparisons = ["A_vs_B", "C_vs_B"]
    pd.DataFrame({"comparison_id": comparisons, "comparison_order": [0, 1]}).to_parquet(
        results_dir / "comparison_catalog.parquet", index=False
    )
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

    monkeypatch.setattr(config.settings, "sessions_dir", tmp_path)
    store = AsyncMock()
    store.get = AsyncMock(
        return_value=Session(
            id=session_id,
            name="DIA",
            pipeline="msqrob2",
            state=SessionState.COMPLETED,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
    )
    app.dependency_overrides[get_session_store] = lambda: store
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_metadata_omits_unbounded_comparison_list(client):
    response = client.get(
        "/api/sessions/550e8400-e29b-41d4-a716-446655440000/"
        "compare/comparison-correlation"
    )

    assert response.status_code == 200
    assert response.json()["comparison_count"] == 2
    assert "comparison_ids" not in response.json()


def test_tile_and_reference_lookup_are_bounded(client):
    prefix = (
        "/api/sessions/550e8400-e29b-41d4-a716-446655440000/"
        "compare/comparison-correlation"
    )
    tile = client.get(f"{prefix}/tile?level=0&row=0&column=0")
    lookup = client.get(f"{prefix}/lookup?comparison=A_vs_B&limit=1")

    assert tile.status_code == 200
    assert len(tile.json()["correlations"]) == 2
    assert lookup.status_code == 200
    assert lookup.json()["nearest"] == [
        {"comparison_id": "C_vs_B", "correlation": 1.0, "support_count": 100}
    ]
