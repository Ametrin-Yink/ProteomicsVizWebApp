"""Tests for bounded-memory upload persistence."""

from pathlib import Path

import pytest
from app.core.exceptions import FileTooLargeError, ValidationError
from app.utils.uploads import UPLOAD_CHUNK_SIZE, stream_upload_to_file


class RecordingUpload:
    def __init__(self, content: bytes):
        self.content = content
        self.offset = 0
        self.read_sizes: list[int] = []

    async def read(self, size: int = -1) -> bytes:
        self.read_sizes.append(size)
        if self.offset >= len(self.content):
            return b""
        end = len(self.content) if size < 0 else self.offset + size
        chunk = self.content[self.offset : end]
        self.offset += len(chunk)
        return chunk


@pytest.mark.asyncio
async def test_stream_upload_writes_in_bounded_chunks(tmp_path: Path):
    content = b"a" * (UPLOAD_CHUNK_SIZE + 17)
    upload = RecordingUpload(content)
    destination = tmp_path / "data.txt"

    size = await stream_upload_to_file(upload, destination, len(content))

    assert size == len(content)
    assert destination.read_bytes() == content
    assert upload.read_sizes == [UPLOAD_CHUNK_SIZE] * 3


@pytest.mark.asyncio
async def test_stream_upload_removes_oversized_partial_file(tmp_path: Path):
    destination = tmp_path / "too-large.txt"

    with pytest.raises(FileTooLargeError):
        await stream_upload_to_file(RecordingUpload(b"12345"), destination, 4)

    assert not destination.exists()


@pytest.mark.asyncio
async def test_stream_upload_rejects_empty_file(tmp_path: Path):
    destination = tmp_path / "empty.txt"

    with pytest.raises(ValidationError, match="empty"):
        await stream_upload_to_file(RecordingUpload(b""), destination, 10)

    assert not destination.exists()


@pytest.mark.asyncio
async def test_stream_upload_never_overwrites_existing_file(tmp_path: Path):
    destination = tmp_path / "existing.txt"
    destination.write_bytes(b"original")

    with pytest.raises(FileExistsError):
        await stream_upload_to_file(RecordingUpload(b"replacement"), destination, 20)

    assert destination.read_bytes() == b"original"
