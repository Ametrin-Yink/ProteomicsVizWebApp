"""Tests for the PTM optional-protein downstream analysis adapter."""

import asyncio

import pandas as pd
from app.api.routes.visualization_ptm import load_ptm_results
from app.core.config import settings


def test_ptm_protein_results_include_fasta_gene_and_distinct_psm_count(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "protein_database_dir", tmp_path)
    (tmp_path / "Human_Sequence.fasta").write_text(
        ">sp|P1|PROTEIN_ONE GN=GENE1\nMPEPTIDE\n",
        encoding="utf-8",
    )
    results_dir = tmp_path / "results"
    results_dir.mkdir()
    pd.DataFrame(
        {
            "Protein": ["P1"],
            "ProteinAccession": ["P1"],
            "Comparison": ["Drug_vs_DMSO"],
            "log2FC": [1.2],
            "pvalue": [0.01],
            "adj.pvalue": [0.02],
        }
    ).to_csv(results_dir / "protein_results.tsv", sep="\t", index=False)
    pd.DataFrame(
        {
            "ProteinName": ["P1", "P1", "P1"],
            "PSM": ["PSM1", "PSM1", "PSM2"],
        }
    ).to_csv(results_dir / "protein_msstats_input.tsv", sep="\t", index=False)
    pd.DataFrame(
        {
            "Protein": ["SITE"],
            "Comparison": ["Drug_vs_DMSO"],
            "log2FC": [1.0],
            "pvalue": [0.01],
            "adj.pvalue": [0.02],
        }
    ).to_csv(results_dir / "ptm_site_results.tsv", sep="\t", index=False)

    comparisons = asyncio.run(
        load_ptm_results(
            results_dir,
            comparison="Drug_vs_DMSO",
            layer="protein",
            fasta_path=tmp_path / "Human_Sequence.fasta",
        )
    )

    protein = comparisons[0]["protein_model"][0]
    assert protein["Gene_Name"] == "GENE1"
    assert protein["PSM_Count"] == 2
