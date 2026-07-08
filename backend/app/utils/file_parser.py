"""
File parsing utilities for proteomics PD export files.

Handles delimiter detection, TMT/DIA column validation, and
file format detection for TMT and DIA proteomics files.
"""

import re
from pathlib import Path

import pandas as pd

from app.core.exceptions import InvalidFileFormatError

# Pattern for TMT abundance columns: "Abundance 126", "Abundance 127N", etc.
TMT_ABUNDANCE_PATTERN = r'^"?Abundance\s+(\d+)([NC])?"?$'

# Required columns for TMT files (same as DIA)
TMT_REQUIRED_COLUMNS = [
    "Sequence",
    "Modifications",
    "Charge",
    "Contaminant",
    "Master Protein Accessions",
    "Quan Info",
]

# Required columns for DIA files (same as TMT)
DIA_REQUIRED_COLUMNS = [
    "Sequence",
    "Modifications",
    "Charge",
    "Contaminant",
    "Master Protein Accessions",
    "Quan Info",
]


def detect_delimiter(file_path: Path) -> str:
    """Read first line, detect tab vs comma.

    Args:
        file_path: Path to the file.

    Returns:
        '\\t' if tab-delimited, ',' if comma-delimited.

    Raises:
        InvalidFileFormatError: If delimiter cannot be determined.
    """
    try:
        with open(file_path, encoding="utf-8") as f:
            first_line = f.readline()
    except Exception as e:
        raise InvalidFileFormatError(
            message=f"Failed to read file: {file_path.name}",
            details={"filename": file_path.name, "error": str(e)},
        ) from e

    # Count tabs vs commas in the header line
    tab_count = first_line.count("\t")
    comma_count = first_line.count(",")

    if tab_count >= comma_count and tab_count > 0:
        return "\t"
    if comma_count > 0:
        return ","
    raise InvalidFileFormatError(
        message=f"Cannot detect delimiter in file: {file_path.name}",
        details={"filename": file_path.name, "first_line": first_line[:200]},
    )


def detect_tmt_channels(columns: list[str]) -> list[str]:
    """Extract sorted TMT channel labels from abundance columns.

    Matches columns matching pattern: ^"?Abundance\\s+(\\d+)([NC])?"?$

    Args:
        columns: List of column names from the file.

    Returns:
        Sorted list of TMT channel labels (e.g. ['126', '127N', ..., '134N']).
    """
    pattern = re.compile(TMT_ABUNDANCE_PATTERN)
    channels = []
    for col in columns:
        match = pattern.match(col)
        if match:
            label = match.group(1) + (match.group(2) or "")
            channels.append(label)

    # Sort numerically by the numeric prefix, then by suffix order (N before C)
    SUFFIX_ORDER = {"": 0, "N": 1, "C": 2}

    def sort_key(ch: str) -> tuple[int, int]:
        num_str = ""
        suffix = ""
        for c in ch:
            if c.isdigit():
                num_str += c
            else:
                suffix += c
        return (int(num_str), SUFFIX_ORDER.get(suffix, 3))

    channels.sort(key=sort_key)
    return channels


def read_file_columns(file_path: Path) -> list[str]:
    """Read column headers only (nrows=0) with auto-detected delimiter.

    Args:
        file_path: Path to the file.

    Returns:
        List of column names.
    """
    delimiter = detect_delimiter(file_path)
    try:
        df = pd.read_csv(file_path, delimiter=delimiter, nrows=0)
        return list(df.columns)
    except Exception as e:
        raise InvalidFileFormatError(
            message=f"Failed to read columns from: {file_path.name}",
            details={"filename": file_path.name, "error": str(e)},
        ) from e


def validate_tmt_columns(df: pd.DataFrame, filename: str) -> None:
    """Validate TMT file: required columns present + >=2 abundance columns matching TMT pattern.

    Abundance columns must be numeric or empty.

    Args:
        df: DataFrame to validate.
        filename: Original filename for error messages.

    Raises:
        InvalidFileFormatError: On validation failure.
    """
    columns = set(df.columns)

    # Check required columns
    missing = [col for col in TMT_REQUIRED_COLUMNS if col not in columns]
    if missing:
        raise InvalidFileFormatError(
            message=f"Missing required columns in {filename}",
            details={
                "filename": filename,
                "missing_columns": missing,
                "required_columns": TMT_REQUIRED_COLUMNS,
                "available_columns": list(columns),
            },
        )

    # Check for at least 2 abundance columns matching TMT pattern
    pattern = re.compile(TMT_ABUNDANCE_PATTERN)
    abundance_cols = [col for col in df.columns if pattern.match(str(col))]
    if len(abundance_cols) < 2:
        raise InvalidFileFormatError(
            message=f"Missing TMT abundance columns in {filename}",
            details={
                "filename": filename,
                "abundance_columns_found": abundance_cols,
                "expected_pattern": str(TMT_ABUNDANCE_PATTERN),
                "available_columns": list(columns),
            },
        )

    # Validate abundance values are numeric (sample first 100 rows)
    sample = df[abundance_cols].head(100)
    for col in abundance_cols:
        numeric = pd.to_numeric(sample[col], errors="coerce")
        # Only flag rows where the original value is non-null AND non-numeric
        mask = numeric.isna() & sample[col].notna()
        if mask.any():
            non_numeric_rows = sample[col][mask].head(5)
            raise InvalidFileFormatError(
                message=f"Non-numeric values found in abundance column '{col}' in {filename}",
                details={
                    "filename": filename,
                    "column": col,
                    "non_numeric_values": non_numeric_rows.to_list(),
                },
            )


def validate_dia_columns(df: pd.DataFrame, filename: str) -> None:
    """Validate DIA file: required columns present + 'Quan Value' column present.

    'Quan Value' column must be numeric.

    Args:
        df: DataFrame to validate.
        filename: Original filename for error messages.

    Raises:
        InvalidFileFormatError: On validation failure.
    """
    columns = set(df.columns)

    # Check required columns
    missing = [col for col in DIA_REQUIRED_COLUMNS if col not in columns]
    if missing:
        raise InvalidFileFormatError(
            message=f"Missing required columns in {filename}",
            details={
                "filename": filename,
                "missing_columns": missing,
                "required_columns": DIA_REQUIRED_COLUMNS,
                "available_columns": list(columns),
            },
        )

    # Check for Quan Value column
    if "Quan Value" not in columns:
        raise InvalidFileFormatError(
            message=f"Missing 'Quan Value' column in {filename}",
            details={
                "filename": filename,
                "available_columns": list(columns),
            },
        )

    # Validate Quan Value values are numeric (sample first 100 rows)
    sample = df[["Quan Value"]].head(100)
    numeric = pd.to_numeric(sample["Quan Value"], errors="coerce")
    # Only flag rows where the original value is non-null AND non-numeric
    mask = numeric.isna() & sample["Quan Value"].notna()
    if mask.any():
        non_numeric_rows = sample["Quan Value"][mask].head(5)
        raise InvalidFileFormatError(
            message=f"Non-numeric values found in 'Quan Value' column in {filename}",
            details={
                "filename": filename,
                "column": "Quan Value",
                "non_numeric_values": non_numeric_rows.to_list(),
            },
        )


def parse_proteomics_file(file_path: Path, file_type: str) -> dict:
    """Parse a PD export file. Auto-detect delimiter. Validate columns per file_type.

    Args:
        file_path: Path to the file.
        file_type: 'tmt' or 'dia'.

    Returns:
        Dict with: columns (list), tmt_channels (list|None), has_quan_value (bool|None).

    Raises:
        InvalidFileFormatError: On validation failure or unknown file_type.
    """
    delimiter = detect_delimiter(file_path)
    df = pd.read_csv(file_path, delimiter=delimiter, low_memory=False)
    columns = list(df.columns)

    if file_type == "tmt":
        validate_tmt_columns(df, file_path.name)
        tmt_channels = detect_tmt_channels(columns)
        return {
            "columns": columns,
            "tmt_channels": tmt_channels,
            "has_quan_value": None,
        }
    elif file_type == "dia":
        validate_dia_columns(df, file_path.name)
        return {
            "columns": columns,
            "tmt_channels": None,
            "has_quan_value": True,
        }
    else:
        raise InvalidFileFormatError(
            message=f"Unknown file type: {file_type}",
            details={"file_type": file_type, "filename": file_path.name},
        )


def sanitize_filename(filename: str) -> str:
    """Sanitize a filename to remove unsafe characters.

    Args:
        filename: Original filename

    Returns:
        Sanitized filename
    """
    # Remove path separators and other unsafe characters
    unsafe_chars = '<>:"/\\|?*'
    for char in unsafe_chars:
        filename = filename.replace(char, "_")
    return filename
