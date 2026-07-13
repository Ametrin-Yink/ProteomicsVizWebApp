# File Management System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global file library with DuckDB-backed indexing, a file explorer page, and replace per-session drag-and-drop uploads with library-based file selection.

**Architecture:** New `FileIndexService` (DuckDB) and `files.py` FastAPI router on the backend. New `/files` page + `FileLibraryPicker` modal + modified wizard pages on the frontend. Files are copied from the library to session directories at selection time.

**Tech Stack:** Python 3.12 (FastAPI, DuckDB, asyncio), React 19 / Next.js 16 (TypeScript, Tailwind, Radix UI, Zustand, Lucide)

## Global Constraints

- ALL test files MUST be in `Tests/` directory
- Backend tests run with `backend/.venv/Scripts/python.exe -m pytest` from project root
- Frontend lint with `cd frontend && npm run lint`
- NEVER use `as any` or `@ts-ignore` in TypeScript
- NEVER use rpy2 — always subprocess for R
- API routes use `async def` with `asyncio.to_thread()` for filesystem I/O
- Frontend stores use Zustand selectors `useStore(s => s.field)` never `useStore()`
- File names sanitized via existing `sanitize_filename()` in `backend/app/utils/file_parser.py`
- Session IDs are UUIDs — test sessions must use valid UUIDs
- `FILE_LIBRARY_DIR` configurable via `.env`, default `backend/file_library/`
- Only `.txt` and `.csv` files accepted for upload to library; FASTA stays PTM wizard-only
- `max_upload_size_mb` (default 500MB) for library uploads

---

### Task 1: Backend Configuration — `file_library_dir` Setting

**Files:**
- Modify: `backend/app/core/config.py`
- Test: `Tests/backend/unit/services/test_file_library_config.py`

**Interfaces:**
- Produces: `settings.file_library_dir: Path` — resolved absolute path to library root (default `backend/file_library/`)
- Produces: `settings.ensure_directories()` creates `file_library_dir` on startup

- [ ] **Step 1: Write the failing test**

```python
# Tests/backend/unit/services/test_file_library_config.py
import os
from pathlib import Path
from unittest.mock import patch


class TestFileLibraryConfig:
    def test_file_library_dir_default(self):
        """file_library_dir defaults to backend/file_library/."""
        from app.core.config import Settings

        # Patch sessions_dir so ensure_directories doesn't create real dirs
        with patch.object(Settings, 'ensure_directories', lambda self: None):
            s = Settings(
                sessions_dir=Path("/tmp/sessions"),
                protein_database_dir=Path("/tmp/proteins"),
            )
        expected = Path(__file__).resolve().parent.parent.parent.parent / "backend" / "file_library"
        assert s.file_library_dir == expected

    def test_file_library_dir_from_env(self):
        """file_library_dir reads from FILE_LIBRARY_DIR env var."""
        from app.core.config import Settings

        with patch.object(Settings, 'ensure_directories', lambda self: None):
            s = Settings(
                file_library_dir=Path("/custom/library"),
                sessions_dir=Path("/tmp/sessions"),
                protein_database_dir=Path("/tmp/proteins"),
            )
        assert s.file_library_dir == Path("/custom/library")

    def test_ensure_directories_creates_library_dir(self, tmp_path):
        """ensure_directories creates the file_library_dir."""
        from app.core.config import Settings

        lib_dir = tmp_path / "file_library"
        s = Settings(
            file_library_dir=lib_dir,
            sessions_dir=tmp_path / "sessions",
            protein_database_dir=tmp_path / "proteins",
        )
        s.ensure_directories()
        assert lib_dir.exists()
        assert lib_dir.is_dir()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/services/test_file_library_config.py -v
```

Expected: `AttributeError: 'Settings' object has no attribute 'file_library_dir'` or similar.

- [ ] **Step 3: Add `file_library_dir` to Settings**

In `backend/app/core/config.py`, add the field after `protein_database_dir` (line ~73):

```python
    file_library_dir: Path = Field(
        default=Path(__file__).resolve().parent.parent.parent / "file_library",
        description="Directory for the global file library",
    )
```

Add `file_library_dir` to `resolve_path` validator list and `ensure_directories()`:

In the `ensure_directories` method, add after `self.protein_database_dir.mkdir(...)`:
```python
        self.file_library_dir.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/services/test_file_library_config.py -v
```

Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/config.py Tests/backend/unit/services/test_file_library_config.py
git commit -m "feat: add file_library_dir setting to backend config

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: FileIndexService — DuckDB Index Management

**Files:**
- Create: `backend/app/services/file_index_service.py`
- Test: `Tests/backend/unit/services/test_file_index_service.py`

**Interfaces:**
- Produces: `FileIndexService(library_dir: Path)` — constructor, creates schema on first use
- Produces: `FileIndexService.scan_and_sync() -> dict` — walks filesystem, returns `{total, added, removed, updated}`
- Produces: `FileIndexService.list_directory(path: str) -> list[dict]` — returns `[{name, path, type, size, modified_at}]`
- Produces: `FileIndexService.search(query: str) -> list[dict]` — LIKE search by name
- Produces: `FileIndexService.insert_entry(path, size, file_type, modified_at)` — insert single row
- Produces: `FileIndexService.update_entry(old_path, new_path, new_parent, size, modified_at)` — update row
- Produces: `FileIndexService.delete_entry(path: str)` — delete row (prefix-delete for folders)
- Produces: `FileIndexService.count() -> int` — total non-folder files

- [ ] **Step 1: Write the failing test**

```python
# Tests/backend/unit/services/test_file_index_service.py
import time
from datetime import datetime
from pathlib import Path

import pytest


@pytest.fixture
def index_service(tmp_path):
    """Create a FileIndexService pointed at a temp directory."""
    from app.services.file_index_service import FileIndexService
    return FileIndexService(tmp_path)


class TestFileIndexServiceSchema:
    def test_schema_created_on_init(self, tmp_path):
        """DuckDB file and schema are created on first init."""
        from app.services.file_index_service import FileIndexService
        import duckdb

        svc = FileIndexService(tmp_path)
        db_path = tmp_path / ".library_index.duckdb"
        assert db_path.exists()

        # Verify schema
        conn = duckdb.connect(str(db_path))
        cols = conn.execute("PRAGMA table_info('files')").fetchall()
        col_names = [c[1] for c in cols]
        assert "path" in col_names
        assert "name" in col_names
        assert "size" in col_names
        assert "file_type" in col_names
        assert "parent_path" in col_names
        conn.close()


class TestFileIndexServiceCRUD:
    def test_insert_and_list(self, index_service, tmp_path):
        """Insert entries then list a directory."""
        now = datetime.now()
        index_service.insert_entry("folder1", 0, "folder", now)
        index_service.insert_entry("folder1/file1.txt", 1024, "txt", now)
        index_service.insert_entry("folder1/file2.csv", 2048, "csv", now)

        entries = index_service.list_directory("folder1")
        assert len(entries) == 2
        names = {e["name"] for e in entries}
        assert names == {"file1.txt", "file2.csv"}

    def test_list_root_returns_top_level(self, index_service):
        """list_directory('/') returns root-level entries."""
        now = datetime.now()
        index_service.insert_entry("proj_a", 0, "folder", now)
        index_service.insert_entry("proj_b", 0, "folder", now)
        index_service.insert_entry("readme.txt", 512, "txt", now)

        entries = index_service.list_directory("")
        assert len(entries) == 3

    def test_search_by_name(self, index_service):
        """search returns entries matching name substring."""
        now = datetime.now()
        index_service.insert_entry("a/sample_01.txt", 100, "txt", now)
        index_service.insert_entry("a/sample_02.txt", 200, "txt", now)
        index_service.insert_entry("b/other.csv", 300, "csv", now)

        results = index_service.search("sample")
        assert len(results) == 2
        assert all("sample" in r["name"] for r in results)

    def test_search_escapes_special_chars(self, index_service):
        """search treats % and _ as literal characters."""
        now = datetime.now()
        index_service.insert_entry("a/100_percent.txt", 100, "txt", now)

        results = index_service.search("100%")
        assert len(results) == 1

    def test_get_entry(self, index_service):
        """get_entry returns a single entry by path."""
        now = datetime.now()
        index_service.insert_entry("data/file.txt", 4096, "txt", now)

        entry = index_service.get_entry("data/file.txt")
        assert entry is not None
        assert entry["name"] == "file.txt"
        assert entry["size"] == 4096

    def test_get_entry_missing(self, index_service):
        """get_entry returns None for unknown path."""
        assert index_service.get_entry("nonexistent.txt") is None

    def test_update_entry(self, index_service):
        """update_entry changes path, parent, size."""
        now = datetime.now()
        index_service.insert_entry("old/file.txt", 100, "txt", now)

        new_now = datetime.now()
        index_service.update_entry("old/file.txt", "new/file.txt", "new", 200, new_now)

        entry = index_service.get_entry("new/file.txt")
        assert entry is not None
        assert entry["size"] == 200
        assert entry["parent_path"] == "new"

        # Old path is gone
        assert index_service.get_entry("old/file.txt") is None

    def test_delete_entry_file(self, index_service):
        """delete_entry removes a file entry."""
        now = datetime.now()
        index_service.insert_entry("x.txt", 50, "txt", now)

        index_service.delete_entry("x.txt")
        assert index_service.get_entry("x.txt") is None

    def test_delete_entry_folder_cascades(self, index_service):
        """delete_entry on folder removes all children."""
        now = datetime.now()
        index_service.insert_entry("dir", 0, "folder", now)
        index_service.insert_entry("dir/a.txt", 10, "txt", now)
        index_service.insert_entry("dir/sub", 0, "folder", now)
        index_service.insert_entry("dir/sub/b.txt", 20, "txt", now)

        index_service.delete_entry("dir")

        assert index_service.get_entry("dir") is None
        assert index_service.get_entry("dir/a.txt") is None
        assert index_service.get_entry("dir/sub") is None
        assert index_service.get_entry("dir/sub/b.txt") is None

    def test_count(self, index_service):
        """count returns number of non-folder entries."""
        now = datetime.now()
        index_service.insert_entry("f1", 0, "folder", now)
        index_service.insert_entry("f1/a.txt", 1, "txt", now)
        index_service.insert_entry("f1/b.csv", 2, "csv", now)

        assert index_service.count() == 2


class TestFileIndexServiceScan:
    def test_scan_populates_empty_db(self, index_service, tmp_path):
        """scan_and_sync populates index from files on disk."""
        # Create files on disk
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "a.txt").write_text("hello")
        (tmp_path / "b.csv").write_text("world")

        result = index_service.scan_and_sync()

        assert result["total"] == 3  # 1 folder + 2 files
        # Files should be findable
        assert index_service.get_entry("sub/a.txt") is not None
        assert index_service.get_entry("b.csv") is not None

    def test_scan_detects_deleted_files(self, index_service, tmp_path):
        """scan_and_sync removes entries for deleted files."""
        # First, create files and scan
        (tmp_path / "keep.txt").write_text("keep")
        (tmp_path / "remove.txt").write_text("gone")
        index_service.scan_and_sync()
        assert index_service.get_entry("remove.txt") is not None

        # Delete remove.txt from disk
        (tmp_path / "remove.txt").unlink()
        result = index_service.scan_and_sync()

        assert result["removed"] == 1
        assert index_service.get_entry("remove.txt") is None
        assert index_service.get_entry("keep.txt") is not None

    def test_scan_detects_modified_files(self, index_service, tmp_path):
        """scan_and_sync updates entries for changed files."""
        (tmp_path / "change.txt").write_text("v1")
        index_service.scan_and_sync()

        entry1 = index_service.get_entry("change.txt")
        old_size = entry1["size"]

        # Modify file
        time.sleep(0.1)  # Ensure mtime changes
        (tmp_path / "change.txt").write_text("v2 - bigger")

        result = index_service.scan_and_sync()
        assert result["updated"] >= 1

        entry2 = index_service.get_entry("change.txt")
        assert entry2["size"] > old_size
```

- [ ] **Step 2: Run test to verify it fails**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/services/test_file_index_service.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.services.file_index_service'`

- [ ] **Step 3: Write minimal FileIndexService**

```python
# backend/app/services/file_index_service.py
"""DuckDB-backed file index for the global file library."""

import os
import threading
from datetime import datetime
from pathlib import Path

import duckdb


class FileIndexService:
    """Manages the DuckDB index of the file library.

    All write operations (scan, insert, update, delete) are guarded by
    a threading.Lock. DuckDB allows concurrent readers but only one writer;
    the lock prevents races between e.g. a page-load scan and an in-flight upload.
    """

    def __init__(self, library_dir: Path):
        self.library_dir = Path(library_dir).resolve()
        self.db_path = self.library_dir / ".library_index.duckdb"
        self._write_lock = threading.Lock()
        self._ensure_schema()

    # ---- Connection helpers ----

    def _get_conn(self) -> duckdb.DuckDBPyConnection:
        """Open a new DuckDB connection to the index database."""
        return duckdb.connect(str(self.db_path))

    def _normalize_path(self, disk_path: Path) -> str:
        """Convert an absolute disk path to a forward-slash relative path."""
        rel = disk_path.relative_to(self.library_dir)
        return rel.as_posix()

    # ---- Schema ----

    def _ensure_schema(self):
        """Create tables and indexes if they don't exist."""
        self.library_dir.mkdir(parents=True, exist_ok=True)
        with self._write_lock:
            conn = self._get_conn()
            try:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS files (
                        id INTEGER PRIMARY KEY,
                        path TEXT UNIQUE NOT NULL,
                        name TEXT NOT NULL,
                        size BIGINT NOT NULL DEFAULT 0,
                        file_type TEXT NOT NULL,
                        modified_at TIMESTAMP NOT NULL,
                        parent_path TEXT NOT NULL,
                        indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_parent ON files(parent_path)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_name ON files(name)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_type ON files(file_type)"
                )
            finally:
                conn.close()

    # ---- Scan ----

    def scan_and_sync(self) -> dict:
        """Walk the filesystem and sync with DuckDB index.

        Returns dict with keys: total, added, removed, updated.
        """
        # Collect current filesystem state
        fs_paths: dict[str, dict] = {}
        for root, dirs, files in os.walk(str(self.library_dir)):
            # Skip the DuckDB file itself
            if ".library_index.duckdb" in dirs:
                dirs.remove(".library_index.duckdb")
            root_path = Path(root)
            # Add directories
            if root_path != self.library_dir:
                rel = self._normalize_path(root_path)
                st = root_path.stat()
                fs_paths[rel] = {
                    "name": root_path.name,
                    "size": 0,
                    "file_type": "folder",
                    "parent_path": str(Path(rel).parent) if str(Path(rel).parent) != "." else "",
                    "modified_at": datetime.fromtimestamp(st.st_mtime),
                }
            # Add files
            for fname in files:
                fp = root_path / fname
                rel = self._normalize_path(fp)
                st = fp.stat()
                ext = fp.suffix.lstrip(".").lower()
                if ext not in ("txt", "csv"):
                    continue
                fs_paths[rel] = {
                    "name": fname,
                    "size": st.st_size,
                    "file_type": ext,
                    "parent_path": str(Path(rel).parent),
                    "modified_at": datetime.fromtimestamp(st.st_mtime),
                }

        fs_path_set = set(fs_paths.keys())

        with self._write_lock:
            conn = self._get_conn()
            try:
                # Get current DB state
                db_rows = conn.execute(
                    "SELECT path, size, modified_at FROM files"
                ).fetchall()
                db_paths: dict[str, tuple] = {
                    row[0]: (row[1], row[2]) for row in db_rows
                }
                db_path_set = set(db_paths.keys())

                added = 0
                updated = 0

                # INSERT new and UPDATE changed
                for path, info in fs_paths.items():
                    if path not in db_path_set:
                        conn.execute(
                            """INSERT INTO files (path, name, size, file_type, parent_path, modified_at)
                               VALUES (?, ?, ?, ?, ?, ?)""",
                            [path, info["name"], info["size"], info["file_type"],
                             info["parent_path"], info["modified_at"]],
                        )
                        added += 1
                    else:
                        db_size, db_mtime = db_paths[path]
                        if db_size != info["size"] or db_mtime != info["modified_at"]:
                            conn.execute(
                                """UPDATE files SET size = ?, modified_at = ?
                                   WHERE path = ?""",
                                [info["size"], info["modified_at"], path],
                            )
                            updated += 1

                # DELETE removed
                removed = 0
                gone = db_path_set - fs_path_set
                if gone:
                    for path in gone:
                        conn.execute("DELETE FROM files WHERE path = ?", [path])
                    removed = len(gone)

                total = conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
            finally:
                conn.close()

        return {
            "total": total,
            "added": added,
            "removed": removed,
            "updated": updated,
        }

    # ---- Read operations (no lock needed) ----

    def list_directory(self, path: str) -> list[dict]:
        """Return entries in a directory, folders first then files, sorted by name."""
        conn = self._get_conn()
        try:
            rows = conn.execute(
                """SELECT name, path, file_type, size, modified_at
                   FROM files WHERE parent_path = ?
                   ORDER BY
                     CASE file_type WHEN 'folder' THEN 0 ELSE 1 END,
                     name""",
                [path],
            ).fetchall()
            return [
                {
                    "name": r[0],
                    "path": r[1],
                    "type": r[2],
                    "size": r[3],
                    "modified_at": r[4].isoformat() if r[4] else None,
                }
                for r in rows
            ]
        finally:
            conn.close()

    def search(self, query: str) -> list[dict]:
        """Search files by name substring. Escapes LIKE special chars."""
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conn = self._get_conn()
        try:
            rows = conn.execute(
                "SELECT name, path, file_type, size, modified_at FROM files "
                "WHERE file_type != 'folder' AND name LIKE ? ESCAPE '\\'",
                [f"%{escaped}%"],
            ).fetchall()
            return [
                {
                    "name": r[0],
                    "path": r[1],
                    "type": r[2],
                    "size": r[3],
                    "modified_at": r[4].isoformat() if r[4] else None,
                }
                for r in rows
            ]
        finally:
            conn.close()

    def get_entry(self, path: str) -> dict | None:
        """Return a single entry by path, or None."""
        conn = self._get_conn()
        try:
            row = conn.execute(
                "SELECT name, path, file_type, size, modified_at FROM files WHERE path = ?",
                [path],
            ).fetchone()
            if row is None:
                return None
            return {
                "name": row[0],
                "path": row[1],
                "type": row[2],
                "size": row[3],
                "modified_at": row[4].isoformat() if row[4] else None,
            }
        finally:
            conn.close()

    def count(self) -> int:
        """Return total number of non-folder files in the index."""
        conn = self._get_conn()
        try:
            row = conn.execute(
                "SELECT COUNT(*) FROM files WHERE file_type != 'folder'"
            ).fetchone()
            return row[0] if row else 0
        finally:
            conn.close()

    # ---- Write operations (lock-guarded) ----

    def insert_entry(self, path: str, size: int, file_type: str, modified_at: datetime):
        """Insert a single entry. Caller must hold no lock."""
        parent = str(Path(path).parent) if str(Path(path).parent) != "." else ""
        name = Path(path).name
        with self._write_lock:
            conn = self._get_conn()
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO files (path, name, size, file_type, parent_path, modified_at)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    [path, name, size, file_type, parent, modified_at],
                )
            finally:
                conn.close()

    def update_entry(
        self, old_path: str, new_path: str, new_parent: str,
        size: int, modified_at: datetime,
    ):
        """Update path, parent, size, modified_at for an entry. For folders, cascades to children."""
        name = Path(new_path).name
        with self._write_lock:
            conn = self._get_conn()
            try:
                # Check if this is a folder (cascade update to children)
                is_folder = conn.execute(
                    "SELECT file_type FROM files WHERE path = ?", [old_path]
                ).fetchone()
                if is_folder and is_folder[0] == "folder":
                    conn.execute(
                        """UPDATE files
                           SET path = REPLACE(path, ?, ?),
                               parent_path = REPLACE(parent_path, ?, ?)
                           WHERE path = ? OR path LIKE ?""",
                        [old_path, new_path, old_path, new_path,
                         old_path, old_path + "/%"],
                    )
                else:
                    conn.execute(
                        """UPDATE files
                           SET path = ?, name = ?, parent_path = ?, size = ?, modified_at = ?
                           WHERE path = ?""",
                        [new_path, name, new_parent, size, modified_at, old_path],
                    )
            finally:
                conn.close()

    def delete_entry(self, path: str):
        """Delete an entry. For folders, cascades to all children."""
        with self._write_lock:
            conn = self._get_conn()
            try:
                is_folder = conn.execute(
                    "SELECT file_type FROM files WHERE path = ?", [path]
                ).fetchone()
                if is_folder and is_folder[0] == "folder":
                    conn.execute(
                        "DELETE FROM files WHERE path = ? OR path LIKE ?",
                        [path, path + "/%"],
                    )
                else:
                    conn.execute("DELETE FROM files WHERE path = ?", [path])
            finally:
                conn.close()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/services/test_file_index_service.py -v
```

Expected: all tests PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/file_index_service.py Tests/backend/unit/services/test_file_index_service.py
git commit -m "feat: add FileIndexService with DuckDB-backed file library index

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Files API Router — 10 Endpoints + Main.py

**Files:**
- Create: `backend/app/api/routes/files.py`
- Modify: `backend/app/main.py`
- Test: `Tests/backend/unit/routes/test_files_routes.py`
- Test: `Tests/backend/integration/test_file_library_e2e.py`

**Interfaces:**
- Consumes: `FileIndexService` from Task 2
- Consumes: `settings.file_library_dir` from Task 1
- Consumes: `settings.max_upload_size_bytes` (existing)
- Consumes: `SessionStore` from existing `app.db.session_store`
- Consumes: `sanitize_filename` from existing `app.utils.file_parser`
- Consumes: `parse_proteomics_file` from existing `app.utils.file_parser`
- Produces: `files.router` — FastAPI APIRouter, mounted at `/api/files`
- Produces: 10 endpoints as defined in spec Section 3.5

- [ ] **Step 1: Write the failing integration test**

```python
# Tests/backend/unit/routes/test_files_routes.py
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
def client_with_files(mock_index):
    """Create a TestClient with the files router mounted."""
    from fastapi import FastAPI

    app = FastAPI()
    # We need to patch the router's dependency. The router will use a
    # dependency function to get the index service. We override it.
    from app.api.routes.files import router as files_router

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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/routes/test_files_routes.py -v
```

Expected: `ModuleNotFoundError` for `app.api.routes.files`

- [ ] **Step 3: Write the files router**

```python
# backend/app/api/routes/files.py
"""File library API routes — global file management independent of sessions."""

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from app.core.config import settings
from app.services.file_index_service import FileIndexService

router = APIRouter()
logger = logging.getLogger("proteomics")

# ---- Singleton index service ----
_index_service: Optional[FileIndexService] = None


def get_index_service() -> FileIndexService:
    """Dependency: return the singleton FileIndexService."""
    global _index_service
    if _index_service is None:
        _index_service = FileIndexService(settings.file_library_dir)
    return _index_service


# ---- Path validation helpers ----

def _validate_path(path: str) -> Path:
    """Validate a relative path and resolve it inside the library root.

    Returns the resolved absolute Path. Raises HTTPException on invalid paths.
    """
    if ".." in Path(path).parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path traversal not allowed.",
        )
    resolved = (settings.file_library_dir / path).resolve()
    if not str(resolved).startswith(str(settings.file_library_dir.resolve())):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path must be inside the file library.",
        )
    return resolved


def _validate_name(name: str) -> str:
    """Validate a file or folder name. Returns stripped name."""
    import re

    name = name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name cannot be empty.",
        )
    if not re.match(r"^[a-zA-Z0-9_\- .]+$", name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name contains invalid characters.",
        )
    return name


# ---- Endpoints ----

@router.get("/tree")
async def list_directory(
    path: str = Query("", description="Relative path to list"),
    index: FileIndexService = Depends(get_index_service),
):
    """List directory contents — folders first, then files."""
    entries = index.list_directory(path)
    return {"path": path, "entries": entries}


@router.post("/folders")
async def create_folder(
    body: dict,
    index: FileIndexService = Depends(get_index_service),
):
    """Create a new folder in the library."""
    parent_path = body.get("parent_path", "")
    name = _validate_name(body.get("name", ""))

    folder_rel = str(Path(parent_path) / name) if parent_path else name
    folder_abs = _validate_path(folder_rel)

    if folder_abs.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{name}' already exists.",
        )

    folder_abs.mkdir(parents=True, exist_ok=False)
    rel = str(Path(folder_rel).as_posix())
    index.insert_entry(rel, 0, "folder", datetime.now())
    return {"path": rel, "name": name}


@router.post("/upload")
async def upload_files(
    target_path: str = Query("", description="Target folder in library"),
    files: list[UploadFile] = File(...),
    index: FileIndexService = Depends(get_index_service),
):
    """Upload files to the library. Only .txt and .csv accepted."""
    target_dir = _validate_path(target_path) if target_path else settings.file_library_dir

    response_files = []
    for file in files:
        # Validate filename
        safe_name = _validate_name(file.filename)

        # Check extension
        ext = Path(safe_name).suffix.lower()
        if ext not in (".txt", ".csv"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Only .txt and .csv files are allowed. '{safe_name}' is '{ext}'.",
            )

        # Reject FASTA by extension
        if ext in (".fasta", ".fa", ".faa") or safe_name.lower().endswith((".fasta", ".fa", ".faa")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="FASTA files must be uploaded in the PTM wizard, not the file library.",
            )

        # Check for duplicate
        dest = target_dir / safe_name
        if dest.exists():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"'{safe_name}' already exists in this folder.",
            )

        # Read and validate
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File '{safe_name}' is empty.",
            )
        if len(content) > settings.max_upload_size_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File '{safe_name}' exceeds {settings.max_upload_size_mb}MB maximum.",
            )

        # Write to disk
        async with aiofiles.open(dest, "wb") as f:
            await f.write(content)

        # Index
        rel = str((Path(target_path) / safe_name).as_posix()) if target_path else safe_name
        file_type = ext.lstrip(".")
        index.insert_entry(rel, len(content), file_type, datetime.fromtimestamp(dest.stat().st_mtime))

        response_files.append({
            "name": safe_name,
            "size": len(content),
            "type": file_type,
        })

    return {"files": response_files}


@router.put("/rename")
async def rename_entry(
    body: dict,
    index: FileIndexService = Depends(get_index_service),
):
    """Rename a file or folder."""
    path = body.get("path", "")
    new_name = _validate_name(body.get("new_name", ""))

    old_abs = _validate_path(path)
    if not old_abs.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"'{path}' not found.")

    parent = old_abs.parent
    new_abs = parent / new_name
    if new_abs.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{new_name}' already exists in this folder.",
        )

    old_rel = str(Path(path).as_posix())
    new_rel = str((Path(old_rel).parent / new_name).as_posix()) if Path(old_rel).parent != Path(".") else new_name
    new_parent = str(Path(new_rel).parent) if Path(new_rel).parent != Path(".") else ""

    import shutil
    await _run_in_thread(shutil.move, str(old_abs), str(new_abs))

    index.update_entry(
        old_rel, new_rel, new_parent,
        new_abs.stat().st_size if new_abs.is_file() else 0,
        datetime.fromtimestamp(new_abs.stat().st_mtime),
    )
    return {"path": new_rel, "name": new_name}


@router.put("/move")
async def move_entry(
    body: dict,
    index: FileIndexService = Depends(get_index_service),
):
    """Move a file or folder to a different parent directory."""
    source_path = body.get("source_path", "")
    target_parent = body.get("target_parent", "")

    src_abs = _validate_path(source_path)
    tgt_dir = _validate_path(target_parent) if target_parent else settings.file_library_dir

    if not src_abs.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"'{source_path}' not found.")
    if not tgt_dir.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target must be a folder.")

    # Prevent moving into self or descendant
    try:
        src_abs.relative_to(tgt_dir)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot move a folder into itself or a descendant.",
        )
    except ValueError:
        pass  # src is not inside target — ok

    dest_abs = tgt_dir / src_abs.name
    if dest_abs.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{src_abs.name}' already exists in the target folder.",
        )

    import shutil
    await _run_in_thread(shutil.move, str(src_abs), str(dest_abs))

    old_rel = str(Path(source_path).as_posix())
    new_rel = str((Path(target_parent) / src_abs.name).as_posix()) if target_parent else src_abs.name
    new_parent = target_parent

    is_folder = dest_abs.is_dir()
    index.update_entry(
        old_rel, new_rel, new_parent,
        dest_abs.stat().st_size if not is_folder else 0,
        datetime.fromtimestamp(dest_abs.stat().st_mtime),
    )
    return {"path": new_rel, "new_parent": new_parent}


@router.delete("/delete")
async def delete_entry(
    body: dict,
    index: FileIndexService = Depends(get_index_service),
):
    """Delete a file or folder. Folders are deleted recursively."""
    path = body.get("path", "")
    abs_path = _validate_path(path)

    if not abs_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"'{path}' not found.")

    if abs_path.is_dir():
        import shutil
        await _run_in_thread(shutil.rmtree, str(abs_path))
    else:
        await _run_in_thread(os.unlink, str(abs_path))

    rel = str(Path(path).as_posix())
    index.delete_entry(rel)
    return {"deleted": rel}


@router.post("/scan")
async def scan_library(
    index: FileIndexService = Depends(get_index_service),
):
    """Force a full re-scan of the library directory."""
    result = await _run_in_thread(index.scan_and_sync)
    return result


@router.get("/search")
async def search_files(
    q: str = Query(..., description="Search query"),
    index: FileIndexService = Depends(get_index_service),
):
    """Search files by name substring."""
    results = index.search(q)
    return {"results": results}


@router.get("/content")
async def get_file_content(
    path: str = Query(..., description="Relative path to file"),
):
    """Download file contents (for client-side parsing). 10MB max."""
    abs_path = _validate_path(path)

    if not abs_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"'{path}' not found.")
    if abs_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot download a folder as a file.",
        )

    max_size = 10 * 1024 * 1024  # 10MB
    if abs_path.stat().st_size > max_size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large to preview. Select it for a pipeline analysis instead.",
        )

    async with aiofiles.open(abs_path, "rb") as f:
        content = await f.read()

    from fastapi.responses import Response
    return Response(content=content, media_type="text/plain")


@router.post("/select")
async def select_files_for_session(
    body: dict,
    index: FileIndexService = Depends(get_index_service),
):
    """Copy files from library to a session and parse them. Returns ProteomicsFileInfo list."""
    import asyncio
    import shutil

    from app.db.session_store import SessionStore
    from app.models.session import ProteomicsFileInfo
    from app.utils.file_parser import parse_proteomics_file, sanitize_filename

    session_id = body.get("session_id", "")
    paths: list[str] = body.get("paths", [])

    store = SessionStore(settings.sessions_dir)
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found.",
        )

    if not session.config or not session.config.file_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session must have file_type ('tmt' or 'dia') configured before selecting files.",
        )

    file_type = session.config.file_type
    session_uploads = settings.sessions_dir / session_id / "uploads"
    session_uploads.mkdir(parents=True, exist_ok=True)

    response_files = []

    for path in paths:
        src_abs = _validate_path(path)
        if not src_abs.exists() or not src_abs.is_file():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File '{path}' not found in library.",
            )

        safe_name = sanitize_filename(src_abs.name)
        dest = session_uploads / safe_name

        # Handle duplicate names in session
        counter = 1
        while dest.exists():
            stem = Path(safe_name).stem
            ext = Path(safe_name).suffix
            dest = session_uploads / f"{stem}_{counter}{ext}"
            counter += 1

        await _run_in_thread(shutil.copy2, str(src_abs), str(dest))

        # Parse file
        result = await _run_in_thread(parse_proteomics_file, dest, file_type)

        proteomics_file = ProteomicsFileInfo(
            filename=dest.name,
            size=dest.stat().st_size,
            columns=result["columns"],
            file_type=file_type,
        )
        session.files.proteomics.append(proteomics_file)

        file_resp = {
            "filename": dest.name,
            "size": dest.stat().st_size,
            "columns": result["columns"],
            "file_type": file_type,
        }
        if result.get("tmt_channels"):
            file_resp["tmt_channels"] = result["tmt_channels"]
        if result.get("has_quan_value"):
            file_resp["has_quan_value"] = result["has_quan_value"]

        response_files.append(file_resp)

    await store.save(session)
    return {"files": response_files}


# ---- Helper ----

async def _run_in_thread(func, *args, **kwargs):
    """Run a synchronous function in a thread to avoid blocking the event loop."""
    import asyncio
    return await asyncio.to_thread(func, *args, **kwargs)
```

- [ ] **Step 4: Write the integration E2E test**

```python
# Tests/backend/integration/test_file_library_e2e.py
"""End-to-end tests for file library API with real filesystem."""

import io
import uuid
from pathlib import Path

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
        resp = client_with_file_library.delete(
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
```

- [ ] **Step 5: Run unit route tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/routes/test_files_routes.py -v
```

Expected: all PASS

- [ ] **Step 6: Run integration E2E tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/test_file_library_e2e.py -v
```

Expected: all PASS

- [ ] **Step 7: Mount the router in main.py**

In `backend/app/main.py`, add to imports:
```python
from app.api.routes import files as files_routes
```

Add router mounting before sessions router (after compare):
```python
app.include_router(files_routes.router, prefix="/api/files", tags=["files"])
```

- [ ] **Step 8: Run all tests again to verify nothing broke**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/ Tests/backend/integration/ -v --tb=short
```

- [ ] **Step 9: Commit**

```bash
git add backend/app/api/routes/files.py backend/app/main.py \
  Tests/backend/unit/routes/test_files_routes.py \
  Tests/backend/integration/test_file_library_e2e.py
git commit -m "feat: add file library API router with 10 endpoints

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Frontend API Client

**Files:**
- Modify: `frontend/src/lib/api-client.ts`
- Test: `frontend/src/lib/__tests__/file-library-client.test.ts`

**Interfaces:**
- Produces: `fileLibraryApi` object with 10 methods matching all API endpoints
- Each method returns the parsed JSON response from the backend
- `upload()` supports `onProgress` callback for progress tracking
- `getContent()` returns text (not JSON)

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/lib/__tests__/file-library-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileLibraryApi } from '../api-client';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fileLibraryApi', () => {
  it('listDirectory calls GET /files/tree with path param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ path: 'proj', entries: [] }),
    });

    await fileLibraryApi.listDirectory('proj');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/files/tree');
    expect(url).toContain('path=proj');
  });

  it('createFolder calls POST /files/folders', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ path: 'proj/new', name: 'new' }),
    });

    await fileLibraryApi.createFolder('proj', 'new');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/files/folders');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ parent_path: 'proj', name: 'new' });
  });

  it('search calls GET /files/search with q param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    await fileLibraryApi.search('sample');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/files/search');
    expect(url).toContain('q=sample');
  });

  it('getContent calls GET /files/content and returns text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('col1,col2\nval1,val2'),
    });

    const text = await fileLibraryApi.getContent('meta.csv');
    expect(text).toBe('col1,col2\nval1,val2');
  });

  it('selectForSession calls POST /files/select', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ files: [] }),
    });

    await fileLibraryApi.selectForSession('session-uuid', ['path/to/file.txt']);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/files/select');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      session_id: 'session-uuid',
      paths: ['path/to/file.txt'],
    });
  });

  it('delete calls DELETE /files/delete with body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ deleted: 'path/to/file.txt' }),
    });

    await fileLibraryApi.delete('path/to/file.txt');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/files/delete');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ path: 'path/to/file.txt' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/lib/__tests__/file-library-client.test.ts
```

Expected: `fileLibraryApi is not defined` or similar.

- [ ] **Step 3: Add fileLibraryApi to api-client.ts**

In `frontend/src/lib/api-client.ts`, add after the existing API objects (before the final exports):

```typescript
// ---- File Library API ----

export const fileLibraryApi = {
  listDirectory: (path: string): Promise<{ path: string; entries: FileLibraryEntry[] }> =>
    api.get(`/files/tree?path=${encodeURIComponent(path)}`).then(r => r.data),

  createFolder: (parentPath: string, name: string): Promise<{ path: string; name: string }> =>
    api.post(`/files/folders`, { parent_path: parentPath, name }).then(r => r.data),

  upload: async (
    files: File[],
    targetPath: string,
    onProgress?: (pct: number) => void,
  ): Promise<{ files: { name: string; size: number; type: string }[] }> => {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    const response = await fetch(
      `${API_PREFIX}/files/upload?target_path=${encodeURIComponent(targetPath)}`,
      {
        method: 'POST',
        body: formData,
      },
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }
    return response.json();
  },

  rename: (path: string, newName: string): Promise<{ path: string; name: string }> =>
    api.put(`/files/rename`, { path, new_name: newName }).then(r => r.data),

  move: (sourcePath: string, targetParent: string): Promise<{ path: string; new_parent: string }> =>
    api.put(`/files/move`, { source_path: sourcePath, target_parent: targetParent }).then(r => r.data),

  delete: (path: string): Promise<{ deleted: string }> =>
    api.delete(`/files/delete`, { data: { path } }).then(r => r.data),

  scan: (): Promise<{ total: number; added: number; removed: number; updated: number }> =>
    api.post(`/files/scan`).then(r => r.data),

  search: (query: string): Promise<{ results: FileLibraryEntry[] }> =>
    api.get(`/files/search?q=${encodeURIComponent(query)}`).then(r => r.data),

  getContent: (path: string): Promise<string> =>
    api.get(`/files/content?path=${encodeURIComponent(path)}`, { responseType: 'text' }).then(r => r.data),

  selectForSession: (
    sessionId: string,
    paths: string[],
  ): Promise<{ files: SelectedFileInfo[] }> =>
    api.post(`/files/select`, { session_id: sessionId, paths }).then(r => r.data),
};
```

Add the type definitions near the top of the file with the other type imports:

```typescript
// Add these type exports (used by fileLibraryApi)
export interface FileLibraryEntry {
  name: string;
  path: string;
  type: 'txt' | 'csv' | 'folder';
  size: number;
  modified_at: string | null;
}

export interface SelectedFileInfo {
  filename: string;
  size: number;
  columns: string[];
  file_type: 'tmt' | 'dia';
  tmt_channels?: string[];
  has_quan_value?: boolean;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/lib/__tests__/file-library-client.test.ts
```

Expected: all PASS

- [ ] **Step 5: Run lint**

```bash
cd frontend && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api-client.ts frontend/src/lib/__tests__/file-library-client.test.ts
git commit -m "feat: add fileLibraryApi client with 10 methods

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Navigation + Files Page Shell

**Files:**
- Modify: `frontend/src/components/layout/TopNavigation.tsx`
- Create: `frontend/src/app/files/page.tsx`
- Create: `frontend/src/components/files/FileLibraryPage.tsx`
- Test: `Tests/frontend/files-page.test.tsx` (placeholder — frontend tests pattern)

**Interfaces:**
- Consumes: `fileLibraryApi` from Task 4
- Produces: `/files` route renders `FileLibraryPage`
- Produces: `FileLibraryPage` — renders layout skeleton with loading/empty states, delegates to child components (Toolbar, FolderTree, FileList) added in Task 6

- [ ] **Step 1: Add "Files" to TopNavigation**

In `frontend/src/components/layout/TopNavigation.tsx`, modify the `navLinks` array:

```typescript
const navLinks = [
  { href: '/', label: 'Home', id: 'home' },
  { href: '/files', label: 'Files', id: 'files' },
  { href: '/reports', label: 'Reports', id: 'reports' },
  { href: '/about', label: 'About', id: 'about' },
];
```

- [ ] **Step 2: Create the Files page**

```typescript
// frontend/src/app/files/page.tsx
'use client';

import React from 'react';
import { FileLibraryPage } from '@/components/files/FileLibraryPage';

export default function FilesPage() {
  return <FileLibraryPage />;
}
```

- [ ] **Step 3: Create FileLibraryPage shell**

```typescript
// frontend/src/components/files/FileLibraryPage.tsx
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { fileLibraryApi, FileLibraryEntry } from '@/lib/api-client';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

export const FileLibraryPage: React.FC = () => {
  const { addToast } = useUIStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileLibraryEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [totalFiles, setTotalFiles] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  // Initial scan + load
  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Full scan on initial load
      const scanResult = await fileLibraryApi.scan();
      setTotalFiles(scanResult.total);
      setLastScan(new Date());

      // Load root directory
      const data = await fileLibraryApi.listDirectory(currentPath);
      setEntries(data.entries);

      // Calculate total size
      let size = 0;
      for (const e of data.entries) {
        size += e.size;
      }
      setTotalSize(size);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load file library';
      setError(msg);
      addToast('error', msg);
    } finally {
      setLoading(false);
    }
  }, [currentPath, addToast]);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await fileLibraryApi.scan();
      setLastScan(new Date());
      const data = await fileLibraryApi.listDirectory(currentPath);
      setEntries(data.entries);
    } catch (err) {
      addToast('error', 'Failed to rescan library');
    } finally {
      setLoading(false);
    }
  }, [currentPath, addToast]);

  const handleNavigate = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedPaths(new Set());
  }, []);

  // ---- Loading state ----
  if (loading && entries.length === 0 && !error) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="files-loading">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <span className="text-sm text-text-muted">Indexing file library...</span>
        </div>
      </div>
    );
  }

  // ---- Error state ----
  if (error && entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="files-error">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <FolderOpen className="w-12 h-12 text-text-muted" />
          <p className="text-text-muted">{error}</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ---- Empty state ----
  if (!loading && entries.length === 0 && currentPath === '') {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="files-empty">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <FolderOpen className="w-16 h-16 text-text-muted" />
          <h2 className="text-lg font-semibold text-text-primary">Your file library is empty</h2>
          <p className="text-sm text-text-muted">
            Drop .txt or .csv files here, or click Upload to get started.
            You can also copy files directly to the file library folder on disk and click Refresh.
          </p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  // ---- Normal state ----
  return (
    <div className="flex-1 flex flex-col h-full" data-testid="files-page">
      {/* Toolbar placeholder — implemented in Task 6 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface">
        <span className="text-sm text-text-muted">Toolbar placeholder — Task 6</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Folder tree placeholder — implemented in Task 6 */}
        <div className="w-72 border-r border-border bg-surface/50 p-4 overflow-y-auto">
          <span className="text-sm text-text-muted">Folder tree placeholder — Task 6</span>
        </div>

        {/* File list placeholder — implemented in Task 6 */}
        <div className="flex-1 p-4 overflow-y-auto">
          <span className="text-sm text-text-muted">File list placeholder — Task 6</span>
          {entries.map(e => (
            <div key={e.path} className="text-sm text-text py-1">
              {e.type === 'folder' ? '📁' : '📄'} {e.name}
            </div>
          ))}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-t border-border bg-surface text-xs text-text-muted">
        <span>{totalFiles.toLocaleString()} files</span>
        <span>·</span>
        <span>{(totalSize / (1024 * 1024)).toFixed(1)} MB</span>
        {lastScan && (
          <>
            <span>·</span>
            <span>Last scan: {Math.round((Date.now() - lastScan.getTime()) / 60000)} min ago</span>
          </>
        )}
      </div>
    </div>
  );
};

export default FileLibraryPage;
```

- [ ] **Step 4: Verify the page renders at /files**

Start the frontend dev server and navigate to `http://localhost:3000/files`. The page should show the layout skeleton with placeholder text for the toolbar, folder tree, and file list. The status bar should show file count.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/TopNavigation.tsx \
  frontend/src/app/files/page.tsx \
  frontend/src/components/files/FileLibraryPage.tsx
git commit -m "feat: add Files page with navigation tab and layout shell

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: File Explorer Components

**Files:**
- Create: `frontend/src/components/files/FileLibraryToolbar.tsx`
- Create: `frontend/src/components/files/FolderTree.tsx`
- Create: `frontend/src/components/files/FileList.tsx`
- Create: `frontend/src/components/files/ContextMenu.tsx`
- Modify: `frontend/src/components/files/FileLibraryPage.tsx` (wire up components)

**Interfaces:**
- Consumes: `FileLibraryEntry` type from api-client (Task 4)
- Consumes: `FileLibraryPage` state from Task 5
- Produces: `FileLibraryToolbar` — props: `{onCreateFolder, onUpload, onDelete, onRename, searchQuery, onSearchChange, onRefresh, selectedCount}`
- Produces: `FolderTree` — props: `{currentPath, onNavigate, onContextMenu}`
- Produces: `FileList` — props: `{entries, selectedPaths, onToggleSelect, onSelectAll, onClearSelection, onNavigate, onContextMenu}`
- Produces: `ContextMenu` — props: `{x, y, items: [{label, action, disabled?}], onClose}`

This task is large. Each component is implemented in a sub-step.

- [ ] **Step 1: FileLibraryToolbar**

```typescript
// frontend/src/components/files/FileLibraryToolbar.tsx
'use client';

import React, { useRef } from 'react';
import { FolderPlus, Upload, Trash2, Pencil, Search, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileLibraryToolbarProps {
  onCreateFolder: () => void;
  onUpload: (files: FileList) => void;
  onDelete: () => void;
  onRename: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  selectedCount: number;
  uploading: boolean;
}

export const FileLibraryToolbar: React.FC<FileLibraryToolbarProps> = ({
  onCreateFolder,
  onUpload,
  onDelete,
  onRename,
  searchQuery,
  onSearchChange,
  onRefresh,
  selectedCount,
  uploading,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface">
      {/* Actions */}
      <button
        onClick={onCreateFolder}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text bg-background border border-border rounded-md hover:bg-surface/80 transition-colors"
        title="New Folder"
      >
        <FolderPlus className="w-4 h-4" />
        <span className="hidden lg:inline">New Folder</span>
      </button>

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text bg-background border border-border rounded-md hover:bg-surface/80 transition-colors disabled:opacity-50"
        title="Upload Files"
      >
        {uploading ? (
          <RefreshCw className="w-4 h-4 animate-spin" />
        ) : (
          <Upload className="w-4 h-4" />
        )}
        <span className="hidden lg:inline">Upload</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.csv"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onUpload(e.target.files);
            e.target.value = '';
          }
        }}
      />

      <button
        onClick={onDelete}
        disabled={selectedCount === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-error bg-background border border-border rounded-md hover:bg-error/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title={`Delete (${selectedCount} selected)`}
      >
        <Trash2 className="w-4 h-4" />
        <span className="hidden lg:inline">Delete</span>
        {selectedCount > 0 && (
          <span className="text-xs bg-error/10 text-error px-1.5 py-0.5 rounded-full">
            {selectedCount}
          </span>
        )}
      </button>

      <button
        onClick={onRename}
        disabled={selectedCount !== 1}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text bg-background border border-border rounded-md hover:bg-surface/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title="Rename"
      >
        <Pencil className="w-4 h-4" />
        <span className="hidden lg:inline">Rename</span>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files..."
          className="pl-8 pr-3 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary w-48 lg:w-64"
        />
      </div>

      {/* Refresh */}
      <button
        onClick={onRefresh}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text bg-background border border-border rounded-md hover:bg-surface/80 transition-colors"
        title="Refresh (re-scan library)"
      >
        <RefreshCw className="w-4 h-4" />
      </button>
    </div>
  );
};

export default FileLibraryToolbar;
```

- [ ] **Step 2: FolderTree**

```typescript
// frontend/src/components/files/FolderTree.tsx
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';
import { fileLibraryApi, FileLibraryEntry } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface FolderTreeProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, name: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  loaded: boolean;
}

export const FolderTree: React.FC<FolderTreeProps> = ({
  currentPath,
  onNavigate,
  onContextMenu,
}) => {
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Load root-level folders on mount
  useEffect(() => {
    fileLibraryApi.listDirectory('').then(data => {
      const folders = data.entries
        .filter(e => e.type === 'folder')
        .map(e => ({
          name: e.name,
          path: e.path,
          children: [],
          loaded: false,
        }));
      setRootNodes(folders);
    }).catch(() => {});
  }, []);

  const toggleExpand = useCallback(async (node: TreeNode) => {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(node.path)) {
      newExpanded.delete(node.path);
      setExpandedPaths(newExpanded);
      return;
    }

    newExpanded.add(node.path);
    setExpandedPaths(newExpanded);

    // Lazy-load children
    if (!node.loaded) {
      const data = await fileLibraryApi.listDirectory(node.path);
      const children = data.entries
        .filter(e => e.type === 'folder')
        .map(e => ({
          name: e.name,
          path: e.path,
          children: [],
          loaded: false,
        }));
      node.children = children;
      node.loaded = true;
      setRootNodes([...rootNodes]);
    }
  }, [expandedPaths, rootNodes]);

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path);
    const isActive = currentPath === node.path;

    return (
      <div key={node.path}>
        <div
          className={cn(
            'flex items-center gap-1 px-2 py-1 cursor-pointer rounded text-sm transition-colors',
            isActive
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-text-secondary hover:bg-surface hover:text-text',
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => {
            onNavigate(node.path);
            toggleExpand(node);
          }}
          onContextMenu={(e) => onContextMenu(e, node.path, node.name)}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 flex-shrink-0" />
          )}
          {isActive ? (
            <FolderOpen className="w-4 h-4 flex-shrink-0 text-primary" />
          ) : (
            <Folder className="w-4 h-4 flex-shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </div>
        {isExpanded && node.children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="py-1" data-testid="folder-tree">
      {/* Root link */}
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 cursor-pointer rounded text-sm transition-colors',
          currentPath === ''
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-text-secondary hover:bg-surface hover:text-text',
        )}
        style={{ paddingLeft: '8px' }}
        onClick={() => onNavigate('')}
      >
        <Folder className="w-4 h-4 flex-shrink-0" />
        <span className="truncate">File Library</span>
      </div>
      {rootNodes.map(node => renderNode(node, 1))}
    </div>
  );
};

export default FolderTree;
```

- [ ] **Step 3: ContextMenu**

```typescript
// frontend/src/components/files/ContextMenu.tsx
'use client';

import React, { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 36);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[180px]"
      style={{ left: adjustedX, top: adjustedY }}
      data-testid="context-menu"
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => {
            if (!item.disabled) {
              item.action();
              onClose();
            }
          }}
          disabled={item.disabled}
          className={cn(
            'w-full text-left px-3 py-1.5 text-sm transition-colors',
            item.danger
              ? 'text-error hover:bg-error/5'
              : 'text-text hover:bg-surface',
            item.disabled && 'opacity-40 cursor-not-allowed',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};

// Need to import cn
import { cn } from '@/lib/utils';

export default ContextMenu;
```

- [ ] **Step 4: FileList**

```typescript
// frontend/src/components/files/FileList.tsx
'use client';

import React from 'react';
import { FileText, FileSpreadsheet, Folder, ChevronRight } from 'lucide-react';
import { FileLibraryEntry } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface FileListProps {
  entries: FileLibraryEntry[];
  currentPath: string;
  selectedPaths: Set<string>;
  onToggleSelect: (path: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onNavigate: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, name: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getIcon(type: string) {
  switch (type) {
    case 'folder':
      return <Folder className="w-5 h-5 text-amber-500 flex-shrink-0" />;
    case 'csv':
      return <FileSpreadsheet className="w-5 h-5 text-green-600 flex-shrink-0" />;
    default:
      return <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />;
  }
}

export const FileList: React.FC<FileListProps> = ({
  entries,
  currentPath,
  selectedPaths,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onNavigate,
  onContextMenu,
}) => {
  const allSelected = entries.length > 0 && entries.every(e => selectedPaths.has(e.path));
  const someSelected = entries.some(e => selectedPaths.has(e.path));

  // Breadcrumb segments
  const segments = currentPath ? currentPath.split('/') : [];

  return (
    <div className="flex flex-col h-full" data-testid="file-list">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 px-4 py-2 text-sm text-text-muted border-b border-border">
        <button
          onClick={() => onNavigate('')}
          className="hover:text-text hover:underline"
        >
          Files
        </button>
        {segments.map((seg, i) => {
          const segPath = segments.slice(0, i + 1).join('/');
          return (
            <React.Fragment key={segPath}>
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
              <button
                onClick={() => onNavigate(segPath)}
                className="hover:text-text hover:underline truncate max-w-[200px]"
              >
                {seg}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Bulk actions */}
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs">
        <button
          onClick={onSelectAll}
          className="text-primary hover:underline"
        >
          Select All
        </button>
        <span className="text-text-muted">·</span>
        <button
          onClick={onClearSelection}
          className="text-primary hover:underline"
        >
          Clear Selection
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface text-left">
            <tr className="border-b border-border">
              <th className="w-10 px-4 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={() => allSelected ? onClearSelection() : onSelectAll()}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
              </th>
              <th className="px-2 py-2 text-xs font-medium text-text-muted uppercase">Name</th>
              <th className="px-2 py-2 text-xs font-medium text-text-muted uppercase w-24">Size</th>
              <th className="px-2 py-2 text-xs font-medium text-text-muted uppercase w-44">Modified</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => {
              const isSelected = selectedPaths.has(entry.path);
              return (
                <tr
                  key={entry.path}
                  className={cn(
                    'border-b border-border/50 hover:bg-surface/50 transition-colors cursor-pointer',
                    isSelected && 'bg-primary/5',
                  )}
                  onClick={(e) => {
                    if (entry.type === 'folder') {
                      onNavigate(entry.path);
                    } else {
                      onToggleSelect(entry.path);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenu(e, entry.path, entry.name);
                  }}
                >
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(entry.path)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      {getIcon(entry.type)}
                      <span className="text-sm text-text truncate max-w-[400px]">
                        {entry.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-sm text-text-muted">
                    {formatSize(entry.size)}
                  </td>
                  <td className="px-2 py-2 text-sm text-text-muted">
                    {formatDate(entry.modified_at)}
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-sm text-text-muted">
                  This folder is empty.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FileList;
```

- [ ] **Step 5: Wire components into FileLibraryPage**

Replace the placeholder sections in `FileLibraryPage.tsx` with real components. The key changes:

```typescript
// Replace the toolbar placeholder with:
<FileLibraryToolbar
  onCreateFolder={handleCreateFolder}
  onUpload={handleUpload}
  onDelete={handleDelete}
  onRename={handleRename}
  searchQuery={searchQuery}
  onSearchChange={handleSearchChange}
  onRefresh={handleRefresh}
  selectedCount={selectedPaths.size}
  uploading={uploading}
/>

// Replace the folder tree placeholder with:
<FolderTree
  currentPath={currentPath}
  onNavigate={handleNavigate}
  onContextMenu={handleFolderContextMenu}
/>

// Replace the file list placeholder with:
<FileList
  entries={displayedEntries}
  currentPath={currentPath}
  selectedPaths={selectedPaths}
  onToggleSelect={handleToggleSelect}
  onSelectAll={handleSelectAll}
  onClearSelection={() => setSelectedPaths(new Set())}
  onNavigate={handleNavigate}
  onContextMenu={handleFileContextMenu}
/>
```

Add the handler functions and state for `uploading`, `searchResults`, `contextMenu`, `renameTarget`, etc. These are standard React state management — full implementation details follow from the component interfaces above.

- [ ] **Step 6: Verify the full file explorer works**

Start backend + frontend. Visit `/files`. Verify:
- Folder tree shows library root and any folders
- Click a folder → file list updates with breadcrumbs
- Upload a file → appears in the list
- Rename a file → name updates
- Delete a file → disappears
- Search → filters results
- Refresh → re-scans library

- [ ] **Step 7: Run frontend lint**

```bash
cd frontend && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/files/
git commit -m "feat: add file explorer components (toolbar, folder tree, file list, context menu)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: FileLibraryPicker + Wizard Integration

**Files:**
- Create: `frontend/src/components/files/FileLibraryPicker.tsx`
- Modify: `frontend/src/app/new/upload/page.tsx`
- Modify: `frontend/src/app/new/metadata/page.tsx`

**Interfaces:**
- Consumes: `fileLibraryApi.selectForSession()` from Task 4
- Consumes: `fileLibraryApi.getContent()` from Task 4
- Consumes: FolderTree and FileList from Task 6 (reused inside picker)
- Produces: `FileLibraryPicker` modal — props: `{sessionId, fileType, onSelect, onClose}`
- Produces: Modified upload page — renders "Browse File Library" button instead of FileUploadZone for TMT/DIA
- Produces: Modified metadata page — renders "Import from Library" button

- [ ] **Step 1: Create FileLibraryPicker**

```typescript
// frontend/src/components/files/FileLibraryPicker.tsx
'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { X, Loader2, Search, FolderOpen } from 'lucide-react';
import { fileLibraryApi, FileLibraryEntry } from '@/lib/api-client';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

interface FileLibraryPickerProps {
  sessionId: string;
  /** 'tmt' | 'dia' | 'csv-only' — filters displayed files */
  fileType: 'tmt' | 'dia' | 'csv-only';
  onSelect: (selectedPaths: string[]) => void;
  onClose: () => void;
}

export const FileLibraryPicker: React.FC<FileLibraryPickerProps> = ({
  sessionId,
  fileType,
  onSelect,
  onClose,
}) => {
  const { addToast } = useUIStore();
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileLibraryEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileLibraryEntry[] | null>(null);
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Load directory on mount and on path change
  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const data = await fileLibraryApi.listDirectory(path);
      setEntries(data.entries.filter(e => {
        if (fileType === 'csv-only') return e.type === 'csv' || e.type === 'folder';
        return e.type === 'txt' || e.type === 'csv' || e.type === 'folder';
      }));
    } catch {
      addToast('error', 'Failed to load file library');
    } finally {
      setLoading(false);
    }
  }, [fileType, addToast]);

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  // Debounced search
  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimer) clearTimeout(searchTimer);
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await fileLibraryApi.search(query);
        setSearchResults(data.results.filter(e => {
          if (fileType === 'csv-only') return e.type === 'csv';
          return e.type === 'txt' || e.type === 'csv';
        }));
      } catch {
        // Search failed silently
      }
    }, 300);
    setSearchTimer(timer);
  }, [fileType, searchTimer]);

  const displayedEntries = searchResults ?? entries;

  const handleToggleSelect = (path: string) => {
    const next = new Set(selectedPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelectedPaths(next);
  };

  const handleSelectAll = () => {
    const next = new Set(selectedPaths);
    for (const e of displayedEntries) {
      if (e.type !== 'folder') next.add(e.path);
    }
    setSelectedPaths(next);
  };

  const handleClearSelection = () => {
    // Only clear visible entries
    const next = new Set(selectedPaths);
    for (const e of displayedEntries) {
      next.delete(e.path);
    }
    setSelectedPaths(next);
  };

  const totalSize = useMemo(() => {
    let size = 0;
    for (const p of selectedPaths) {
      const e = entries.find(en => en.path === p);
      if (e) size += e.size;
    }
    return size;
  }, [selectedPaths, entries]);

  const handleConfirm = async () => {
    const paths = Array.from(selectedPaths);
    if (paths.length === 0) return;

    setCopying(true);
    try {
      if (fileType === 'csv-only') {
        // Metadata mode: just pass paths back, parent fetches content
        onSelect(paths);
      } else {
        // Pipeline mode: copy to session + parse
        const result = await fileLibraryApi.selectForSession(sessionId, paths);
        // Pass selected file info back via paths (parent handles the file metadata via API response)
        onSelect(paths);
      }
    } catch (err) {
      addToast('error', `Failed to select files: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setCopying(false);
    }
  };

  const isEmpty = !loading && displayedEntries.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="file-picker">
      <div className="bg-background rounded-xl shadow-2xl w-[900px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="font-semibold text-text-primary">Select Files for Analysis</h2>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text rounded transition-colors"
            disabled={copying}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search bar */}
        <div className="px-4 py-2 border-b border-border bg-surface/50">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search files..."
              className="pl-8 pr-3 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary w-full"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Folder tree */}
          <div className="w-56 border-r border-border overflow-y-auto bg-surface/30 p-2">
            {searchQuery ? (
              <p className="text-xs text-text-muted p-2">Search active — showing all matching files</p>
            ) : (
              <div className="text-xs text-text-muted p-2">
                {/* Simplified folder tree for picker; reuses FolderTree logic inline */}
                <button
                  onClick={() => setCurrentPath('')}
                  className={cn(
                    'block w-full text-left px-2 py-1 rounded text-sm',
                    currentPath === '' ? 'bg-primary/10 text-primary font-medium' : 'text-text-secondary hover:bg-surface',
                  )}
                >
                  📁 All Files
                </button>
                {/* For full implementation: import FolderTree and pass onNavigate */}
              </div>
            )}
          </div>

          {/* File list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            ) : isEmpty ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                <FolderOpen className="w-10 h-10 text-text-muted" />
                <p className="text-sm text-text-muted">
                  {fileType === 'csv-only'
                    ? 'No CSV files found in the library.'
                    : 'Your file library is empty. Upload .txt or .csv files from the Files page first.'}
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-surface text-left">
                  <tr className="border-b border-border">
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={displayedEntries.length > 0 && displayedEntries.every(e => selectedPaths.has(e.path))}
                        onChange={() => {
                          if (displayedEntries.every(e => selectedPaths.has(e.path))) {
                            handleClearSelection();
                          } else {
                            handleSelectAll();
                          }
                        }}
                        className="w-4 h-4 rounded"
                      />
                    </th>
                    <th className="px-2 py-2 text-xs font-medium text-text-muted uppercase">Name</th>
                    <th className="px-2 py-2 text-xs font-medium text-text-muted uppercase w-24">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedEntries.filter(e => e.type !== 'folder').map(entry => (
                    <tr
                      key={entry.path}
                      className={cn(
                        'border-b border-border/50 hover:bg-surface/50 cursor-pointer',
                        selectedPaths.has(entry.path) && 'bg-primary/5',
                      )}
                      onClick={() => handleToggleSelect(entry.path)}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedPaths.has(entry.path)}
                          onChange={() => handleToggleSelect(entry.path)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 rounded"
                        />
                      </td>
                      <td className="px-2 py-2 text-sm text-text">{entry.name}</td>
                      <td className="px-2 py-2 text-sm text-text-muted">
                        {entry.size < 1024 ? `${entry.size} B` : `${(entry.size / (1024 * 1024)).toFixed(1)} MB`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-surface/50">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSelectAll}
              className="text-xs text-primary hover:underline"
            >
              Select All
            </button>
            <span className="text-text-muted text-xs">·</span>
            <button
              onClick={handleClearSelection}
              className="text-xs text-primary hover:underline"
            >
              Clear Selection
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-muted">
              Selected: {selectedPaths.size} files · {(totalSize / (1024 * 1024)).toFixed(1)} MB
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm font-medium text-text-secondary hover:text-text bg-background border border-border rounded-md"
              disabled={copying}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedPaths.size === 0 || copying}
              className="px-4 py-1.5 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {copying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Copying...
                </>
              ) : (
                'Select'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileLibraryPicker;
```

- [ ] **Step 2: Modify the upload wizard page**

In `frontend/src/app/new/upload/page.tsx`, replace the FileUploadZone for TMT/DIA:

```typescript
// Replace the entire TMT/DIA Data Input section (the <FileUploadZone> usage) with:

<section className="bg-background border border-border rounded-lg">
  <div className="px-5 py-3 border-b border-border flex items-center gap-3">
    <Upload className="w-5 h-5 text-primary" />
    <div>
      <h2 className="font-semibold text-text-primary">Data Input</h2>
      <p className="text-sm text-text-muted">
        Select PSM files from the file library
      </p>
    </div>
  </div>
  <div className="p-5">
    <button
      data-testid="browse-library-btn"
      onClick={() => setShowPicker(true)}
      className="inline-flex items-center gap-2 px-6 py-4 border-2 border-dashed border-primary/40 rounded-xl bg-primary/5 hover:bg-primary/10 transition-colors"
    >
      <FolderOpen className="w-6 h-6 text-primary" />
      <div className="text-left">
        <p className="text-base font-medium text-text">Browse File Library</p>
        <p className="text-sm text-text-muted">Select .txt or .csv PSM files</p>
      </div>
    </button>

    {uploadedFiles.length > 0 && (
      <p className="mt-3 text-sm text-text-muted">
        {uploadedFiles.length} files selected · {(uploadedFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(1)} MB total
      </p>
    )}

    {/* Show FileLibraryPicker modal when showPicker is true */}
    {showPicker && (
      <FileLibraryPicker
        sessionId={sessionId}
        fileType={analysisType as 'tmt' | 'dia'}
        onSelect={async (paths) => {
          setShowPicker(false);
          // paths were already copied to session by the picker
          // Reload session files to get parsed metadata
          const resp = await fetch(`/api/sessions/${sessionId}`);
          if (resp.ok) {
            const raw = await resp.json();
            const files = mapBackendFiles(raw.files);
            const { addUploadedFile } = useAnalysisStore.getState();
            for (const file of files) {
              addUploadedFile(file);
            }
          }
        }}
        onClose={() => setShowPicker(false)}
      />
    )}
  </div>
</section>
```

Add state and imports:
```typescript
// Add at top of UploadContentInner:
import { FolderOpen } from 'lucide-react';
import { FileLibraryPicker } from '@/components/files/FileLibraryPicker';

// Add state:
const [showPicker, setShowPicker] = useState(false);
```

**Keep the PTM branch unchanged** — only the TMT/DIA path changes.

- [ ] **Step 3: Modify the metadata page**

In `frontend/src/app/new/metadata/page.tsx`, add the "Import from Library" button:

```typescript
// Add imports:
import { FolderOpen } from 'lucide-react';
import { FileLibraryPicker } from '@/components/files/FileLibraryPicker';

// Add state:
const [showMetadataPicker, setShowMetadataPicker] = useState(false);

// Add button next to existing CSV import/export buttons:
<button
  onClick={() => setShowMetadataPicker(true)}
  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text bg-background border border-border rounded-md hover:bg-surface/80 transition-colors"
  data-testid="import-from-library-btn"
>
  <FolderOpen className="w-4 h-4" />
  Import from Library
</button>

// Add modal:
{showMetadataPicker && (
  <FileLibraryPicker
    sessionId={sessionId}
    fileType="csv-only"
    onSelect={async (paths) => {
      setShowMetadataPicker(false);
      if (paths.length > 0) {
        // Fetch first selected CSV content and parse
        const content = await fileLibraryApi.getContent(paths[0]);
        // Parse CSV client-side (reuse existing parser from DiaMetadataTable / TmtChannelMapping)
        // ... existing CSV import logic applied to `content`
        addToast('success', 'Metadata imported from library');
      }
    }}
    onClose={() => setShowMetadataPicker(false)}
  />
)}
```

- [ ] **Step 4: Run all backend tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/ -v --tb=short
```

Expected: all existing + new tests PASS

- [ ] **Step 5: Run frontend lint + tests**

```bash
cd frontend && npm run lint
cd frontend && npx vitest run
```

- [ ] **Step 6: Full integration smoke test**

1. Start backend: `cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000`
2. Start frontend: `cd frontend && npm run dev`
3. Navigate to `http://localhost:3000/files` — verify the file explorer works:
   - Create folder, upload .txt and .csv files
   - Rename a file
   - Move a file to a different folder
   - Delete a file
   - Search for a file
   - Refresh
4. Create a new DIA session:
   - Click Home → DIA card → Upload step → "Browse File Library" → select files → confirm
   - Verify ExperimentTable shows the selected files
   - Continue to Metadata → click "Import from Library" → select a CSV → verify table populates
5. Create a TMT session and repeat

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/files/FileLibraryPicker.tsx \
  frontend/src/app/new/upload/page.tsx \
  frontend/src/app/new/metadata/page.tsx
git commit -m "feat: add FileLibraryPicker modal and integrate into wizard upload and metadata pages

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Verification Checklist

Run these before declaring the feature complete:

- [ ] `backend/.venv/Scripts/python.exe -m pytest Tests/backend/ -v --tb=short` — all pass
- [ ] `cd frontend && npm run lint` — no errors
- [ ] `cd frontend && npx vitest run` — all pass
- [ ] Manual: Files page loads, shows empty state when library is empty
- [ ] Manual: Can create folder, upload .txt/.csv, rename, move, delete
- [ ] Manual: Dropping files directly into the library folder and pressing Refresh picks them up
- [ ] Manual: Uploading .fasta or .pdf to library is rejected
- [ ] Manual: DIA/TMT wizard shows "Browse File Library" button (not FileUploadZone)
- [ ] Manual: FileLibraryPicker filters by file type, Select All / Clear Selection work
- [ ] Manual: Selected files appear in ExperimentTable after picker confirm
- [ ] Manual: Metadata page "Import from Library" opens picker filtered to CSV, imports correctly
- [ ] Manual: PTM wizard is unchanged (still has inline upload zones)

