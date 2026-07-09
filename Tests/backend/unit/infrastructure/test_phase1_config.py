"""
Tests for Phase 1+2 configuration settings: DuckDB streaming, msqrob2 batching, ridge default.
"""

import os

import pytest
from app.core.config import Settings
from app.models.analysis import AnalysisConfig


class TestDuckDbMsqrob2BatchSettings:
    """Verify new Phase 1+2 settings have correct defaults and validation."""

    def test_use_duckdb_streaming_default(self):
        """DuckDB streaming is enabled by default."""
        settings = Settings()
        assert settings.use_duckdb_streaming is True

    def test_msqrob2_batch_size_default(self):
        """msqrob2_batch_size defaults to 10."""
        settings = Settings()
        assert settings.msqrob2_batch_size == 10

    def test_msqrob2_batch_size_within_bounds(self):
        """msqrob2_batch_size must be between 1 and 50."""
        settings = Settings()
        assert 1 <= settings.msqrob2_batch_size <= 50

    def test_msqrob2_max_workers_default(self):
        """msqrob2_max_workers defaults to min(cpu_count // 2, 32)."""
        cpu = os.cpu_count() or 4
        settings = Settings()
        expected = min(cpu // 2, 32)
        assert settings.msqrob2_max_workers == expected

    def test_msqrob2_max_workers_within_bounds(self):
        """msqrob2_max_workers must be between 1 and 64."""
        settings = Settings()
        assert 1 <= settings.msqrob2_max_workers <= 64

    def test_msqrob2_n_cores_cap_default(self):
        """msqrob2_n_cores_cap defaults to 32."""
        settings = Settings()
        assert settings.msqrob2_n_cores_cap == 32

    def test_msqrob2_n_cores_cap_within_bounds(self):
        """msqrob2_n_cores_cap must be between 1 and 64."""
        settings = Settings()
        assert 1 <= settings.msqrob2_n_cores_cap <= 64

    def test_environ_overrides_duckdb(self, monkeypatch):
        """use_duckdb_streaming should be overridable via env var."""
        monkeypatch.setenv("USE_DUCKDB_STREAMING", "false")
        settings = Settings()
        assert settings.use_duckdb_streaming is False

    @pytest.mark.parametrize(
        "env_val,expected",
        [
            ("5", 5),
            ("20", 20),
            ("1", 1),
        ],
    )
    def test_msqrob2_batch_size_from_env(self, monkeypatch, env_val, expected):
        """msqrob2_batch_size should be overridable via env var."""
        monkeypatch.setenv("MSQROB2_BATCH_SIZE", env_val)
        settings = Settings()
        assert settings.msqrob2_batch_size == expected

    @pytest.mark.parametrize(
        "env_val,expected",
        [
            ("8", 8),
            ("16", 16),
            ("1", 1),
        ],
    )
    def test_msqrob2_max_workers_from_env(self, monkeypatch, env_val, expected):
        """msqrob2_max_workers should be overridable via env var."""
        monkeypatch.setenv("MSQROB2_MAX_WORKERS", env_val)
        settings = Settings()
        assert settings.msqrob2_max_workers == expected


class TestMsqrob2RidgeDefault:
    """Verify msqrob2_ridge default changed to True."""

    def test_ridge_default_is_true(self):
        """msqrob2_ridge now defaults to True for stability."""
        config = AnalysisConfig()
        assert config.msqrob2_ridge is True

    def test_ridge_can_be_disabled(self):
        """Setting msqrob2_ridge to False is still allowed."""
        config = AnalysisConfig(msqrob2_ridge=False)
        assert config.msqrob2_ridge is False
