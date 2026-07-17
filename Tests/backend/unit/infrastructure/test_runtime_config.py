"""Behavior contracts for scientific runtime configuration."""

import os

import pytest
from app.core.config import Settings
from app.models.analysis import AnalysisConfig


def test_batch_runtime_defaults_are_bounded():
    settings = Settings()
    expected_workers = min((os.cpu_count() or 4) // 2, 32)

    for prefix in ("msstats", "msqrob2"):
        assert getattr(settings, f"{prefix}_batch_size") == 10, prefix
        assert getattr(settings, f"{prefix}_max_workers") == expected_workers, prefix
        assert getattr(settings, f"{prefix}_n_cores_cap") == 32, prefix


@pytest.mark.parametrize(
    "environment,field,value",
    [
        ("MSSTATS_BATCH_SIZE", "msstats_batch_size", 5),
        ("MSSTATS_MAX_WORKERS", "msstats_max_workers", 8),
        ("MSQROB2_BATCH_SIZE", "msqrob2_batch_size", 7),
        ("MSQROB2_MAX_WORKERS", "msqrob2_max_workers", 6),
    ],
)
def test_batch_runtime_environment_overrides(monkeypatch, environment, field, value):
    monkeypatch.setenv(environment, str(value))
    assert getattr(Settings(), field) == value


@pytest.mark.parametrize(
    "field,expected",
    [
        ("r_script_timeout", 7200),
        ("r_data_process_timeout", 7200),
        ("r_group_comparison_timeout", 3600),
        ("r_msqrob2_data_process_timeout", 7200),
        ("r_msqrob2_group_comparison_timeout", 3600),
    ],
)
def test_scientific_process_timeout_defaults(field, expected):
    assert getattr(Settings(), field) == expected


def test_msqrob2_ridge_is_safe_for_three_replicates_by_default():
    assert AnalysisConfig().msqrob2_ridge is False
