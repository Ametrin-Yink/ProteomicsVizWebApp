import os
import pytest
from app.core.config import Settings


class TestMsstatsBatchSettings:
    def test_batch_settings_have_defaults(self):
        """Settings should load with production-appropriate defaults."""
        settings = Settings()
        assert settings.msstats_batch_size == 10
        assert settings.msstats_max_workers >= 1
        assert settings.msstats_max_workers <= 64
        assert settings.msstats_n_cores_cap == 32

    def test_batch_size_within_bounds(self):
        """batch_size must be between 1 and 50."""
        settings = Settings()
        assert 1 <= settings.msstats_batch_size <= 50

    def test_max_workers_respects_cpu_count(self):
        """max_workers should default to min(cpu_count // 2, 32)."""
        cpu = os.cpu_count() or 4
        settings = Settings()
        expected = min(cpu // 2, 32)
        assert settings.msstats_max_workers == expected

    @pytest.mark.parametrize("env_val,expected", [
        ("5", 5),
        ("20", 20),
        ("1", 1),
    ])
    def test_batch_size_from_env(self, monkeypatch, env_val, expected):
        """batch_size should be overridable via env var."""
        monkeypatch.setenv("MSSTATS_BATCH_SIZE", env_val)
        settings = Settings()
        assert settings.msstats_batch_size == expected

    @pytest.mark.parametrize("env_val,expected", [
        ("8", 8),
        ("16", 16),
        ("1", 1),
    ])
    def test_max_workers_from_env(self, monkeypatch, env_val, expected):
        """max_workers should be overridable via env var."""
        monkeypatch.setenv("MSSTATS_MAX_WORKERS", env_val)
        settings = Settings()
        assert settings.msstats_max_workers == expected

    def test_n_cores_cap_is_reasonable(self):
        """n_cores_cap should be between 1 and 64."""
        settings = Settings()
        assert 1 <= settings.msstats_n_cores_cap <= 64
