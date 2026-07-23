"""Tests for the blockwise large-DIA comparison correlation artifact."""

import json

import numpy as np
import pandas as pd
import pytest


def _write_correlation_fixture(results_dir):
    comparisons = ["A_vs_B", "C_vs_B", "D_vs_B", "Sparse_vs_B"]
    pd.DataFrame(
        {
            "comparison_id": comparisons,
            "comparison_order": range(len(comparisons)),
        }
    ).to_parquet(results_dir / "comparison_catalog.parquet", index=False)
    rows = []
    for index in range(120):
        values = {
            "A_vs_B": float(index),
            "C_vs_B": float(index * 2),
            "D_vs_B": float(-index) if index < 110 else None,
            "Sparse_vs_B": float(index) if index < 50 else None,
        }
        for comparison, value in values.items():
            rows.append(
                {
                    "comparison_id": comparison,
                    "protein_accession": f"P{index:04d}",
                    "gene_name": f"G{index:04d}",
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
    (results_dir / "visualization_artifacts.json").write_text(
        json.dumps({"schema_version": 1, "generated_at": "fixture"}),
        encoding="utf-8",
    )


def test_builds_pairwise_complete_pearson_in_bounded_blocks(tmp_path):
    from app.services.comparison_correlation import (
        ComparisonCorrelationArtifact,
        build_comparison_correlation_artifact,
    )

    _write_correlation_fixture(tmp_path)
    progress = []
    metadata = build_comparison_correlation_artifact(
        tmp_path,
        block_size=2,
        min_support=100,
        progress_callback=lambda completed, total: progress.append((completed, total)),
    )
    artifact = ComparisonCorrelationArtifact(tmp_path)

    assert metadata["method"] == "pearson"
    assert metadata["comparison_count"] == 4
    assert progress[-1][0] == progress[-1][1]
    assert artifact.get_cell(0, 1) == {
        "row_index": 0,
        "column_index": 1,
        "correlation": 1.0,
        "support_count": 120,
        "sufficient_support": True,
    }
    negative = artifact.get_cell(0, 2)
    assert negative["correlation"] == -1.0
    assert negative["support_count"] == 110
    sparse = artifact.get_cell(0, 3)
    assert sparse["correlation"] is None
    assert sparse["support_count"] == 50
    assert sparse["sufficient_support"] is False


def test_tiles_and_reference_lookup_are_bounded(tmp_path):
    from app.services.comparison_correlation import (
        ComparisonCorrelationArtifact,
        build_comparison_correlation_artifact,
    )

    _write_correlation_fixture(tmp_path)
    build_comparison_correlation_artifact(
        tmp_path, block_size=2, min_support=100, tile_size=2
    )
    artifact = ComparisonCorrelationArtifact(tmp_path)

    tile = artifact.get_tile(level=0, row=0, column=0, tile_size=2)
    assert np.asarray(tile["correlations"]).shape == (2, 2)
    assert np.asarray(tile["support_counts"]).shape == (2, 2)
    assert tile["aggregation"] == "exact"

    lookup = artifact.lookup_reference("A_vs_B", limit=2)
    assert lookup["nearest"][0]["comparison_id"] == "C_vs_B"
    assert lookup["least_correlated"][0]["comparison_id"] == "D_vs_B"

    spearman = artifact.get_spearman("A_vs_B", "D_vs_B")
    assert spearman["correlation"] == pytest.approx(-1.0)
    assert spearman["support_count"] == 110

    detail = artifact.get_fold_change_detail(["A_vs_B", "D_vs_B"], max_proteins=10)
    assert detail["comparisons"] == ["A_vs_B", "D_vs_B"]
    assert len(detail["proteins"]) == 10
    assert len(detail["fold_changes"]) == 10
    assert all(len(row) == 2 for row in detail["fold_changes"])
