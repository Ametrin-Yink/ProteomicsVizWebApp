"""Tests for performance optimization configuration."""

import pytest
from pathlib import Path

from app.core.config import Settings, settings


class TestPerformanceSettings:
    """Test performance optimization settings."""

    def test_parquet_settings_exist(self):
        """Verify Parquet settings are available."""
        assert hasattr(settings, 'use_parquet')
        assert hasattr(settings, 'parquet_compression')
        assert isinstance(settings.use_parquet, bool)
        assert settings.parquet_compression in ['zstd', 'snappy', 'gzip']

    def test_parquet_default_values(self):
        """Verify Parquet default settings."""
        assert settings.use_parquet is True
        assert settings.parquet_compression == 'zstd'

    def test_gsea_cache_settings_exist(self):
        """Verify GSEA cache settings are available."""
        assert hasattr(settings, 'gsea_cache_enabled')
        assert hasattr(settings, 'gsea_cache_ttl_hours')
        assert hasattr(settings, 'gsea_cache_dir')
        assert isinstance(settings.gsea_cache_enabled, bool)
        assert isinstance(settings.gsea_cache_ttl_hours, int)

    def test_gsea_cache_default_values(self):
        """Verify GSEA cache default settings."""
        assert settings.gsea_cache_enabled is True
        assert settings.gsea_cache_ttl_hours == 168  # 7 days

    def test_gsea_cache_dir_path(self):
        """Verify GSEA cache directory path."""
        cache_dir = settings.gsea_cache_dir
        assert isinstance(cache_dir, Path)
        assert 'cache' in str(cache_dir).lower()
        assert 'gsea' in str(cache_dir).lower()

    def test_ensure_directories_creates_cache(self, tmp_path):
        """Test that ensure_directories creates cache directory."""
        test_settings = Settings(
            sessions_dir=tmp_path / "sessions",
            protein_database_dir=tmp_path / "protein_db",
            gsea_cache_enabled=True
        )

        test_settings.ensure_directories()

        assert test_settings.gsea_cache_dir.exists()
