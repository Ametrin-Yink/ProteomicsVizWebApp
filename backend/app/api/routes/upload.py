"""
File upload API routes.

Handles proteomics file uploads with validation.
"""

import logging
from datetime import UTC, datetime
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.api.deps import get_session_store
from app.core.config import settings
from app.core.exceptions import ValidationError
from app.db.session_store import SessionStore
from app.models.session import FileInfo, ProteomicsFileInfo
from app.utils.file_parser import FileParser, parse_psm_filename, sanitize_filename

router = APIRouter()
logger = logging.getLogger("proteomics")


@router.post("/{session_id}/upload/proteomics")
async def upload_proteomics_files(
    session_id: str,
    files: list[UploadFile] = File(...),
    store: SessionStore = Depends(get_session_store),
):
    """Upload proteomics CSV files."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    parser = FileParser()
    uploaded_files = []

    for file in files:
        # Check file size
        content = await file.read()
        if len(content) > settings.max_upload_size_bytes:
            raise ValidationError(
                message=f"File {file.filename} exceeds maximum size of {settings.max_upload_size_mb}MB"
            )

        # Parse and validate
        try:
            session_uploads_dir = Path(settings.sessions_dir) / session_id / "uploads"
            session_uploads_dir.mkdir(parents=True, exist_ok=True)
            file_info = await parser.parse_proteomics_file(
                filename=file.filename, content=content, session_dir=session_uploads_dir
            )
            uploaded_files.append(file_info)
        except Exception as e:
            # Clean up any files already written for this batch
            for prev in uploaded_files:
                try:
                    prev_path = session_uploads_dir / prev.original_filename
                    if prev_path.exists():
                        prev_path.unlink()
                except Exception:
                    pass
            import traceback

            logger.error(f"Upload error for {file.filename}: {traceback.format_exc()}")
            raise ValidationError(
                message=f"Error parsing {file.filename}: {e!s}"
            ) from e

    # Convert UploadedFileMetadata to ProteomicsFileInfo and update session
    response_files = []
    for file_metadata in uploaded_files:
        # Parse filename to get experiment, condition, replicate
        parsed = parse_psm_filename(file_metadata.original_filename)

        proteomics_file = ProteomicsFileInfo(
            filename=file_metadata.original_filename,
            size=file_metadata.size,
            uploaded_at=file_metadata.uploaded_at,
            columns=[],  # Will be populated later if needed
            experiment=parsed.experiment,
            conditions=parsed.conditions,
            replicate=parsed.replicate,
        )
        session.files.proteomics.append(proteomics_file)

        # Build frontend-compatible response with parsed metadata
        response_files.append(
            {
                "filename": file_metadata.original_filename,
                "size": file_metadata.size,
                "experiment": parsed.experiment,
                "conditions": parsed.conditions,
                "replicate": parsed.replicate,
                "columns": [],
            }
        )

    await store.save(session)

    return {
        "message": f"Successfully uploaded {len(uploaded_files)} files",
        "files": response_files,
    }


@router.post("/{session_id}/upload/ptm-enrichment")
async def upload_ptm_enrichment_files(
    session_id: str,
    files: list[UploadFile] = File(...),
    store: SessionStore = Depends(get_session_store),
):
    """Upload PTM enrichment CSV files."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    parser = FileParser()
    uploaded_files = []

    for file in files:
        content = await file.read()
        if len(content) > settings.max_upload_size_bytes:
            raise ValidationError(
                message=f"File {file.filename} exceeds maximum size of {settings.max_upload_size_mb}MB"
            )

        try:
            session_uploads_dir = (
                Path(settings.sessions_dir) / session_id / "uploads" / "ptm_enrichment"
            )
            session_uploads_dir.mkdir(parents=True, exist_ok=True)
            file_info = await parser.parse_proteomics_file(
                filename=file.filename, content=content, session_dir=session_uploads_dir
            )
            uploaded_files.append(file_info)
        except Exception as e:
            for prev in uploaded_files:
                try:
                    prev_path = session_uploads_dir / prev.original_filename
                    if prev_path.exists():
                        prev_path.unlink()
                except Exception:
                    pass
            import traceback

            logger.error(f"Upload error for {file.filename}: {traceback.format_exc()}")
            raise ValidationError(
                message=f"Error parsing {file.filename}: {e!s}"
            ) from e

    response_files = []
    for file_metadata in uploaded_files:
        parsed = parse_psm_filename(file_metadata.original_filename)

        proteomics_file = ProteomicsFileInfo(
            filename=file_metadata.original_filename,
            size=file_metadata.size,
            uploaded_at=file_metadata.uploaded_at,
            columns=[],
            experiment=parsed.experiment,
            conditions=parsed.conditions,
            replicate=parsed.replicate,
        )
        session.files.ptm_enrichment.append(proteomics_file)

        response_files.append(
            {
                "filename": file_metadata.original_filename,
                "size": file_metadata.size,
                "experiment": parsed.experiment,
                "conditions": parsed.conditions,
                "replicate": parsed.replicate,
                "columns": [],
            }
        )

    await store.save(session)

    return {
        "message": f"Successfully uploaded {len(uploaded_files)} files",
        "files": response_files,
    }


@router.post("/{session_id}/upload/global-proteome")
async def upload_global_proteome_files(
    session_id: str,
    files: list[UploadFile] = File(...),
    store: SessionStore = Depends(get_session_store),
):
    """Upload global proteome CSV files."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    parser = FileParser()
    uploaded_files = []

    for file in files:
        content = await file.read()
        if len(content) > settings.max_upload_size_bytes:
            raise ValidationError(
                message=f"File {file.filename} exceeds maximum size of {settings.max_upload_size_mb}MB"
            )

        try:
            session_uploads_dir = (
                Path(settings.sessions_dir) / session_id / "uploads" / "global_proteome"
            )
            session_uploads_dir.mkdir(parents=True, exist_ok=True)
            file_info = await parser.parse_proteomics_file(
                filename=file.filename, content=content, session_dir=session_uploads_dir
            )
            uploaded_files.append(file_info)
        except Exception as e:
            for prev in uploaded_files:
                try:
                    prev_path = session_uploads_dir / prev.original_filename
                    if prev_path.exists():
                        prev_path.unlink()
                except Exception:
                    pass
            import traceback

            logger.error(f"Upload error for {file.filename}: {traceback.format_exc()}")
            raise ValidationError(
                message=f"Error parsing {file.filename}: {e!s}"
            ) from e

    response_files = []
    for file_metadata in uploaded_files:
        parsed = parse_psm_filename(file_metadata.original_filename)

        proteomics_file = ProteomicsFileInfo(
            filename=file_metadata.original_filename,
            size=file_metadata.size,
            uploaded_at=file_metadata.uploaded_at,
            columns=[],
            experiment=parsed.experiment,
            conditions=parsed.conditions,
            replicate=parsed.replicate,
        )
        session.files.global_proteome.append(proteomics_file)

        response_files.append(
            {
                "filename": file_metadata.original_filename,
                "size": file_metadata.size,
                "experiment": parsed.experiment,
                "conditions": parsed.conditions,
                "replicate": parsed.replicate,
                "columns": [],
            }
        )

    await store.save(session)

    return {
        "message": f"Successfully uploaded {len(uploaded_files)} files",
        "files": response_files,
    }


@router.post("/{session_id}/upload/fasta")
async def upload_fasta_file(
    session_id: str,
    file: UploadFile = File(...),
    store: SessionStore = Depends(get_session_store),
):
    """Upload a single FASTA file."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Validate file extension
    ext = Path(file.filename).suffix.lower()
    if ext not in {".fasta", ".fa", ".faa"} and not file.filename.lower().endswith(".fasta"):
        raise ValidationError(
            message=f"Invalid file extension: {file.filename}. Expected .fasta, .fa, or .faa"
        )

    # Check file size (max 100MB)
    content = await file.read()
    max_fasta_size = 100 * 1024 * 1024
    if len(content) > max_fasta_size:
        raise ValidationError(
            message=f"File {file.filename} exceeds maximum size of 100MB"
        )

    # Validate FASTA format — first line must start with ">"
    try:
        text_content = content.decode("utf-8")
    except UnicodeDecodeError:
        raise ValidationError(
            message=f"File {file.filename} is not a valid text file"
        )

    first_line = text_content.strip().split("\n")[0] if text_content else ""
    if not first_line.startswith(">"):
        raise ValidationError(
            message=f"File {file.filename} is not a valid FASTA file. First line must start with '>'"
        )

    # Save file
    safe_filename = sanitize_filename(file.filename)
    fasta_dir = Path(settings.sessions_dir) / session_id / "uploads" / "fasta"
    fasta_dir.mkdir(parents=True, exist_ok=True)
    file_path = fasta_dir / safe_filename

    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    # Update session metadata
    fasta_file = FileInfo(
        filename=file.filename,
        size=len(content),
        uploaded_at=datetime.now(UTC),
    )
    session.files.fasta.append(fasta_file)

    await store.save(session)

    return {
        "message": "Successfully uploaded FASTA file",
        "files": [
            {
                "filename": file.filename,
                "size": len(content),
            }
        ],
    }


@router.delete("/{session_id}/files/{file_type}/{filename}")
async def delete_file(
    session_id: str,
    file_type: str,
    filename: str,
    store: SessionStore = Depends(get_session_store),
):
    """Delete a file from a session."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    if file_type == "proteomics":
        # Remove from session metadata
        session.files.proteomics = [
            f for f in session.files.proteomics if f.filename != filename
        ]
        file_path = Path(settings.sessions_dir) / session_id / "uploads" / filename
        try:
            if file_path.exists():
                file_path.unlink()
        except Exception as e:
            logger.warning(f"Failed to delete uploaded file {filename}: {e}")
    elif file_type == "ptm-enrichment":
        session.files.ptm_enrichment = [
            f for f in session.files.ptm_enrichment if f.filename != filename
        ]
        file_path = Path(settings.sessions_dir) / session_id / "uploads" / "ptm_enrichment" / filename
        try:
            if file_path.exists():
                file_path.unlink()
        except Exception as e:
            logger.warning(f"Failed to delete uploaded file {filename}: {e}")
    elif file_type == "global-proteome":
        session.files.global_proteome = [
            f for f in session.files.global_proteome if f.filename != filename
        ]
        file_path = Path(settings.sessions_dir) / session_id / "uploads" / "global_proteome" / filename
        try:
            if file_path.exists():
                file_path.unlink()
        except Exception as e:
            logger.warning(f"Failed to delete uploaded file {filename}: {e}")
    elif file_type == "fasta":
        session.files.fasta = [
            f for f in session.files.fasta if f.filename != filename
        ]
        file_path = Path(settings.sessions_dir) / session_id / "uploads" / "fasta" / filename
        try:
            if file_path.exists():
                file_path.unlink()
        except Exception as e:
            logger.warning(f"Failed to delete uploaded file {filename}: {e}")
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type: {file_type}",
        )

    await store.save(session)

    return {"message": f"File {filename} deleted"}
