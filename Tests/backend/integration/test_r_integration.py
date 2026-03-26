"""
Integration tests for R integration.

Tests R package availability and script execution.
"""

import subprocess
import pytest


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

    def test_msqrob2_available(self):
        """Verify msqrob2 package is installed."""
        result = subprocess.run(
            ['Rscript', '-e', 'library(msqrob2); cat("OK")'],
            capture_output=True,
            text=True
        )

        assert result.returncode == 0
        assert "OK" in result.stdout

    def test_qfeatures_available(self):
        """Verify QFeatures package is installed."""
        result = subprocess.run(
            ['Rscript', '-e', 'library(QFeatures); cat("OK")'],
            capture_output=True,
            text=True
        )

        assert result.returncode == 0
        assert "OK" in result.stdout

    def test_limma_available(self):
        """Verify limma package is installed."""
        result = subprocess.run(
            ['Rscript', '-e', 'library(limma); cat("OK")'],
            capture_output=True,
            text=True
        )

        assert result.returncode == 0
        assert "OK" in result.stdout


class TestRScripts:
    """Test R script execution."""

    def test_verify_r_packages_script_exists(self):
        """Verify R package verification script exists."""
        from pathlib import Path
        script_path = Path(__file__).parent.parent.parent.parent / "backend" / "scripts" / "verify_r_packages.R"

        assert script_path.exists()

    def test_msqrob2_protein_script_exists(self):
        """Verify protein abundance script exists."""
        from pathlib import Path
        script_path = Path(__file__).parent.parent.parent.parent / "backend" / "scripts" / "msqrob2_protein.R"

        assert script_path.exists()

    def test_msqrob2_de_script_exists(self):
        """Verify DE analysis script exists."""
        from pathlib import Path
        script_path = Path(__file__).parent.parent.parent.parent / "backend" / "scripts" / "msqrob2_de.R"

        assert script_path.exists()
