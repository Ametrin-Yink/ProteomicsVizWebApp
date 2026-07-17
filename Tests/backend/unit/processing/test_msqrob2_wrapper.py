"""Behavior contracts for msqrob2 command configuration."""

import pytest
from app.models.analysis import AnalysisConfig
from app.services.msqrob2_wrapper import Msqrob2Wrapper


@pytest.fixture
def wrapper() -> Msqrob2Wrapper:
    return Msqrob2Wrapper()


def test_data_process_config_maps_scientific_parameters(wrapper):
    source = AnalysisConfig(
        msqrob2_normalization="quantiles",
        msqrob2_imputation="knn",
        msqrob2_aggregation="medianPolish",
        resolve_shared_peptides=True,
        max_missing_fraction_per_condition=0.2,
        min_psms_per_protein=3,
        msqrob2_batch_column="batch",
        metadata={
            "sample.txt": {
                "condition": "DrugA",
                "replicate": "1",
                "batch": "Plate1",
            }
        },
    )

    result = wrapper._build_data_process_config(source, n_cores=5)
    assert result == {
        "normalization": "quantiles",
        "imputation": "knn",
        "aggregation": "medianPolish",
        "numberOfCores": 5,
        "batch_column": "batch",
        "metadata": {
            "sample.txt": {
                "condition_1": "DrugA",
                "replicate": "1",
                "batch": "Plate1",
            }
        },
        "keep_intermediate_assays": False,
    }


def test_data_process_script_counts_distinct_psms(wrapper):
    script = (wrapper.scripts_dir / "msqrob2_data_process.R").read_text()
    assert ".(PSM_Count = uniqueN(Unique_PSM))" in script


def test_group_comparison_config_maps_model_options(wrapper):
    source = AnalysisConfig(
        msqrob2_ridge=True,
        msqrob2_adjust_method="holm",
        msqrob2_batch_column="batch",
    )
    result = wrapper._build_gc_config(
        source,
        n_cores=3,
        skip_fit=True,
        save_fitted_rds=True,
    )
    assert result == {
        "ridge": True,
        "maxitRob": 10,
        "adjust_method": "holm",
        "numberOfCores": 3,
        "batch_column": "batch",
        "metadata": None,
        "skip_fit": True,
        "save_fitted_rds": True,
    }


def test_command_extras_are_empty(wrapper):
    assert wrapper._build_cmd_extras() == []
