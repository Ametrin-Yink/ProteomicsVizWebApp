"""
Report API routes.

Provides endpoints for HTML report export: weblink generation, listing,
serving static report files, ZIP download, and deletion.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from app.core.config import settings
from app.core.exceptions import SessionNotFoundError
from app.services.report_store import (
    create_report,
    list_reports,
    get_report_dir,
    get_report_metadata,
    delete_report,
)
from app.services.session_manager import SessionManager

logger = logging.getLogger("proteomics")

router = APIRouter()
global_router = APIRouter()


def get_session_manager(request: Request) -> SessionManager:
    return request.app.state.session_manager


# --- Session-scoped route (mounted at /api/sessions) ---

@router.post("/{session_id}/export/weblink")
async def export_weblink(
    session_id: str,
    name: str = Form(...),
    zip: UploadFile = File(...),
    session_manager: SessionManager = Depends(get_session_manager),
):
    """
    Upload a self-contained HTML report ZIP and generate a weblink.

    The ZIP must contain index.html at root and optional assets/ folder.
    """
    # Validate session exists and is completed
    try:
        session = await session_manager.get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.state.value != "completed":
        raise HTTPException(status_code=400, detail="Analysis must be completed before exporting")

    if not name.strip():
        raise HTTPException(status_code=400, detail="Report name is required")

    try:
        zip_data = await zip.read()
        metadata = create_report(
            name=name.strip(),
            session_id=session_id,
            session_name=session.name,
            zip_data=zip_data,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Weblink export failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to create report")

    return {
        "report_id": metadata["report_id"],
        "name": metadata["name"],
        "weblink": f"/reports/{metadata['report_id']}",
        "download_url": f"/api/reports/{metadata['report_id']}/download",
        "created_at": metadata["created_at"],
    }


# --- Global routes (mounted at /api) ---

@global_router.get("/reports")
async def get_reports():
    """List all generated reports across all sessions."""
    reports = list_reports()
    return {"reports": reports}


@global_router.get("/reports/{report_id}")
async def serve_report(report_id: str):
    """Serve the index.html of a report for weblink viewing."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        raise HTTPException(status_code=404, detail="Report not found")
    index_path = report_dir / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Report HTML not found")
    return FileResponse(index_path, media_type="text/html")


@global_router.get("/reports/{report_id}/assets/{path:path}")
async def serve_report_asset(report_id: str, path: str):
    """Serve asset files (JS, JSON) for a report."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        raise HTTPException(status_code=404, detail="Report not found")
    asset_path = report_dir / "assets" / path
    # Security: ensure path stays within report directory
    if not str(asset_path.resolve()).startswith(str(report_dir.resolve())):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not asset_path.exists():
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(asset_path)


@global_router.get("/reports/{report_id}/download")
async def download_report_zip(report_id: str):
    """Download the original ZIP archive of a report."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        raise HTTPException(status_code=404, detail="Report not found")
    zip_path = report_dir / "export.zip"
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="ZIP archive not found")
    metadata = get_report_metadata(report_id)
    filename = f"{metadata['name'].replace(' ', '_')}.zip" if metadata else "report.zip"
    return FileResponse(zip_path, media_type="application/zip", filename=filename)


@global_router.delete("/reports/{report_id}")
async def delete_report_endpoint(report_id: str):
    """Delete a report and all its files."""
    if not delete_report(report_id):
        raise HTTPException(status_code=404, detail="Report not found")
    return {"message": "Report deleted"}
