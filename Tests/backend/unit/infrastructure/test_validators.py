"""
Unit tests for validation utilities.

Tests various validation functions for sessions, files, and configurations.
"""

import pytest
from app.core.exceptions import (
    FileTooLargeError,
    ValidationError,
)
from app.utils.validators import (
    validate_file_size,
    validate_session_name,
)


class TestValidateFileSize:
    """Test file size validation."""

    def test_valid_file_size(self):
        """Accept file under size limit."""
        # Should not raise for small file
        validate_file_size(1024 * 1024, "test.csv")  # 1MB

    def test_file_too_large(self):
        """Reject file over size limit."""
        with pytest.raises(FileTooLargeError) as exc_info:
            validate_file_size(600 * 1024 * 1024, "test.csv")  # 600MB

        assert "exceeds maximum" in str(exc_info.value.message).lower()


class TestValidateSessionName:
    """Test session name validation."""

    def test_valid_session_name(self):
        """Accept valid session name."""
        result = validate_session_name("Test Session")

        assert result == "Test Session"

    def test_empty_name(self):
        """Reject empty session name."""
        with pytest.raises(ValidationError) as exc_info:
            validate_session_name("")

        assert "required" in str(exc_info.value.message).lower()

    def test_name_too_long(self):
        """Reject session name over 200 chars."""
        with pytest.raises(ValidationError) as exc_info:
            validate_session_name("x" * 201)

        assert "200 characters" in str(exc_info.value.message)

    def test_invalid_characters(self):
        """Reject session name with invalid characters."""
        with pytest.raises(ValidationError) as exc_info:
            validate_session_name("test<name>")

        assert "invalid characters" in str(exc_info.value.message).lower()
