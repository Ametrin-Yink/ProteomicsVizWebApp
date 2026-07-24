"""Tests for the custom exception hierarchy."""

from app.core.exceptions import (
    AppException,
    ConfigurationError,
    ExternalAPIError,
    FileTooLargeError,
    InvalidFileFormatError,
    ProcessingError,
    ResourceError,
    RScriptError,
    SessionNotFoundError,
    ValidationError,
)


class TestAppException:
    def test_defaults(self):
        exc = AppException("Something broke")
        assert exc.message == "Something broke"
        assert exc.status_code == 500
        assert exc.code == "INTERNAL_ERROR"
        assert exc.details == {}
        assert exc.request_id is None
        assert str(exc) == "Something broke"

    def test_with_details_and_request_id(self):
        exc = AppException("fail", details={"key": "val"}, request_id="req-1")
        assert exc.details == {"key": "val"}
        assert exc.request_id == "req-1"


class TestExceptionHierarchy:
    def test_validation_error(self):
        exc = ValidationError("bad input")
        assert exc.status_code == 400
        assert exc.code == "VALIDATION_ERROR"
        assert isinstance(exc, AppException)

    def test_file_too_large(self):
        exc = FileTooLargeError("too big")
        assert exc.status_code == 400
        assert exc.code == "FILE_TOO_LARGE"
        assert isinstance(exc, AppException)

    def test_invalid_file_format(self):
        exc = InvalidFileFormatError("wrong format")
        assert exc.status_code == 400
        assert exc.code == "INVALID_FILE_FORMAT"
        assert isinstance(exc, AppException)

    def test_session_not_found(self):
        exc = SessionNotFoundError("missing")
        assert exc.status_code == 404
        assert exc.code == "SESSION_NOT_FOUND"
        assert isinstance(exc, AppException)

    def test_r_script_error(self):
        exc = RScriptError("R failed")
        assert exc.status_code == 500
        assert exc.code == "R_SCRIPT_ERROR"
        assert isinstance(exc, AppException)

    def test_external_api_error(self):
        exc = ExternalAPIError("api down")
        assert exc.status_code == 503
        assert exc.code == "EXTERNAL_API_ERROR"
        assert isinstance(exc, AppException)

    def test_resource_error(self):
        exc = ResourceError("out of memory")
        assert exc.status_code == 503
        assert exc.code == "RESOURCE_ERROR"
        assert isinstance(exc, AppException)

    def test_configuration_error(self):
        exc = ConfigurationError("bad config")
        assert exc.status_code == 400
        assert exc.code == "CONFIGURATION_ERROR"
        assert isinstance(exc, AppException)


class TestProcessingError:
    def test_requires_step(self):
        exc = ProcessingError("pipeline failed", step=3)
        assert exc.step == 3
        assert exc.recoverable is True
        assert exc.status_code == 500
        assert exc.code == "PROCESSING_ERROR"

    def test_non_recoverable(self):
        exc = ProcessingError("fatal", step=1, recoverable=False)
        assert exc.recoverable is False
        assert exc.step == 1

    def test_has_details(self):
        exc = ProcessingError(
            "failed", step=2, details={"retry_count": 3}, request_id="abc"
        )
        assert exc.details == {"retry_count": 3}
        assert exc.request_id == "abc"
        assert exc.step == 2
