"""
Integration tests for R integration.

Tests R package availability and script execution.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest


def _find_rscript() -> str:
    """Find Rscript from configuration, PATH, or standard Windows locations."""
    configured = os.environ.get("R_EXECUTABLE")
    if configured:
        return configured

    on_path = shutil.which("Rscript")
    if on_path:
        return on_path

    roots = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "R",
        Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "R",
    ]
    candidates = sorted(
        (
            candidate
            for root in roots
            if root.is_dir()
            for candidate in root.glob("R-*/bin/x64/Rscript.exe")
        ),
        reverse=True,
    )
    return str(candidates[0]) if candidates else "Rscript"


RSCRIPT_EXEC = _find_rscript()


def _rscript_available() -> bool:
    """Check whether the resolved Rscript executable can run."""
    try:
        result = subprocess.run(
            [RSCRIPT_EXEC, "--version"], capture_output=True, text=True, timeout=10
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


@pytest.mark.skipif(
    not _rscript_available(), reason="Rscript not found on PATH or at known location"
)
class TestMsstatsPackageAvailability:
    """Test MSstats package availability."""

    @pytest.mark.parametrize("package", ["MSstats", "MSstatsConvert"])
    def test_msstats_package_available(self, package):
        """Verify MSstats package is installed."""
        result = subprocess.run(
            [RSCRIPT_EXEC, "-e", f"library({package})"], capture_output=True, text=True
        )

        assert result.returncode == 0, f"{package} not installed"


class TestMsstatsScripts:
    """Test MSstats script existence."""

    def test_msstats_data_process_script_exists(self):
        """Verify MSstats data process script exists (used by multi-condition pipeline)."""
        script_path = (
            Path(__file__).resolve().parent.parent.parent.parent.parent
            / "backend"
            / "scripts"
            / "msstats_data_process.R"
        )

        assert script_path.exists()

    def test_msstats_group_comparison_multi_script_exists(self):
        """Verify MSstats multi-condition group comparison script exists."""
        script_path = (
            Path(__file__).resolve().parent.parent.parent.parent.parent
            / "backend"
            / "scripts"
            / "msstats_group_comparison_multi.R"
        )

        assert script_path.exists()

    """Test R package availability."""

    def test_rscript_available(self):
        """Verify Rscript is available."""
        result = subprocess.run(
            [RSCRIPT_EXEC, "--version"], capture_output=True, text=True
        )

        assert result.returncode == 0

    @pytest.mark.parametrize("package", ["msqrob2", "QFeatures", "limma"])
    def test_r_package_available(self, package):
        """Verify R package is installed."""
        result = subprocess.run(
            [RSCRIPT_EXEC, "-e", f"library({package})"], capture_output=True, text=True
        )

        assert result.returncode == 0, f"{package} not installed"


class TestRScripts:
    """Test R script execution."""

    def test_msqrob2_data_process_script_exists(self):
        """Verify msqrob2 data process script exists (used by multi-condition pipeline)."""
        script_path = (
            Path(__file__).resolve().parent.parent.parent.parent.parent
            / "backend"
            / "scripts"
            / "msqrob2_data_process.R"
        )

        assert script_path.exists()

    def test_msqrob2_group_comparison_multi_script_exists(self):
        """Verify msqrob2 multi-condition group comparison script exists."""
        script_path = (
            Path(__file__).resolve().parent.parent.parent.parent.parent
            / "backend"
            / "scripts"
            / "msqrob2_group_comparison_multi.R"
        )

        assert script_path.exists()
