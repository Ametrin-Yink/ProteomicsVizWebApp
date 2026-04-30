"""
General utility helpers.

Provides common utility functions used across the application.
"""

import uuid


def generate_uuid() -> str:
    """
    Generate a new UUID string.

    Returns:
        UUID string
    """
    return str(uuid.uuid4())
