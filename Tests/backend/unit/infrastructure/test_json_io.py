"""Tests for non-blocking JSON file helpers."""

import asyncio
import time
from pathlib import Path

import pytest
from app.utils.json_io import read_json_file, write_json_file


@pytest.mark.asyncio
async def test_json_read_does_not_block_event_loop(tmp_path, monkeypatch):
    json_path = tmp_path / "status.json"
    json_path.write_text('{"status": "completed"}', encoding="utf-8")
    original_read_text = Path.read_text

    def slow_read_text(path, *args, **kwargs):
        if path == json_path:
            time.sleep(0.1)
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", slow_read_text)

    read_task = asyncio.create_task(read_json_file(json_path))
    await asyncio.sleep(0.02)

    assert not read_task.done()
    assert await read_task == {"status": "completed"}


@pytest.mark.asyncio
async def test_json_write_preserves_format_options(tmp_path):
    json_path = tmp_path / "status.json"

    await write_json_file(
        json_path, {"value": Path("result.tsv")}, indent=2, default=str
    )

    content = json_path.read_text(encoding="utf-8")
    assert content == '{\n  "value": "result.tsv"\n}'


@pytest.mark.asyncio
async def test_failed_json_replace_preserves_existing_file(tmp_path, monkeypatch):
    import app.utils.json_io as json_io

    json_path = tmp_path / "status.json"
    json_path.write_text('{"status": "old"}', encoding="utf-8")

    def fail_replace(_source, _destination):
        raise OSError("replace failed")

    monkeypatch.setattr(json_io.os, "replace", fail_replace)

    with pytest.raises(OSError, match="replace failed"):
        await write_json_file(json_path, {"status": "new"})

    assert json_path.read_text(encoding="utf-8") == '{"status": "old"}'
    assert list(tmp_path.iterdir()) == [json_path]
