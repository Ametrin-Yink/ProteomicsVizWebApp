"""Tests that coarse session filesystem work does not block the event loop."""

import asyncio
import shutil
import time
from pathlib import Path

import pytest
from app.db.session_store import SessionStore
from app.models.session import Session


@pytest.mark.asyncio
async def test_delete_runs_recursive_removal_off_event_loop(tmp_path, monkeypatch):
    store = SessionStore(tmp_path)
    session_id = "550e8400-e29b-41d4-a716-446655440001"
    session_dir = tmp_path / session_id
    session_dir.mkdir()
    (session_dir / "large-result.tsv").write_text("data")

    original_rmtree = shutil.rmtree

    def slow_rmtree(path):
        time.sleep(0.1)
        original_rmtree(path)

    monkeypatch.setattr(shutil, "rmtree", slow_rmtree)

    deletion = asyncio.create_task(store.delete(session_id))
    await asyncio.sleep(0.02)

    assert not deletion.done()
    await deletion
    assert not session_dir.exists()


@pytest.mark.asyncio
async def test_update_atomically_replaces_existing_session_file(tmp_path, monkeypatch):
    store = SessionStore(tmp_path)
    session = Session(
        id="550e8400-e29b-41d4-a716-446655440001",
        name="Before",
    )
    await store.create(session)

    def fail_if_unlinked(_path):
        raise AssertionError(
            "the live session file must not be unlinked before replacement"
        )

    monkeypatch.setattr(Path, "unlink", fail_if_unlinked)
    session.name = "After"

    await store.update(session)

    assert (await store.get(session.id)).name == "After"
