"""Tests for PTM equivalents of the standard QC plots."""

import asyncio

import pandas as pd
from app.services.ptm_qc_calculator import _calculate, calculate_protein_qc_plots


def test_ptm_qc_uses_site_and_psm_channel_matrices():
    site_rows = []
    for site, base in (("P1_C10", 100.0), ("P2_C20", 200.0)):
        for condition in ("DMSO", "Drug"):
            for replicate in (1, 2):
                site_rows.append(
                    {
                        "ProteinName": site,
                        "Condition": condition,
                        "Replicate": replicate,
                        "NormalizedAbundance": base + replicate * 10,
                        "Imputed": site == "P2_C20"
                        and condition == "Drug"
                        and replicate == 2,
                    }
                )

    psm_rows = []
    for psm, base in (("PSM1", 1000.0), ("PSM2", 2000.0)):
        for condition in ("DMSO", "Drug"):
            for replicate in (1, 2):
                psm_rows.append(
                    {
                        "PSM": psm,
                        "Condition": condition,
                        "BioReplicate": f"{condition}_{replicate}",
                        "Intensity": base + replicate * 100,
                    }
                )

    result = _calculate(
        pd.DataFrame(site_rows),
        pd.DataFrame(psm_rows),
        pd.DataFrame(
            {
                "Comparison": ["Drug_vs_DMSO", "Drug_vs_DMSO"],
                "pvalue": [0.01, 0.9],
            }
        ),
    )

    assert result["total_proteins"] == 2
    assert result["total_psms"] == 2
    assert result["pca"]["samples"] == ["DMSO_1", "DMSO_2", "Drug_1", "Drug_2"]
    assert result["data_completeness"]["Drug_2"] == {
        "present": 1,
        "missing": 1,
    }
    assert set(result["protein_cv"]) == {"DMSO", "Drug"}
    assert set(result["psm_cv"]) == {"DMSO", "Drug"}
    assert "Drug_vs_DMSO" in result["pvalue_distributions"]


def test_protein_qc_reads_optional_protein_outputs(tmp_path):
    summary_rows = []
    psm_rows = []
    for protein, abundance in (("P1", 10.0), ("P2", 11.0)):
        for condition in ("DMSO", "Drug"):
            for replicate in (1, 2):
                summary_rows.append(
                    {
                        "Protein": protein,
                        "Condition": condition,
                        "BioReplicate": f"{condition}_{replicate}",
                        "Abundance": abundance + replicate / 10,
                    }
                )
                psm_rows.append(
                    {
                        "PSM": f"{protein}_PSM",
                        "Condition": condition,
                        "BioReplicate": f"{condition}_{replicate}",
                        "Intensity": 2 ** (abundance + replicate / 10),
                    }
                )

    pd.DataFrame(summary_rows).to_csv(
        tmp_path / "protein_summarized.tsv", sep="\t", index=False
    )
    pd.DataFrame(psm_rows).to_csv(
        tmp_path / "protein_msstats_input.tsv", sep="\t", index=False
    )
    pd.DataFrame(
        {
            "Comparison": ["Drug_vs_DMSO", "Drug_vs_DMSO"],
            "pvalue": [0.01, 0.5],
        }
    ).to_csv(tmp_path / "protein_results.tsv", sep="\t", index=False)

    result = asyncio.run(calculate_protein_qc_plots(tmp_path))

    assert result is not None
    assert result["total_proteins"] == 2
    assert result["total_psms"] == 2
    assert result["pca"]["samples"] == ["DMSO_1", "DMSO_2", "Drug_1", "Drug_2"]
    assert "Drug_vs_DMSO" in result["pvalue_distributions"]
