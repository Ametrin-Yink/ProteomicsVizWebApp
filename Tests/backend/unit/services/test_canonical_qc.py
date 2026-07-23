"""Tests for bounded QC generation from canonical visualization artifacts."""

import json

import pandas as pd
from app.models.analysis import AnalysisConfig, PipelineTool
from app.services import canonical_qc
from app.services.visualization_artifacts import materialize_visualization_artifacts


def _write_artifacts(tmp_path):
    pd.DataFrame(
        {
            "Master_Protein_Accessions": ["P1", "P2", "P3"],
            "Gene_Name": ["G1", "G2", "G3"],
            "A_1": [10.0, 13.0, 7.0],
            "A_2": [11.0, 12.0, 8.0],
            "B_1": [14.0, 9.0, 9.0],
            "B_2": [15.0, 8.0, 10.0],
        }
    ).to_csv(tmp_path / "Protein_Abundances.tsv", sep="\t", index=False)
    pd.DataFrame(
        {
            "Label": ["A_vs_B", "A_vs_B", "A_vs_B"],
            "Master_Protein_Accessions": ["P1", "P2", "P3"],
            "Gene_Name": ["G1", "G2", "G3"],
            "logFC": [-2.0, 2.0, 0.1],
            "pval": [0.01, 0.02, 0.5],
            "adjPval": [0.02, 0.03, 0.5],
        }
    ).to_csv(tmp_path / "Differential_Results_Long.tsv", sep="\t", index=False)
    psm_path = tmp_path / "filtered_psms.parquet"
    pd.DataFrame(
        {
            "Unique_PSM": ["PSM1", "PSM2", "PSM1", "PSM1"],
            "Condition": ["A", "A", "A", "B"],
            "Replicate": ["1", "1", "2", "1"],
            "Abundance": [100.0, 50.0, 120.0, 80.0],
        }
    ).to_parquet(psm_path, index=False)
    config = AnalysisConfig(
        pipeline=PipelineTool.MSQROB2,
        comparisons=[{"group1": {"C": "A"}, "group2": {"C": "B"}}],
        metadata={
            "A_1": {"C": "A", "replicate": "1"},
            "A_2": {"C": "A", "replicate": "2"},
            "B_1": {"C": "B", "replicate": "1"},
            "B_2": {"C": "B", "replicate": "2"},
        },
    )
    materialize_visualization_artifacts(
        tmp_path,
        config=config,
        pipeline="msqrob2",
    )
    return psm_path


def test_generates_compact_summary_and_one_pca_row_per_sample(tmp_path):
    psm_path = _write_artifacts(tmp_path)

    summary = canonical_qc.generate_canonical_qc(tmp_path, psm_path)

    assert summary["pca_method"] == "exact"
    assert summary["total_psms"] == 2
    assert summary["avg_psms_per_sample"] == 1.3
    assert summary["total_proteins"] == 3
    assert "pca" not in summary
    assert "data_completeness" not in summary
    assert json.loads((tmp_path / "QC_Results.json").read_text()) == summary
    pca = pd.read_parquet(tmp_path / "qc_pca.parquet")
    assert pca["sample_id"].tolist() == ["A_1", "A_2", "B_1", "B_2"]
    assert pca["condition"].tolist() == ["A", "A", "B", "B"]
    assert pca[["pc1", "pc2"]].notna().all().all()


def test_large_matrix_path_uses_incremental_pca(tmp_path, monkeypatch):
    psm_path = _write_artifacts(tmp_path)
    monkeypatch.setattr(canonical_qc, "EXACT_PCA_ELEMENT_LIMIT", 1)

    summary = canonical_qc.generate_canonical_qc(tmp_path, psm_path)

    assert summary["pca_method"] == "incremental"
    assert len(pd.read_parquet(tmp_path / "qc_pca.parquet")) == 4
