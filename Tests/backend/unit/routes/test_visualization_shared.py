"""Tests for visualization shared helpers — FileCache, cache_key, create_response."""

import re
from datetime import UTC, datetime

from app.api.routes.visualization_shared import (
    FileCache,
    build_sample_filter,
    cache_key,
    create_response,
)


class TestCacheKey:
    def test_basic(self):
        assert cache_key("s1", "a", "b") == "s1:a:b"

    def test_single_arg(self):
        assert cache_key("s1", "x") == "s1:x"

    def test_no_extra_args(self):
        assert cache_key("s1") == "s1:"


class TestCreateResponse:
    def test_wraps_data(self):
        resp = create_response({"key": "val"})
        assert "data" in resp
        assert resp["data"] == {"key": "val"}

    def test_includes_meta(self):
        resp = create_response([1, 2, 3])
        assert "meta" in resp
        assert "timestamp" in resp["meta"]
        assert "request_id" in resp["meta"]

    def test_request_id_is_uuid(self):
        resp = create_response(None)
        # UUID format: 8-4-4-4-12 hex chars
        assert re.match(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            resp["meta"]["request_id"],
        )


class TestFileCache:
    def test_get_set_roundtrip(self):
        cache = FileCache(max_size=5)
        cache.set("k", "v")
        assert cache.get("k") == "v"

    def test_get_missing_returns_none(self):
        cache = FileCache()
        assert cache.get("nonexistent") is None

    def test_evicts_when_full(self):
        cache = FileCache(max_size=3)
        cache.set("a", 1)
        cache.set("b", 2)
        cache.set("c", 3)
        cache.set("d", 4)  # evicts oldest ("a")
        assert cache.get("a") is None
        assert cache.get("b") == 2
        assert cache.get("c") == 3
        assert cache.get("d") == 4

    def test_update_refreshes_timestamp(self):
        cache = FileCache(max_size=2)
        cache.set("a", 1)
        cache.set("b", 2)
        cache.set("a", "updated")  # refresh "a", making "b" oldest
        cache.set("c", 3)  # should evict "b", not "a"
        assert cache.get("a") == "updated"
        assert cache.get("b") is None
        assert cache.get("c") == 3

    def test_invalidate_removes_session_keys(self):
        cache = FileCache()
        cache.set("s1:a", 1)
        cache.set("s1:b", 2)
        cache.set("s2:c", 3)
        cache.invalidate("s1")
        assert cache.get("s1:a") is None
        assert cache.get("s1:b") is None
        assert cache.get("s2:c") == 3

    def test_remove(self):
        cache = FileCache()
        cache.set("x", 1)
        cache.remove("x")
        assert cache.get("x") is None
        cache.remove("nonexistent")  # no error

    def test_clear(self):
        cache = FileCache()
        cache.set("a", 1)
        cache.set("b", 2)
        cache.clear()
        assert cache.get("a") is None
        assert cache.get("b") is None


class TestBuildSampleFilter:
    def test_matches_configured_comparison(self):
        from unittest.mock import MagicMock
        session = MagicMock()
        session.config.comparisons = [
            {
                "group1": {"Condition": "DrugA", "Time": "24h"},
                "group2": {"Condition": "DMSO", "Time": "24h"},
            }
        ]
        result = build_sample_filter(session, "DrugA+24h_vs_DMSO+24h")
        assert result == ["DrugA_24h", "DMSO_24h"]

    def test_empty_comparison(self):
        assert build_sample_filter(None, "") is None

    def test_non_matching(self):
        from unittest.mock import MagicMock
        session = MagicMock()
        session.config.comparisons = [
            {"group1": {"C": "A"}, "group2": {"C": "B"}}
        ]
        assert build_sample_filter(session, "nonexistent") is None

    def test_no_config(self):
        from unittest.mock import MagicMock
        session = MagicMock()
        session.config = None
        assert build_sample_filter(session, "anything") is None
