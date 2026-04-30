"""
Integration tests for R integration.

Tests R package availability and script execution.
"""

import subprocess
import pytest
from pathlib import Path


class TestRPackageAvailability:
    """Test R package availability."""

    def test_rscript_available(self):
        """Verify Rscript is available."""
        result = subprocess.run(
            ['Rscript', '--version'],
            capture_output=True,
            text=True
        )

        assert result.returncode == 0

    @pytest.mark.parametrize("package", ["msqrob2", "QFeatures", "limma"])
    def test_r_package_available(self, package):
        """Verify R package is installed."""
        result = subprocess.run(
            ['Rscript', '-e', f'library({package})'],
            capture_output=True,
            text=True
        )

        assert result.returncode == 0, f"{package} not installed"


class TestRScripts:
    """Test R script execution."""

    def test_verify_r_packages_script_exists(self):
        """Verify R package verification script exists."""
        script_path = Path(__file__).parent.parent.parent.parent / "backend" / "scripts" / "verify_r_packages.R"

        assert script_path.exists()

    def test_msqrob2_protein_script_exists(self):
        """Verify protein abundance script exists."""
        script_path = Path(__file__).parent.parent.parent.parent / "backend" / "scripts" / "msqrob2_protein.R"

        assert script_path.exists()

    def test_msqrob2_de_script_exists(self):
        """Verify DE analysis script exists."""
        script_path = Path(__file__).parent.parent.parent.parent / "backend" / "scripts" / "msqrob2_de.R"

        assert script_path.exists()
