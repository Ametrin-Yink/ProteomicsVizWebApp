"""
Unit tests for the compare service.

Tests the core computation functions for fold-change matrix building,
correlation analysis, and dimensionality reduction.
"""

import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from app.services.compare_service import (
    build_fold_change_matrix,
    compute_correlation_matrix,
    compute_protein_correlations,
    run_pca,
)


class TestCorrelationMatrix:
    def test_pearson_correlation_simple(self):
        matrix = np.array(
            [
                [1.0, 2.0, 3.0],
                [1.0, 2.0, 3.0],
            ]
        )
        corr = compute_correlation_matrix(matrix, method="pearson")
        assert corr.shape == (2, 2)
        assert corr[0, 1] == pytest.approx(1.0, abs=1e-6)

    def test_spearman_correlation_rank(self):
        matrix = np.array(
            [
                [1.0, 2.0, 3.0],
                [10.0, 100.0, 1000.0],
            ]
        )
        corr = compute_correlation_matrix(matrix, method="spearman")
        assert corr[0, 1] == pytest.approx(1.0, abs=1e-6)

    def test_fewer_than_3_comparisons_returns_nan(self):
        matrix = np.array(
            [
                [1.0, 2.0],
                [1.0, 2.0],
            ]
        )
        corr = compute_correlation_matrix(matrix, method="pearson")
        assert np.isnan(corr[0, 1])


class TestProteinCorrelations:
    def test_returns_top_and_bottom(self):
        matrix = np.array(
            [
                [1.0, 2.0, 3.0, 4.0, 5.0],
                [1.1, 2.1, 3.1, 4.1, 5.1],
                [-1.0, -2.0, -3.0, -4.0, -5.0],
                [5.0, -3.0, 1.0, -4.0, 2.0],
            ]
        )
        accessions = ["A", "B", "C", "D"]
        gene_names = ["GeneA", "GeneB", "GeneC", "GeneD"]
        result = compute_protein_correlations(
            matrix, accessions, gene_names, query_idx=0, method="pearson", top_n=2
        )
        # Query protein (A) is included first with correlation 1.0
        assert result[0]["accession"] == "A"
        # B is most correlated with A after self
        assert result[1]["accession"] == "B"
        # C is least correlated with A (perfect negative)
        assert result[-1]["accession"] == "C"
        assert len(result) == 4


class TestFoldChangeMatrix:
    def test_extracts_per_protein_per_comparison(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            results_dir = Path(tmpdir) / "results"
            results_dir.mkdir()
            pd.DataFrame(
                {
                    "Master_Protein_Accessions": ["P1", "P2"],
                    "Gene_Name": ["Gene1", "Gene2"],
                    "logFC": [1.5, -0.8],
                    "pval": [0.001, 0.05],
                    "adjPval": [0.01, 0.2],
                }
            ).to_csv(results_dir / "Diff_Expression_A_vs_B.tsv", sep="\t", index=False)
            pd.DataFrame(
                {
                    "Master_Protein_Accessions": ["P1", "P2"],
                    "Gene_Name": ["Gene1", "Gene2"],
                    "logFC": [2.0, 0.3],
                    "pval": [0.0001, 0.5],
                    "adjPval": [0.005, 0.8],
                }
            ).to_csv(results_dir / "Diff_Expression_C_vs_D.tsv", sep="\t", index=False)

            matrix, accessions, gene_names = build_fold_change_matrix(
                tmpdir, ["A_vs_B", "C_vs_D"]
            )
            assert matrix.shape == (2, 2)
            assert matrix[0, 0] == pytest.approx(1.5)
            assert matrix[1, 1] == pytest.approx(0.3)
            assert accessions == ["P1", "P2"]
            assert gene_names == ["Gene1", "Gene2"]


class TestPCA:
    def test_pca_2d_output(self):
        np.random.seed(42)
        matrix = np.random.randn(50, 5)
        coords, var = run_pca(matrix)
        assert coords.shape == (50, 2)
        assert len(var) == 2
        assert 0 < var[0] < 1
        assert 0 < var[1] < 1
        # Verify variance explained is sum of first 2 component ratios
        assert sum(var) > 0.3  # with 5 features, first 2 should explain >30%
        # Coordinates should be centered (mean ~0)
        assert abs(coords[:, 0].mean()) < 1e-6
        assert abs(coords[:, 1].mean()) < 1e-6
