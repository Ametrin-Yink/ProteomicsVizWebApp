"""Shared FastAPI dependencies."""

from app.core.config import settings
from app.db.session_store import SessionStore


def get_session_store() -> SessionStore:
    """Retrieve the session store from app state."""
    store = SessionStore(settings.sessions_dir)
    return store
