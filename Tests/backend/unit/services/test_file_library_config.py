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
        expected = Path(__file__).resolve().parent.parent.parent.parent.parent / "backend" / "file_library"
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
        assert s.file_library_dir == Path("/custom/library").resolve()

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
