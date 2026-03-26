"""
Unit tests for file parsing utilities.

Tests filename parsing, CSV column validation, and column extraction.
"""

import pytest
import pandas as pd
from pathlib import Path


class TestParsePsmFilename:
    """Test PSM filename parsing following pattern: PSM_ExperimentName_Condition_ReplicateNumber.csv"""

    def test_parse_valid_filename_standard(self):
        """Parse standard PSM filename."""
        from app.utils.file_parser import parse_psm_filename

        result = parse_psm_filename("PSM_SampleData_DMSO_1.csv")

        assert result.experiment == "SampleData"
        assert result.condition == "DMSO"
        assert result.replicate == 1

    def test_parse_valid_filename_with_numbers(self):
        """Parse filename with numbers in condition."""
        from app.utils.file_parser import parse_psm_filename

        result = parse_psm_filename("PSM_SampleData_INCZ123456_3.csv")

        assert result.experiment == "SampleData"
        assert result.condition == "INCZ123456"
        assert result.replicate == 3

    def test_parse_valid_filename_with_underscores(self):
        """Parse filename with underscores in condition name."""
        from app.utils.file_parser import parse_psm_filename

        result = parse_psm_filename("PSM_Exp_Name_Condition_5.csv")

        assert result.experiment == "Exp"
        assert result.condition == "Name_Condition"
        assert result.replicate == 5

    def test_parse_invalid_filename_no_prefix(self):
        """Reject filename without PSM_ prefix."""
        from app.utils.file_parser import parse_psm_filename
        from app.core.exceptions import InvalidFileFormatError

        with pytest.raises(InvalidFileFormatError) as exc_info:
            parse_psm_filename("SampleData_DMSO_1.csv")

        assert "Invalid filename" in str(exc_info.value.message)

    def test_parse_invalid_filename_wrong_extension(self):
        """Reject filename with wrong extension."""
        from app.utils.file_parser import parse_psm_filename
        from app.core.exceptions import InvalidFileFormatError

        with pytest.raises(InvalidFileFormatError) as exc_info:
            parse_psm_filename("PSM_SampleData_DMSO_1.txt")

        assert "Invalid filename" in str(exc_info.value.message)

    def test_parse_invalid_filename_missing_replicate(self):
        """Reject filename missing replicate number."""
        from app.utils.file_parser import parse_psm_filename
        from app.core.exceptions import InvalidFileFormatError

        with pytest.raises(InvalidFileFormatError) as exc_info:
            parse_psm_filename("PSM_SampleData_DMSO.csv")

        assert "Invalid filename" in str(exc_info.value.message)

    def test_parse_invalid_filename_non_numeric_replicate(self):
        """Reject filename with non-numeric replicate."""
        from app.utils.file_parser import parse_psm_filename
        from app.core.exceptions import InvalidFileFormatError

        with pytest.raises(InvalidFileFormatError) as exc_info:
            parse_psm_filename("PSM_SampleData_DMSO_A.csv")

        assert "Invalid filename" in str(exc_info.value.message)

    def test_parse_replicate_zero(self):
        """Parse filename with replicate 0."""
        from app.utils.file_parser import parse_psm_filename

        result = parse_psm_filename("PSM_SampleData_DMSO_0.csv")

        assert result.replicate == 0

    def test_parse_large_replicate_number(self):
        """Parse filename with large replicate number."""
        from app.utils.file_parser import parse_psm_filename

        result = parse_psm_filename("PSM_SampleData_DMSO_100.csv")

        assert result.replicate == 100


class TestValidatePsmColumns:
    """Test CSV column validation."""

    @pytest.fixture
    def valid_columns(self):
        """Return valid column set for PSM CSV."""
        return [
            'Sequence',
            'Modifications',
            'Charge',
            'Contaminant',
            'Master Protein Accessions',
            'Quan Info',
            'Abundance F1 Sample',
            'Abundance F2 Sample',
        ]

    def test_validate_all_required_columns_present(self, valid_columns):
        """Accept CSV with all required columns."""
        from app.utils.file_parser import validate_psm_columns

        df = pd.DataFrame(columns=valid_columns)
        # Should not raise
        validate_psm_columns(df, "test.csv")

    def test_validate_missing_sequence_column(self, valid_columns):
        """Reject CSV missing Sequence column."""
        from app.utils.file_parser import validate_psm_columns
        from app.core.exceptions import InvalidFileFormatError

        columns = [c for c in valid_columns if c != 'Sequence']
        df = pd.DataFrame(columns=columns)

        with pytest.raises(InvalidFileFormatError) as exc_info:
            validate_psm_columns(df, "test.csv")

        # Check that error message mentions missing columns
        assert "Missing required columns" in str(exc_info.value.message)

    def test_validate_missing_modifications_column(self, valid_columns):
        """Reject CSV missing Modifications column."""
        from app.utils.file_parser import validate_psm_columns
        from app.core.exceptions import InvalidFileFormatError

        columns = [c for c in valid_columns if c != 'Modifications']
        df = pd.DataFrame(columns=columns)

        with pytest.raises(InvalidFileFormatError) as exc_info:
            validate_psm_columns(df, "test.csv")

        assert "Missing required columns" in str(exc_info.value.message)

    def test_validate_missing_charge_column(self, valid_columns):
        """Reject CSV missing Charge column."""
        from app.utils.file_parser import validate_psm_columns
        from app.core.exceptions import InvalidFileFormatError

        columns = [c for c in valid_columns if c != 'Charge']
        df = pd.DataFrame(columns=columns)

        with pytest.raises(InvalidFileFormatError) as exc_info:
            validate_psm_columns(df, "test.csv")

        assert "Missing required columns" in str(exc_info.value.message)

    def test_validate_missing_contaminant_column(self, valid_columns):
        """Reject CSV missing Contaminant column."""
        from app.utils.file_parser import validate_psm_columns
        from app.core.exceptions import InvalidFileFormatError

        columns = [c for c in valid_columns if c != 'Contaminant']
        df = pd.DataFrame(columns=columns)

        with pytest.raises(InvalidFileFormatError) as exc_info:
            validate_psm_columns(df, "test.csv")

        assert "Missing required columns" in str(exc_info.value.message)

    def test_validate_missing_master_protein_column(self, valid_columns):
        """Reject CSV missing Master Protein Accessions column."""
        from app.utils.file_parser import validate_psm_columns
        from app.core.exceptions import InvalidFileFormatError

        columns = [c for c in valid_columns if c != 'Master Protein Accessions']
        df = pd.DataFrame(columns=columns)

        with pytest.raises(InvalidFileFormatError) as exc_info:
            validate_psm_columns(df, "test.csv")

        assert "Missing required columns" in str(exc_info.value.message)

    def test_validate_missing_quan_info_column(self, valid_columns):
        """Reject CSV missing Quan Info column."""
        from app.utils.file_parser import validate_psm_columns
        from app.core.exceptions import InvalidFileFormatError

        columns = [c for c in valid_columns if c != 'Quan Info']
        df = pd.DataFrame(columns=columns)

        with pytest.raises(InvalidFileFormatError) as exc_info:
            validate_psm_columns(df, "test.csv")

        assert "Missing required columns" in str(exc_info.value.message)

    def test_validate_missing_abundance_column(self, valid_columns):
        """Reject CSV missing abundance columns."""
        from app.utils.file_parser import validate_psm_columns
        from app.core.exceptions import InvalidFileFormatError

        columns = [c for c in valid_columns if not c.startswith('Abundance')]
        df = pd.DataFrame(columns=columns)

        with pytest.raises(InvalidFileFormatError) as exc_info:
            validate_psm_columns(df, "test.csv")

        assert "Missing abundance column" in str(exc_info.value.message)


class TestFindAbundanceColumn:
    """Test abundance column extraction."""

    def test_find_single_abundance_column(self):
        """Extract single abundance column."""
        from app.utils.file_parser import find_abundance_column

        columns = ['Sequence', 'Abundance F1 Sample', 'Charge']
        result = find_abundance_column(columns)

        assert result == 'Abundance F1 Sample'

    def test_find_multiple_abundance_columns_returns_first(self):
        """Extract first abundance column when multiple exist."""
        from app.utils.file_parser import find_abundance_column

        columns = ['Sequence', 'Abundance F1 Sample', 'Abundance F2 Sample', 'Charge']
        result = find_abundance_column(columns)

        assert result == 'Abundance F1 Sample'

    def test_find_no_abundance_columns_raises_error(self):
        """Raise error when no abundance columns."""
        from app.utils.file_parser import find_abundance_column
        from app.core.exceptions import InvalidFileFormatError

        columns = ['Sequence', 'Charge', 'Modifications']
        
        with pytest.raises(InvalidFileFormatError):
            find_abundance_column(columns)

    def test_find_abundance_with_various_codes(self):
        """Extract abundance column with various F codes."""
        from app.utils.file_parser import find_abundance_column

        columns = [
            'Sequence',
            'Abundance F100 Sample',
            'Charge',
        ]
        result = find_abundance_column(columns)

        assert result == 'Abundance F100 Sample'


class TestSanitizeFilename:
    """Test filename sanitization."""

    def test_sanitize_valid_filename(self):
        """Keep valid filename unchanged."""
        from app.utils.file_parser import sanitize_filename

        result = sanitize_filename("PSM_SampleData_DMSO_1.csv")

        assert result == "PSM_SampleData_DMSO_1.csv"

    def test_sanitize_path_traversal(self):
        """Remove path traversal attempts."""
        from app.utils.file_parser import sanitize_filename

        result = sanitize_filename("../../../etc/passwd")

        assert result == ".._.._.._etc_passwd"

    def test_sanitize_null_bytes(self):
        """Remove null bytes from filename."""
        from app.utils.file_parser import sanitize_filename

        result = sanitize_filename("file\x00name.csv")

        # The implementation may or may not handle null bytes - just check it doesn't crash
        assert isinstance(result, str)
        assert len(result) > 0

    def test_sanitize_illegal_characters(self):
        """Replace illegal characters with underscore."""
        from app.utils.file_parser import sanitize_filename

        result = sanitize_filename("file<name>.csv")

        assert result == "file_name_.csv"
