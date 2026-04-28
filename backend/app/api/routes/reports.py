"""
Report generation API routes.

Provides endpoints for PDF report generation and download.
"""

import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from fastapi.responses import FileResponse, JSONResponse

from app.core.config import settings
from app.core.exceptions import SessionNotFoundError, ProcessingError
from app.models.session import Session
from app.models.analysis import ReportRequest, ReportStatus
from app.services.report_generator import report_generator
from app.services.session_manager import SessionManager

logger = logging.getLogger("proteomics")

router = APIRouter()


def get_session_manager(request: Request) -> SessionManager:
    """Get session manager from app state."""
    return request.app.state.session_manager


@router.post("/{session_id}/reports/generate", response_model=ReportStatus)
async def generate_report(
    session_id: str,
    report_request: Optional[ReportRequest] = None,
    background_tasks: BackgroundTasks = None,
    session_manager: SessionManager = Depends(get_session_manager)
):
    """
    Generate PDF report for a session.
    
    Args:
        session_id: Session ID
        report_request: Optional report configuration
        background_tasks: Background tasks for async processing
        session_manager: Session manager instance
        
    Returns:
        ReportStatus with generation status and download URL
    """
    try:
        # Get session
        session = await session_manager.get_session(session_id)
        
        # Check if analysis is complete
        if session.state.value != "completed":
            raise HTTPException(
                status_code=400,
                detail="Analysis must be completed before generating report"
            )
        
        # Use default report request if not provided
        if report_request is None:
            report_request = ReportRequest()
        
        # Generate report ID
        import uuid
        report_id = str(uuid.uuid4())
        
        # Determine output path
        results_dir = settings.sessions_dir / session_id / "results"
        results_dir.mkdir(parents=True, exist_ok=True)
        output_path = results_dir / f"report_{report_id}.pdf"
        
        # Create initial status
        status = ReportStatus(
            report_id=report_id,
            status="generating",
            progress=0
        )
        
        # Generate report (can be async in background)
        try:
            # Load analysis results
            diff_expression_path = results_dir / "Diff_Expression.tsv"
            protein_abundances_path = results_dir / "Protein_Abundances.tsv"
            # Actual file names from the pipeline
            qc_data_path = results_dir / "QC_Results.json"
            gsea_results_path = results_dir / "GSEA_Results.json"
            
            # Generate report
            generated_path = await report_generator.generate_report_from_files(
                session=session,
                diff_expression_path=diff_expression_path,
                protein_abundances_path=protein_abundances_path if protein_abundances_path.exists() else None,
                qc_data_path=qc_data_path if qc_data_path.exists() else None,
                gsea_results_path=gsea_results_path if gsea_results_path.exists() else None,
                output_path=output_path,
                report_request=report_request
            )
            
            # Update status
            status.status = "completed"
            status.progress = 100
            status.completed_at = datetime.utcnow()
            status.download_url = f"/api/sessions/{session_id}/reports/{report_id}/download"
            
            logger.info(f"Report generated: {generated_path}")
            
        except Exception as e:
            logger.error(f"Report generation failed: {e}")
            status.status = "failed"
            status.error_message = str(e)
            raise HTTPException(status_code=500, detail=str(e))
        
        return status
        
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except Exception as e:
        logger.error(f"Error generating report: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}/reports/{report_id}/download")
async def download_report(
    session_id: str,
    report_id: str,
    session_manager: SessionManager = Depends(get_session_manager)
):
    """
    Download generated PDF report.
    
    Args:
        session_id: Session ID
        report_id: Report ID
        session_manager: Session manager instance
        
    Returns:
        PDF file response
    """
    try:
        # Verify session exists
        await session_manager.get_session(session_id)
        
        # Find report file
        results_dir = settings.sessions_dir / session_id / "results"
        report_path = results_dir / f"report_{report_id}.pdf"
        
        if not report_path.exists():
            # Try to find any report file
            report_files = list(results_dir.glob("report_*.pdf"))
            if report_files:
                report_path = report_files[0]
            else:
                raise HTTPException(status_code=404, detail="Report not found")
        
        return FileResponse(
            path=report_path,
            media_type="application/pdf",
            filename=f"proteomics_report_{session_id}.pdf"
        )
        
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading report: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}/reports")
async def list_reports(
    session_id: str,
    session_manager: SessionManager = Depends(get_session_manager)
):
    """
    List all reports for a session.
    
    Args:
        session_id: Session ID
        session_manager: Session manager instance
        
    Returns:
        List of report metadata
    """
    try:
        # Verify session exists
        await session_manager.get_session(session_id)
        
        # Find all report files
        results_dir = settings.sessions_dir / session_id / "results"
        report_files = list(results_dir.glob("report_*.pdf"))
        
        reports = []
        for report_file in report_files:
            # Extract report ID from filename
            report_id = report_file.stem.replace("report_", "")
            
            # Get file stats
            stat = report_file.stat()
            
            reports.append({
                "report_id": report_id,
                "filename": report_file.name,
                "size_mb": round(stat.st_size / (1024 * 1024), 2),
                "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                "download_url": f"/api/sessions/{session_id}/reports/{report_id}/download"
            })
        
        # Sort by creation time (newest first)
        reports.sort(key=lambda x: x["created_at"], reverse=True)
        
        return {"reports": reports}
        
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except Exception as e:
        logger.error(f"Error listing reports: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@router.delete("/{session_id}/reports/{report_id}")
async def delete_report(
    session_id: str,
    report_id: str,
    session_manager: SessionManager = Depends(get_session_manager)
):
    """
    Delete a report.
    
    Args:
        session_id: Session ID
        report_id: Report ID
        session_manager: Session manager instance
        
    Returns:
        Success message
    """
    try:
        # Verify session exists
        await session_manager.get_session(session_id)
        
        # Find report file
        results_dir = settings.sessions_dir / session_id / "results"
        report_path = results_dir / f"report_{report_id}.pdf"
        
        if not report_path.exists():
            raise HTTPException(status_code=404, detail="Report not found")
        
        # Delete file
        report_path.unlink()
        
        logger.info(f"Report deleted: {report_path}")
        
        return {"message": "Report deleted successfully"}
        
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting report: {e}")
        raise HTTPException(status_code=500, detail=str(e))
