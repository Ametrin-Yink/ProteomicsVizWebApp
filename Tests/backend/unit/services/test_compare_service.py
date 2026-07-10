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


class TestDimensionalityReduction:
    def test_cluster_pca_returns_2d(self):
        np.random.seed(42)
        matrix = np.random.randn(20, 10)
        from app.services.compare_service import run_cluster

        coords, variance = run_cluster(matrix, "pca")
        assert coords.shape == (20, 2)
        assert len(variance) == 2
        assert 0 < variance[0] < 1

    def test_cluster_umap_returns_2d(self):
        np.random.seed(42)
        matrix = np.random.randn(20, 10)
        from app.services.compare_service import run_cluster

        coords, variance = run_cluster(matrix, "umap")
        assert coords.shape == (20, 2)
        # variance is None when umap falls back to PCA
        assert variance is None or len(variance) == 2

    def test_cluster_tsne_returns_2d(self):
        np.random.seed(42)
        matrix = np.random.randn(20, 10)
        from app.services.compare_service import run_cluster

        coords, variance = run_cluster(matrix, "tsne")
        assert coords.shape == (20, 2)
        # variance is None when tsne falls back to PCA
        assert variance is None or len(variance) == 2

    def test_cluster_unknown_method_falls_back(self):
        np.random.seed(42)
        matrix = np.random.randn(20, 10)
        from app.services.compare_service import run_cluster

        coords, _variance = run_cluster(matrix, "invalid_method")
        assert coords.shape == (20, 2)


class TestVennDiagram:
    def test_computes_two_comparisons(self, tmp_path):
        results_dir = tmp_path / "results"
        results_dir.mkdir()
        pd.DataFrame(
            {
                "Master_Protein_Accessions": ["P1", "P2", "P3", "P4"],
                "Gene_Name": ["G1", "G2", "G3", "G4"],
                "logFC": [2.0, -1.5, 0.3, 0.1],
                "pval": [0.001, 0.01, 0.5, 0.05],
                "adjPval": [0.005, 0.05, 0.6, 0.04],
            }
        ).to_csv(results_dir / "Diff_Expression_A_vs_B.tsv", sep="\t", index=False)

        pd.DataFrame(
            {
                "Master_Protein_Accessions": ["P1", "P3", "P4", "P5"],
                "Gene_Name": ["G1", "G3", "G4", "G5"],
                "logFC": [1.5, 0.8, -2.0, 0.2],
                "pval": [0.0001, 0.03, 0.001, 0.5],
                "adjPval": [0.001, 0.04, 0.005, 0.5],
            }
        ).to_csv(results_dir / "Diff_Expression_C_vs_D.tsv", sep="\t", index=False)

        from app.services.compare_service import compute_venn_data

        result = compute_venn_data(
            str(tmp_path),
            ["A_vs_B", "C_vs_D"],
            pvalue_threshold=0.05,
            logfc_threshold=1.0,
        )
        assert result is not None

    def test_computes_three_comparisons(self, tmp_path):
        results_dir = tmp_path / "results"
        results_dir.mkdir()
        for comp in ["A_vs_B", "C_vs_D", "E_vs_F"]:
            pd.DataFrame(
                {
                    "Master_Protein_Accessions": ["P1", "P2"],
                    "Gene_Name": ["G1", "G2"],
                    "logFC": [2.0, -1.5],
                    "pval": [0.001, 0.01],
                    "adjPval": [0.005, 0.05],
                }
            ).to_csv(
                results_dir / f"Diff_Expression_{comp}.tsv",
                sep="\t",
                index=False,
            )

        from app.services.compare_service import compute_venn_data

        result = compute_venn_data(
            str(tmp_path),
            ["A_vs_B", "C_vs_D", "E_vs_F"],
            pvalue_threshold=0.05,
            logfc_threshold=1.0,
        )
        assert result is not None


class TestHierarchicalOrder:
    def test_returns_all_indices(self):
        np.random.seed(42)
        matrix = np.random.randn(30, 5)
        from app.services.compare_service import compute_hierarchical_order

        order = compute_hierarchical_order(matrix)
        assert len(order) == 30
        assert len(set(order)) == 30

    def test_single_row_returns_trivial(self):
        matrix = np.array([[1.0, 2.0, 3.0]])
        from app.services.compare_service import compute_hierarchical_order

        order = compute_hierarchical_order(matrix)
        assert order == [0]

    def test_two_rows_returns_both(self):
        matrix = np.array([[1.0, 2.0], [3.0, 4.0]])
        from app.services.compare_service import compute_hierarchical_order

        order = compute_hierarchical_order(matrix)
        assert len(order) == 2
        assert set(order) == {0, 1}


class TestSimilarityMatrix:
    def test_symmetric_matrix(self):
        np.random.seed(42)
        matrix = np.random.randn(10, 6)
        from app.services.compare_service import compute_similarity_matrix

        sim = compute_similarity_matrix(matrix)
        assert sim.shape == (10, 10)
        # Should be symmetric
        assert np.allclose(sim, sim.T)

    def test_diagonal_is_zero_or_minimal(self):
        np.random.seed(42)
        matrix = np.random.randn(10, 6)
        from app.services.compare_service import compute_similarity_matrix

        sim = compute_similarity_matrix(matrix)
        # Diagonal should be 0 (distance to self)
        for i in range(10):
            assert abs(sim[i, i]) < 1e-6
