"""
Pytest configuration and shared fixtures for backend tests.
"""

import os
import sys
import tempfile
from pathlib import Path

# Keep import-time stores and task recovery away from runtime data. Retaining
# the TemporaryDirectory object keeps this directory alive for the pytest run.
_test_runtime = tempfile.TemporaryDirectory(prefix="proteomicsviz-tests-")
os.environ["SESSIONS_DIR"] = str(Path(_test_runtime.name) / "sessions")

# Add backend directory to Python path for imports
backend_dir = Path(__file__).parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import pandas as pd
import pytest


@pytest.fixture(autouse=True)
def test_sessions_dir(tmp_path_factory, monkeypatch) -> Path:
    """Return an isolated session directory for a single test."""
    sessions_dir = tmp_path_factory.mktemp("session-isolation")
    from app.core.config import settings

    monkeypatch.setattr(settings, "sessions_dir", sessions_dir)
    return sessions_dir


@pytest.fixture
def client(test_sessions_dir: Path):
    """Create a FastAPI test client backed by an isolated session store."""
    from app.main import app
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c


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


@pytest.fixture(scope="session")
def test_data_dir() -> Path:
    """Return path to test data directory."""
    test_dir = Path(__file__).parent / "fixtures"
    test_dir.mkdir(exist_ok=True)
    return test_dir


@pytest.fixture
def tmt_fixture_path() -> Path:
    """Return path to the TMT sample fixture file."""
    return Path(__file__).parent / "fixtures" / "tmt_sample_10000rows.txt"


@pytest.fixture
def dia_fixture_path() -> Path:
    """Return path to the DIA sample fixture file."""
    return Path(__file__).parent / "fixtures" / "dia_sample_01_10000rows.txt"


# Pytest hooks for custom reporting


def pytest_configure(config):
    """Configure pytest."""
    config.addinivalue_line("markers", "slow: marks tests as slow")
    config.addinivalue_line("markers", "integration: marks tests as integration tests")
    config.addinivalue_line("markers", "unit: marks tests as unit tests")


def pytest_collection_modifyitems(config, items):
    """Modify test collection."""
    for item in items:
        if "integration" in item.nodeid:
            item.add_marker(pytest.mark.integration)
        elif "unit" in item.nodeid:
            item.add_marker(pytest.mark.unit)


def pytest_runtest_makereport(item, call):
    """Custom test reporting."""
    if call.when == "call" and call.excinfo is not None:
        # Test failed - could add custom logging here
        pass
