"""Unit tests for file library API routes (real index service, real filesystem).

Uses a real DuckDB-backed FileIndexService so listing, search, scan, and
PTM library selection all exercise the actual index pipeline.
"""

import asyncio
import io
import time
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pandas as pd
import pytest
from app.db.session_store import SessionStore
from app.models.session import (
    Session, SessionConfig, SessionFiles, SessionState,
)
from app.services.file_index_service import FileIndexService
from fastapi.testclient import TestClient


@pytest.fixture
def index_service(tmp_path):
    """Real DuckDB-backed FileIndexService in a temp library directory."""
    library = tmp_path / "library"
    library.mkdir()
    svc = FileIndexService(library)
    # Pre-populate with a sample file for listing/search tests
    (library / "proj").mkdir()
    (library / "proj" / "sample.txt").write_text("test content")
    svc.scan_and_sync()
    return svc


@pytest.fixture
def client_with_files(index_service, tmp_path, monkeypatch):
    """TestClient with a real FileIndexService dependency override."""
    monkeypatch.setattr(
        "app.core.config.settings.file_library_dir",
        index_service.library_dir,
    )
    from fastapi import FastAPI

    app = FastAPI()
    from app.api.routes.files import get_index_service
    from app.api.routes.files import router as files_router

    app.dependency_overrides[get_index_service] = lambda: index_service
    app.include_router(files_router, prefix="/api/files")

    with TestClient(app) as c:
        yield c


@pytest.fixture
def ptm_library_client(tmp_path, monkeypatch):
    """Client for PTM enrichment / FASTA selection tests with real index."""
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
    pd.DataFrame([mismatch]).drop(
        columns=["Isolation Interference in Percent"]
    ).to_csv(library / "protein_mismatch.txt", sep="\t", index=False)
    (library / "reference.fasta").write_text(">sp|P1|TEST\nMACDK\n", encoding="utf-8")

    index = FileIndexService(library)
    index.scan_and_sync()

    session_id = "550e8400-e29b-41d4-a716-446655440000"
    session = Session(
        id=session_id, name="PTM",
        template="multi_condition_comparison", pipeline="ptm",
        state=SessionState.CONFIGURING,
        config=SessionConfig(file_type="tmt", resolve_shared_peptides=True),
        files=SessionFiles(),
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    )
    asyncio.run(SessionStore(sessions).create(session))

    from app.api.routes.files import get_index_service
    from app.api.routes.files import router as files_router
    from fastapi import FastAPI

    app = FastAPI()
    app.dependency_overrides[get_index_service] = lambda: index
    app.include_router(files_router, prefix="/api/files")
    with TestClient(app) as client:
        yield client, session_id, sessions


class TestTreeEndpoint:
    def test_list_root_directory(self, client_with_files):
        resp = client_with_files.get("/api/files/tree?path=")
        assert resp.status_code == 200
        data = resp.json()
        assert "entries" in data
        names = {e["name"] for e in data["entries"]}
        assert "proj" in names  # folder created during setup

    def test_list_subdirectory(self, client_with_files):
        resp = client_with_files.get("/api/files/tree?path=proj")
        assert resp.status_code == 200
        data = resp.json()
        names = {e["name"] for e in data["entries"]}
        assert "sample.txt" in names

    @pytest.mark.asyncio
    async def test_list_directory_does_not_block_event_loop(self, tmp_path):
        """The async helper must offload blocking DuckDB calls.

        This test intentionally uses a mock to inject a slow synchronous
        path — it is the one exception in this file.
        """
        from app.api.routes.files import list_directory

        mock_index = MagicMock()

        def slow_list_directory(path):
            time.sleep(0.1)
            return [{"name": path}]

        mock_index.list_directory.side_effect = slow_list_directory

        listing_task = asyncio.create_task(
            list_directory("proj", mock_index)
        )
        await asyncio.sleep(0.02)

        assert not listing_task.done()
        result = await listing_task
        assert result == {"path": "proj", "entries": [{"name": "proj"}]}


class TestCreateFolder:
    def test_create_folder_success(self, client_with_files, index_service):
        resp = client_with_files.post(
            "/api/files/folders",
            json={"parent_path": "proj", "name": "new_folder"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "new_folder"
        # Verify on real filesystem
        assert (index_service.library_dir / "proj" / "new_folder").is_dir()

    def test_create_folder_invalid_name(self, client_with_files):
        resp = client_with_files.post(
            "/api/files/folders",
            json={"parent_path": "", "name": ".."},
        )
        assert resp.status_code == 400


class TestUpload:
    def test_upload_rejects_invalid_extension(self, client_with_files):
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
    def test_search_returns_results(self, client_with_files):
        resp = client_with_files.get("/api/files/search?q=sample")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["results"]) >= 1
        assert any(r["name"] == "sample.txt" for r in data["results"])


class TestScan:
    def test_scan_returns_result(self, client_with_files):
        resp = client_with_files.post("/api/files/scan")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1


class TestPTMLibrarySelection:
    def test_selects_enrichment_and_custom_fasta_by_role(
        self, ptm_library_client
    ):
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
    def test_delete_rejects_library_root(
        self, client_with_files, index_service, path
    ):
        sentinel = index_service.library_dir / "keep.txt"
        sentinel.write_text("user data")

        resp = client_with_files.request(
            "DELETE",
            "/api/files/delete",
            json={"path": path},
        )

        assert resp.status_code == 400
        assert resp.json()["detail"] == "Cannot delete the file library root."
        assert sentinel.read_text() == "user data"
