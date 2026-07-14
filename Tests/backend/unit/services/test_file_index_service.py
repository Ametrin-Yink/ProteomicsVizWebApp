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
        index_service.insert_entry("a/100%_file.txt", 100, "txt", now)

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


class TestFileIndexServicePaths:
    """Path normalization — forward slashes on all platforms."""

    def test_parent_path_uses_forward_slashes(self, index_service, tmp_path):
        """parent_path uses / not \\ on all platforms."""
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "file.txt").write_text("data")
        index_service.scan_and_sync()

        entry = index_service.get_entry("sub/file.txt")
        assert entry is not None
        assert "\\" not in entry["parent_path"], f"parent_path has backslash: {entry['parent_path']}"
        assert entry["parent_path"] == "sub"

    def test_insert_entry_parent_path(self, index_service):
        """insert_entry stores normalized parent_path."""
        now = datetime.now()
        index_service.insert_entry("a/b/file.txt", 100, "txt", now)
        entry = index_service.get_entry("a/b/file.txt")
        assert entry is not None
        assert "\\" not in entry["parent_path"]
        assert entry["parent_path"] == "a/b"

    def test_nested_folder_parents(self, index_service, tmp_path):
        """Scan with nested folders produces correct parent_path at all levels."""
        (tmp_path / "a").mkdir()
        (tmp_path / "a" / "b").mkdir()
        (tmp_path / "a" / "b" / "c").mkdir()
        (tmp_path / "a" / "b" / "c" / "deep.txt").write_text("deep")
        (tmp_path / "a" / "top.txt").write_text("top")

        index_service.scan_and_sync()

        top = index_service.get_entry("a/top.txt")
        assert top is not None
        assert top["parent_path"] == "a"

        deep = index_service.get_entry("a/b/c/deep.txt")
        assert deep is not None
        assert deep["parent_path"] == "a/b/c"

    def test_scan_after_external_file_added(self, index_service, tmp_path):
        """Drop file via OS, scan picks it up."""
        (tmp_path / "existing.txt").write_text("old")
        index_service.scan_and_sync()
        assert index_service.get_entry("existing.txt") is not None

        # Add file externally
        (tmp_path / "external.txt").write_text("new")
        result = index_service.scan_and_sync()
        assert result["added"] == 1
        assert index_service.get_entry("external.txt") is not None

    def test_scan_after_external_file_deleted(self, index_service, tmp_path):
        """Delete file via OS, scan removes it from index."""
        (tmp_path / "remove_me.txt").write_text("bye")
        index_service.scan_and_sync()
        assert index_service.get_entry("remove_me.txt") is not None

        (tmp_path / "remove_me.txt").unlink()
        result = index_service.scan_and_sync()
        assert result["removed"] == 1
        assert index_service.get_entry("remove_me.txt") is None

    def test_scan_after_db_file_deleted(self, tmp_path):
        """Delete the .duckdb file, service still works after re-init."""
        from app.services.file_index_service import FileIndexService

        svc = FileIndexService(tmp_path)
        (tmp_path / "data.txt").write_text("stuff")
        svc.scan_and_sync()
        assert svc.get_entry("data.txt") is not None

        # Delete the DB file
        db_path = tmp_path / ".library_index.duckdb"
        db_path.unlink()
        assert not db_path.exists()

        # scan_and_sync should recreate schema and re-index
        result = svc.scan_and_sync()
        assert result["added"] >= 1  # data.txt was added
        assert svc.get_entry("data.txt") is not None

    def test_update_entry_folder_no_prefix_collision(self, index_service):
        """Renaming 'proj' does not affect 'proj_extra'."""
        now = datetime.now()
        index_service.insert_entry("proj", 0, "folder", now)
        index_service.insert_entry("proj/file.txt", 10, "txt", now)
        index_service.insert_entry("proj_extra", 0, "folder", now)
        index_service.insert_entry("proj_extra/file.txt", 20, "txt", now)

        index_service.update_entry("proj", "project", "project", 0, now)

        # proj_extra should be unaffected
        assert index_service.get_entry("proj_extra") is not None
        assert index_service.get_entry("proj_extra/file.txt") is not None
        # proj should be renamed
        assert index_service.get_entry("proj") is None
        assert index_service.get_entry("project") is not None
        assert index_service.get_entry("project/file.txt") is not None
