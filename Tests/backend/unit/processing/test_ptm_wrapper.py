"""Tests for PTMWrapper — config building and n_cores resolution."""

import asyncio

import pytest
from app.models.analysis import AnalysisConfig, PipelineTool
from app.services.ptm_wrapper import PTMWrapper


@pytest.fixture
def wrapper():
    return PTMWrapper()


class TestPTMWrapperInit:
    def test_script_names(self, wrapper):
        assert wrapper._data_process_script_name == "ptm_summarization.R"
        assert wrapper._gc_script_name == "ptm_group_comparison.R"

    def test_cal_prefix(self, wrapper):
        assert wrapper._cal_prefix == "_ptm_cal"


class TestResolveNCores:
    def test_always_returns_one(self, wrapper):
        config = AnalysisConfig(pipeline=PipelineTool.PTM)
        result = asyncio.run(
            wrapper._resolve_n_cores(config, "ptm_n_cores", None)
        )
        assert result == 1


class TestBuildDataProcessConfig:
    def test_maps_ptm_fields(self, wrapper):
        config = AnalysisConfig(
            pipeline=PipelineTool.PTM,
            ptm_normalization="equalizeMedians",
            ptm_summary_method="msstats",
            ptm_mbimpute=True,
            ptm_labeling_type="TMT10",
            ptm_mod_ids=["Carbamidomethyl"],
            ptm_which_proteinid="Protein",
            ptm_which_quantification="intensity",
        )
        result = wrapper._build_data_process_config(config, n_cores=1)
        assert result["normalization"] == "equalizeMedians"
        assert result["summaryMethod"] == "msstats"
        assert result["MBimpute"] is True
        assert result["labeling_type"] == "TMT10"
        assert result["mod_id"] == ["Carbamidomethyl"]
        assert result["which_proteinid"] == "Protein"
        assert result["which_quantification"] == "intensity"
        assert result["numberOfCores"] == 1


class TestBuildGcConfig:
    def test_builds_with_defaults(self, wrapper):
        config = AnalysisConfig(
            pipeline=PipelineTool.PTM,
            ptm_labeling_type="TMT10",
        )
        result = wrapper._build_gc_config(config, n_cores=1)
        assert result["ptm_label_type"] == "TMT10"
        assert result["protein_label_type"] == "TMT10"
        assert result["adj_method"] == "BH"
        assert result["moderated"] is True
        assert result["numberOfCores"] == 1

    def test_extra_overrides_defaults(self, wrapper):
        config = AnalysisConfig(
            pipeline=PipelineTool.PTM,
            ptm_labeling_type="TMT10",
        )
        result = wrapper._build_gc_config(
            config, n_cores=2,
            ptm_label_type="TMT16",
        )
        assert result["ptm_label_type"] == "TMT16"
        assert result["protein_label_type"] == "TMT10"  # from config default
        assert result["numberOfCores"] == 2
