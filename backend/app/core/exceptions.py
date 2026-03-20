"""
Custom exception classes for the Proteomics Visualization API.

Defines the exception hierarchy and FastAPI exception handlers.
"""

from typing import Any, Optional
from datetime import datetime
from fastapi import Request
from fastapi.responses import JSONResponse
import logging

logger = logging.getLogger("proteomics")


class ProteomicsException(Exception):
    """Base proteomics exception for FastAPI handler."""
    
    def __init__(self, message: str, code: str = "INTERNAL_ERROR", status_code: int = 500):
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(self.message)


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


# Exception handler for FastAPI
async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    """Handle all application exceptions."""
    
    request_id = getattr(request.state, 'request_id', None) or exc.request_id
    
    logger.error(
        f"Exception: {exc.code}",
        extra={
            "path": request.url.path,
            "method": request.method,
            "code": exc.code,
            "message": exc.message,
            "request_id": request_id,
        }
    )
    
    response_content: dict[str, Any] = {
        "error": {
            "code": exc.code,
            "message": exc.message,
            "details": exc.details,
            "timestamp": datetime.utcnow().isoformat(),
            "request_id": request_id,
        }
    }
    
    # Add step information for processing errors
    if isinstance(exc, ProcessingError):
        response_content["error"]["step"] = exc.step
        response_content["error"]["recoverable"] = exc.recoverable
    
    return JSONResponse(
        status_code=exc.status_code,
        content=response_content
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handle generic exceptions."""
    
    request_id = getattr(request.state, 'request_id', None)
    
    logger.exception(
        f"Unhandled exception: {str(exc)}",
        extra={
            "path": request.url.path,
            "method": request.method,
            "request_id": request_id,
        }
    )
    
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred",
                "details": {},
                "timestamp": datetime.utcnow().isoformat(),
                "request_id": request_id,
            }
        }
    )
