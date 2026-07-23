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
