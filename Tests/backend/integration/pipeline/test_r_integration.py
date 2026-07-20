"""
Integration tests for R integration.

Tests R package availability and script execution.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pandas as pd
import pytest

pytestmark = pytest.mark.r


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


@pytest.fixture(scope="module", autouse=True)
def require_rscript():
    """An explicitly selected R lane must fail rather than silently skip."""
    if not _rscript_available():
        pytest.fail("Rscript not found on PATH or at a known location")


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


class TestPtmTmtRContract:
    def test_ptm_tmt_summarization_and_three_models(self, tmp_path):
        root = Path(__file__).resolve().parent.parent.parent.parent.parent
        summarize_script = root / "backend" / "scripts" / "ptm_summarization.R"
        compare_script = root / "backend" / "scripts" / "ptm_group_comparison.R"

        channels = ["126", "127", "128", "129", "130", "131"]
        conditions = ["Drug", "Drug", "Drug", "DMSO", "DMSO", "DMSO"]
        replicates = [1, 2, 3, 1, 2, 3]
        ptm_rows = []
        protein_rows = []
        for protein_index in range(1, 5):
            accession = f"P{protein_index:05d}"
            site = f"{accession}_C{protein_index * 10}"
            for peptide_index in range(1, 3):
                for channel, condition, replicate in zip(
                    channels, conditions, replicates, strict=True
                ):
                    treatment_multiplier = 2.0 if condition == "Drug" else 1.0
                    common = {
                        "Charge": 2,
                        "Mixture": "1",
                        "TechRepMixture": "1",
                        "Run": "1_1",
                        "Channel": channel,
                        "Condition": condition,
                        "BioReplicate": f"{condition}_{replicate}",
                    }
                    ptm_rows.append(
                        {
                            **common,
                            "ProteinName": site,
                            "PeptideSequence": f"PTMPEP{protein_index}X{peptide_index}",
                            "PSM": f"T{protein_index}{peptide_index}_2",
                            "Intensity": 1000
                            * protein_index
                            * peptide_index
                            * treatment_multiplier,
                        }
                    )
                    protein_rows.append(
                        {
                            **common,
                            "ProteinName": accession,
                            "PeptideSequence": f"PROTPEP{protein_index}X{peptide_index}",
                            "PSM": f"P{protein_index}{peptide_index}_2",
                            "Intensity": 2000
                            * protein_index
                            * peptide_index
                            * (1.2 if condition == "Drug" else 1.0),
                        }
                    )

        ptm_path = tmp_path / "ptm.tsv"
        protein_path = tmp_path / "protein.tsv"
        pd.DataFrame(ptm_rows).to_csv(ptm_path, sep="\t", index=False)
        pd.DataFrame(protein_rows).to_csv(protein_path, sep="\t", index=False)
        rds_path = tmp_path / "summarized.rds"

        summarized = subprocess.run(
            [
                RSCRIPT_EXEC,
                str(summarize_script),
                str(ptm_path),
                str(protein_path),
                json.dumps({"imputation": True, "has_reference": False}),
                str(rds_path),
                str(tmp_path),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert summarized.returncode == 0, summarized.stderr
        assert rds_path.exists()

        output_dir = tmp_path / "comparisons"
        comparisons = [
            {"group1": {"condition": "Drug"}, "group2": {"condition": "DMSO"}}
        ]
        compared = subprocess.run(
            [
                RSCRIPT_EXEC,
                str(compare_script),
                str(rds_path),
                str(output_dir),
                json.dumps(comparisons),
                json.dumps(
                    {
                        "ptm_label_type": "TMT",
                        "protein_label_type": "TMT",
                        "adj_method": "BH",
                    }
                ),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert compared.returncode == 0, compared.stderr
        assert (output_dir / "PTM_Model_Drug_vs_DMSO.tsv").exists(), compared.stdout
        assert (output_dir / "PROTEIN_Model_Drug_vs_DMSO.tsv").exists()
        adjusted_path = output_dir / "ADJUSTED_Model_Drug_vs_DMSO.tsv"
        assert adjusted_path.exists()
        adjusted = pd.read_csv(adjusted_path, sep="\t")
        assert not adjusted.empty
        assert adjusted["Adjusted"].all()
