"""
Input validation utilities.

Provides validation functions for various inputs including session IDs,
file types, and configuration values.
"""

import re
import uuid
from pathlib import Path
from typing import Optional

from app.core.config import settings
from app.core.exceptions import (
    ValidationError,
    FileTooLargeError,
    InvalidFileFormatError
)
from app.utils.file_parser import PSM_FILENAME_PATTERN


def validate_session_id(session_id: str) -> str:
    """
    Validate session ID format.
    
    Args:
        session_id: Session ID to validate
        
    Returns:
        Validated session ID
        
    Raises:
        ValidationError: If session ID is invalid
    """
    if not session_id:
        raise ValidationError(message="Session ID is required")
    
    # Check if valid UUID format
    try:
        uuid.UUID(session_id)
    except ValueError:
        raise ValidationError(
            message="Invalid session ID format",
            details={"session_id": session_id, "expected": "UUID format"}
        )
    
    return session_id


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
                "max_size_mb": settings.max_upload_size_mb
            }
        )


def validate_csv_extension(filename: str) -> None:
    """
    Validate that file has CSV extension.
    
    Args:
        filename: Filename to validate
        
    Raises:
        InvalidFileFormatError: If file is not a CSV
    """
    if not filename.lower().endswith('.csv'):
        raise InvalidFileFormatError(
            message=f"Invalid file format: {filename}",
            details={
                "filename": filename,
                "expected_extension": ".csv"
            }
        )


def validate_psm_filename_pattern(filename: str) -> None:
    """
    Validate PSM filename matches required pattern.
    
    Pattern: PSM_ExperimentName_Condition_ReplicateNumber.csv
    
    Args:
        filename: Filename to validate
        
    Raises:
        InvalidFileFormatError: If filename doesn't match pattern
    """
    if not PSM_FILENAME_PATTERN.match(filename):
        raise InvalidFileFormatError(
            message=f"Invalid PSM filename format: {filename}",
            details={
                "filename": filename,
                "expected_pattern": "PSM_ExperimentName_Condition_ReplicateNumber.csv",
                "example": "PSM_SampleData_DMSO_1.csv"
            }
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
            details={"length": len(name), "max_length": 200}
        )
    
    # Check for invalid characters
    if re.search(r'[<>:"/\\|?*]', name):
        raise ValidationError(
            message="Session name contains invalid characters",
            details={"invalid_chars": '<>:"/\\|?*'}
        )
    
    return name


def validate_condition_name(name: str, field_name: str = "condition") -> str:
    """
    Validate condition name (treatment or control).
    
    Args:
        name: Condition name to validate
        field_name: Field name for error messages
        
    Returns:
        Validated condition name
        
    Raises:
        ValidationError: If name is invalid
    """
    if not name or not name.strip():
        raise ValidationError(message=f"{field_name.capitalize()} is required")
    
    name = name.strip()
    
    if len(name) > 100:
        raise ValidationError(
            message=f"{field_name.capitalize()} must be 100 characters or less",
            details={"length": len(name), "max_length": 100}
        )
    
    return name


def validate_organism(organism: str) -> str:
    """
    Validate organism identifier.
    
    Args:
        organism: Organism identifier to validate
        
    Returns:
        Validated organism identifier
        
    Raises:
        ValidationError: If organism is invalid
    """
    valid_organisms = ['human', 'mouse', 'rat', 'yeast']
    
    organism = organism.lower().strip()
    
    if organism not in valid_organisms:
        raise ValidationError(
            message=f"Invalid organism: {organism}",
            details={
                "provided": organism,
                "valid_options": valid_organisms
            }
        )
    
    return organism


def validate_treatment_control_pair(treatment: str, control: str) -> None:
    """
    Validate that treatment and control are different.
    
    Args:
        treatment: Treatment condition name
        control: Control condition name
        
    Raises:
        ValidationError: If treatment and control are the same
    """
    if treatment.strip().lower() == control.strip().lower():
        raise ValidationError(
            message="Treatment and control must be different",
            details={"treatment": treatment, "control": control}
        )


def validate_file_exists(file_path: Path, description: str = "file") -> None:
    """
    Validate that a file exists.
    
    Args:
        file_path: Path to validate
        description: Description of the file for error messages
        
    Raises:
        ValidationError: If file doesn't exist
    """
    if not file_path.exists():
        raise ValidationError(
            message=f"{description.capitalize()} not found: {file_path}",
            details={"path": str(file_path)}
        )
    
    if not file_path.is_file():
        raise ValidationError(
            message=f"{description.capitalize()} is not a file: {file_path}",
            details={"path": str(file_path)}
        )


def validate_directory_exists(dir_path: Path, description: str = "directory") -> None:
    """
    Validate that a directory exists.
    
    Args:
        dir_path: Path to validate
        description: Description of the directory for error messages
        
    Raises:
        ValidationError: If directory doesn't exist
    """
    if not dir_path.exists():
        raise ValidationError(
            message=f"{description.capitalize()} not found: {dir_path}",
            details={"path": str(dir_path)}
        )
    
    if not dir_path.is_dir():
        raise ValidationError(
            message=f"{description.capitalize()} is not a directory: {dir_path}",
            details={"path": str(dir_path)}
        )


def validate_sort_column(
    sort_by: str,
    valid_columns: list[str],
    default: Optional[str] = None
) -> str:
    """
    Validate sort column.
    
    Args:
        sort_by: Requested sort column
        valid_columns: List of valid column names
        default: Default column if sort_by is invalid
        
    Returns:
        Validated sort column
        
    Raises:
        ValidationError: If sort column is invalid and no default provided
    """
    if not sort_by:
        if default:
            return default
        raise ValidationError(message="Sort column is required")
    
    if sort_by not in valid_columns:
        if default:
            return default
        raise ValidationError(
            message=f"Invalid sort column: {sort_by}",
            details={
                "sort_by": sort_by,
                "valid_columns": valid_columns
            }
        )
    
    return sort_by


def validate_sort_order(order: str, default: str = "asc") -> str:
    """
    Validate sort order.
    
    Args:
        order: Sort order (asc or desc)
        default: Default order if invalid
        
    Returns:
        Validated sort order
    """
    order = order.lower().strip()
    
    if order not in ['asc', 'desc']:
        return default
    
    return order
