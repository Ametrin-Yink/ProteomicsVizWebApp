"""End-to-end tests for file library API with real filesystem."""

import io

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client_with_file_library(tmp_path, monkeypatch):
    """Create a TestClient with the full app, overriding file_library_dir to tmp_path."""
    monkeypatch.setattr("app.core.config.settings.file_library_dir", tmp_path)
    # Re-init the index service to point at our temp dir
    import app.api.routes.files as files_mod
    files_mod._index_service = None  # force re-init

    from app.main import app

    # Also override sessions_dir
    sess_dir = tmp_path / "sessions"
    sess_dir.mkdir()
    monkeypatch.setattr("app.core.config.settings.sessions_dir", sess_dir)

    with TestClient(app) as c:
        yield c


class TestFileLibraryE2E:
    """End-to-end CRUD flow."""

    def test_full_crud_flow(self, client_with_file_library, tmp_path):
        """Create folder, upload file, list, rename, move, delete."""
        # 1. Create folder
        resp = client_with_file_library.post(
            "/api/files/folders",
            json={"parent_path": "", "name": "MyProject"},
        )
        assert resp.status_code == 200

        # 2. Upload a file into it
        content = b"Sequence,Charge\nPEPTIDE,2\n"
        fake_csv = io.BytesIO(content)
        resp = client_with_file_library.post(
            "/api/files/upload?target_path=MyProject",
            files={"files": ("data.csv", fake_csv, "text/csv")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["files"]) == 1
        assert data["files"][0]["name"] == "data.csv"

        # 3. List the folder
        resp = client_with_file_library.get("/api/files/tree?path=MyProject")
        assert resp.status_code == 200
        entries = resp.json()["entries"]
        assert len(entries) == 1
        assert entries[0]["name"] == "data.csv"

        # 4. Rename the file
        resp = client_with_file_library.put(
            "/api/files/rename",
            json={"path": "MyProject/data.csv", "new_name": "renamed.csv"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "renamed.csv"

        # 5. Move to root
        resp = client_with_file_library.put(
            "/api/files/move",
            json={"source_path": "MyProject/renamed.csv", "target_parent": ""},
        )
        assert resp.status_code == 200

        # 6. Verify at root
        resp = client_with_file_library.get("/api/files/tree?path=")
        entries = resp.json()["entries"]
        names = {e["name"] for e in entries}
        assert "renamed.csv" in names
        assert "MyProject" in names

        # 7. Search
        resp = client_with_file_library.get("/api/files/search?q=rename")
        assert resp.status_code == 200
        assert len(resp.json()["results"]) == 1

        # 8. Get content
        resp = client_with_file_library.get("/api/files/content?path=renamed.csv")
        assert resp.status_code == 200
        assert resp.text == "Sequence,Charge\nPEPTIDE,2\n"

        # 9. Delete
        resp = client_with_file_library.request(
            "DELETE",
            "/api/files/delete",
            json={"path": "renamed.csv"},
        )
        assert resp.status_code == 200

        # 10. Verify gone
        resp = client_with_file_library.get("/api/files/content?path=renamed.csv")
        assert resp.status_code == 404

    def test_upload_rejects_non_csv_txt(self, client_with_file_library):
        """Uploading a .pdf returns 400."""
        fake_pdf = io.BytesIO(b"%PDF-1.4 fake")
        resp = client_with_file_library.post(
            "/api/files/upload",
            files={"files": ("doc.pdf", fake_pdf, "application/pdf")},
        )
        assert resp.status_code == 400

    def test_duplicate_upload_rejected(self, client_with_file_library):
        """Uploading same filename twice returns 409."""
        fake = io.BytesIO(b"data")
        client_with_file_library.post(
            "/api/files/upload",
            files={"files": ("dup.txt", fake, "text/plain")},
        )
        fake2 = io.BytesIO(b"different data")
        resp = client_with_file_library.post(
            "/api/files/upload",
            files={"files": ("dup.txt", fake2, "text/plain")},
        )
        assert resp.status_code == 409

    def test_scan_syncs_index(self, client_with_file_library, tmp_path):
        """POST /scan picks up externally added files."""
        # Drop a file directly into the library
        (tmp_path / "external.txt").write_text("hello from outside")

        resp = client_with_file_library.post("/api/files/scan")
        assert resp.status_code == 200
        result = resp.json()
        assert result["added"] >= 1

        # Now it should appear in listings
        resp = client_with_file_library.get("/api/files/tree?path=")
        names = {e["name"] for e in resp.json()["entries"]}
        assert "external.txt" in names
