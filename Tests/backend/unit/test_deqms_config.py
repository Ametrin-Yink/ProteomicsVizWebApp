"""Tests for DEqMS analysis configuration."""

import pytest

from app.models.analysis import AnalysisConfig, AnalysisTemplate


def test_deqms_template_in_enum():
    """Verify DEQMS_PAIRWISE exists in AnalysisTemplate enum."""
    assert hasattr(AnalysisTemplate, 'DEQMS_PAIRWISE')
    assert AnalysisTemplate.DEQMS_PAIRWISE == "deqms_pairwise_comparison"


def test_deqms_config_default():
    """Verify AnalysisConfig accepts DEqMS template with defaults."""
    config = AnalysisConfig(
        template=AnalysisTemplate.DEQMS_PAIRWISE,
        treatment="Treatment",
        control="Control",
    )
    assert config.template == AnalysisTemplate.DEQMS_PAIRWISE
    assert config.deqms_fit_method == "loess"


@pytest.mark.parametrize("fit_method", ["loess", "nls", "spline"])
def test_deqms_fit_method_accepted(fit_method):
    """Verify valid fit methods are accepted."""
    config = AnalysisConfig(
        template=AnalysisTemplate.DEQMS_PAIRWISE,
        treatment="Treatment",
        control="Control",
        deqms_fit_method=fit_method,
    )
    assert config.deqms_fit_method == fit_method


def test_deqms_config_validates_treatment_control():
    """Verify control must differ from treatment."""
    with pytest.raises(ValueError, match="must differ"):
        AnalysisConfig(
            template=AnalysisTemplate.DEQMS_PAIRWISE,
            treatment="Same",
            control="Same",
        )
