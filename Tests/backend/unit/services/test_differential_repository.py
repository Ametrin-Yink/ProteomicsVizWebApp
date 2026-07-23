"""Tests for canonical differential-result access."""

import pandas as pd
import pytest


def _repository(tmp_path):
    from app.services.differential_repository import DifferentialRepository

    frame = pd.DataFrame(
        {
            "comparison_id": ["A_vs_B", "A_vs_B", "C_vs_B"],
            "protein_accession": ["P1", "P2", "P3"],
            "gene_name": ["GENE1", "GENE2;ALIAS", "GENE3"],
            "log2_fold_change": [2.0, -1.0, 5.0],
            "p_value": [0.01, 0.1, 0.0001],
            "adjusted_p_value": [0.02, 0.2, 0.001],
            "standard_error": [0.1, 0.2, 0.1],
            "statistic": [5.0, -2.0, 10.0],
            "psm_count": [12, 4, 7],
            "result_layer": ["protein", "protein", "protein"],
            "pipeline": ["msqrob2", "msqrob2", "msqrob2"],
        }
    )
    frame.to_parquet(tmp_path / "differential_results.parquet", index=False)
    return DifferentialRepository(tmp_path)


def test_ranked_genes_are_scoped_to_one_comparison(tmp_path):
    ranking = _repository(tmp_path).get_ranked_genes("A_vs_B")

    assert [row["gene"] for row in ranking] == ["GENE1", "GENE2"]
    assert ranking[0]["metric"] == pytest.approx(2.0)
    assert ranking[1]["metric"] == pytest.approx(-1.0)


def test_exports_only_the_selected_comparison_with_legacy_boundary_headers(tmp_path):
    destination = tmp_path / "scratch" / "comparison.tsv"
    _repository(tmp_path).export_comparison_tsv("A_vs_B", destination)

    exported = pd.read_csv(destination, sep="\t")
    assert exported.columns.tolist() == [
        "Master_Protein_Accessions",
        "Gene_Name",
        "logFC",
        "pval",
        "adjPval",
        "se",
        "t",
    ]
    assert exported["Master_Protein_Accessions"].tolist() == ["P1", "P2"]


def test_unknown_comparison_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="Unknown comparison"):
        _repository(tmp_path).get_ranked_genes("missing")


def test_results_query_filters_sorts_summarizes_and_pages_in_duckdb(tmp_path):
    result = _repository(tmp_path).list_results(
        "A_vs_B",
        page=1,
        page_size=1,
        sort_by="log_fc",
        sort_order="desc",
        search="gene",
        significant_only=False,
    )

    assert result["total"] == 2
    assert result["total_proteins"] == 2
    assert result["significant_proteins"] == 1
    assert result["upregulated"] == 1
    assert result["downregulated"] == 0
    assert result["total_pages"] == 2
    assert result["results"] == [
        {
            "master_protein_accessions": "P1",
            "gene_name": "GENE1",
            "log_fc": 2.0,
            "pval": 0.01,
            "adj_pval": 0.02,
            "se": 0.1,
            "t_statistic": 5.0,
            "significant": True,
            "psm_count": 12,
        }
    ]


def test_results_query_uses_first_comparison_when_unspecified(tmp_path):
    result = _repository(tmp_path).list_results("", page=1, page_size=50)

    assert result["comparison"] == "A_vs_B"
    assert result["total"] == 2
