"""Unit tests for Msqrob2Wrapper — QFeatures pipeline command construction."""

import pytest
from app.models.analysis import AnalysisConfig
from app.services.msqrob2_wrapper import Msqrob2Wrapper


@pytest.fixture
def wrapper():
    return Msqrob2Wrapper()


@pytest.fixture
def basic_config():
    return AnalysisConfig(
        organism="human",
        treatment="DrugA",
        control="DMSO",
    )


class TestInit:
    def test_creates_instance(self, wrapper):
        assert wrapper is not None

    def test_has_scripts_dir(self, wrapper):
        assert wrapper.scripts_dir is not None
        assert wrapper.scripts_dir.name == "scripts"

    def test_r_executable_set(self, wrapper):
        from app.core.config import settings

        assert wrapper.r_executable == settings.r_executable


class TestDataProcessConfig:
    def test_includes_normalization(self, wrapper, basic_config):
        config = wrapper._build_data_process_config(basic_config, n_cores=4)
        assert "normalization" in config
        assert "numberOfCores" in config
        assert config["numberOfCores"] == 4

    def test_includes_remove_razor_flag(self, wrapper):
        config = AnalysisConfig(
            organism="human", treatment="A", control="B", remove_razor=True
        )
        result = wrapper._build_data_process_config(config, n_cores=2)
        assert result["remove_razor"] is True

    def test_includes_strict_filtering_flag(self, wrapper):
        config = AnalysisConfig(
            organism="human", treatment="A", control="B", strict_filtering=True
        )
        result = wrapper._build_data_process_config(config, n_cores=2)
        assert result["strict_filtering"] is True

    def test_batch_column_included_when_set(self, wrapper):
        config = AnalysisConfig(
            organism="human",
            treatment="A",
            control="B",
            msqrob2_batch_column="Plate",
        )
        result = wrapper._build_data_process_config(config, n_cores=4)
        assert result["batch_column"] == "Plate"

    def test_batch_column_none_when_not_set(self, wrapper, basic_config):
        result = wrapper._build_data_process_config(basic_config, n_cores=4)
        assert result["batch_column"] is None


class TestGroupComparisonConfig:
    def test_includes_thresholds(self, wrapper, basic_config):
        gc_config = wrapper._build_gc_config(basic_config, n_cores=4)
        assert isinstance(gc_config, dict)

    def test_ncores_passed_through(self, wrapper, basic_config):
        gc_config = wrapper._build_gc_config(basic_config, n_cores=8)
        assert gc_config.get("numberOfCores") == 8 or "n_cores" in gc_config


class TestCmdExtras:
    def test_empty_by_default(self, wrapper):
        extras = wrapper._build_cmd_extras()
        assert extras == []
