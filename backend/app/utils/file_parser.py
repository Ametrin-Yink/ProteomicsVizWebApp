"""
CSV file parsing utilities with filename extraction.

Handles parsing of PSM CSV files and extraction of metadata from filenames.
"""

import re
import asyncio
from pathlib import Path
from dataclasses import dataclass
from typing import Optional
from datetime import datetime

import pandas as pd
import aiofiles

from app.core.exceptions import InvalidFileFormatError
from app.models.data import UploadedFileMetadata


@dataclass
class ParsedFilename:
    """Parsed PSM filename components."""
    
    experiment: str
    condition: str
    replicate: int
    original_filename: str


# Required columns for PSM CSV files
REQUIRED_COLUMNS = [
    "Sequence",
    "Modifications",
    "Charge",
    "Contaminant",
    "Master Protein Accessions",
    "Quan Info",
]

# Pattern for PSM filenames: PSM_ExperimentName_Condition_ReplicateNumber.csv
# Using non-greedy matching (+?) to properly handle underscores in condition names
PSM_FILENAME_PATTERN = re.compile(
    r'^PSM_(?P<experiment>.+?)_(?P<condition>.+?)_(?P<replicate>\d+)\.csv$',
    re.IGNORECASE
)


class FileParser:
    """Parser for proteomics and compound files."""
    
    async def parse_proteomics_file(
        self,
        filename: str,
        content: bytes,
        session_dir: Path
    ) -> UploadedFileMetadata:
        """
        Parse and validate a proteomics PSM file.
        
        Args:
            filename: Original filename
            content: File content as bytes
            session_dir: Directory to save the file
            
        Returns:
            UploadedFileMetadata with file information
            
        Raises:
            InvalidFileFormatError: If file is invalid
        """
        # Validate filename format
        parse_psm_filename(filename)
        
        # Sanitize filename
        safe_filename = sanitize_filename(filename)
        
        # Save file
        file_path = session_dir / safe_filename
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        async with aiofiles.open(file_path, 'wb') as f:
            await f.write(content)
        
        # Validate CSV content
        try:
            df = await asyncio.to_thread(pd.read_csv, file_path)
            validate_psm_columns(df, filename)
        except Exception as e:
            # Clean up saved file on validation error
            if file_path.exists():
                file_path.unlink()
            raise InvalidFileFormatError(
                message=f"Invalid CSV content in {filename}",
                details={"filename": filename, "error": str(e)}
            )
        
        return UploadedFileMetadata(
            filename=safe_filename,
            original_filename=filename,
            size=len(content),
            content_type="text/csv",
            uploaded_at=datetime.now().isoformat(),
            path=str(file_path)
        )
    
    async def parse_compound_file(
        self,
        filename: str,
        content: bytes,
        session_dir: Path
    ) -> UploadedFileMetadata:
        """
        Parse and validate a compound CSV file.
        
        Args:
            filename: Original filename
            content: File content as bytes
            session_dir: Directory to save the file
            
        Returns:
            UploadedFileMetadata with file information
            
        Raises:
            InvalidFileFormatError: If file is invalid
        """
        # Sanitize filename
        safe_filename = sanitize_filename(filename)
        
        # Save file
        file_path = session_dir / safe_filename
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        async with aiofiles.open(file_path, 'wb') as f:
            await f.write(content)
        
        # Validate CSV content
        try:
            df = await asyncio.to_thread(pd.read_csv, file_path)
            # Check for required columns (case-insensitive, space/underscore agnostic)
            columns_normalized = [col.lower().replace(' ', '_').replace('-', '_') for col in df.columns]
            if 'corp_id' not in columns_normalized and 'compound_id' not in columns_normalized:
                raise InvalidFileFormatError(
                    message=f"Missing corp_id or compound_id column in {filename}",
                    details={
                        "filename": filename,
                        "available_columns": list(df.columns)
                    }
                )
        except Exception as e:
            if not isinstance(e, InvalidFileFormatError):
                e = InvalidFileFormatError(
                    message=f"Invalid CSV content in {filename}",
                    details={"filename": filename, "error": str(e)}
                )
            # Clean up saved file on validation error
            if file_path.exists():
                file_path.unlink()
            raise e
        
        return UploadedFileMetadata(
            filename=safe_filename,
            original_filename=filename,
            size=len(content),
            content_type="text/csv",
            uploaded_at=datetime.now().isoformat(),
            path=str(file_path)
        )


def parse_psm_filename(filename: str) -> ParsedFilename:
    """
    Parse PSM filename to extract experiment, condition, and replicate.
    
    Expected format: PSM_ExperimentName_Condition_ReplicateNumber.csv
    
    Args:
        filename: The filename to parse
        
    Returns:
        ParsedFilename object with extracted components
        
    Raises:
        InvalidFileFormatError: If filename doesn't match expected pattern
    """
    match = PSM_FILENAME_PATTERN.match(filename)
    
    if not match:
        raise InvalidFileFormatError(
            message=f"Invalid filename format: {filename}",
            details={
                "filename": filename,
                "expected_pattern": "PSM_ExperimentName_Condition_ReplicateNumber.csv",
                "example": "PSM_SampleData_DMSO_1.csv"
            }
        )
    
    return ParsedFilename(
        experiment=match.group('experiment'),
        condition=match.group('condition'),
        replicate=int(match.group('replicate')),
        original_filename=filename
    )


def find_abundance_column(columns: list[str]) -> str:
    """
    Find the abundance column in the CSV.
    
    Pattern: "Abundance F{code} Sample"
    
    Args:
        columns: List of column names from the CSV
        
    Returns:
        Name of the abundance column
        
    Raises:
        InvalidFileFormatError: If no abundance column found
    """
    abundance_pattern = re.compile(r'^"?Abundance F[\dA-Z]+ Sample"?$', re.IGNORECASE)
    
    for col in columns:
        if abundance_pattern.match(col):
            return col
    
    raise InvalidFileFormatError(
        message="No abundance column found in CSV",
        details={
            "available_columns": columns,
            "expected_pattern": "Abundance F{code} Sample"
        }
    )


def validate_psm_columns(df: pd.DataFrame, filename: str) -> None:
    """
    Validate that the DataFrame has all required columns.
    
    Args:
        df: DataFrame to validate
        filename: Original filename for error messages
        
    Raises:
        InvalidFileFormatError: If required columns are missing
    """
    columns = set(df.columns)
    missing = [col for col in REQUIRED_COLUMNS if col not in columns]
    
    if missing:
        raise InvalidFileFormatError(
            message=f"Missing required columns in {filename}",
            details={
                "filename": filename,
                "missing_columns": missing,
                "required_columns": REQUIRED_COLUMNS,
                "available_columns": list(columns)
            }
        )
    
    # Also check for abundance column
    try:
        find_abundance_column(list(columns))
    except InvalidFileFormatError:
        raise InvalidFileFormatError(
            message=f"Missing abundance column in {filename}",
            details={
                "filename": filename,
                "expected_pattern": "Abundance F{{code}} Sample",
                "available_columns": list(columns)
            }
        )


def parse_psm_csv(file_path: Path) -> pd.DataFrame:
    """
    Parse a PSM CSV file and validate its contents.
    
    Args:
        file_path: Path to the CSV file
        
    Returns:
        DataFrame with validated data
        
    Raises:
        InvalidFileFormatError: If file is invalid
    """
    try:
        df = pd.read_csv(file_path)
    except Exception as e:
        raise InvalidFileFormatError(
            message=f"Failed to read CSV file: {file_path.name}",
            details={"filename": file_path.name, "error": str(e)}
        )
    
    validate_psm_columns(df, file_path.name)
    
    return df


def extract_columns_from_csv(file_path: Path) -> list[str]:
    """
    Extract column names from a CSV file without loading all data.
    
    Args:
        file_path: Path to the CSV file
        
    Returns:
        List of column names
    """
    try:
        df = pd.read_csv(file_path, nrows=0)
        return list(df.columns)
    except Exception as e:
        raise InvalidFileFormatError(
            message=f"Failed to read CSV columns: {file_path.name}",
            details={"filename": file_path.name, "error": str(e)}
        )


def parse_compound_csv(file_path: Path) -> pd.DataFrame:
    """
    Parse a compound ID CSV file.
    
    Expected columns:
    - corp_id: Corporate compound ID
    - smiles: SMILES string
    
    Args:
        file_path: Path to the CSV file
        
    Returns:
        DataFrame with compound data
    """
    try:
        df = pd.read_csv(file_path)
    except Exception as e:
        raise InvalidFileFormatError(
            message=f"Failed to read compound CSV: {file_path.name}",
            details={"filename": file_path.name, "error": str(e)}
        )
    
    # Check for required columns (case-insensitive)
    columns_lower = [col.lower() for col in df.columns]
    
    if 'corp_id' not in columns_lower and 'compound_id' not in columns_lower:
        raise InvalidFileFormatError(
            message=f"Missing corp_id column in {file_path.name}",
            details={
                "filename": file_path.name,
                "available_columns": list(df.columns)
            }
        )
    
    return df


def get_file_size(file_path: Path) -> int:
    """
    Get file size in bytes.
    
    Args:
        file_path: Path to the file
        
    Returns:
        File size in bytes
    """
    return file_path.stat().st_size


def format_file_size(size_bytes: int) -> str:
    """
    Format file size in human-readable format.
    
    Args:
        size_bytes: Size in bytes
        
    Returns:
        Human-readable size string
    """
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def sanitize_filename(filename: str) -> str:
    """
    Sanitize a filename to remove unsafe characters.
    
    Args:
        filename: Original filename
        
    Returns:
        Sanitized filename
    """
    # Remove path separators and other unsafe characters
    unsafe_chars = '<>:"/\\|?*'
    for char in unsafe_chars:
        filename = filename.replace(char, '_')
    return filename
