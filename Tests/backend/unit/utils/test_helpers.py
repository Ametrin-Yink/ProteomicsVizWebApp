"""Tests for trivial utility helpers."""

import re
import uuid as uuid_mod

from app.utils.helpers import generate_uuid


def test_generate_uuid_returns_string():
    result = generate_uuid()
    assert isinstance(result, str)


def test_generate_uuid_is_valid_uuid_format():
    result = generate_uuid()
    # UUID format: 8-4-4-4-12 hex chars
    assert re.match(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        result,
        re.IGNORECASE,
    )


def test_generate_uuid_unique():
    results = {generate_uuid() for _ in range(100)}
    assert len(results) == 100
