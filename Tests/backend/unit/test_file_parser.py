"""
Unit tests for file parsing utilities.

Tests delimiter detection, channel detection, column validation,
and file parsing for TMT and DIA proteomics files.
"""

from pathlib import Path

import pandas as pd
import pytest
from app.core.exceptions import InvalidFileFormatError
from app.utils.file_parser import (
    DIA_REQUIRED_COLUMNS,
    TMT_ABUNDANCE_PATTERN,
    TMT_REQUIRED_COLUMNS,
    detect_delimiter,
    detect_tmt_channels,
    parse_proteomics_file,
    read_file_columns,
    validate_dia_columns,
    validate_tmt_columns,
)


class TestDetectDelimiter:
    """Test delimiter auto-detection."""

    def test_detect_delimiter_tab(self, test_data_dir: Path):
        """Detect tab delimiter from TMT fixture (tab-separated)."""
        path = test_data_dir / "tmt_sample_1000rows.txt"
        result = detect_delimiter(path)
        assert result == "\t"

    def test_detect_delimiter_comma(self, tmp_path: Path):
        """Detect comma delimiter from a simple CSV file."""
        path = tmp_path / "test.csv"
        path.write_text("a,b,c\n1,2,3\n")
        result = detect_delimiter(path)
        assert result == ","


class TestDetectTmtChannels:
    """Test TMT channel detection from column names."""

    def test_detect_tmt_channels_16plex(self):
        """Extract 16 TMT channels from a 16-plex column list."""
        columns = [
            "Abundance 126",
            "Abundance 127N",
            "Abundance 127C",
            "Abundance 128N",
            "Abundance 128C",
            "Abundance 129N",
            "Abundance 129C",
            "Abundance 130N",
            "Abundance 130C",
            "Abundance 131N",
            "Abundance 131C",
            "Abundance 132N",
            "Abundance 132C",
            "Abundance 133N",
            "Abundance 133C",
            "Abundance 134N",
        ]
        channels = detect_tmt_channels(columns)
        assert channels == [
            "126",
            "127N",
            "127C",
            "128N",
            "128C",
            "129N",
            "129C",
            "130N",
            "130C",
            "131N",
            "131C",
            "132N",
            "132C",
            "133N",
            "133C",
            "134N",
        ]

    def test_detect_tmt_channels_no_channels(self):
        """Return empty list when no abundance columns present."""
        columns = ["Sequence", "Charge", "Master Protein Accessions"]
        channels = detect_tmt_channels(columns)
        assert channels == []


class TestValidateTmtColumns:
    """Test TMT column validation."""

    @pytest.fixture
    def valid_tmt_df(self) -> pd.DataFrame:
        """Create a valid TMT DataFrame with required columns and abundance columns."""
        return pd.DataFrame(
            {
                "Sequence": ["PEPTIDE1", "PEPTIDE2", "PEPTIDE3"],
                "Modifications": ["", "Oxidation", ""],
                "Charge": [2, 3, 2],
                "Contaminant": [False, False, False],
                "Master Protein Accessions": ["P12345", "P67890", "P11111"],
                "Quan Info": ["Valid", "Valid", "Valid"],
                "Abundance 126": [100.0, 200.0, None],
                "Abundance 127N": [150.0, None, 250.0],
                "Abundance 127C": [175.0, 225.0, 275.0],
            }
        )

    def test_validate_tmt_columns_valid(self, valid_tmt_df):
        """Valid TMT DataFrame passes validation without raising."""
        validate_tmt_columns(valid_tmt_df, "test_tmt.txt")

    def test_validate_tmt_columns_missing_required(self, valid_tmt_df):
        """Missing Sequence column raises InvalidFileFormatError."""
        df = valid_tmt_df.drop(columns=["Sequence"])
        with pytest.raises(InvalidFileFormatError) as exc_info:
            validate_tmt_columns(df, "test_tmt.txt")
        assert "Missing" in str(exc_info.value.message)

    def test_validate_tmt_columns_no_abundance(self):
        """No abundance columns matching TMT pattern raises error."""
        df = pd.DataFrame(
            {
                "Sequence": ["A"],
                "Modifications": [""],
                "Charge": [2],
                "Contaminant": [False],
                "Master Protein Accessions": ["P12345"],
                "Quan Info": ["Valid"],
            }
        )
        with pytest.raises(InvalidFileFormatError) as exc_info:
            validate_tmt_columns(df, "test_tmt.txt")
        assert "abundance columns" in str(exc_info.value.message).lower()


class TestValidateDiaColumns:
    """Test DIA column validation."""

    @pytest.fixture
    def valid_dia_df(self) -> pd.DataFrame:
        """Create a valid DIA DataFrame with required columns and Quan Value."""
        return pd.DataFrame(
            {
                "Sequence": ["PEPTIDE1", "PEPTIDE2"],
                "Modifications": ["", "Oxidation"],
                "Charge": [2, 3],
                "Contaminant": [False, False],
                "Master Protein Accessions": ["P12345", "P67890"],
                "Quan Info": ["Valid", "Valid"],
                "Quan Value": [1000.0, 2000.0],
            }
        )

    def test_validate_dia_columns_valid(self, valid_dia_df):
        """Valid DIA DataFrame passes validation without raising."""
        validate_dia_columns(valid_dia_df, "test_dia.txt")

    def test_validate_dia_columns_missing_quan_value(self, valid_dia_df):
        """Missing Quan Value column raises InvalidFileFormatError."""
        df = valid_dia_df.drop(columns=["Quan Value"])
        with pytest.raises(InvalidFileFormatError) as exc_info:
            validate_dia_columns(df, "test_dia.txt")
        assert "Quan Value" in str(exc_info.value.message)


class TestReadFileColumns:
    """Test reading column headers without loading data."""

    def test_read_file_columns(self, test_data_dir: Path):
        """Read column names from TMT fixture."""
        path = test_data_dir / "tmt_sample_1000rows.txt"
        columns = read_file_columns(path)
        assert len(columns) == 78
        assert "Sequence" in columns
        assert "Quan Info" in columns
        assert "Abundance 126" in columns
        assert "Abundance 134N" in columns
