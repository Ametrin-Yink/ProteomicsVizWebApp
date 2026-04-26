"""
General utility helpers.

Provides common utility functions used across the application.
"""

import re
import uuid
import json
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
import logging

logger = logging.getLogger("proteomics")


def generate_uuid() -> str:
    """
    Generate a new UUID string.
    
    Returns:
        UUID string
    """
    return str(uuid.uuid4())


def generate_request_id() -> str:
    """
    Generate a unique request ID.
    
    Returns:
        Request ID string
    """
    return str(uuid.uuid4())[:8]


def generate_report_id() -> str:
    """
    Generate a unique report ID.
    
    Returns:
        Report ID string
    """
    return f"report-{str(uuid.uuid4())[:8]}"


def format_datetime(dt: Optional[datetime] = None) -> str:
    """
    Format datetime to ISO 8601 string.
    
    Args:
        dt: Datetime to format (defaults to now)
        
    Returns:
        ISO 8601 formatted string
    """
    if dt is None:
        dt = datetime.now(timezone.utc)
    return dt.isoformat() + "Z"


def parse_datetime(dt_str: str) -> Optional[datetime]:
    """
    Parse ISO 8601 datetime string.
    
    Args:
        dt_str: Datetime string to parse
        
    Returns:
        Parsed datetime or None if invalid
    """
    try:
        # Handle 'Z' suffix
        if dt_str.endswith('Z'):
            dt_str = dt_str[:-1] + '+00:00'
        return datetime.fromisoformat(dt_str)
    except (ValueError, TypeError):
        return None


def calculate_overall_progress(current_step: int, step_progress: int) -> int:
    """
    Calculate overall pipeline progress.
    
    Args:
        current_step: Current step number (1-9)
        step_progress: Current step progress (0-100)
        
    Returns:
        Overall progress percentage (0-100)
    """
    if current_step < 1 or current_step > 9:
        return 0
    
    # Each step is worth ~11.11%
    step_weight = 100 / 9
    completed_progress = (current_step - 1) * step_weight
    current_step_contribution = (step_progress / 100) * step_weight
    
    return int(completed_progress + current_step_contribution)


def compute_file_hash(file_path: Path, algorithm: str = "md5") -> str:
    """
    Compute hash of a file.
    
    Args:
        file_path: Path to the file
        algorithm: Hash algorithm (md5, sha256)
        
    Returns:
        Hex digest of file hash
    """
    hash_obj = hashlib.new(algorithm)
    
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            hash_obj.update(chunk)
    
    return hash_obj.hexdigest()


def safe_json_loads(data: str, default: Any = None) -> Any:
    """
    Safely load JSON string.
    
    Args:
        data: JSON string to parse
        default: Default value if parsing fails
        
    Returns:
        Parsed JSON or default value
    """
    try:
        return json.loads(data)
    except (json.JSONDecodeError, TypeError):
        return default


def safe_json_dumps(data: Any, default: str = "{}") -> str:
    """
    Safely dump data to JSON string.
    
    Args:
        data: Data to serialize
        default: Default value if serialization fails
        
    Returns:
        JSON string
    """
    try:
        return json.dumps(data, default=str)
    except (TypeError, ValueError):
        return default


def truncate_string(s: str, max_length: int, suffix: str = "...") -> str:
    """
    Truncate string to maximum length.
    
    Args:
        s: String to truncate
        max_length: Maximum length
        suffix: Suffix to add if truncated
        
    Returns:
        Truncated string
    """
    if len(s) <= max_length:
        return s
    return s[:max_length - len(suffix)] + suffix


def merge_dicts(base: dict, override: dict) -> dict:
    """
    Merge two dictionaries, with override taking precedence.
    
    Args:
        base: Base dictionary
        override: Override dictionary
        
    Returns:
        Merged dictionary
    """
    result = base.copy()
    result.update(override)
    return result


def deep_merge_dicts(base: dict, override: dict) -> dict:
    """
    Deep merge two dictionaries.
    
    Args:
        base: Base dictionary
        override: Override dictionary
        
    Returns:
        Deep merged dictionary
    """
    result = base.copy()
    
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge_dicts(result[key], value)
        else:
            result[key] = value
    
    return result


def ensure_list(value: Any) -> list:
    """
    Ensure value is a list.
    
    Args:
        value: Value to convert to list
        
    Returns:
        List containing the value, or the value if already a list
    """
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def remove_none_values(d: dict) -> dict:
    """
    Remove None values from dictionary.
    
    Args:
        d: Dictionary to clean
        
    Returns:
        Dictionary with None values removed
    """
    return {k: v for k, v in d.items() if v is not None}


def chunk_list(lst: list, chunk_size: int) -> list:
    """
    Split list into chunks.
    
    Args:
        lst: List to chunk
        chunk_size: Size of each chunk
        
    Returns:
        List of chunks
    """
    return [lst[i:i + chunk_size] for i in range(0, len(lst), chunk_size)]


def find_common_prefix(strings: list[str]) -> str:
    """
    Find common prefix of a list of strings.
    
    Args:
        strings: List of strings
        
    Returns:
        Common prefix
    """
    if not strings:
        return ""
    
    prefix = strings[0]
    for s in strings[1:]:
        while not s.startswith(prefix):
            prefix = prefix[:-1]
            if not prefix:
                return ""
    return prefix


def find_common_suffix(strings: list[str]) -> str:
    """
    Find common suffix of a list of strings.
    
    Args:
        strings: List of strings
        
    Returns:
        Common suffix
    """
    if not strings:
        return ""
    
    suffix = strings[0]
    for s in strings[1:]:
        while not s.endswith(suffix):
            suffix = suffix[1:]
            if not suffix:
                return ""
    return suffix


def format_number(n: float, decimals: int = 2) -> str:
    """
    Format number with specified decimal places.
    
    Args:
        n: Number to format
        decimals: Number of decimal places
        
    Returns:
        Formatted number string
    """
    return f"{n:.{decimals}f}"


def format_percentage(n: float, decimals: int = 1) -> str:
    """
    Format number as percentage.
    
    Args:
        n: Number to format (0-1)
        decimals: Number of decimal places
        
    Returns:
        Formatted percentage string
    """
    return f"{n * 100:.{decimals}f}%"


def clamp_value(value: float, min_val: float, max_val: float) -> float:
    """
    Clamp value to range [min_val, max_val].
    
    Args:
        value: Value to clamp
        min_val: Minimum value
        max_val: Maximum value
        
    Returns:
        Clamped value
    """
    return max(min_val, min(max_val, value))


def is_valid_email(email: str) -> bool:
    """
    Basic email validation.
    
    Args:
        email: Email to validate
        
    Returns:
        True if valid email format
    """
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))



class Timer:
    """Simple timer context manager."""
    
    def __init__(self, name: str = "Operation"):
        self.name = name
        self.start_time: Optional[datetime] = None
        self.end_time: Optional[datetime] = None
    
    def __enter__(self):
        self.start_time = datetime.now(timezone.utc)
        logger.info(f"{self.name} started")
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.end_time = datetime.now(timezone.utc)
        duration = (self.end_time - self.start_time).total_seconds()
        logger.info(f"{self.name} completed in {duration:.2f}s")
    
    @property
    def elapsed(self) -> float:
        """Get elapsed time in seconds."""
        if self.start_time is None:
            return 0.0
        end = self.end_time or datetime.now(timezone.utc)
        return (end - self.start_time).total_seconds()
