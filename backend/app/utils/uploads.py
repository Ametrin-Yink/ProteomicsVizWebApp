"""Bounded-memory helpers for persisting uploaded files."""

import asyncio
from pathlib import Path

import aiofiles
from fastapi import UploadFile

from app.core.exceptions import FileTooLargeError, ValidationError

UPLOAD_CHUNK_SIZE = 1024 * 1024


async def stream_upload_to_file(
    upload: UploadFile,
    destination: Path,
    max_size_bytes: int,
) -> int:
    """Write an upload without buffering it or overwriting an existing file."""
    size = 0
    created = False

    try:
        async with aiofiles.open(destination, "xb") as output:
            created = True
            while chunk := await upload.read(UPLOAD_CHUNK_SIZE):
                size += len(chunk)
                if size > max_size_bytes:
                    raise FileTooLargeError(
                        message=f"File {destination.name} exceeds the maximum upload size"
                    )
                await output.write(chunk)

        if size == 0:
            raise ValidationError(message=f"File {destination.name} is empty")
    except BaseException:
        if created:
            await asyncio.to_thread(destination.unlink, missing_ok=True)
        raise

    return size
