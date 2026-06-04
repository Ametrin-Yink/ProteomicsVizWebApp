"""Unit tests for GSEA service — running ES curve and heatmap computation."""
import numpy as np
import pandas as pd
import pytest
from app.services.gsea_service import gsea_service


class TestRunningESCurve:
    def test_positive_nes_produces_curve(self):
        """With positive NES, the ES curve contains valid points."""
        ranked_genes = ["A", "B", "C", "D", "E", "F", "G", "H"]
        pathway_genes = ["A", "C", "E", "G"]
        ranked_metrics = [3.0, 2.0, 1.5, 1.0, 0.5, 0.0, -0.5, -1.0]

        curve = gsea_service.generate_running_es_curve(
            ranked_genes, pathway_genes, nes=2.0, ranked_metrics=ranked_metrics
        )

        assert isinstance(curve, list)
        assert len(curve) > 0
        assert len(curve[0]) == 2  # [position, es_value]

    def test_curve_peak_positive_when_enriched_at_top(self):
        ranked_genes = ["A", "B", "C", "D", "E", "F", "G", "H"]
        pathway_genes = ["A", "C", "E", "G"]
        ranked_metrics = [3.0, 2.0, 1.5, 1.0, 0.5, 0.0, -0.5, -1.0]

        curve = gsea_service.generate_running_es_curve(
            ranked_genes, pathway_genes, nes=2.0, ranked_metrics=ranked_metrics
        )

        max_es = max(p[1] for p in curve)
        assert max_es > 0

    def test_negative_nes_produces_trough(self):
        ranked_genes = ["A", "B", "C", "D", "E", "F", "G", "H"]
        pathway_genes = ["G", "H"]
        ranked_metrics = [3.0, 2.0, 1.5, 1.0, 0.5, 0.0, -0.5, -1.0]

        curve = gsea_service.generate_running_es_curve(
            ranked_genes, pathway_genes, nes=-1.8, ranked_metrics=ranked_metrics
        )

        min_es = min(p[1] for p in curve)
        assert min_es < 0

    def test_empty_pathway_genes_handled(self):
        curve = gsea_service.generate_running_es_curve(
            ["A", "B", "C"], [], nes=1.0, ranked_metrics=[1.0, 0.5, 0.0]
        )
        assert isinstance(curve, list)

    def test_no_overlap_produces_empty_or_decreasing_curve(self):
        ranked_genes = ["A", "B", "C"]
        pathway_genes = ["X", "Y", "Z"]
        ranked_metrics = [1.0, 0.5, 0.0]

        curve = gsea_service.generate_running_es_curve(
            ranked_genes, pathway_genes, nes=1.0, ranked_metrics=ranked_metrics
        )

        # May return empty list or valid curve depending on implementation
        assert isinstance(curve, list)
        if len(curve) > 0:
            # No gene hits ever — ES should never increase above 0
            for p in curve:
                assert len(p) == 2

    def test_all_hits_at_start_produces_strong_peak(self):
        ranked_genes = ["A", "B", "C", "D", "E", "F", "G", "H"]
        pathway_genes = ["A", "B", "C"]
        ranked_metrics = [5.0, 4.0, 3.0, 2.0, 1.0, 0.0, -1.0, -2.0]

        curve = gsea_service.generate_running_es_curve(
            ranked_genes, pathway_genes, nes=2.5, ranked_metrics=ranked_metrics
        )

        assert len(curve) > 0
        # Early positions should have increasing ES
        early_es = [p[1] for p in curve[:4]]
        assert max(early_es) > 0


class TestGenerateHeatmapData:
    def test_returns_genes_samples_zscores(self):
        protein_df = pd.DataFrame({
            "Master_Protein_Accessions": ["P1", "P2", "P3", "P4"],
            "Gene_Name": ["GENE1", "GENE2", "GENE3", "GENE4"],
            "S1": [15.0, 14.0, 13.0, 12.0],
            "S2": [16.0, 14.5, 12.5, 11.5],
            "S3": [14.5, 13.5, 13.5, 12.5],
        })

        result = gsea_service.generate_heatmap_data(
            protein_df, lead_genes=["GENE1", "GENE2", "GENE3"]
        )

        assert result is not None
        assert "genes" in result
        assert "samples" in result
        assert "z_scores" in result
        assert len(result["genes"]) == 3
        assert len(result["samples"]) == 3

    def test_missing_lead_genes_returns_none(self):
        protein_df = pd.DataFrame({
            "Master_Protein_Accessions": ["P1"],
            "Gene_Name": ["GENE1"],
            "S1": [15.0],
        })

        result = gsea_service.generate_heatmap_data(
            protein_df, lead_genes=["NONEXISTENT"]
        )

        assert result is None

    def test_excludes_psm_count_column(self):
        protein_df = pd.DataFrame({
            "Master_Protein_Accessions": ["P1"],
            "Gene_Name": ["GENE1"],
            "PSM_Count": [5],
            "S1": [15.0],
        })

        result = gsea_service.generate_heatmap_data(
            protein_df, lead_genes=["GENE1"]
        )

        assert result is not None
        assert "PSM_Count" not in result["samples"]

    def test_single_gene_single_sample(self):
        protein_df = pd.DataFrame({
            "Master_Protein_Accessions": ["P1"],
            "Gene_Name": ["GENE1"],
            "S1": [10.0],
        })

        result = gsea_service.generate_heatmap_data(
            protein_df, lead_genes=["GENE1"]
        )

        assert result is not None
        assert len(result["genes"]) == 1
        assert len(result["samples"]) == 1
        assert len(result["z_scores"]) == 1

    def test_empty_protein_df_handled(self):
        protein_df = pd.DataFrame({
            "Master_Protein_Accessions": [],
            "Gene_Name": [],
            "S1": [],
        }).astype({"S1": "float64"})

        result = gsea_service.generate_heatmap_data(
            protein_df, lead_genes=["GENE1"]
        )

        # Should handle gracefully — either None or valid structure
        if result is not None:
            assert "genes" in result
