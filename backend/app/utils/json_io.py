"""Non-blocking JSON file helpers for async route handlers."""

import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import Any


def _read_json_file(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json_file(
    path: Path,
    data: Any,
    indent: int | None,
    default: Any,
) -> None:
    payload = json.dumps(data, indent=indent, default=default)
    temp_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temp_path.write_text(payload, encoding="utf-8")
        os.replace(temp_path, path)
    finally:
        temp_path.unlink(missing_ok=True)


async def read_json_file(path: Path) -> Any:
    """Read and decode a JSON file without blocking the event loop."""
    return await asyncio.to_thread(_read_json_file, path)


async def write_json_file(
    path: Path,
    data: Any,
    *,
    indent: int | None = None,
    default: Any = None,
) -> None:
    """Atomically encode and write JSON without blocking the event loop."""
    await asyncio.to_thread(_write_json_file, path, data, indent, default)
