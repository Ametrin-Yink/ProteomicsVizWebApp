"""
JSON-based session persistence layer.

Provides CRUD operations for session data stored as JSON files.
"""

import asyncio
import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path

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

    # Class-level lock shared across all instances to prevent concurrent writes
    _save_lock: asyncio.Lock = None  # type: ignore

    def __init__(self, sessions_dir: Path | None = None):
        """
        Initialize session store.

        Args:
            sessions_dir: Directory for session storage (defaults to settings)
        """
        self.sessions_dir = sessions_dir or settings.sessions_dir
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

    def _get_session_dir(self, session_id: str) -> Path:
        """Get session directory path. Validates session_id as UUID to prevent path traversal."""
        import re

        if not re.match(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            session_id,
            re.IGNORECASE,
        ):
            raise SessionNotFoundError(
                message=f"Session not found: {session_id}",
                details={"session_id": session_id},
            )
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
                details={"session_id": session_id},
            )

        async with aiofiles.open(session_file, encoding="utf-8") as f:
            content = await f.read()

        if not content.strip():
            # File is empty — likely a race condition from a concurrent write.
            # Retry once with a short delay to let the writer finish.
            await asyncio.sleep(0.05)
            async with aiofiles.open(session_file, encoding="utf-8") as f:
                content = await f.read()
            if not content.strip():
                raise SessionNotFoundError(
                    message=f"Session file is empty: {session_id}",
                    details={"session_id": session_id},
                )

        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            logger.warning(f"Corrupted JSON in session {session_id}: {e}")
            raise SessionNotFoundError(
                message=f"Session file is corrupted: {session_id}",
                details={"session_id": session_id, "error": str(e)},
            ) from e

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
        session.updated_at = datetime.now(UTC)

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
                details={"session_id": session_id},
            )

        # Delete all files in session directory
        import shutil

        await asyncio.to_thread(shutil.rmtree, session_dir)

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

        import re

        _uuid_re = re.compile(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            re.IGNORECASE,
        )

        for session_dir in self.sessions_dir.iterdir():
            if not session_dir.is_dir():
                continue
            if not _uuid_re.match(session_dir.name):
                continue
            session_file = session_dir / "session.json"
            if session_file.exists():
                try:
                    async with aiofiles.open(session_file, encoding="utf-8") as f:
                        content = await f.read()
                        data = json.loads(content)
                        sessions.append(Session(**data))
                except Exception as e:
                    logger.warning(
                        f"Failed to load session: {session_dir.name}",
                        extra={"error": str(e)},
                    )

        # Sort by updated_at descending (handle mixed naive/aware datetimes)

        sessions.sort(
            key=lambda s: (
                s.updated_at.replace(tzinfo=UTC)
                if s.updated_at.tzinfo is None
                else s.updated_at
            ),
            reverse=True,
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
        Save session to JSON file using atomic write-to-temp-then-rename.
        This prevents concurrent reads from seeing an empty/truncated file.

        Args:
            session: Session to save
        """
        if SessionStore._save_lock is None:
            SessionStore._save_lock = asyncio.Lock()
        session_file = self._get_session_file(session.id)
        async with SessionStore._save_lock:
            # Write to a temporary file in the same directory (ensures same filesystem
            # for atomic rename), then replace the target file. This way, readers
            # never see a truncated file.
            tmp_path = session_file.with_suffix(".tmp")
            async with aiofiles.open(tmp_path, "w", encoding="utf-8") as f:
                await f.write(session.model_dump_json(indent=2))
                await f.flush()
            await asyncio.to_thread(os.replace, tmp_path, session_file)

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

        async with aiofiles.open(pipeline_file, "w", encoding="utf-8") as f:
            await f.write(json.dumps(state, indent=2, default=str))

    async def load_pipeline_state(self, session_id: str) -> dict | None:
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

        async with aiofiles.open(pipeline_file, encoding="utf-8") as f:
            content = await f.read()

        if not content.strip():
            # Retry once for race condition with concurrent write
            await asyncio.sleep(0.05)
            async with aiofiles.open(pipeline_file, encoding="utf-8") as f:
                content = await f.read()
            if not content.strip():
                logger.warning(f"Pipeline state file is empty: {session_id}")
                return None

        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            logger.warning(f"Pipeline state corrupted for {session_id}: {e}")
            return None

    async def update_session_state(
        self, session_id: str, state: SessionState, error_message: str | None = None
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

        cutoff = datetime.now(UTC) - timedelta(days=max_age_days)
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
                        extra={"error": str(e)},
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
                        async with aiofiles.open(session_file, encoding="utf-8") as f:
                            content = await f.read()
                            if not content.strip():
                                logger.warning(f"Empty session file: {session_file}")
                                continue
                            data = json.loads(content)
                            session = Session(**data)
                            sessions.append(session)
                            logger.info(f"Loaded existing session: {session.id}")
                except TimeoutError:
                    logger.warning(f"Timeout reading session file: {session_file}")
                    continue
                except json.JSONDecodeError as e:
                    logger.warning(f"Corrupted JSON in {session_file}: {e}")
                    continue
                except Exception as e:
                    logger.warning(
                        f"Failed to load session from {session_dir.name}: {e}"
                    )
                    continue

        logger.info(f"Scanned {len(sessions)} existing sessions")
        return sessions


# Global session store instance
session_store = SessionStore()
