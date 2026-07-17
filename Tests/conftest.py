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
os.environ["FILE_LIBRARY_DIR"] = str(Path(_test_runtime.name) / "file_library")

# Add backend directory to Python path for imports
backend_dir = Path(__file__).parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import pytest


@pytest.fixture(autouse=True)
def test_sessions_dir(tmp_path_factory, monkeypatch, request) -> Path:
    """Isolate runtime session and file-library data for a single test."""
    from app.core.config import settings

    if request.node.get_closest_marker("live"):
        return settings.sessions_dir

    sessions_dir = tmp_path_factory.mktemp("session-isolation")
    file_library_dir = tmp_path_factory.mktemp("file-library-isolation")

    monkeypatch.setattr(settings, "sessions_dir", sessions_dir)
    monkeypatch.setattr(settings, "file_library_dir", file_library_dir)
    return sessions_dir


@pytest.fixture
def client(test_sessions_dir: Path):
    """Create a FastAPI test client backed by an isolated session store."""
    from app.main import app
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def test_data_dir() -> Path:
    """Return path to test data directory."""
    return Path(__file__).parent / "fixtures"


@pytest.fixture
def tmt_fixture_path() -> Path:
    """Return path to the TMT sample fixture file."""
    return Path(__file__).parent / "fixtures" / "tmt_sample_10000rows.txt"


@pytest.fixture
def dia_fixture_path() -> Path:
    """Return path to the DIA sample fixture file."""
    return Path(__file__).parent / "fixtures" / "dia_sample_01_10000rows.txt"
