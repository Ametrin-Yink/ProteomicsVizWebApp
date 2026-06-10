"""
Pytest configuration and shared fixtures for backend tests.
"""

import sys
from pathlib import Path

# Add backend directory to Python path for imports
backend_dir = Path(__file__).parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import shutil
from collections.abc import Generator
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def client():
    """Create FastAPI test client."""
    from app.main import app
    from fastapi.testclient import TestClient

    return TestClient(app)


@pytest.fixture
def sample_data_dir() -> Path:
    """Return path to sample data directory."""
    return Path(__file__).parent.parent / "SampleData"


@pytest.fixture
def temp_session_dir(tmp_path: Path) -> Generator[Path, None, None]:
    """Create temporary session directory for tests."""
    session_dir = tmp_path / "sessions" / "test-session"
    session_dir.mkdir(parents=True)
    yield session_dir
    shutil.rmtree(session_dir, ignore_errors=True)


@pytest.fixture
def sample_psm_data() -> pd.DataFrame:
    """Create sample PSM data for testing."""
    return pd.DataFrame(
        {
            "Sequence": ["PEPTIDE1", "PEPTIDE2", "PEPTIDE3"],
            "Modifications": ["", "Oxidation", ""],
            "Charge": [2, 3, 2],
            "Contaminant": [False, False, False],
            "Master Protein Accessions": ["P12345", "P67890", "P11111"],
            "Quan Info": ["Valid", "Valid", "Valid"],
            "Abundance F1 Sample": [1000.0, 2000.0, 1500.0],
            "Abundance F2 Sample": [1100.0, 2100.0, 1600.0],
        }
    )


@pytest.fixture
def sample_protein_abundance() -> pd.DataFrame:
    """Create sample protein abundance data."""
    return pd.DataFrame(
        {
            "Protein": ["P12345", "P67890", "P11111", "P22222", "P33333"],
            "DMSO_1": [1000.0, 2000.0, 1500.0, 1200.0, 1800.0],
            "DMSO_2": [1100.0, 2100.0, 1600.0, 1300.0, 1900.0],
            "DMSO_3": [1050.0, 2050.0, 1550.0, 1250.0, 1850.0],
            "INCZ_1": [2000.0, 2000.0, 1500.0, 1200.0, 1800.0],
            "INCZ_2": [2100.0, 2100.0, 1600.0, 1300.0, 1900.0],
            "INCZ_3": [2050.0, 2050.0, 1550.0, 1250.0, 1850.0],
        }
    ).set_index("Protein")


@pytest.fixture
def sample_diff_expression() -> pd.DataFrame:
    """Create sample differential expression data."""
    return pd.DataFrame(
        {
            "Master_Protein_Accessions": [
                "P12345",
                "P67890",
                "P11111",
                "P22222",
                "P33333",
            ],
            "Gene_Name": ["GENE1", "GENE2", "GENE3", "GENE4", "GENE5"],
            "logFC": [2.0, -1.5, 0.5, 0.0, -2.0],
            "pval": [0.001, 0.01, 0.5, 0.8, 0.0001],
            "adjPval": [0.005, 0.05, 0.6, 0.9, 0.001],
        }
    )


@pytest.fixture
def mock_session():
    """Create mock session for testing."""
    from unittest.mock import MagicMock

    session = MagicMock()
    session.id = "test-session-id"
    session.name = "Test Session"
    session.template = "multi_condition_comparison"
    session.state = "created"
    session.config = None
    session.files = None
    return session


@pytest.fixture
def mock_processing_state():
    """Create mock processing state."""
    return {
        "current_step": 0,
        "completed_steps": [],
        "failed_step": None,
        "error": None,
        "outputs": {},
    }


@pytest.fixture(scope="session")
def test_data_dir() -> Path:
    """Return path to test data directory."""
    test_dir = Path(__file__).parent / "fixtures"
    test_dir.mkdir(exist_ok=True)
    return test_dir


@pytest.fixture
def create_test_csv(tmp_path: Path):
    """Factory fixture to create test CSV files."""

    def _create(filename: str, data: pd.DataFrame) -> Path:
        filepath = tmp_path / filename
        data.to_csv(filepath, index=False)
        return filepath

    return _create


# ── Service-layer fixtures ──


@pytest.fixture
def mock_subprocess_run():
    """Mock subprocess.run to return success with fake R output."""
    import subprocess as _subprocess_mod

    with patch.object(_subprocess_mod, "run") as mock_run:
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "R processing complete\n"
        mock_result.stderr = ""
        mock_run.return_value = mock_result
        yield mock_run


@pytest.fixture
def mock_subprocess_failure():
    """Mock subprocess.run to simulate R script failure."""
    import subprocess as _subprocess_mod

    with patch.object(_subprocess_mod, "run") as mock_run:
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = ""
        mock_result.stderr = "Error in msqrob2::msqrob(): object 'x' not found\n"
        mock_run.return_value = mock_result
        yield mock_run


@pytest.fixture
def sample_abundance_matrix() -> np.ndarray:
    """10 proteins x 6 samples abundance matrix for QC calculator tests."""
    rng = np.random.default_rng(42)
    return np.abs(rng.standard_normal((10, 6)) * 2 + 10)


@pytest.fixture
def sample_gene_sets() -> dict[str, set[str]]:
    """Small GMT-style gene sets for GSEA curve tests."""
    return {
        "Pathway_A": {"GENE1", "GENE2", "GENE3", "GENE4"},
        "Pathway_B": {"GENE5", "GENE6", "GENE7"},
        "Pathway_C": {"GENE1", "GENE5", "GENE8", "GENE9", "GENE10"},
    }


@pytest.fixture
def sample_ranked_genes() -> tuple[list[str], list[float]]:
    """Ranked gene list matching sample_gene_sets."""
    genes = [f"GENE{i}" for i in range(1, 21)]
    metrics = [3.0 - (i * 0.15) for i in range(20)]  # descending
    return genes, metrics


@pytest.fixture
def mock_session_with_config():
    """Fully configured mock session for orchestrator/manager tests."""
    from datetime import UTC, datetime

    from app.models.session import SessionConfig, SessionState

    session = MagicMock()
    session.id = "550e8400-e29b-41d4-a716-446655440000"
    session.name = "Test Experiment"
    session.state = SessionState.CONFIGURING
    session.template = "multi_condition_comparison"
    session.pipeline = "msqrob2"
    session.config = SessionConfig(
        treatment="DrugA",
        control="DMSO",
        organism="human",
        remove_razor=False,
        strict_filtering=False,
        comparisons=[{"group1": {"C": "DrugA"}, "group2": {"C": "DMSO"}}],
    )
    session.files = MagicMock()
    session.files.proteomics = [
        MagicMock(filename=f"PSM_Exp_DrugA_{i}.csv") for i in range(1, 4)
    ] + [MagicMock(filename=f"PSM_Exp_DMSO_{i}.csv") for i in range(1, 4)]
    session.files.compound = None
    session.created_at = datetime.now(UTC)
    session.updated_at = datetime.now(UTC)
    session.markers = {}
    session.volcano_filters = None
    session.error_message = None
    return session


@pytest.fixture(autouse=True)
def reset_pipeline_registry() -> None:
    """Reset pipeline registry before each test to prevent cross-test leakage."""
    from app.services.pipeline_registry import reset_registry

    reset_registry()


# Pytest hooks for custom reporting


def pytest_configure(config):
    """Configure pytest."""
    config.addinivalue_line("markers", "slow: marks tests as slow")
    config.addinivalue_line("markers", "integration: marks tests as integration tests")
    config.addinivalue_line("markers", "unit: marks tests as unit tests")
    config.addinivalue_line(
        "markers",
        "needs_sample_data: requires real-world SampleData/ files not shipped in git",
    )


def pytest_collection_modifyitems(config, items):
    """Modify test collection."""
    # Add markers based on test location
    sample_data_dir = Path(__file__).parent.parent / "SampleData"
    sample_data_exists = any(sample_data_dir.glob("*.csv"))

    for item in items:
        if "integration" in item.nodeid:
            item.add_marker(pytest.mark.integration)
        elif "unit" in item.nodeid:
            item.add_marker(pytest.mark.unit)

        # Skip tests that need SampleData when the directory is missing
        if item.get_closest_marker("needs_sample_data") and not sample_data_exists:
            item.add_marker(
                pytest.mark.skip(
                    reason="SampleData/ not found — add real PSM files to run this test"
                )
            )


def pytest_runtest_makereport(item, call):
    """Custom test reporting."""
    if call.when == "call" and call.excinfo is not None:
        # Test failed - could add custom logging here
        pass
