"""
JSON-based session persistence layer.

Provides CRUD operations for session data stored as JSON files.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiofiles

from app.core.config import settings
from app.core.exceptions import SessionNotFoundError
from app.models.session import Session, SessionState

logger = logging.getLogger("proteomics")


class SessionStore:
    """
    JSON-based session storage.
    
    Stores sessions as JSON files in the sessions directory.
    Each session has its own subdirectory: sessions/{session_id}/
    """
    
    def __init__(self, sessions_dir: Optional[Path] = None):
        """
        Initialize session store.
        
        Args:
            sessions_dir: Directory for session storage (defaults to settings)
        """
        self.sessions_dir = sessions_dir or settings.sessions_dir
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        self._save_lock = asyncio.Lock()
    
    def _get_session_dir(self, session_id: str) -> Path:
        """Get session directory path."""
        return self.sessions_dir / session_id
    
    def _get_session_file(self, session_id: str) -> Path:
        """Get session JSON file path."""
        return self._get_session_dir(session_id) / "session.json"
    
    def _get_pipeline_file(self, session_id: str) -> Path:
        """Get pipeline state JSON file path."""
        return self._get_session_dir(session_id) / "pipeline_state.json"
    
    def _ensure_session_dir(self, session_id: str) -> Path:
        """Ensure session directory exists."""
        session_dir = self._get_session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        return session_dir
    
    async def create(self, session: Session) -> Session:
        """
        Create a new session.
        
        Args:
            session: Session to create
            
        Returns:
            Created session
        """
        self._ensure_session_dir(session.id)
        await self._save_session(session)
        
        logger.info(f"Session created: {session.id}", extra={"session_id": session.id})
        return session
    
    async def get(self, session_id: str) -> Session:
        """
        Get session by ID.
        
        Args:
            session_id: Session ID
            
        Returns:
            Session object
            
        Raises:
            SessionNotFoundError: If session doesn't exist
        """
        session_file = self._get_session_file(session_id)
        
        if not session_file.exists():
            raise SessionNotFoundError(
                message=f"Session not found: {session_id}",
                details={"session_id": session_id}
            )
        
        async with aiofiles.open(session_file, 'r', encoding='utf-8') as f:
            content = await f.read()
            data = json.loads(content)
        
        return Session(**data)
    
    async def update(self, session: Session) -> Session:
        """
        Update existing session.
        
        Args:
            session: Session to update
            
        Returns:
            Updated session
            
        Raises:
            SessionNotFoundError: If session doesn't exist
        """
        # Verify session exists
        await self.get(session.id)
        
        # Update timestamp
        session.updated_at = datetime.now(timezone.utc)
        
        await self._save_session(session)
        
        logger.info(f"Session updated: {session.id}", extra={"session_id": session.id})
        return session
    
    async def save(self, session: Session) -> Session:
        """
        Save session (alias for update).
        
        Args:
            session: Session to save
            
        Returns:
            Saved session
        """
        return await self.update(session)
    
    async def delete(self, session_id: str) -> None:
        """
        Delete session.
        
        Args:
            session_id: Session ID to delete
            
        Raises:
            SessionNotFoundError: If session doesn't exist
        """
        session_dir = self._get_session_dir(session_id)
        
        if not session_dir.exists():
            raise SessionNotFoundError(
                message=f"Session not found: {session_id}",
                details={"session_id": session_id}
            )
        
        # Delete all files in session directory
        import shutil
        shutil.rmtree(session_dir)
        
        logger.info(f"Session deleted: {session_id}", extra={"session_id": session_id})
    
    async def list_all(self) -> list[Session]:
        """
        List all sessions.
        
        Returns:
            List of all sessions
        """
        sessions = []
        
        if not self.sessions_dir.exists():
            return sessions
        
        for session_dir in self.sessions_dir.iterdir():
            if session_dir.is_dir():
                session_file = session_dir / "session.json"
                if session_file.exists():
                    try:
                        async with aiofiles.open(session_file, 'r', encoding='utf-8') as f:
                            content = await f.read()
                            data = json.loads(content)
                            sessions.append(Session(**data))
                    except Exception as e:
                        logger.warning(
                            f"Failed to load session: {session_dir.name}",
                            extra={"error": str(e)}
                        )
        
        # Sort by updated_at descending (handle mixed naive/aware datetimes)
        from datetime import timezone as tz
        sessions.sort(
            key=lambda s: s.updated_at.replace(tzinfo=tz.utc) if s.updated_at.tzinfo is None else s.updated_at,
            reverse=True
        )
        
        return sessions
    
    async def exists(self, session_id: str) -> bool:
        """
        Check if session exists.
        
        Args:
            session_id: Session ID to check
            
        Returns:
            True if session exists
        """
        session_file = self._get_session_file(session_id)
        return session_file.exists()
    
    async def _save_session(self, session: Session) -> None:
        """
        Save session to JSON file. Thread-safe via asyncio lock.

        Args:
            session: Session to save
        """
        session_file = self._get_session_file(session.id)
        async with self._save_lock:
            async with aiofiles.open(session_file, 'w', encoding='utf-8') as f:
                await f.write(session.model_dump_json(indent=2))
    
    def get_session_data_dir(self, session_id: str) -> Path:
        """
        Get data directory for a session.
        
        Args:
            session_id: Session ID
            
        Returns:
            Path to session data directory
        """
        data_dir = self._get_session_dir(session_id) / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir
    
    def get_session_uploads_dir(self, session_id: str) -> Path:
        """
        Get uploads directory for a session.
        
        Args:
            session_id: Session ID
            
        Returns:
            Path to session uploads directory
        """
        uploads_dir = self._get_session_dir(session_id) / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        return uploads_dir
    
    def get_session_results_dir(self, session_id: str) -> Path:
        """
        Get results directory for a session.
        
        Args:
            session_id: Session ID
            
        Returns:
            Path to session results directory
        """
        results_dir = self._get_session_dir(session_id) / "results"
        results_dir.mkdir(parents=True, exist_ok=True)
        return results_dir
    
    async def save_pipeline_state(self, session_id: str, state: dict) -> None:
        """
        Save pipeline state.
        
        Args:
            session_id: Session ID
            state: Pipeline state dictionary
        """
        self._ensure_session_dir(session_id)
        pipeline_file = self._get_pipeline_file(session_id)
        
        async with aiofiles.open(pipeline_file, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(state, indent=2, default=str))
    
    async def load_pipeline_state(self, session_id: str) -> Optional[dict]:
        """
        Load pipeline state.
        
        Args:
            session_id: Session ID
            
        Returns:
            Pipeline state dictionary or None if not found
        """
        pipeline_file = self._get_pipeline_file(session_id)
        
        if not pipeline_file.exists():
            return None
        
        async with aiofiles.open(pipeline_file, 'r', encoding='utf-8') as f:
            content = await f.read()
            return json.loads(content)
    
    async def update_session_state(
        self,
        session_id: str,
        state: SessionState,
        error_message: Optional[str] = None
    ) -> Session:
        """
        Update session state.
        
        Args:
            session_id: Session ID
            state: New session state
            error_message: Optional error message
            
        Returns:
            Updated session
        """
        session = await self.get(session_id)
        session.state = state
        if error_message:
            session.error_message = error_message
        return await self.update(session)
    
    async def cleanup_old_sessions(self, max_age_days: int = 30) -> int:
        """
        Clean up sessions older than specified days.
        
        Args:
            max_age_days: Maximum age in days
            
        Returns:
            Number of sessions cleaned up
        """
        from datetime import timedelta
        
        cutoff = datetime.utcnow() - timedelta(days=max_age_days)
        sessions = await self.list_all()
        
        cleaned = 0
        for session in sessions:
            if session.updated_at < cutoff:
                try:
                    await self.delete(session.id)
                    cleaned += 1
                except Exception as e:
                    logger.error(
                        f"Failed to delete old session: {session.id}",
                        extra={"error": str(e)}
                    )
        
        logger.info(f"Cleaned up {cleaned} old sessions")
        return cleaned
    
    async def scan_existing_sessions(self) -> list[Session]:
        """
        Scan for existing sessions in the sessions directory.
        Loads all valid session files found.
        Skips corrupted files and continues scanning.

        Returns:
            List of loaded sessions
        """
        import asyncio
        sessions = []

        if not self.sessions_dir.exists():
            logger.info("Sessions directory does not exist yet, creating...")
            self.sessions_dir.mkdir(parents=True, exist_ok=True)
            return sessions

        session_dirs = [d for d in self.sessions_dir.iterdir() if d.is_dir()]
        logger.info(f"Found {len(session_dirs)} session directories to scan")

        for session_dir in session_dirs:
            session_file = session_dir / "session.json"
            if session_file.exists():
                try:
                    # Add timeout for each file read to prevent hanging
                    async with asyncio.timeout(5.0):  # 5 second timeout per file
                        async with aiofiles.open(session_file, 'r', encoding='utf-8') as f:
                            content = await f.read()
                            if not content.strip():
                                logger.warning(f"Empty session file: {session_file}")
                                continue
                            data = json.loads(content)
                            session = Session(**data)
                            sessions.append(session)
                            logger.info(f"Loaded existing session: {session.id}")
                except asyncio.TimeoutError:
                    logger.warning(f"Timeout reading session file: {session_file}")
                    continue
                except json.JSONDecodeError as e:
                    logger.warning(f"Corrupted JSON in {session_file}: {e}")
                    continue
                except Exception as e:
                    logger.warning(f"Failed to load session from {session_dir.name}: {e}")
                    continue

        logger.info(f"Scanned {len(sessions)} existing sessions")
        return sessions


# Global session store instance
session_store = SessionStore()
