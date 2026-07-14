"""File library API routes -- global file management independent of sessions."""

import asyncio
import logging
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from app.core.config import settings
from app.services.file_index_service import FileIndexService

router = APIRouter()
logger = logging.getLogger("proteomics")

# ---- Singleton index service ----
_index_service: Optional[FileIndexService] = None


def get_index_service() -> FileIndexService:
    """Dependency: return the singleton FileIndexService."""
    global _index_service
    if _index_service is None:
        _index_service = FileIndexService(settings.file_library_dir)
    return _index_service


# ---- Path validation helpers ----


def _validate_path(path: str) -> Path:
    """Validate a relative path and resolve it inside the library root.

    Returns the resolved absolute Path. Raises HTTPException on invalid paths.
    """
    if ".." in Path(path).parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path traversal not allowed.",
        )
    resolved = (settings.file_library_dir / path).resolve()
    if not str(resolved).startswith(str(settings.file_library_dir.resolve())):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path must be inside the file library.",
        )
    return resolved


def _validate_name(name: str) -> str:
    """Validate a file or folder name. Returns stripped name."""
    import re

    name = name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name cannot be empty.",
        )
    if not re.match(r"^[a-zA-Z0-9_\- .]+$", name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name contains invalid characters.",
        )
    return name


# ---- Endpoints ----


@router.get("/tree")
async def list_directory(
    path: str = Query("", description="Relative path to list"),
    index: FileIndexService = Depends(get_index_service),
):
    """List directory contents -- folders first, then files."""
    entries = index.list_directory(path)
    return {"path": path, "entries": entries}


@router.post("/folders")
async def create_folder(
    body: dict,
    index: FileIndexService = Depends(get_index_service),
):
    """Create a new folder in the library."""
    parent_path = body.get("parent_path", "")
    name = _validate_name(body.get("name", ""))

    folder_rel = str(Path(parent_path) / name) if parent_path else name
    folder_abs = _validate_path(folder_rel)

    if folder_abs.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{name}' already exists.",
        )

    folder_abs.mkdir(parents=True, exist_ok=False)
    rel = str(Path(folder_rel).as_posix())
    index.insert_entry(rel, 0, "folder", datetime.now())
    return {"path": rel, "name": name}


@router.post("/upload")
async def upload_files(
    target_path: str = Query("", description="Target folder in library"),
    files: list[UploadFile] = File(...),
    index: FileIndexService = Depends(get_index_service),
):
    """Upload files to the library. Only .txt and .csv accepted."""
    target_dir = _validate_path(target_path) if target_path else settings.file_library_dir

    response_files = []
    for file in files:
        # Validate filename
        safe_name = _validate_name(file.filename or "")

        # Check extension
        ext = Path(safe_name).suffix.lower()
        if ext not in (".txt", ".csv"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Only .txt and .csv files are allowed. '{safe_name}' is '{ext}'.",
            )

        # Check for duplicate
        dest = target_dir / safe_name
        if dest.exists():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"'{safe_name}' already exists in this folder.",
            )

        # Read and validate
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File '{safe_name}' is empty.",
            )
        if len(content) > settings.max_upload_size_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File '{safe_name}' exceeds {settings.max_upload_size_mb}MB maximum.",
            )

        # Write to disk
        async with aiofiles.open(dest, "wb") as f:
            await f.write(content)

        # Index
        rel = str((Path(target_path) / safe_name).as_posix()) if target_path else safe_name
        file_type = ext.lstrip(".")
        index.insert_entry(rel, len(content), file_type, datetime.fromtimestamp(dest.stat().st_mtime))

        response_files.append({
            "name": safe_name,
            "size": len(content),
            "type": file_type,
        })

    return {"files": response_files}


@router.put("/rename")
async def rename_entry(
    body: dict,
    index: FileIndexService = Depends(get_index_service),
):
    """Rename a file or folder."""
    path = body.get("path", "")
    new_name = _validate_name(body.get("new_name", ""))

    old_abs = _validate_path(path)
    if not old_abs.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"'{path}' not found.")

    parent = old_abs.parent
    new_abs = parent / new_name
    if new_abs.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{new_name}' already exists in this folder.",
        )

    old_rel = str(Path(path).as_posix())
    new_rel = (Path(old_rel).parent / new_name).as_posix() if str(Path(old_rel).parent) != "." else new_name
    new_parent = Path(new_rel).parent.as_posix() if str(Path(new_rel).parent) != "." else ""

    await _run_in_thread(shutil.move, str(old_abs), str(new_abs))

    index.update_entry(
        old_rel, new_rel, new_parent,
        new_abs.stat().st_size if new_abs.is_file() else 0,
        datetime.fromtimestamp(new_abs.stat().st_mtime),
    )
    return {"path": new_rel, "name": new_name}


@router.put("/move")
async def move_entry(
    body: dict,
    index: FileIndexService = Depends(get_index_service),
):
    """Move a file or folder to a different parent directory."""
    source_path = body.get("source_path", "")
    target_parent = body.get("target_parent", "")

    src_abs = _validate_path(source_path)
    tgt_dir = _validate_path(target_parent) if target_parent else settings.file_library_dir

    if not src_abs.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"'{source_path}' not found.")
    if not tgt_dir.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target must be a folder.")

    # Prevent moving into self or descendant
    if src_abs == tgt_dir:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot move an item into itself.",
        )
    if src_abs.is_dir():
        try:
            tgt_dir.relative_to(src_abs)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot move a folder into itself or a descendant.",
            )
        except ValueError:
            pass  # target is not inside source -- ok

    dest_abs = tgt_dir / src_abs.name
    if dest_abs.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"'{src_abs.name}' already exists in the target folder.",
        )

    await _run_in_thread(shutil.move, str(src_abs), str(dest_abs))

    old_rel = str(Path(source_path).as_posix())
    new_rel = str((Path(target_parent) / src_abs.name).as_posix()) if target_parent else src_abs.name
    new_parent = target_parent

    is_folder = dest_abs.is_dir()
    index.update_entry(
        old_rel, new_rel, new_parent,
        dest_abs.stat().st_size if not is_folder else 0,
        datetime.fromtimestamp(dest_abs.stat().st_mtime),
    )
    return {"path": new_rel, "new_parent": new_parent}


@router.delete("/delete")
async def delete_entry(
    body: dict,
    index: FileIndexService = Depends(get_index_service),
):
    """Delete a file or folder. Folders are deleted recursively."""
    path = body.get("path", "")
    abs_path = _validate_path(path)

    if not abs_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"'{path}' not found.")

    if abs_path.is_dir():
        await _run_in_thread(shutil.rmtree, str(abs_path))
    else:
        await _run_in_thread(os.unlink, str(abs_path))

    rel = str(Path(path).as_posix())
    index.delete_entry(rel)
    return {"deleted": rel}


@router.post("/scan")
async def scan_library(
    index: FileIndexService = Depends(get_index_service),
):
    """Force a full re-scan of the library directory."""
    result = await _run_in_thread(index.scan_and_sync)
    return result


@router.get("/search")
async def search_files(
    q: str = Query(..., description="Search query"),
    index: FileIndexService = Depends(get_index_service),
):
    """Search files by name substring."""
    results = index.search(q)
    return {"results": results}


@router.get("/content")
async def get_file_content(
    path: str = Query(..., description="Relative path to file"),
):
    """Download file contents (for client-side parsing). 10MB max."""
    abs_path = _validate_path(path)

    if not abs_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"'{path}' not found.")
    if abs_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot download a folder as a file.",
        )

    max_size = 10 * 1024 * 1024  # 10MB
    if abs_path.stat().st_size > max_size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large to preview. Select it for a pipeline analysis instead.",
        )

    async with aiofiles.open(abs_path, "rb") as f:
        content = await f.read()

    from fastapi.responses import Response
    return Response(content=content, media_type="text/plain")


@router.post("/select")
async def select_files_for_session(
    body: dict,
    index: FileIndexService = Depends(get_index_service),
):
    """Copy files from library to a session and parse them. Returns ProteomicsFileInfo list."""

    from app.db.session_store import SessionStore
    from app.models.session import ProteomicsFileInfo
    from app.utils.file_parser import parse_proteomics_file, sanitize_filename

    session_id = body.get("session_id", "")
    paths: list[str] = body.get("paths", [])

    store = SessionStore(settings.sessions_dir)
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found.",
        )

    if not session.config or not session.config.file_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session must have file_type ('tmt' or 'dia') configured before selecting files.",
        )

    file_type = session.config.file_type
    session_uploads = settings.sessions_dir / session_id / "uploads"
    session_uploads.mkdir(parents=True, exist_ok=True)

    response_files = []

    for path in paths:
        src_abs = _validate_path(path)
        if not src_abs.exists() or not src_abs.is_file():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File '{path}' not found in library.",
            )

        safe_name = sanitize_filename(src_abs.name)
        dest = session_uploads / safe_name

        # Handle duplicate names in session
        counter = 1
        while dest.exists():
            stem = Path(safe_name).stem
            ext = Path(safe_name).suffix
            dest = session_uploads / f"{stem}_{counter}{ext}"
            counter += 1

        await _run_in_thread(shutil.copy2, str(src_abs), str(dest))

        # Parse file
        result = await _run_in_thread(parse_proteomics_file, dest, file_type)

        proteomics_file = ProteomicsFileInfo(
            filename=dest.name,
            size=dest.stat().st_size,
            columns=result["columns"],
            file_type=file_type,
        )
        session.files.proteomics.append(proteomics_file)

        file_resp = {
            "filename": dest.name,
            "size": dest.stat().st_size,
            "columns": result["columns"],
            "file_type": file_type,
        }
        if result.get("tmt_channels"):
            file_resp["tmt_channels"] = result["tmt_channels"]
        if result.get("has_quan_value"):
            file_resp["has_quan_value"] = result["has_quan_value"]

        response_files.append(file_resp)

    await store.save(session)
    return {"files": response_files}


# ---- Helper ----


async def _run_in_thread(func, *args, **kwargs):
    """Run a synchronous function in a thread to avoid blocking the event loop."""
    return await asyncio.to_thread(func, *args, **kwargs)
