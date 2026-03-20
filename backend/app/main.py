"""
FastAPI main application entry point.

Initializes the FastAPI application with all routers, middleware, and WebSocket support.
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import sessions, upload, analysis, processing, visualization, reports, compounds
from app.core.config import settings
from app.core.exceptions import ProteomicsException, AppException
from app.db.session_store import SessionStore
from app.services.session_manager import SessionManager

logger = logging.getLogger("proteomics")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Startup
    settings.ensure_directories()
    session_store = SessionStore(settings.sessions_dir)
    app.state.session_manager = SessionManager(session_store)
    app.state.session_store = session_store
    
    # Scan existing sessions
    await app.state.session_manager.scan_existing_sessions()
    
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
    expose_headers=["*"],
    max_age=3600,
)


# Exception handler
@app.exception_handler(ProteomicsException)
async def proteomics_exception_handler(request, exc: ProteomicsException):
    """Handle custom proteomics exceptions."""
    response = JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.message, "code": exc.code},
    )
    # Add CORS headers to exception responses
    response.headers["Access-Control-Allow-Origin"] = "http://localhost:3000"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


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


# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "version": settings.app_version}


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
    print(f"WebSocket connection requested for session {session_id}", flush=True)
    await websocket.accept()
    print(f"WebSocket connection accepted for session {session_id}", flush=True)
    
    session_manager = app.state.session_manager
    
    try:
        print(f"Got session_manager for session {session_id}", flush=True)
        
        # Register connection
        await session_manager.register_websocket(session_id, websocket)
        print(f"WebSocket registered for session {session_id}", flush=True)
        
        # Keep connection alive and handle messages
        print(f"Entering WebSocket message loop for session {session_id}", flush=True)
        while True:
            try:
                # Receive message (ping/keepalive from client)
                print(f"Waiting for message from session {session_id}...", flush=True)
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=settings.websocket_ping_interval
                )
                print(f"Received message from session {session_id}: {data[:100]}...", flush=True)
                
                # Handle ping
                if data == "ping" or (data.startswith('{') and '"type":"ping"' in data.replace(' ', '')):
                    print(f"Sending pong to session {session_id}", flush=True)
                    await websocket.send_text('{"type": "pong"}')
                    print(f"Pong sent to session {session_id}", flush=True)
                    continue
                
                # Handle subscribe message from frontend
                if data.startswith('{') and '"type":"subscribe"' in data.replace(' ', ''):
                    # Subscribe message received, connection is ready
                    print(f"Subscribe message received for session {session_id}", flush=True)
                    
                    # Send current processing state if available
                    try:
                        session_store = app.state.session_store
                        pipeline_state = await session_store.load_pipeline_state(session_id)
                        if pipeline_state:
                            # Send current step progress
                            current_step = pipeline_state.get("current_step", 0)
                            completed_steps = pipeline_state.get("completed_steps", [])
                            
                            # Send progress for completed steps
                            print(f"Sending {len(completed_steps)} completed steps to session {session_id}: {completed_steps}", flush=True)
                            for step_num in completed_steps:
                                try:
                                    progress_msg = {
                                        "type": "progress",
                                        "payload": {
                                            "step": step_num,
                                            "step_name": f"Step {step_num}",
                                            "status": "completed",
                                            "progress": 100,
                                            "message": f"Step {step_num} completed",
                                            "overall_progress": int((len(completed_steps) / 9) * 100)
                                        }
                                    }
                                    await websocket.send_json(progress_msg)
                                    print(f"Sent progress for completed step {step_num} to session {session_id}", flush=True)
                                except Exception as e:
                                    print(f"Error sending step {step_num} to session {session_id}: {e}", flush=True)
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
                                print(f"Sent completion message to session {session_id}", flush=True)
                    except Exception as e:
                        print(f"Error sending current state for session {session_id}: {e}", flush=True)
                    
                    continue
                
                # Handle pong from frontend
                if data.startswith('{') and '"type":"pong"' in data.replace(' ', ''):
                    print(f"Pong received from session {session_id}", flush=True)
                    continue
                    
            except asyncio.TimeoutError:
                # Send ping to check connection
                print(f"WebSocket timeout for session {session_id}, sending ping", flush=True)
                try:
                    await websocket.send_text('{"type": "ping"}')
                    print(f"Ping sent to session {session_id}", flush=True)
                except Exception as e:
                    print(f"Failed to send ping to session {session_id}: {e}", flush=True)
                    break
            except WebSocketDisconnect:
                print(f"WebSocket disconnected for session {session_id}", flush=True)
                break
            except Exception as e:
                print(f"WebSocket receive error for session {session_id}: {type(e).__name__}: {e}", flush=True)
                break
                
    except Exception as e:
        print(f"WebSocket outer error for session {session_id}: {type(e).__name__}: {e}", flush=True)
        logger.error(f"WebSocket error for session {session_id}: {e}", exc_info=True)
    finally:
        print(f"WebSocket connection closing for session {session_id}", flush=True)
        logger.info(f"WebSocket connection closing for session {session_id}")
        # Unregister connection
        try:
            await session_manager.unregister_websocket(session_id, websocket)
        except Exception as e:
            print(f"Error unregistering WebSocket for session {session_id}: {e}", flush=True)
        try:
            await websocket.close()
        except Exception as e:
            print(f"Error closing WebSocket for session {session_id}: {e}", flush=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
