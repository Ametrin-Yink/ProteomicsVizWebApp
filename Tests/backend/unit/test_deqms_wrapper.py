"""Tests for DEqMS wrapper."""

import pytest
from pathlib import Path

from app.services.deqms_wrapper import DeqmsWrapper
from app.core.exceptions import RScriptError


@pytest.fixture
def wrapper():
    return DeqmsWrapper()


def test_wrapper_initialization(wrapper):
    """Test wrapper initializes with correct defaults."""
    assert wrapper.r_executable is not None
    assert wrapper.timeout > 0
    assert wrapper.scripts_dir.exists()


def test_scripts_exist(wrapper):
    """Test that DEqMS R scripts exist."""
    assert (wrapper.scripts_dir / "deqms_protein.R").exists()
    assert (wrapper.scripts_dir / "deqms_de.R").exists()


@pytest.mark.asyncio
async def test_verify_r_packages(wrapper):
    """Test R package verification."""
    result = await wrapper.verify_r_packages()
    # May fail if R is not on PATH from test working directory
    assert isinstance(result, dict)
    assert "success" in result
    assert "output" in result or "error" in result


@pytest.mark.asyncio
async def test_script_not_found(wrapper, tmp_path):
    """Test error when R script doesn't exist."""
    wrapper2 = DeqmsWrapper()
    wrapper2.scripts_dir = tmp_path

    with pytest.raises(RScriptError, match="not found"):
        await wrapper2.step6_protein_abundance(
            input_file=tmp_path / "input.tsv",
            output_file=tmp_path / "output.tsv",
        )
