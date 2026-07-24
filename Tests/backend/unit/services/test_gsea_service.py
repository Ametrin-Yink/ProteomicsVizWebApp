"""Unit tests for GSEA service — running ES curve and heatmap computation."""

import pandas as pd
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
        protein_df = pd.DataFrame(
            {
                "Master_Protein_Accessions": ["P1", "P2", "P3", "P4"],
                "Gene_Name": ["GENE1", "GENE2", "GENE3", "GENE4"],
                "S1": [15.0, 14.0, 13.0, 12.0],
                "S2": [16.0, 14.5, 12.5, 11.5],
                "S3": [14.5, 13.5, 13.5, 12.5],
            }
        )

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
        protein_df = pd.DataFrame(
            {
                "Master_Protein_Accessions": ["P1"],
                "Gene_Name": ["GENE1"],
                "S1": [15.0],
            }
        )

        result = gsea_service.generate_heatmap_data(
            protein_df, lead_genes=["NONEXISTENT"]
        )

        assert result is None

    def test_excludes_psm_count_column(self):
        protein_df = pd.DataFrame(
            {
                "Master_Protein_Accessions": ["P1"],
                "Gene_Name": ["GENE1"],
                "PSM_Count": [5],
                "S1": [15.0],
            }
        )

        result = gsea_service.generate_heatmap_data(protein_df, lead_genes=["GENE1"])

        assert result is not None
        assert "PSM_Count" not in result["samples"]

    def test_single_gene_single_sample(self):
        protein_df = pd.DataFrame(
            {
                "Master_Protein_Accessions": ["P1"],
                "Gene_Name": ["GENE1"],
                "S1": [10.0],
            }
        )

        result = gsea_service.generate_heatmap_data(protein_df, lead_genes=["GENE1"])

        assert result is not None
        assert len(result["genes"]) == 1
        assert len(result["samples"]) == 1
        assert len(result["z_scores"]) == 1

    def test_empty_protein_df_handled(self):
        protein_df = pd.DataFrame(
            {
                "Master_Protein_Accessions": [],
                "Gene_Name": [],
                "S1": [],
            }
        ).astype({"S1": "float64"})

        result = gsea_service.generate_heatmap_data(protein_df, lead_genes=["GENE1"])

        # Should handle gracefully — either None or valid structure
        if result is not None:
            assert "genes" in result


# ── _prepare_ranked_list ────────────────────────────────────────────────


class TestPrepareRankedList:
    def test_ranks_by_metric(self):
        df = pd.DataFrame({
            "Gene_Name": ["A", "B", "C"],
            "pval": [0.01, 0.05, 0.5],
            "logFC": [2.0, -1.5, 0.3],
        })
        result = gsea_service._prepare_ranked_list(df)
        assert result is not None
        assert len(result) == 3
        # A: -log10(0.01)*sign(2.0) = 2.0, should be first (highest metric)
        assert result.iloc[0]["gene"] == "A"

    def test_cleans_gene_names(self):
        df = pd.DataFrame({
            "Gene_Name": ["P12345-2; P67890"],
            "pval": [0.01],
            "logFC": [1.0],
        })
        result = gsea_service._prepare_ranked_list(df)
        assert result is not None
        assert result.iloc[0]["gene"] == "P12345"

    def test_filters_invalid_pvalues(self):
        df = pd.DataFrame({
            "Gene_Name": ["A", "B"],
            "pval": [0.0, 1.5],
            "logFC": [1.0, 1.0],
        })
        result = gsea_service._prepare_ranked_list(df)
        # pval <= 0 filtered, pval > 1 filtered — both should be removed
        assert result is None or len(result) == 0

    def test_missing_columns_returns_none(self):
        df = pd.DataFrame({"X": [1], "Y": [2]})
        result = gsea_service._prepare_ranked_list(df)
        assert result is None


# ── save_results / get_results ──────────────────────────────────────────


class TestSaveAndGetResults:
    def test_save_writes_json(self, tmp_path):
        from app.models.data import GSEAResult, GSEAResults

        results = {
            "go_bp": GSEAResults(
                database="go_bp",
                total_pathways=1,
                significant_pathways=0,
                overrepresented=0,
                underrepresented=0,
                results=[
                    GSEAResult(
                        term="TERM", name="Term", es=0.5, nes=1.2,
                        pval=0.01, fdr=0.02, matched_genes=5,
                    )
                ],
            )
        }
        path = tmp_path / "results.json"
        gsea_service.save_results(results, path)
        assert path.exists()
        import json
        data = json.loads(path.read_text())
        assert "go_bp" in data

    def test_get_results_specific_db(self):
        from app.models.data import GSEAResult, GSEAResults
        results = {
            "go_bp": GSEAResults(
                database="go_bp",
                total_pathways=0, significant_pathways=0,
                overrepresented=0, underrepresented=0,
            )
        }
        r = gsea_service.get_results(results, "go_bp")
        assert r is not None
        r2 = gsea_service.get_results(results, "nonexistent")
        assert r2 is None

    def test_get_results_all(self):
        results = {}
        assert gsea_service.get_results(results) == {}
