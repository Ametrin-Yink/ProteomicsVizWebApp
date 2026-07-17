"""Behavior contracts for MSstats command configuration."""

import json

import pytest
from app.models.analysis import AnalysisConfig
from app.services.msstats_wrapper import MsstatsWrapper


@pytest.fixture
def wrapper() -> MsstatsWrapper:
    return MsstatsWrapper()


def test_data_process_config_maps_scientific_parameters(wrapper):
    source = AnalysisConfig(
        msstats_normalization="quantile",
        msstats_feature_selection="topN",
        msstats_summary_method="linear",
        msstats_impute=False,
        msstats_log_base=10,
        msstats_censored_int="0",
        msstats_max_quantile=0.95,
        msstats_remove50missing=True,
        msstats_n_top_feature=5,
        msstats_min_feature_count=4,
        msstats_remove_uninformative_feature_outlier=True,
        msstats_equal_feature_var=False,
        msstats_name_standards="P1,P2",
        min_peptides_per_protein=3,
    )

    assert wrapper._build_data_process_config(source, n_cores=6) == {
        "normalization": "quantile",
        "logTrans": 10,
        "summaryMethod": "linear",
        "MBimpute": False,
        "featureSubset": "topN",
        "n_top_feature": 5,
        "censoredInt": "0",
        "maxQuantileforCensored": 0.95,
        "remove50missing": True,
        "min_feature_count": 4,
        "remove_uninformative_feature_outlier": True,
        "equalFeatureVar": False,
        "nameStandards": "P1,P2",
        "min_peptides": 3,
        "numberOfCores": 6,
    }


def test_group_comparison_config_maps_runtime_options(wrapper):
    result = wrapper._build_gc_config(
        AnalysisConfig(),
        n_cores=4,
        log_base=10,
        save_fitted_models=False,
    )
    assert result == {
        "log_base": 10,
        "save_fitted_models": False,
        "numberOfCores": 4,
    }


@pytest.mark.parametrize(
    "covariates,expected",
    [({"Batch": "Plate"}, {"Batch": "Plate"}), (None, {})],
)
def test_command_extras_serialize_covariates(wrapper, covariates, expected):
    extras = wrapper._build_cmd_extras(covariates=covariates)
    assert len(extras) == 1
    assert json.loads(extras[0]) == expected
