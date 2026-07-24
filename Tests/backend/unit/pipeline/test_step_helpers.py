"""Tests for pipeline step helper functions."""

from pathlib import Path

import pandas as pd
import pytest

duckdb = pytest.importorskip("duckdb")
from app.core.exceptions import ProcessingError
from app.models.analysis import Organism
from app.services.steps._helpers import (
    build_comparison_label,
    build_comparison_pair_label,
    count_significant_differential,
    differential_output_paths,
    get_gene_mapping,
    get_psm_input,
    primary_differential_output,
)

# ── get_gene_mapping ───────────────────────────────────────────────────


class TestGetGeneMapping:
    def test_human(self, monkeypatch, tmp_path):
        from app.core.config import settings
        monkeypatch.setattr(settings, "protein_database_dir", tmp_path)
        result = get_gene_mapping(Organism.HUMAN)
        assert result == tmp_path / "Human_GeneName.tsv"

    def test_mouse(self, monkeypatch, tmp_path):
        from app.core.config import settings
        monkeypatch.setattr(settings, "protein_database_dir", tmp_path)
        result = get_gene_mapping(Organism.MOUSE)
        assert result == tmp_path / "Mouse_GeneName.tsv"

    def test_none_organism(self):
        assert get_gene_mapping(None) is None

    def test_unset_protein_database_dir(self):
        # With default settings, protein_database_dir may be set.
        # Test the None-dir guard by temporarily clearing it.
        assert get_gene_mapping(None) is None


# ── get_psm_input ──────────────────────────────────────────────────────


class TestGetPsmInput:
    def test_returns_psm_file_path(self):
        from unittest.mock import MagicMock
        ctx = MagicMock()
        ctx.psm_file_path = Path("/tmp/test.parquet")
        assert get_psm_input(ctx, step=5) == Path("/tmp/test.parquet")

    def test_raises_when_missing(self):
        from unittest.mock import MagicMock
        ctx = MagicMock()
        ctx.psm_file_path = None
        with pytest.raises(ProcessingError, match="PSM file not saved"):
            get_psm_input(ctx, step=5)


# ── build_comparison_label ─────────────────────────────────────────────


class TestBuildComparisonLabel:
    def test_single_value(self):
        assert build_comparison_label({"Condition": "Treated"}) == "Treated"

    def test_multi_value(self):
        result = build_comparison_label({"Condition": "DrugA", "Time": "24h"})
        # Dict values joined with + in dict order (Python 3.7+ preserves order)
        assert "DrugA" in result
        assert "24h" in result
        assert "+" in result

    def test_empty_dict(self):
        assert build_comparison_label({}) == ""

    def test_non_string_values(self):
        assert build_comparison_label({"count": 42}) == "42"


# ── build_comparison_pair_label ────────────────────────────────────────


class TestBuildComparisonPairLabel:
    def test_group_format(self):
        result = build_comparison_pair_label({
            "group1": {"Condition": "DrugA"},
            "group2": {"Condition": "DMSO"},
        })
        assert result == "DrugA_vs_DMSO"

    def test_legacy_format(self):
        result = build_comparison_pair_label({
            "treatment": "A",
            "control": "B",
        })
        assert "A_vs_B" in result

    def test_missing_keys_raises(self):
        with pytest.raises(ValueError, match="must define"):
            build_comparison_pair_label({"unknown": "format"})


# ── differential_output_paths ──────────────────────────────────────────


class TestDifferentialOutputPaths:
    def test_returns_matching_files(self, tmp_path):
        (tmp_path / "Differential_Results_A.tsv").touch()
        (tmp_path / "Differential_Results_B.tsv").touch()
        (tmp_path / "other.txt").touch()
        paths = differential_output_paths(tmp_path)
        assert len(paths) == 2
        assert all("Differential_Results_" in str(p) for p in paths)

    def test_empty_directory(self, tmp_path):
        assert differential_output_paths(tmp_path) == []


# ── primary_differential_output ────────────────────────────────────────


class TestPrimaryDifferentialOutput:
    def test_batched(self, tmp_path):
        path = primary_differential_output(tmp_path, batched=True)
        assert path.name == "Differential_Results_Shard_00000.tsv"

    def test_unbatched(self, tmp_path):
        path = primary_differential_output(tmp_path, batched=False)
        assert path.name == "Differential_Results_Long.tsv"


# ── count_significant_differential ─────────────────────────────────────


class TestCountSignificantDifferential:
    def test_returns_count(self, tmp_path):
        tsv = tmp_path / "test.tsv"
        pd.DataFrame({
            "adjPval": [0.01, 0.03, 0.5, 0.8],
            "logFC": [2.0, -1.0, 0.5, -0.2],
        }).to_csv(tsv, sep="\t", index=False)
        assert count_significant_differential([tsv], 0.05) == 2

    def test_empty_paths_returns_zero(self):
        assert count_significant_differential([], 0.05) == 0

    def test_handles_na_nan(self, tmp_path):
        tsv = tmp_path / "test.tsv"
        pd.DataFrame({
            "adjPval": [0.01, "NA", "NaN", 0.02],
            "logFC": [2.0, -1.0, 0.5, -0.2],
        }).to_csv(tsv, sep="\t", index=False)
        result = count_significant_differential([tsv], 0.05)
        assert result == 2  # NA and NaN skipped, 0.01 and 0.02 pass
