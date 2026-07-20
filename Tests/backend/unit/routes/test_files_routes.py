"""Unit tests for file library API routes (mocked index service)."""

import asyncio
import io
import time
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pandas as pd
import pytest
from app.db.session_store import SessionStore
from app.models.session import Session, SessionConfig, SessionFiles, SessionState
from fastapi.testclient import TestClient


@pytest.fixture
def mock_index():
    """Return a mock FileIndexService."""
    idx = MagicMock()
    idx.list_directory.return_value = [
        {
            "name": "sample.txt",
            "path": "proj/sample.txt",
            "type": "txt",
            "size": 1024,
            "modified_at": "2026-07-13T00:00:00",
        },
    ]
    idx.scan_and_sync.return_value = {
        "total": 1,
        "added": 0,
        "removed": 0,
        "updated": 0,
    }
    idx.search.return_value = []
    idx.get_entry.return_value = {
        "name": "sample.txt",
        "path": "proj/sample.txt",
        "type": "txt",
        "size": 1024,
        "modified_at": "2026-07-13T00:00:00",
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
    from app.api.routes.files import get_index_service
    from app.api.routes.files import router as files_router

    # Override the index dependency
    app.dependency_overrides[get_index_service] = lambda: mock_index
    app.include_router(files_router, prefix="/api/files")

    with TestClient(app) as c:
        yield c


@pytest.fixture
def ptm_library_client(mock_index, tmp_path, monkeypatch):
    library = tmp_path / "library"
    sessions = tmp_path / "sessions"
    library.mkdir()
    monkeypatch.setattr("app.core.config.settings.file_library_dir", library)
    monkeypatch.setattr("app.core.config.settings.sessions_dir", sessions)

    base = {
        "Annotated Sequence": "[K].ACDK.[R]",
        "Modifications": "N-Term(TMT6plex); C2(DBIA)",
        "Charge": 2,
        "Contaminant": False,
        "Master Protein Accessions": "P1",
        "Quan Info": "",
        "Average Reporter SN": 10,
        "Isolation Interference in Percent": 10,
        "Normalized CHIMERYS Coefficient": 0.9,
        "Abundance 126": 100,
        "Abundance 127": 120,
    }
    pd.DataFrame([base]).to_csv(library / "ptm.txt", sep="\t", index=False)
    pd.DataFrame([base]).drop(columns=["Isolation Interference in Percent"]).to_csv(
        library / "protein.txt", sep="\t", index=False
    )
    mismatch = {**base, "Abundance 128": 90}
    del mismatch["Abundance 127"]
    pd.DataFrame([mismatch]).drop(columns=["Isolation Interference in Percent"]).to_csv(
        library / "protein_mismatch.txt", sep="\t", index=False
    )
    (library / "reference.fasta").write_text(">sp|P1|TEST\nMACDK\n", encoding="utf-8")

    session_id = "550e8400-e29b-41d4-a716-446655440000"
    session = Session(
        id=session_id,
        name="PTM",
        template="multi_condition_comparison",
        pipeline="ptm",
        state=SessionState.CONFIGURING,
        config=SessionConfig(file_type="tmt", resolve_shared_peptides=True),
        files=SessionFiles(),
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    asyncio.run(SessionStore(sessions).create(session))

    from app.api.routes.files import get_index_service
    from app.api.routes.files import router as files_router
    from fastapi import FastAPI

    app = FastAPI()
    app.dependency_overrides[get_index_service] = lambda: mock_index
    app.include_router(files_router, prefix="/api/files")
    with TestClient(app) as client:
        yield client, session_id, sessions


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

    @pytest.mark.asyncio
    async def test_list_directory_does_not_block_event_loop(self, mock_index):
        from app.api.routes.files import list_directory

        def slow_list_directory(path):
            time.sleep(0.1)
            return [{"name": path}]

        mock_index.list_directory.side_effect = slow_list_directory

        listing_task = asyncio.create_task(list_directory("proj", mock_index))
        await asyncio.sleep(0.02)

        assert not listing_task.done()
        assert await listing_task == {"path": "proj", "entries": [{"name": "proj"}]}


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
        assert "Only .txt, .csv, .fasta" in resp.json()["detail"]

    def test_upload_accepts_fasta_for_library_selection(self, client_with_files):
        fake_file = io.BytesIO(b">sequence\nACGT")
        resp = client_with_files.post(
            "/api/files/upload?target_path=",
            files={"files": ("ref.fasta", fake_file, "text/plain")},
        )
        assert resp.status_code == 200


class TestSearch:
    def test_search_returns_results(self, client_with_files, mock_index):
        mock_index.search.return_value = [
            {
                "name": "sample.txt",
                "path": "proj/sample.txt",
                "type": "txt",
                "size": 1024,
                "modified_at": "2026-07-13T00:00:00",
            },
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


class TestPTMLibrarySelection:
    def test_selects_enrichment_and_custom_fasta_by_role(self, ptm_library_client):
        client, session_id, sessions = ptm_library_client
        enrichment = client.post(
            "/api/files/select",
            json={
                "session_id": session_id,
                "paths": ["ptm.txt"],
                "role": "ptm_enrichment",
            },
        )
        fasta = client.post(
            "/api/files/select",
            json={
                "session_id": session_id,
                "paths": ["reference.fasta"],
                "role": "custom_fasta",
            },
        )

        assert enrichment.status_code == 200
        modifications = enrichment.json()["files"][0]["detected_modifications"]
        assert {item["name"] for item in modifications} == {"DBIA", "TMT6plex"}
        assert fasta.status_code == 200
        session = asyncio.run(SessionStore(sessions).get(session_id))
        assert len(session.files.ptm_enrichment) == 1
        assert len(session.files.fasta) == 1

    def test_rejects_optional_protein_with_mismatched_channels(
        self, ptm_library_client
    ):
        client, session_id, _ = ptm_library_client
        first = client.post(
            "/api/files/select",
            json={
                "session_id": session_id,
                "paths": ["ptm.txt"],
                "role": "ptm_enrichment",
            },
        )
        mismatch = client.post(
            "/api/files/select",
            json={
                "session_id": session_id,
                "paths": ["protein_mismatch.txt"],
                "role": "global_proteome",
            },
        )

        assert first.status_code == 200
        assert mismatch.status_code == 400
        assert "channels must match exactly" in mismatch.json()["detail"]


class TestDelete:
    @pytest.mark.parametrize("path", ["", "."])
    def test_delete_rejects_library_root(self, client_with_files, tmp_path, path):
        sentinel = tmp_path / "keep.txt"
        sentinel.write_text("user data")

        resp = client_with_files.request(
            "DELETE",
            "/api/files/delete",
            json={"path": path},
        )

        assert resp.status_code == 400
        assert resp.json()["detail"] == "Cannot delete the file library root."
        assert sentinel.read_text() == "user data"
