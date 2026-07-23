"""Contract tests for canonical visualization artifacts."""

import json

import pandas as pd
import pytest
from app.models.analysis import AnalysisConfig, PipelineTool


def _config() -> AnalysisConfig:
    return AnalysisConfig(
        pipeline=PipelineTool.MSQROB2,
        file_type="dia",
        comparisons=[
            {
                "group1": {"drug": "Drug"},
                "group2": {"drug": "DMSO"},
            },
            {
                "group1": {"drug": "Other"},
                "group2": {"drug": "DMSO"},
            },
        ],
        metadata={
            "dmso_1.txt": {"drug": "DMSO", "replicate": "1", "batch": "A"},
            "dmso_2.txt": {"drug": "DMSO", "replicate": "2", "batch": "A"},
            "drug_1.txt": {"drug": "Drug", "replicate": "1", "batch": "A"},
            "other_1.txt": {"drug": "Other", "replicate": "1", "batch": "B"},
        },
        msqrob2_normalization="center.median",
        msqrob2_imputation="MinDet",
    )


def _write_sources(results_dir) -> None:
    pd.DataFrame(
        {
            "Master_Protein_Accessions": ["P1", "P2"],
            "Gene_Name": ["GENE1", "GENE2"],
            "PSM_Count": [4, 2],
            "DMSO_1": [10.0, 8.0],
            "DMSO_2": [12.0, 9.0],
            "Drug_1": [14.0, 10.0],
            "Other_1": [30.0, 11.0],
        }
    ).to_csv(results_dir / "Protein_Abundances.tsv", sep="\t", index=False)

    pd.DataFrame(
        {
            "ProteinAccession": ["P1", "P1", "P1", "P1"],
            "GeneName": ["GENE1"] * 4,
            "PeptideId": ["PEP1", "PEP1", "PEP2", "PEP2"],
            "SampleId": ["DMSO_1", "Drug_1", "DMSO_1", "Drug_1"],
            "Condition": ["DMSO", "Drug", "DMSO", "Drug"],
            "Replicate": ["1", "1", "1", "1"],
            "ProcessedLog2Abundance": [9.5, 13.5, 10.5, 14.5],
            "Provenance": ["observed", "imputed", "observed", "observed"],
            "ResultLayer": ["protein"] * 4,
        }
    ).to_csv(results_dir / "peptide_processed_long.tsv", sep="\t", index=False)

    pd.DataFrame(
        {
            "Label": ["Drug_vs_DMSO"] * 2 + ["Other_vs_DMSO"] * 2,
            "Master_Protein_Accessions": ["P1", "P2", "P1", "P2"],
            "Gene_Name": ["GENE1", "GENE2", "GENE1", "GENE2"],
            "logFC": [1.0, -1.0, 1.0, -1.0],
            "pval": [0.01, 0.5, 0.01, 0.5],
            "adjPval": [0.02, 0.6, 0.02, 0.6],
        }
    ).to_csv(
        results_dir / "Differential_Results_Long.tsv",
        sep="\t",
        index=False,
    )


def test_materializes_versioned_processed_log2_contract(tmp_path):
    from app.services.visualization_artifacts import (
        VISUALIZATION_SCHEMA_VERSION,
        materialize_visualization_artifacts,
    )

    _write_sources(tmp_path)
    manifest = materialize_visualization_artifacts(
        tmp_path,
        config=_config(),
        pipeline="msqrob2",
    )

    assert manifest["schema_version"] == VISUALIZATION_SCHEMA_VERSION
    assert manifest["abundance_scale"] == "log2"
    assert manifest["normalization_method"] == "center.median"
    assert manifest["imputation_method"] == "MinDet"
    assert manifest["artifacts"]["protein_abundance"] == (
        "protein_abundance_long.parquet"
    )

    stored = json.loads(
        (tmp_path / "visualization_artifacts.json").read_text(encoding="utf-8")
    )
    assert stored == manifest

    protein = pd.read_parquet(tmp_path / "protein_abundance_long.parquet")
    assert set(protein["processed_log2_abundance"]) == {
        8.0,
        9.0,
        10.0,
        11.0,
        12.0,
        14.0,
        30.0,
    }
    assert set(protein["condition"]) == {"DMSO", "Drug", "Other"}
    assert set(protein["provenance"]) == {"model_estimated"}
    p1_drug = protein[
        (protein["protein_accession"] == "P1") & (protein["sample_id"] == "Drug_1")
    ].iloc[0]
    assert p1_drug["observed_feature_count"] == 1
    assert p1_drug["imputed_feature_count"] == 1
    assert p1_drug["imputation_fraction"] == pytest.approx(0.5)

    peptide = pd.read_parquet(tmp_path / "peptide_abundance_long.parquet")
    assert peptide["processed_log2_abundance"].tolist() == [9.5, 13.5, 10.5, 14.5]
    assert peptide["provenance"].tolist() == [
        "observed",
        "imputed",
        "observed",
        "observed",
    ]

    comparisons = pd.read_parquet(tmp_path / "comparison_catalog.parquet")
    assert comparisons["comparison_id"].tolist() == [
        "Drug_vs_DMSO",
        "Other_vs_DMSO",
    ]
    differential = pd.read_parquet(tmp_path / "differential_results.parquet")
    assert differential["comparison_id"].tolist() == [
        "Drug_vs_DMSO",
        "Drug_vs_DMSO",
        "Other_vs_DMSO",
        "Other_vs_DMSO",
    ]
    qc_groups = pd.read_parquet(tmp_path / "qc_group_metrics.parquet")
    dmso = qc_groups[
        (qc_groups["group_by"] == "condition") & (qc_groups["group_value"] == "DMSO")
    ].iloc[0]
    assert dmso["protein_cv_count"] == 2
    assert dmso["protein_cv_median"] > 0


def test_abundance_repository_scopes_summary_and_detail_to_comparison(tmp_path):
    from app.services.abundance_repository import AbundanceRepository
    from app.services.visualization_artifacts import materialize_visualization_artifacts

    _write_sources(tmp_path)
    materialize_visualization_artifacts(
        tmp_path,
        config=_config(),
        pipeline="msqrob2",
    )
    repository = AbundanceRepository(tmp_path)

    protein = repository.get_summary(
        entity="protein",
        protein_accession="P1",
        comparison_id="Drug_vs_DMSO",
        result_layer="protein",
    )

    assert [group["condition"] for group in protein["groups"]] == ["Drug", "DMSO"]
    assert [point["sample_id"] for point in protein["points"]] == [
        "Drug_1",
        "DMSO_1",
        "DMSO_2",
    ]
    assert [point["processed_log2_abundance"] for point in protein["points"]] == [
        14.0,
        10.0,
        12.0,
    ]
    assert protein["scale"] == "log2"

    peptide = repository.get_summary(
        entity="peptide",
        protein_accession="P1",
        comparison_id="Drug_vs_DMSO",
        result_layer="protein",
    )
    assert [group["condition"] for group in peptide["groups"]] == ["Drug", "DMSO"]
    assert len(peptide["points"]) == 4
    assert peptide["groups"][0]["imputed_count"] == 1

    first_page = repository.get_detail(
        entity="peptide",
        protein_accession="P1",
        comparison_id="Drug_vs_DMSO",
        result_layer="protein",
        cursor=None,
        limit=2,
    )
    assert len(first_page["items"]) == 2
    assert first_page["next_cursor"] is not None
    second_page = repository.get_detail(
        entity="peptide",
        protein_accession="P1",
        comparison_id="Drug_vs_DMSO",
        result_layer="protein",
        cursor=first_page["next_cursor"],
        limit=2,
    )
    assert len(second_page["items"]) == 2
    assert second_page["next_cursor"] is None


def test_repository_suppresses_unknown_comparison(tmp_path):
    from app.services.abundance_repository import AbundanceRepository
    from app.services.visualization_artifacts import materialize_visualization_artifacts

    _write_sources(tmp_path)
    materialize_visualization_artifacts(
        tmp_path,
        config=_config(),
        pipeline="msqrob2",
    )

    with pytest.raises(ValueError, match="Unknown comparison"):
        AbundanceRepository(tmp_path).get_summary(
            entity="protein",
            protein_accession="P1",
            comparison_id="missing",
            result_layer="protein",
        )


def test_heatmap_uses_all_and_only_comparison_samples_with_raw_log2_hover_data(
    tmp_path,
):
    from app.services.abundance_repository import AbundanceRepository
    from app.services.visualization_artifacts import materialize_visualization_artifacts

    _write_sources(tmp_path)
    materialize_visualization_artifacts(
        tmp_path,
        config=_config(),
        pipeline="msqrob2",
    )

    heatmap = AbundanceRepository(tmp_path).get_gene_heatmap(
        genes=["GENE2", "GENE1", "MISSING"],
        comparison_id="Drug_vs_DMSO",
    )

    assert heatmap["genes"] == ["GENE2", "GENE1"]
    assert heatmap["protein_accessions"] == ["P2", "P1"]
    assert heatmap["samples"] == ["Drug_1", "DMSO_1", "DMSO_2"]
    assert heatmap["conditions"] == ["Drug", "DMSO", "DMSO"]
    assert heatmap["log2_abundances"] == [
        [10.0, 8.0, 9.0],
        [14.0, 10.0, 12.0],
    ]
    assert heatmap["z_scores"][0] == pytest.approx([1.22474487, -1.22474487, 0.0])
    assert heatmap["z_scores"][1] == pytest.approx([1.22474487, -1.22474487, 0.0])
