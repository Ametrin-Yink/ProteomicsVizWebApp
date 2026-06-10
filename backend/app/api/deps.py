"""Shared FastAPI dependencies."""

from fastapi import Request

from app.db.session_store import SessionStore


def get_session_store(request: Request) -> SessionStore:
    """Retrieve the singleton session store from app state."""
    return request.app.state.session_store
