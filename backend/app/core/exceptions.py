"""
Custom exception classes for the Proteomics Visualization API.

Defines the exception hierarchy and FastAPI exception handlers.
"""

from typing import Any, Optional
from datetime import datetime, timezone
from fastapi import Request
from fastapi.responses import JSONResponse
import logging

logger = logging.getLogger("proteomics")


class AppException(Exception):
    """Base application exception."""

    status_code: int = 500
    code: str = "INTERNAL_ERROR"

    def __init__(
        self,
        message: str,
        details: Optional[dict] = None,
        request_id: Optional[str] = None
    ):
        self.message = message
        self.details = details or {}
        self.request_id = request_id
        super().__init__(self.message)


class ValidationError(AppException):
    """Invalid input data."""

    status_code = 400
    code = "VALIDATION_ERROR"


class FileTooLargeError(AppException):
    """File exceeds size limit."""

    status_code = 400
    code = "FILE_TOO_LARGE"


class InvalidFileFormatError(AppException):
    """CSV missing required columns or invalid format."""

    status_code = 400
    code = "INVALID_FILE_FORMAT"


class SessionNotFoundError(AppException):
    """Session ID doesn't exist."""

    status_code = 404
    code = "SESSION_NOT_FOUND"


class ProcessingError(AppException):
    """Processing pipeline failure."""

    status_code = 500
    code = "PROCESSING_ERROR"

    def __init__(
        self,
        message: str,
        step: int,
        recoverable: bool = True,
        details: Optional[dict] = None,
        request_id: Optional[str] = None
    ):
        super().__init__(message, details, request_id)
        self.step = step
        self.recoverable = recoverable


class RScriptError(AppException):
    """R subprocess failed."""

    status_code = 500
    code = "R_SCRIPT_ERROR"


class ExternalAPIError(AppException):
    """External API (biomart) failed."""

    status_code = 503
    code = "EXTERNAL_API_ERROR"


class ResourceError(AppException):
    """Resource error (memory, disk space, etc.)."""

    status_code = 503
    code = "RESOURCE_ERROR"


class ConfigurationError(AppException):
    """Configuration error."""

    status_code = 400
    code = "CONFIGURATION_ERROR"
