"""
File upload API routes.

Handles proteomics and compound file uploads with validation.
"""

import logging
from pathlib import Path
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, status
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.exceptions import ValidationError
from app.db.session_store import SessionStore
from app.models.session import FileInfo, ProteomicsFileInfo
from app.utils.file_parser import parse_psm_filename
from app.utils.file_parser import FileParser
from app.services.compound_service import CompoundService

router = APIRouter()
logger = logging.getLogger("proteomics")


def get_session_store() -> SessionStore:
    """Dependency to get session store."""
    return SessionStore(settings.sessions_dir)


@router.post("/{session_id}/upload/proteomics")
async def upload_proteomics_files(
    session_id: str,
    files: list[UploadFile] = File(...),
    store: SessionStore = Depends(get_session_store)
):
    """Upload proteomics CSV files."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
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
                filename=file.filename,
                content=content,
                session_dir=session_uploads_dir
            )
            uploaded_files.append(file_info)
        except Exception as e:
            import traceback
            logger.error(f"Upload error for {file.filename}: {traceback.format_exc()}")
            raise ValidationError(message=f"Error parsing {file.filename}: {str(e)}", details={"traceback": traceback.format_exc()})
    
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
            condition=parsed.condition,
            replicate=parsed.replicate
        )
        session.files.proteomics.append(proteomics_file)

        # Build frontend-compatible response with parsed metadata
        response_files.append({
            "filename": file_metadata.original_filename,
            "size": file_metadata.size,
            "experiment": parsed.experiment,
            "condition": parsed.condition,
            "replicate": parsed.replicate,
            "columns": [],
        })

    await store.save(session)

    return {
        "message": f"Successfully uploaded {len(uploaded_files)} files",
        "files": response_files
    }


@router.post("/{session_id}/upload/compound")
async def upload_compound_file(
    session_id: str,
    file: UploadFile = File(...),
    store: SessionStore = Depends(get_session_store)
):
    """Upload compound CSV file."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    
    # Check file size
    content = await file.read()
    if len(content) > settings.max_upload_size_bytes:
        raise ValidationError(
            message=f"File exceeds maximum size of {settings.max_upload_size_mb}MB"
        )
    
    # Parse and validate
    parser = FileParser()
    try:
        file_info = await parser.parse_compound_file(
            filename=file.filename or "compound.csv",
            content=content,
            session_dir=Path(settings.sessions_dir) / session_id
        )
    except Exception as e:
        raise ValidationError(message=f"Error parsing compound file: {str(e)}")
    
    # Parse compounds using CompoundService
    compound_service = CompoundService()
    try:
        compounds_data = compound_service.parse_compound_csv(Path(file_info.path))
        compounds_list = [
            {
                "corp_id": c.corp_id,
                "smiles": c.smiles
            }
            for c in compounds_data.values()
        ]
    except Exception as e:
        logger = logging.getLogger("proteomics")
        logger.error(f"Error parsing compounds: {e}")
        compounds_list = []
    
    # Prepare response with compounds
    response_data = {
        "filename": file_info.original_filename or file_info.filename,
        "size": file_info.size,
        "compounds": compounds_list
    }
    
    # Update session with compound file info
    session.files.compound = FileInfo(
        filename=file_info.filename,
        original_filename=file_info.original_filename or file_info.filename,
        size=file_info.size,
        uploaded_at=file_info.uploaded_at
    )
    await store.save(session)
    
    return {
        "message": "Successfully uploaded compound file",
        "file": response_data
    }


@router.delete("/{session_id}/files/{file_type}/{filename}")
async def delete_file(
    session_id: str,
    file_type: str,
    filename: str,
    store: SessionStore = Depends(get_session_store)
):
    """Delete a file from a session."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    
    if file_type == "proteomics":
        session.files.proteomics = [
            f for f in session.files.proteomics if f.filename != filename
        ]
    elif file_type == "compound":
        session.files.compound = None
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type: {file_type}"
        )
    
    await store.save(session)
    
    return {"message": f"File {filename} deleted"}
