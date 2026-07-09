"""
Input validation utilities.

Provides validation functions for various inputs including session IDs,
file types, and configuration values.
"""

import re

from app.core.config import settings
from app.core.exceptions import (
    FileTooLargeError,
    ValidationError,
)


def validate_file_size(size_bytes: int, filename: str) -> None:
    """
    Validate file size against maximum allowed.

    Args:
        size_bytes: File size in bytes
        filename: Filename for error messages

    Raises:
        FileTooLargeError: If file exceeds maximum size
    """
    max_size = settings.max_upload_size_bytes

    if size_bytes > max_size:
        raise FileTooLargeError(
            message=f"File '{filename}' exceeds maximum size of {settings.max_upload_size_mb}MB",
            details={
                "filename": filename,
                "size_bytes": size_bytes,
                "max_size_bytes": max_size,
                "size_mb": round(size_bytes / (1024 * 1024), 2),
                "max_size_mb": settings.max_upload_size_mb,
            },
        )


def validate_session_name(name: str) -> str:
    """
    Validate session name.

    Args:
        name: Session name to validate

    Returns:
        Validated and trimmed session name

    Raises:
        ValidationError: If name is invalid
    """
    if not name or not name.strip():
        raise ValidationError(message="Session name is required")

    name = name.strip()

    if len(name) > 200:
        raise ValidationError(
            message="Session name must be 200 characters or less",
            details={"length": len(name), "max_length": 200},
        )

    # Check for invalid characters
    if re.search(r'[<>:"/\\|?*]', name):
        raise ValidationError(
            message="Session name contains invalid characters",
            details={"invalid_chars": '<>:"/\\|?*'},
        )

    return name
