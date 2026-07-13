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
                        path TEXT PRIMARY KEY,
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
                parent = str(Path(rel).parent)
                if parent == ".":
                    parent = ""
                fs_paths[rel] = {
                    "name": fname,
                    "size": st.st_size,
                    "file_type": ext,
                    "parent_path": parent,
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
                "SELECT name, path, file_type, parent_path, size, modified_at FROM files WHERE path = ?",
                [path],
            ).fetchone()
            if row is None:
                return None
            return {
                "name": row[0],
                "path": row[1],
                "type": row[2],
                "parent_path": row[3],
                "size": row[4],
                "modified_at": row[5].isoformat() if row[5] else None,
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
                    """INSERT INTO files (path, name, size, file_type, parent_path, modified_at)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT (path) DO UPDATE SET
                         name = EXCLUDED.name,
                         size = EXCLUDED.size,
                         file_type = EXCLUDED.file_type,
                         parent_path = EXCLUDED.parent_path,
                         modified_at = EXCLUDED.modified_at""",
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
