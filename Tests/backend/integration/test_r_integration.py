"""
Integration tests for R integration.

Tests R package availability and script execution.
"""

import subprocess
import pytest
from pathlib import Path


def _rscript_available() -> bool:
    """Check if Rscript is on PATH or at known Windows path."""
    for cmd in ["Rscript", "C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe"]:
        try:
            result = subprocess.run(
                [cmd, "--version"], capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue
    return False


RSCRIPT_EXEC = "C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe"


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

    def test_verify_msstats_script_exists(self):
        """Verify MSstats verification script exists."""
        script_path = (
            Path(__file__).parent.parent.parent.parent
            / "backend"
            / "scripts"
            / "verify_msstats.R"
        )

        assert script_path.exists()

    def test_msstats_data_process_script_exists(self):
        """Verify MSstats data process script exists (used by multi-condition pipeline)."""
        script_path = (
            Path(__file__).parent.parent.parent.parent
            / "backend"
            / "scripts"
            / "msstats_data_process.R"
        )

        assert script_path.exists()

    def test_msstats_group_comparison_multi_script_exists(self):
        """Verify MSstats multi-condition group comparison script exists."""
        script_path = (
            Path(__file__).parent.parent.parent.parent
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

    def test_verify_r_packages_script_exists(self):
        """Verify R package verification script exists."""
        script_path = (
            Path(__file__).parent.parent.parent.parent
            / "backend"
            / "scripts"
            / "verify_r_packages.R"
        )

        assert script_path.exists()

    def test_msqrob2_data_process_script_exists(self):
        """Verify msqrob2 data process script exists (used by multi-condition pipeline)."""
        script_path = (
            Path(__file__).parent.parent.parent.parent
            / "backend"
            / "scripts"
            / "msqrob2_data_process.R"
        )

        assert script_path.exists()

    def test_msqrob2_group_comparison_multi_script_exists(self):
        """Verify msqrob2 multi-condition group comparison script exists."""
        script_path = (
            Path(__file__).parent.parent.parent.parent
            / "backend"
            / "scripts"
            / "msqrob2_group_comparison_multi.R"
        )

        assert script_path.exists()
