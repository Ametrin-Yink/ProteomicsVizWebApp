"""Tests for bounded visualization catalog and QC queries."""

import pandas as pd
import pytest
from app.models.analysis import AnalysisConfig, PipelineTool
from app.services.visualization_artifacts import materialize_visualization_artifacts


def _materialize(results_dir):
    config = AnalysisConfig(
        pipeline=PipelineTool.MSQROB2,
        comparisons=[
            {"group1": {"drug": "Drug"}, "group2": {"drug": "DMSO"}},
            {"group1": {"drug": "Other"}, "group2": {"drug": "DMSO"}},
        ],
    )
    pd.DataFrame(
        {
            "Master_Protein_Accessions": ["P1", "P2"],
            "Gene_Name": ["GENE1", "GENE2"],
            "DMSO_1": [10.0, 9.0],
            "Drug_1": [12.0, 11.0],
            "Other_1": [14.0, 13.0],
        }
    ).to_csv(results_dir / "Protein_Abundances.tsv", sep="\t", index=False)
    pd.DataFrame(
        columns=[
            "ProteinAccession",
            "GeneName",
            "PeptideId",
            "SampleId",
            "Condition",
            "Replicate",
            "ProcessedLog2Abundance",
            "Provenance",
            "ResultLayer",
        ]
    ).to_csv(results_dir / "peptide_processed_long.tsv", sep="\t", index=False)
    pd.DataFrame(
        {
            "Label": ["Drug_vs_DMSO"] * 2 + ["Other_vs_DMSO"] * 2,
            "Master_Protein_Accessions": ["P1", "P2", "P1", "P2"],
            "Gene_Name": ["GENE1", "GENE2", "GENE1", "GENE2"],
            "logFC": [1.0, -1.0, 1.0, -1.0],
            "pval": [0.01, 0.5, 0.02, None],
            "adjPval": [0.01, 0.5, 0.02, None],
        }
    ).to_csv(results_dir / "Differential_Results_Long.tsv", sep="\t", index=False)
    materialize_visualization_artifacts(results_dir, config=config, pipeline="msqrob2")


def test_catalogs_are_searchable_and_cursor_paginated(tmp_path):
    from app.services.visualization_repository import VisualizationRepository

    _materialize(tmp_path)
    repository = VisualizationRepository(tmp_path)

    first = repository.list_comparisons(search=None, cursor=None, limit=1)
    assert [item["comparison_id"] for item in first["items"]] == ["Drug_vs_DMSO"]
    assert first["next_cursor"] is not None
    second = repository.list_comparisons(
        search=None, cursor=first["next_cursor"], limit=1
    )
    assert [item["comparison_id"] for item in second["items"]] == ["Other_vs_DMSO"]
    assert second["next_cursor"] is None

    samples = repository.list_samples(search="other", cursor=None, limit=50)
    assert [item["sample_id"] for item in samples["items"]] == ["Other_1"]


def test_qc_overview_is_bounded_to_fifty_groups(tmp_path):
    from app.services.visualization_repository import VisualizationRepository

    _materialize(tmp_path)
    repository = VisualizationRepository(tmp_path)
    overview = repository.get_qc_overview(
        group_by="condition", search=None, cursor=None, limit=50
    )

    assert [group["group_value"] for group in overview["groups"]] == [
        "Drug",
        "DMSO",
        "Other",
    ]
    assert overview["normalization_method"] == "center.median"

    with pytest.raises(ValueError, match="at most 50"):
        repository.get_qc_overview(
            group_by="condition", search=None, cursor=None, limit=51
        )


def test_qc_sample_health_is_searchable_and_cursor_paginated(tmp_path):
    from app.services.visualization_repository import VisualizationRepository

    _materialize(tmp_path)
    repository = VisualizationRepository(tmp_path)
    first = repository.list_qc_samples(search=None, cursor=None, limit=2)

    assert [item["sample_id"] for item in first["items"]] == ["DMSO_1", "Drug_1"]
    assert first["next_cursor"] is not None
    second = repository.list_qc_samples(
        search=None, cursor=first["next_cursor"], limit=2
    )
    assert [item["sample_id"] for item in second["items"]] == ["Other_1"]

    searched = repository.list_qc_samples(search="other", cursor=None, limit=100)
    assert [item["sample_id"] for item in searched["items"]] == ["Other_1"]


def test_qc_group_search_can_reach_groups_beyond_the_first_viewport(tmp_path):
    from app.services.visualization_artifacts import QC_GROUP_METRICS
    from app.services.visualization_repository import VisualizationRepository

    _materialize(tmp_path)
    groups_path = tmp_path / QC_GROUP_METRICS
    groups = pd.read_parquet(groups_path)
    extra = pd.DataFrame(
        [
            {
                "group_by": "condition",
                "group_value": f"Condition_{index:04d}",
                "sample_count": 1,
                "observation_count": 2,
                "q1": 10.0,
                "median": 11.0,
                "q3": 12.0,
                "observed_count": 2,
                "imputed_count": 0,
                "missing_count": 0,
                "group_order": index + 3,
            }
            for index in range(60)
        ]
    )
    pd.concat([groups, extra], ignore_index=True).to_parquet(groups_path, index=False)

    overview = VisualizationRepository(tmp_path).get_qc_overview(
        group_by="condition",
        search="Condition_0059",
        cursor=None,
        limit=50,
    )

    assert overview["group_count"] == 63
    assert overview["matching_group_count"] == 1
    assert [group["group_value"] for group in overview["groups"]] == ["Condition_0059"]


def test_qc_differential_is_comparison_specific(tmp_path):
    from app.services.visualization_repository import VisualizationRepository

    _materialize(tmp_path)
    repository = VisualizationRepository(tmp_path)

    drug = repository.get_qc_differential("Drug_vs_DMSO")
    other = repository.get_qc_differential("Other_vs_DMSO")

    assert drug["tested_count"] == 2
    assert drug["failed_count"] == 0
    assert sum(drug["pvalue_distribution"]["counts"]) == 2
    assert other["tested_count"] == 1
    assert other["failed_count"] == 1
