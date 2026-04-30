"""
Sessions API routes.

CRUD operations for analysis sessions.
"""

import uuid
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status

from app.models.session import (
    Session, SessionCreate, SessionUpdate, SessionSummary,
    SessionState, SessionConfig, SessionFiles,
    VisualizationStateUpdate,
)
from app.api.deps import get_session_store
from app.db.session_store import SessionStore

router = APIRouter()


@router.post("", response_model=Session, status_code=status.HTTP_201_CREATED)
async def create_session(
    data: SessionCreate,
    store: SessionStore = Depends(get_session_store)
):
    """Create a new analysis session."""
    session = Session(
        id=str(uuid.uuid4()),
        name=data.name,
        template=data.template,
        state=SessionState.CREATED,
        config=None,
        files=SessionFiles(),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    
    await store.create(session)
    return session


@router.get("", response_model=List[SessionSummary])
async def list_sessions(store: SessionStore = Depends(get_session_store)):
    """List all sessions."""
    sessions = await store.list_all()
    return [
        SessionSummary(
            id=s.id,
            name=s.name,
            state=s.state,
            created_at=s.created_at,
            updated_at=s.updated_at,
            has_results=s.state == SessionState.COMPLETED
        )
        for s in sessions
    ]


@router.get("/{session_id}", response_model=Session)
async def get_session(
    session_id: str,
    store: SessionStore = Depends(get_session_store)
):
    """Get a specific session."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    return session


@router.put("/{session_id}", response_model=Session)
async def update_session(
    session_id: str,
    data: SessionUpdate,
    store: SessionStore = Depends(get_session_store)
):
    """Update a session."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    
    # Update fields
    if data.name is not None:
        session.name = data.name
    if data.config is not None:
        session.config = data.config
    
    await store.update(session)
    return session


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: str,
    store: SessionStore = Depends(get_session_store)
):
    """Delete a session and all its data."""
    try:
        await store.delete(session_id)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    return None


@router.put("/{session_id}/config", response_model=Session)
@router.post("/{session_id}/config", response_model=Session)
async def update_session_config(
    session_id: str,
    config: SessionConfig,
    store: SessionStore = Depends(get_session_store)
):
    """Update session configuration."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )
    
    # Update session
    session.config = config
    session.state = SessionState.CONFIGURING
    await store.update(session)
    
    return session


@router.patch("/{session_id}/visualization-state", response_model=Session)
async def update_visualization_state(
    session_id: str,
    data: VisualizationStateUpdate,
    store: SessionStore = Depends(get_session_store)
):
    """Update visualization state (markers and/or volcano filters) for a session."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )

    if data.markers is not None:
        session.markers = data.markers
    if data.volcano_filters is not None:
        session.volcano_filters = data.volcano_filters

    await store.update(session)
    return session


