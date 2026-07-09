"""Unit tests for MsstatsWrapper — MSstats pipeline command construction."""
import json

import pytest
from app.models.analysis import AnalysisConfig, PipelineTool
from app.services.msstats_wrapper import MsstatsWrapper


@pytest.fixture
def wrapper():
    return MsstatsWrapper()


@pytest.fixture
def msstats_config():
    return AnalysisConfig(
        organism="human",
        treatment="DrugA",
        control="DMSO",
        pipeline=PipelineTool.MSSTATS,
        msstats_normalization="equalizeMedians",
        msstats_feature_selection="highQuality",
        msstats_summary_method="TMP",
        msstats_impute=True,
        msstats_n_top_feature=3,
        msstats_min_feature_count=2,
        msstats_log_base=2,
        msstats_censored_int="NA",
        msstats_max_quantile=0.999,
        msstats_remove50missing=False,
        msstats_remove_uninformative_feature_outlier=True,
        msstats_equal_feature_var=True,
        msstats_name_standards="TRUE",
        min_peptides_per_protein=2,
    )


class TestInit:
    def test_creates_instance(self, wrapper):
        assert wrapper is not None

    def test_has_scripts_dir(self, wrapper):
        assert wrapper.scripts_dir is not None

    def test_n_cores_config_attr(self, wrapper):
        assert wrapper._n_cores_config_attr == "msstats_n_cores"


class TestDataProcessConfig:
    def test_returns_dict(self, wrapper, msstats_config):
        config = wrapper._build_data_process_config(msstats_config, n_cores=4)
        assert isinstance(config, dict)

    def test_includes_normalization(self, wrapper, msstats_config):
        config = wrapper._build_data_process_config(msstats_config, n_cores=4)
        assert config["normalization"] == "equalizeMedians"

    def test_includes_summary_method(self, wrapper, msstats_config):
        config = wrapper._build_data_process_config(msstats_config, n_cores=4)
        assert config["summaryMethod"] == "TMP"

    def test_includes_feature_selection(self, wrapper, msstats_config):
        config = wrapper._build_data_process_config(msstats_config, n_cores=4)
        assert config["featureSubset"] == "highQuality"

    def test_includes_n_top_feature(self, wrapper, msstats_config):
        config = wrapper._build_data_process_config(msstats_config, n_cores=4)
        assert config["n_top_feature"] == 3

    def test_includes_min_feature_count(self, wrapper, msstats_config):
        config = wrapper._build_data_process_config(msstats_config, n_cores=4)
        assert config["min_feature_count"] == 2

    def test_includes_n_cores(self, wrapper, msstats_config):
        config = wrapper._build_data_process_config(msstats_config, n_cores=8)
        assert config["numberOfCores"] == 8

    def test_impute_flag(self, wrapper, msstats_config):
        config = wrapper._build_data_process_config(msstats_config, n_cores=4)
        assert config["MBimpute"] is True

    def test_min_peptides_falls_back_to_1(self, wrapper):
        config = AnalysisConfig(organism="human", treatment="A", control="B")
        result = wrapper._build_data_process_config(config, n_cores=4)
        assert result["min_peptides"] == 1


class TestGroupComparisonConfig:
    def test_returns_dict(self, wrapper, msstats_config):
        gc_config = wrapper._build_gc_config(msstats_config, n_cores=4)
        assert isinstance(gc_config, dict)

    def test_includes_log_base(self, wrapper, msstats_config):
        gc_config = wrapper._build_gc_config(msstats_config, n_cores=4, log_base=2)
        assert gc_config["log_base"] == 2

    def test_n_cores_passed_through(self, wrapper, msstats_config):
        gc_config = wrapper._build_gc_config(msstats_config, n_cores=8)
        assert gc_config["numberOfCores"] == 8


class TestCmdExtras:
    def test_includes_covariates_json(self, wrapper):
        extras = wrapper._build_cmd_extras(covariates={"Batch": "Plate"})
        assert len(extras) == 1
        parsed = json.loads(extras[0])
        assert parsed["Batch"] == "Plate"

    def test_empty_covariates_returns_empty_dict_json(self, wrapper):
        extras = wrapper._build_cmd_extras(covariates=None)
        assert len(extras) == 1
        assert json.loads(extras[0]) == {}

    def test_no_covariates_returns_empty_dict_json(self, wrapper):
        extras = wrapper._build_cmd_extras()
        assert len(extras) == 1
        assert json.loads(extras[0]) == {}
