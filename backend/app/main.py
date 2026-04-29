"""
FastAPI main application entry point.

Initializes the FastAPI application with all routers, middleware, and WebSocket support.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import JSONResponse

from app.api.routes import sessions, upload, analysis, processing, visualization, reports, compounds
from app.core.config import settings
from app.core.exceptions import AppException
from app.db.session_store import SessionStore
from app.models.analysis import STEP_DISPLAY_NAMES
from app.services.session_manager import session_manager

logger = logging.getLogger("proteomics")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager with timeout protection."""
    # Startup
    try:
        settings.ensure_directories()
    except Exception as e:
        logger.error(f"Failed to create directories: {e}")
        # Continue anyway - might be permission issue but app can still run

    session_store = SessionStore(settings.sessions_dir)
    app.state.session_store = session_store
    # Use the global session_manager instance
    session_manager.session_store = session_store
    app.state.session_manager = session_manager

    # Scan existing sessions with timeout protection
    # Use asyncio.wait_for to prevent hanging on corrupted files
    try:
        import asyncio
        await asyncio.wait_for(
            app.state.session_manager.scan_existing_sessions(),
            timeout=30.0  # 30 second timeout for session scanning
        )
    except asyncio.TimeoutError:
        logger.warning("Session scanning timed out after 30 seconds - continuing with empty session list")
    except Exception as e:
        logger.warning(f"Session scanning failed: {e} - continuing with empty session list")

    yield

    # Shutdown
    pass


# Initialize FastAPI app
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Proteomics Visualization Web App API",
    lifespan=lifespan,
)

# CORS middleware - MUST be added before any routes
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["Content-Type"],
    max_age=3600,
)


# Exception handler for AppException hierarchy
@app.exception_handler(AppException)
async def app_exception_handler(request, exc: AppException):
    """Handle application exceptions."""
    response = JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details
            }
        },
    )
    # Add CORS headers to exception responses
    response.headers["Access-Control-Allow-Origin"] = "http://localhost:3000"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


# Exception handler for HTTPException (includes 409 Conflict)
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    """Handle HTTP exceptions including 409 Conflict."""
    response = JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )
    # Add CORS headers to exception responses
    response.headers["Access-Control-Allow-Origin"] = "http://localhost:3000"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


# Health check endpoint - responds immediately without scanning sessions
@app.get("/health")
async def health_check():
    """Health check endpoint - responds immediately even if sessions aren't loaded."""
    return {
        "status": "healthy",
        "version": settings.app_version,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


# Explicit CORS preflight handler for all routes
@app.options("/{path:path}")
async def handle_cors_preflight(path: str):
    """Handle CORS preflight requests explicitly."""
    from fastapi.responses import Response
    response = Response()
    response.headers["Access-Control-Allow-Origin"] = "http://localhost:3000"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Max-Age"] = "3600"
    return response


# Include routers
# IMPORTANT: Order matters! More specific routes must come before generic ones
# Processing router has /{session_id}/process which must match before sessions router's /{session_id}
app.include_router(processing.router, prefix="/api/sessions", tags=["processing"])
app.include_router(upload.router, prefix="/api/sessions", tags=["upload"])
app.include_router(analysis.router, prefix="/api/sessions", tags=["analysis"])
app.include_router(visualization.router, prefix="/api/sessions", tags=["visualization"])
app.include_router(reports.router, prefix="/api/sessions", tags=["reports"])
app.include_router(compounds.router, prefix="/api/sessions", tags=["compounds"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])

# Organisms endpoint
@app.get("/api/organisms")
async def list_organisms():
    """List available organisms from protein database."""
    from app.services.organism_scanner import OrganismScanner
    scanner = OrganismScanner(settings.protein_database_dir)
    organisms = scanner.scan()
    return {"organisms": organisms}


# WebSocket endpoint for real-time updates
@app.websocket("/ws/sessions/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for session real-time updates."""
    logger.info(f"WebSocket connection requested for session {session_id}")

    try:
        await websocket.accept()
    except Exception as e:
        logger.error(f"WebSocket accept failed for session {session_id}: {e}", exc_info=True)
        return

    try:
        session_manager = app.state.session_manager
        if not session_manager:
            logger.error(f"session_manager not initialized for session {session_id}")
            await websocket.close(code=1011, reason="Server not ready")
            return

        # Register connection
        await session_manager.register_websocket(session_id, websocket)

        # Keep connection alive and handle messages
        while True:
            try:
                # Receive message (ping/keepalive from client)
                # Use a longer timeout (60s) to allow for processing time
                # Frontend sends ping every 30s, so 60s gives enough buffer
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=60
                )
                logger.debug(f"Received message from session {session_id}: {data[:100]}...")

                # Handle ping
                if data == "ping" or (data.startswith('{') and '"type":"ping"' in data.replace(' ', '')):
                    await websocket.send_text('{"type": "pong"}')
                    continue

                # Handle subscribe message from frontend
                if data.startswith('{') and '"type":"subscribe"' in data.replace(' ', ''):
                    # Subscribe message received, connection is ready

                    # Send current processing state if available
                    try:
                        session_store = app.state.session_store
                        pipeline_state = await session_store.load_pipeline_state(session_id)
                        if pipeline_state:
                            # Send historical logs first
                            logs = pipeline_state.get("logs", [])
                            logger.info(f"Sending {len(logs)} historical logs to session {session_id}")
                            for log in logs:
                                try:
                                    log_msg = {
                                        "type": "log",
                                        "payload": log
                                    }
                                    await websocket.send_json(log_msg)
                                except Exception as e:
                                    logger.warning(f"Error sending log to session {session_id}: {e}")
                                    break

                            # Send current step progress
                            current_step = pipeline_state.get("current_step", 0)
                            completed_steps = pipeline_state.get("completed_steps", [])

                            # Send progress for completed steps
                            for step_num in completed_steps:
                                try:
                                    step_display_name = STEP_DISPLAY_NAMES.get(step_num, f"Step {step_num}")
                                    progress_msg = {
                                        "type": "progress",
                                        "payload": {
                                            "step": step_num,
                                            "step_name": step_display_name,
                                            "status": "completed",
                                            "progress": 100,
                                            "message": f"{step_display_name} completed",
                                            "overall_progress": int((len(completed_steps) / 9) * 100)
                                        }
                                    }
                                    await websocket.send_json(progress_msg)
                                except Exception as e:
                                    logger.warning(f"Error sending step {step_num} to session {session_id}: {e}")
                                    break

                            # Send completion message if pipeline is done
                            if pipeline_state.get("completed_at"):
                                complete_msg = {
                                    "type": "complete",
                                    "payload": {
                                        "session_id": session_id,
                                        "outputs": pipeline_state.get("outputs", {}),
                                        "duration": 0
                                    }
                                }
                                await websocket.send_json(complete_msg)
                                logger.info(f"Sent completion message to session {session_id}")
                    except Exception as e:
                        logger.warning(f"Error sending current state for session {session_id}: {e}")

                    continue

                # Handle pong from frontend
                if data.startswith('{') and '"type":"pong"' in data.replace(' ', ''):
                    continue

            except asyncio.TimeoutError:
                # Send ping to check connection
                try:
                    await websocket.send_text('{"type": "ping"}')
                except Exception as e:
                    logger.debug(f"Failed to send ping to session {session_id}: {e}")
                    break
            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected for session {session_id}")
                break
            except Exception as e:
                logger.warning(f"WebSocket receive error for session {session_id}: {type(e).__name__}: {e}")
                break

    except Exception as e:
        logger.error(f"WebSocket error for session {session_id}: {e}", exc_info=True)
    finally:
        logger.info(f"WebSocket connection closing for session {session_id}")
        # Unregister connection
        try:
            await session_manager.unregister_websocket(session_id, websocket)
        except Exception as e:
            logger.warning(f"Error unregistering WebSocket for session {session_id}: {e}")
        try:
            await websocket.close()
        except Exception as e:
            logger.warning(f"Error closing WebSocket for session {session_id}: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
