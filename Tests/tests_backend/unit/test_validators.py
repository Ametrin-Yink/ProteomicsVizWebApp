"""
Unit tests for validation utilities.

Tests various validation functions for sessions, files, and configurations.
"""

import pytest
from pathlib import Path


class TestValidateSessionId:
    """Test session ID validation."""

    def test_valid_uuid(self):
        """Accept valid UUID."""
        from app.utils.validators import validate_session_id

        result = validate_session_id("550e8400-e29b-41d4-a716-446655440000")

        assert result == "550e8400-e29b-41d4-a716-446655440000"

    def test_invalid_uuid(self):
        """Reject invalid UUID format."""
        from app.utils.validators import validate_session_id
        from app.core.exceptions import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_session_id("not-a-uuid")

        assert "Invalid session ID" in str(exc_info.value.message)

    def test_empty_session_id(self):
        """Reject empty session ID."""
        from app.utils.validators import validate_session_id
        from app.core.exceptions import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_session_id("")

        assert "required" in str(exc_info.value.message).lower()


class TestValidateFileSize:
    """Test file size validation."""

    def test_valid_file_size(self):
        """Accept file under size limit."""
        from app.utils.validators import validate_file_size

        # Should not raise for small file
        validate_file_size(1024 * 1024, "test.csv")  # 1MB

    def test_file_too_large(self):
        """Reject file over size limit."""
        from app.utils.validators import validate_file_size
        from app.core.exceptions import FileTooLargeError

        with pytest.raises(FileTooLargeError) as exc_info:
            validate_file_size(600 * 1024 * 1024, "test.csv")  # 600MB

        assert "exceeds maximum" in str(exc_info.value.message).lower()


class TestValidateCsvExtension:
    """Test CSV extension validation."""

    def test_valid_csv_extension(self):
        """Accept .csv file."""
        from app.utils.validators import validate_csv_extension

        # Should not raise
        validate_csv_extension("test.csv")

    def test_invalid_extension(self):
        """Reject non-CSV file."""
        from app.utils.validators import validate_csv_extension
        from app.core.exceptions import InvalidFileFormatError

        with pytest.raises(InvalidFileFormatError) as exc_info:
            validate_csv_extension("test.txt")

        assert "Invalid file format" in str(exc_info.value.message)

    def test_case_insensitive(self):
        """Accept .CSV in uppercase."""
        from app.utils.validators import validate_csv_extension

        # Should not raise
        validate_csv_extension("test.CSV")


class TestValidatePsmFilenamePattern:
    """Test PSM filename pattern validation."""

    def test_valid_psm_filename(self):
        """Accept valid PSM filename."""
        from app.utils.validators import validate_psm_filename_pattern

        # Should not raise
        validate_psm_filename_pattern("PSM_SampleData_DMSO_1.csv")

    def test_invalid_filename(self):
        """Reject invalid PSM filename."""
        from app.utils.validators import validate_psm_filename_pattern
        from app.core.exceptions import InvalidFileFormatError

        with pytest.raises(InvalidFileFormatError) as exc_info:
            validate_psm_filename_pattern("invalid_file.csv")

        assert "Invalid PSM filename" in str(exc_info.value.message)


class TestValidateSessionName:
    """Test session name validation."""

    def test_valid_session_name(self):
        """Accept valid session name."""
        from app.utils.validators import validate_session_name

        result = validate_session_name("Test Session")

        assert result == "Test Session"

    def test_empty_name(self):
        """Reject empty session name."""
        from app.utils.validators import validate_session_name
        from app.core.exceptions import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_session_name("")

        assert "required" in str(exc_info.value.message).lower()

    def test_name_too_long(self):
        """Reject session name over 200 chars."""
        from app.utils.validators import validate_session_name
        from app.core.exceptions import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_session_name("x" * 201)

        assert "200 characters" in str(exc_info.value.message)

    def test_invalid_characters(self):
        """Reject session name with invalid characters."""
        from app.utils.validators import validate_session_name
        from app.core.exceptions import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_session_name("test<name>")

        assert "invalid characters" in str(exc_info.value.message).lower()


class TestValidateConditionName:
    """Test condition name validation."""

    def test_valid_condition(self):
        """Accept valid condition name."""
        from app.utils.validators import validate_condition_name

        result = validate_condition_name("DMSO")

        assert result == "DMSO"

    def test_empty_condition(self):
        """Reject empty condition name."""
        from app.utils.validators import validate_condition_name
        from app.core.exceptions import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_condition_name("")

        assert "required" in str(exc_info.value.message).lower()


class TestValidateOrganism:
    """Test organism validation."""

    def test_valid_organism(self):
        """Accept valid organism."""
        from app.utils.validators import validate_organism

        result = validate_organism("human")

        assert result == "human"

    def test_invalid_organism(self):
        """Reject invalid organism."""
        from app.utils.validators import validate_organism
        from app.core.exceptions import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_organism("invalid_organism")

        assert "Invalid organism" in str(exc_info.value.message)

    def test_case_insensitive(self):
        """Accept organism in any case."""
        from app.utils.validators import validate_organism

        result = validate_organism("HUMAN")

        assert result == "human"


class TestValidateTreatmentControlPair:
    """Test treatment/control pair validation."""

    def test_different_conditions(self):
        """Accept different treatment and control."""
        from app.utils.validators import validate_treatment_control_pair

        # Should not raise
        validate_treatment_control_pair("Treatment", "Control")

    def test_same_conditions(self):
        """Reject same treatment and control."""
        from app.utils.validators import validate_treatment_control_pair
        from app.core.exceptions import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_treatment_control_pair("DMSO", "DMSO")

        assert "must be different" in str(exc_info.value.message).lower()


class TestValidatePaginationParams:
    """Test pagination parameter validation."""

    def test_valid_params(self):
        """Accept valid pagination params."""
        from app.utils.validators import validate_pagination_params

        page, per_page = validate_pagination_params(1, 25)

        assert page == 1
        assert per_page == 25

    def test_invalid_page(self):
        """Reject page less than 1."""
        from app.utils.validators import validate_pagination_params
        from app.core.exceptions import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_pagination_params(0, 25)

        assert "Page must be at least 1" in str(exc_info.value.message)

    def test_invalid_per_page(self):
        """Reject per_page less than 1."""
        from app.utils.validators import validate_pagination_params
        from app.core.exceptions import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_pagination_params(1, 0)

        assert "at least 1" in str(exc_info.value.message)


class TestValidateSortColumn:
    """Test sort column validation."""

    def test_valid_column(self):
        """Accept valid sort column."""
        from app.utils.validators import validate_sort_column

        result = validate_sort_column("name", ["name", "date", "size"])

        assert result == "name"

    def test_invalid_column_with_default(self):
        """Return default for invalid column."""
        from app.utils.validators import validate_sort_column

        result = validate_sort_column("invalid", ["name", "date"], default="name")

        assert result == "name"

    def test_invalid_column_no_default(self):
        """Reject invalid column without default."""
        from app.utils.validators import validate_sort_column
        from app.core.exceptions import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_sort_column("invalid", ["name", "date"])

        assert "Invalid sort column" in str(exc_info.value.message)


class TestValidateSortOrder:
    """Test sort order validation."""

    def test_valid_asc(self):
        """Accept asc order."""
        from app.utils.validators import validate_sort_order

        result = validate_sort_order("asc")

        assert result == "asc"

    def test_valid_desc(self):
        """Accept desc order."""
        from app.utils.validators import validate_sort_order

        result = validate_sort_order("desc")

        assert result == "desc"

    def test_invalid_order_returns_default(self):
        """Return default for invalid order."""
        from app.utils.validators import validate_sort_order

        result = validate_sort_order("invalid")

        assert result == "asc"  # default
