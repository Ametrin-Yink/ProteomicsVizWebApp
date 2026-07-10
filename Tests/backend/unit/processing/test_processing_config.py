"""Tests for ProcessingConfig dataclass (preserved from removed test files).

Spec Section 6.1: ProcessingConfig stays unchanged — these tests
are extracted from test_data_processor.py and test_data_processor_steps.py
before those files are deleted.
"""
from app.services.data_processor import ProcessingConfig


class TestProcessingConfig:
    """Test ProcessingConfig behavior."""

    def test_default_config(self):
        """Default config has sensible values."""
        config = ProcessingConfig()
        assert config.remove_razor is False
        assert config.strict_filtering is False
        assert config.fasta_db is None

    def test_config_with_razor(self):
        """Config with razor removal enabled."""
        config = ProcessingConfig(remove_razor=True)
        assert config.remove_razor is True

    def test_config_strict_filtering(self):
        """Config with strict filtering enabled."""
        config = ProcessingConfig(strict_filtering=True)
        assert config.strict_filtering is True

    def test_config_custom(self):
        """ProcessingConfig with custom values."""
        config = ProcessingConfig(remove_razor=True, strict_filtering=True)
        assert config.remove_razor is True
        assert config.strict_filtering is True
