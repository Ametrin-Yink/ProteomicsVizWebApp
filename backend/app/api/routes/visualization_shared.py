"""Shared helpers for visualization route modules."""

import uuid
from datetime import UTC, datetime
from typing import Any


def cache_key(session_id: str, *args: object) -> str:
    """Generate a cache key from a session ID and additional values."""
    return f"{session_id}:{':'.join(str(arg) for arg in args)}"


def create_response(data: Any) -> dict[str, Any]:
    """Wrap visualization data with standard response metadata."""
    return {
        "data": data,
        "meta": {
            "timestamp": datetime.now(UTC).isoformat(),
            "request_id": str(uuid.uuid4()),
        },
    }


class FileCache:
    """Small in-memory cache for immutable visualization result files."""

    def __init__(self, max_size: int = 50):
        self._max_size = max_size
        self._cache: dict[str, tuple[datetime, Any]] = {}

    def get(self, key: str) -> Any:
        entry = self._cache.get(key)
        return entry[1] if entry else None

    def set(self, key: str, value: Any) -> None:
        if len(self._cache) >= self._max_size:
            oldest_key = min(self._cache, key=lambda item: self._cache[item][0])
            del self._cache[oldest_key]
        self._cache[key] = (datetime.now(UTC), value)

    def invalidate(self, session_id: str) -> None:
        prefix = f"{session_id}:"
        self._cache = {
            key: value
            for key, value in self._cache.items()
            if not key.startswith(prefix)
        }

    def remove(self, key: str) -> None:
        self._cache.pop(key, None)

    def clear(self) -> None:
        self._cache.clear()


def build_sample_filter(session: Any, comparison: str) -> list[str] | None:
    """Return condition prefixes belonging to one configured comparison."""
    if not comparison:
        return None
    comparisons = session.config.comparisons if session.config else []
    for configured in comparisons:
        group1 = configured.get("group1", {})
        group2 = configured.get("group2", {})
        group1_label = "+".join(group1.values())
        group2_label = "+".join(group2.values())
        if f"{group1_label}_vs_{group2_label}" == comparison:
            return list(group1.values()) + list(group2.values())
    return None


visualization_cache = FileCache(max_size=50)
