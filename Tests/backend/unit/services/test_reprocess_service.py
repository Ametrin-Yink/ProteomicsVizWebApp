"""Filesystem transaction tests for in-place reprocessing."""

import os

import pytest


def test_commit_staged_results_replaces_current_directory(tmp_path):
    from app.services.reprocess_service import commit_staged_results

    current = tmp_path / "results"
    staged = tmp_path / ".reprocess-test" / "results"
    current.mkdir()
    staged.mkdir(parents=True)
    (current / "value.txt").write_text("old", encoding="utf-8")
    (staged / "value.txt").write_text("new", encoding="utf-8")

    commit_staged_results(tmp_path, staged)

    assert (current / "value.txt").read_text(encoding="utf-8") == "new"
    assert not any(
        path.name.startswith(".results-backup-") for path in tmp_path.iterdir()
    )


def test_commit_failure_restores_previous_results(tmp_path, monkeypatch):
    from app.services import reprocess_service

    current = tmp_path / "results"
    staged = tmp_path / ".reprocess-test" / "results"
    current.mkdir()
    staged.mkdir(parents=True)
    (current / "value.txt").write_text("old", encoding="utf-8")
    (staged / "value.txt").write_text("new", encoding="utf-8")

    real_replace = os.replace
    calls = 0

    def fail_publish(source, destination):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("publish failed")
        return real_replace(source, destination)

    monkeypatch.setattr(reprocess_service.os, "replace", fail_publish)

    with pytest.raises(OSError, match="publish failed"):
        reprocess_service.commit_staged_results(tmp_path, staged)

    assert (current / "value.txt").read_text(encoding="utf-8") == "old"
    assert (staged / "value.txt").read_text(encoding="utf-8") == "new"


class TestDirectorySize:
    def test_empty_directory(self, tmp_path):
        from app.services.reprocess_service import directory_size
        assert directory_size(tmp_path) == 0

    def test_with_files(self, tmp_path):
        from app.services.reprocess_service import directory_size
        (tmp_path / "a.txt").write_text("hello")
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "b.txt").write_text("world")
        assert directory_size(tmp_path) == 10  # 5 + 5

    def test_nonexistent_path(self, tmp_path):
        from app.services.reprocess_service import directory_size
        assert directory_size(tmp_path / "nonexistent") == 0


class TestPreflightReprocessSpace:
    def test_sufficient_space(self, tmp_path):
        from collections import namedtuple
        from unittest.mock import patch

        from app.services.reprocess_service import preflight_reprocess_space

        session_dir = tmp_path / "session"
        session_dir.mkdir()
        (session_dir / "results").mkdir()
        (session_dir / "results" / "data.txt").write_text("x" * 1000)

        DiskUsage = namedtuple("DiskUsage", ["total", "used", "free"])
        with patch(
            "app.services.reprocess_service.shutil.disk_usage",
            return_value=DiskUsage(1_000_000, 0, 1_000_000_000),
        ):
            preflight_reprocess_space(session_dir)

    def test_insufficient_space(self, tmp_path):
        from collections import namedtuple
        from unittest.mock import patch

        from app.services.reprocess_service import preflight_reprocess_space

        session_dir = tmp_path / "session"
        session_dir.mkdir()
        (session_dir / "results").mkdir()
        (session_dir / "results" / "data.txt").write_text("x" * 10000)

        DiskUsage = namedtuple("DiskUsage", ["total", "used", "free"])
        with patch(
            "app.services.reprocess_service.shutil.disk_usage",
            return_value=DiskUsage(100, 0, 1),
        ), pytest.raises(ValueError, match="Insufficient free space"):
            preflight_reprocess_space(session_dir)


class TestClearSavedAnalysisState:
    def test_removes_both(self, tmp_path):
        from app.services.reprocess_service import clear_saved_analysis_state

        session_dir = tmp_path / "session"
        session_dir.mkdir()
        (session_dir / "gsea_run_status.json").write_text("{}")
        (session_dir / "bionet").mkdir()

        clear_saved_analysis_state(session_dir)

        assert not (session_dir / "gsea_run_status.json").exists()
        assert not (session_dir / "bionet").exists()

    def test_missing_handled_gracefully(self, tmp_path):
        from app.services.reprocess_service import clear_saved_analysis_state

        session_dir = tmp_path / "session"
        session_dir.mkdir()
        clear_saved_analysis_state(session_dir)  # no error


class TestWriteReprocessStatus:
    def test_writes_and_overwrites(self, tmp_path):
        from app.services.reprocess_service import write_reprocess_status

        session_dir = tmp_path / "session"
        session_dir.mkdir()

        write_reprocess_status(session_dir, {"status": "running"})
        import json
        data = json.loads(
            (session_dir / "reprocess_status.json").read_text()
        )
        assert data["status"] == "running"

        write_reprocess_status(session_dir, {"status": "done"})
        data = json.loads(
            (session_dir / "reprocess_status.json").read_text()
        )
        assert data["status"] == "done"
