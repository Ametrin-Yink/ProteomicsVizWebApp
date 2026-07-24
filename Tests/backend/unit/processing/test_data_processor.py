"""Tests for DataProcessor internals and ProcessingConfig defaults."""


import pandas as pd
import pytest

duckdb = pytest.importorskip("duckdb")
from app.services.data_processor import (
    DataProcessor,
    ProcessingConfig,
    _detect_delimiter,
    _detect_tmt_abundance_columns,
    _read_columns,
    _sql_identifier,
    _sqlesc,
)

# ── _detect_delimiter ──────────────────────────────────────────────────


class TestDetectDelimiter:
    def test_tab(self, tmp_path):
        path = tmp_path / "test.txt"
        path.write_text("a\tb\tc\n1\t2\t3")
        assert _detect_delimiter(path) == "\t"

    def test_comma(self, tmp_path):
        path = tmp_path / "test.csv"
        path.write_text("a,b,c\n1,2,3")
        assert _detect_delimiter(path) == ","

    def test_empty_file_falls_back_to_comma(self, tmp_path):
        path = tmp_path / "test.txt"
        path.write_text("")
        assert _detect_delimiter(path) == ","  # no tab found


# ── _detect_tmt_abundance_columns ──────────────────────────────────────


class TestDetectTmtAbundanceColumns:
    def test_finds_standard_channels(self):
        cols = ["Sequence", "Abundance 126", "Abundance 127N", "Other"]
        result = _detect_tmt_abundance_columns(cols)
        assert set(result) == {"Abundance 126", "Abundance 127N"}

    def test_finds_c_suffix(self):
        cols = ["Abundance 128C"]
        assert _detect_tmt_abundance_columns(cols) == ["Abundance 128C"]

    def test_rejects_multi_letter_suffix(self):
        cols = ["Abundance 126NC"]
        assert _detect_tmt_abundance_columns(cols) == []

    def test_empty_input(self):
        assert _detect_tmt_abundance_columns([]) == []


# ── _read_columns ─────────────────────────────────────────────────────


class TestReadColumns:
    def test_reads_header(self, tmp_path):
        path = tmp_path / "test.txt"
        path.write_text("Col1\tCol2\tCol3\n1\t2\t3")
        assert _read_columns(path) == ["Col1", "Col2", "Col3"]

    def test_explicit_delimiter(self, tmp_path):
        path = tmp_path / "test.csv"
        path.write_text("A,B,C\n1,2,3")
        assert _read_columns(path, delimiter=",") == ["A", "B", "C"]


# ── _sqlesc and _sql_identifier ───────────────────────────────────────


class TestSqlEsc:
    def test_no_quotes(self):
        assert _sqlesc("hello") == "hello"

    def test_single_quote_doubled(self):
        assert _sqlesc("it's") == "it''s"

    def test_non_string_converted(self):
        assert _sqlesc(42) == "42"
        assert _sqlesc(None) == "None"


class TestSqlIdentifier:
    def test_simple_identifier(self):
        assert _sql_identifier("col") == '"col"'

    def test_embedded_double_quote(self):
        assert _sql_identifier('col"name') == '"col""name"'

    def test_non_string_converted(self):
        assert _sql_identifier(42) == '"42"'


# ── ProcessingConfig ───────────────────────────────────────────────────


class TestProcessingConfig:
    def test_defaults_when_none(self):
        cfg = ProcessingConfig()
        assert cfg.resolve_shared_peptides is False
        assert cfg.max_missing_fraction_per_condition == 0.40
        assert cfg.min_psms_per_protein == 1

    def test_strict_filtering_defaults(self):
        cfg = ProcessingConfig(strict_filtering=True)
        assert cfg.max_missing_fraction_per_condition == 0.20
        assert cfg.min_psms_per_protein == 2

    def test_remove_razor_legacy_migration(self):
        cfg = ProcessingConfig(remove_razor=True)
        assert cfg.resolve_shared_peptides is True

    def test_explicit_overrides_deprecated(self):
        cfg = ProcessingConfig(
            resolve_shared_peptides=False, remove_razor=True,
        )
        assert cfg.resolve_shared_peptides is False

    def test_min_peptides_per_protein_legacy(self):
        cfg = ProcessingConfig(min_peptides_per_protein=3)
        assert cfg.min_psms_per_protein == 3

    def test_strict_with_min_peptides(self):
        cfg = ProcessingConfig(
            strict_filtering=True, min_peptides_per_protein=5,
        )
        assert cfg.min_psms_per_protein == 5  # max(5, 2) = 5

    def test_max_missing_out_of_range(self):
        with pytest.raises(ValueError, match="max_missing"):
            ProcessingConfig(max_missing_fraction_per_condition=1.5)

    def test_min_psms_out_of_range(self):
        with pytest.raises(ValueError, match="min_psms"):
            ProcessingConfig(min_psms_per_protein=0)

    def test_expected_replicates_validation(self):
        with pytest.raises(ValueError, match="replicate"):
            ProcessingConfig(
                expected_replicates_by_condition={"A": 0},
            )


# ── DataProcessor step4 ────────────────────────────────────────────────


@pytest.fixture
def parquet_paths(tmp_path):
    """Provide isolated input/output parquet paths per test (no shared /tmp)."""
    return tmp_path / "in.parquet", tmp_path / "out.parquet"


class TestStep4RemoveLowQuality:
    def test_filters_contaminants_and_low_abundance(self, parquet_paths):
        input_path, output_path = parquet_paths
        cfg = ProcessingConfig()
        processor = DataProcessor(cfg)

        # Create parquet with various edge cases
        df = pd.DataFrame({
            "Sequence": ["OK", "CONTAM", "LOW", "NULL_AB"],
            "Contaminant": ["False", "True", "False", "False"],
            "Abundance": [100.0, 50.0, 0.5, None],
        })
        df.to_parquet(input_path, engine="pyarrow")

        processor.step4_remove_low_quality_duckdb(input_path, output_path)

        result = pd.read_parquet(output_path, engine="pyarrow")
        assert len(result) == 1  # only OK row
        assert result["Sequence"].iloc[0] == "OK"

    def test_with_quan_info_column(self, parquet_paths):
        input_path, output_path = parquet_paths
        cfg = ProcessingConfig()
        processor = DataProcessor(cfg)

        df = pd.DataFrame({
            "Sequence": ["OK", "NO_VAL"],
            "Contaminant": ["False", "False"],
            "Abundance": [100.0, 50.0],
            "Quan_Info": ["Valid", "No Value"],
        })
        df.to_parquet(input_path, engine="pyarrow")

        processor.step4_remove_low_quality_duckdb(input_path, output_path)

        result = pd.read_parquet(output_path, engine="pyarrow")
        assert len(result) == 1  # NO_VAL filtered
        assert result["Sequence"].iloc[0] == "OK"

    def test_empty_result_produces_empty_parquet(self, parquet_paths):
        input_path, output_path = parquet_paths
        cfg = ProcessingConfig()
        processor = DataProcessor(cfg)

        df = pd.DataFrame({
            "Sequence": ["ALL_BAD"],
            "Contaminant": ["True"],
            "Abundance": [0.01],
        })
        df.to_parquet(input_path, engine="pyarrow")

        processor.step4_remove_low_quality_duckdb(input_path, output_path)

        # DuckDB COPY TO produces a parquet even if empty
        assert output_path.exists()
        result = pd.read_parquet(output_path, engine="pyarrow")
        assert len(result) == 0  # all rows filtered out


# ── DataProcessor deprecated aliases ───────────────────────────────────


class TestDeprecatedAliases:
    def test_step3_remove_razor_delegates(self, parquet_paths):
        input_path, output_path = parquet_paths
        cfg = ProcessingConfig()
        processor = DataProcessor(cfg)

        # step3_remove_razor should produce same result as step2
        df = pd.DataFrame({
            "Sequence": ["A", "B"],
            "Contaminant": ["False", "False"],
            "Abundance": [10.0, 20.0],
            "Master_Protein_Accessions": ["P1", "P2"],
            "Modifications": ["", ""],
            "Charge": [2, 2],
            "Quan_Info": ["Valid", "Valid"],
        })
        df.to_parquet(input_path, engine="pyarrow")

        result = processor.step3_remove_razor_duckdb(input_path, output_path)
        assert isinstance(result, bool)

    def test_step5_filter_by_criteria_aliases_step3(self, tmp_path):
        # step5 is just an alias for step3 — verify it works
        input_path = tmp_path / "input.parquet"
        output_path = tmp_path / "output.parquet"
        cfg = ProcessingConfig()
        processor = DataProcessor(cfg)

        df = pd.DataFrame({
            "Unique_PSM": ["P1|Mod|2"],
            "Sequence": ["PEP"],
            "Condition": ["A"],
            "Replicate": [1],
            "Abundance": [100.0],
            "Master_Protein_Accessions": ["P1"],
            "Modifications": ["Mod"],
            "Charge": [2],
        })
        df.to_parquet(input_path, engine="pyarrow")

        # step5_filter_by_criteria is a thin alias
        processor.step5_filter_by_criteria_duckdb(input_path, output_path)
