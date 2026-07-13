"""Unit tests for file library API routes (mocked index service)."""

import io
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def mock_index():
    """Return a mock FileIndexService."""
    idx = MagicMock()
    idx.list_directory.return_value = [
        {"name": "sample.txt", "path": "proj/sample.txt", "type": "txt",
         "size": 1024, "modified_at": "2026-07-13T00:00:00"},
    ]
    idx.scan_and_sync.return_value = {"total": 1, "added": 0, "removed": 0, "updated": 0}
    idx.search.return_value = []
    idx.get_entry.return_value = {
        "name": "sample.txt", "path": "proj/sample.txt", "type": "txt",
        "size": 1024, "modified_at": "2026-07-13T00:00:00",
    }
    idx.count.return_value = 1
    return idx


@pytest.fixture
def client_with_files(mock_index, tmp_path, monkeypatch):
    """Create a TestClient with the files router mounted."""
    monkeypatch.setattr("app.core.config.settings.file_library_dir", tmp_path)
    from fastapi import FastAPI

    app = FastAPI()
    # We need to patch the router's dependency. The router will use a
    # dependency function to get the index service. We override it.
    from app.api.routes.files import get_index_service, router as files_router

    # Override the index dependency
    app.dependency_overrides[get_index_service] = lambda: mock_index
    app.include_router(files_router, prefix="/api/files")

    with TestClient(app) as c:
        yield c


class TestTreeEndpoint:
    def test_list_root_directory(self, client_with_files, mock_index):
        """GET /tree?path=/ returns entries."""
        resp = client_with_files.get("/api/files/tree?path=")
        assert resp.status_code == 200
        data = resp.json()
        assert "entries" in data
        assert len(data["entries"]) == 1
        assert data["entries"][0]["name"] == "sample.txt"

    def test_list_subdirectory(self, client_with_files, mock_index):
        """GET /tree?path=proj returns entries for that path."""
        resp = client_with_files.get("/api/files/tree?path=proj")
        assert resp.status_code == 200
        mock_index.list_directory.assert_called_with("proj")


class TestCreateFolder:
    def test_create_folder_success(self, client_with_files):
        resp = client_with_files.post(
            "/api/files/folders",
            json={"parent_path": "proj", "name": "new_folder"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "new_folder"

    def test_create_folder_invalid_name(self, client_with_files):
        resp = client_with_files.post(
            "/api/files/folders",
            json={"parent_path": "", "name": ".."},
        )
        assert resp.status_code == 400


class TestUpload:
    def test_upload_rejects_invalid_extension(self, client_with_files):
        """Upload of .exe file returns 400."""
        fake_file = io.BytesIO(b"malicious content")
        resp = client_with_files.post(
            "/api/files/upload?target_path=proj",
            files={"files": ("bad.exe", fake_file, "application/octet-stream")},
        )
        assert resp.status_code == 400
        assert "Only .txt and .csv" in resp.json()["detail"]

    def test_upload_rejects_fasta(self, client_with_files):
        """Upload of .fasta file returns 400."""
        fake_file = io.BytesIO(b">sequence\nACGT")
        resp = client_with_files.post(
            "/api/files/upload?target_path=proj",
            files={"files": ("ref.fasta", fake_file, "text/plain")},
        )
        assert resp.status_code == 400


class TestSearch:
    def test_search_returns_results(self, client_with_files, mock_index):
        mock_index.search.return_value = [
            {"name": "sample.txt", "path": "proj/sample.txt", "type": "txt",
             "size": 1024, "modified_at": "2026-07-13T00:00:00"},
        ]
        resp = client_with_files.get("/api/files/search?q=sample")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["results"]) == 1


class TestScan:
    def test_scan_returns_result(self, client_with_files, mock_index):
        resp = client_with_files.post("/api/files/scan")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
