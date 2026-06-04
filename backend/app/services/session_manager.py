"""
Session management service.

Provides high-level operations for session lifecycle management.
"""

import logging
from datetime import UTC, datetime
from pathlib import Path

from fastapi import WebSocket

from app.db.session_store import SessionStore, session_store
from app.models.session import (
    Session,
    SessionConfig,
    SessionCreate,
    SessionState,
    SessionUpdate,
)
from app.utils.helpers import generate_uuid
from app.utils.validators import validate_session_name

logger = logging.getLogger("proteomics")


class SessionManager:
    """
    High-level session management service.

    Coordinates between the session store and business logic.
    """

    def __init__(self, store: SessionStore | None = None):
        """
        Initialize session manager.

        Args:
            store: Session store instance (defaults to global)
        """
        self.store = store or session_store
        self._websocket_connections: dict[str, list[WebSocket]] = {}

    async def create_session(self, data: SessionCreate) -> Session:
        """
        Create a new session.

        Args:
            data: Session creation data

        Returns:
            Created session
        """
        # Validate name
        validated_name = validate_session_name(data.name)

        # Create session
        session = Session(
            id=generate_uuid(),
            name=validated_name,
            template=data.template,
            state=SessionState.CREATED,
        )

        # Persist session
        await self.store.create(session)

        logger.info(
            f"Session created: {session.id}",
            extra={"session_id": session.id, "name": session.name},
        )

        return session

    async def get_session(self, session_id: str) -> Session:
        """
        Get session by ID.

        Args:
            session_id: Session ID

        Returns:
            Session object

        Raises:
            SessionNotFoundError: If session doesn't exist
        """
        return await self.store.get(session_id)

    async def list_sessions(self) -> list[Session]:
        """
        List all sessions.

        Returns:
            List of sessions sorted by updated_at descending
        """
        return await self.store.list_all()

    async def update_session(self, session_id: str, data: SessionUpdate) -> Session:
        """
        Update session.

        Args:
            session_id: Session ID
            data: Update data

        Returns:
            Updated session
        """
        session = await self.store.get(session_id)

        if data.name is not None:
            session.name = validate_session_name(data.name)

        if data.config is not None:
            session.config = data.config
            session.state = SessionState.CONFIGURING

        await self.store.update(session)

        logger.info(f"Session updated: {session_id}", extra={"session_id": session_id})

        return session

    async def update_session_config(
        self, session_id: str, config: SessionConfig
    ) -> Session:
        """
        Update session configuration.

        Args:
            session_id: Session ID
            config: Session configuration

        Returns:
            Updated session
        """
        session = await self.store.get(session_id)
        session.config = config
        session.state = SessionState.CONFIGURING

        await self.store.update(session)

        logger.info(
            f"Session config updated: {session_id}",
            extra={"session_id": session_id, "config": config.model_dump()},
        )

        return session

    async def delete_session(self, session_id: str) -> None:
        """
        Delete session.

        Args:
            session_id: Session ID to delete
        """
        await self.store.delete(session_id)

        logger.info(f"Session deleted: {session_id}", extra={"session_id": session_id})

    async def update_session_state(
        self, session_id: str, state: SessionState, error_message: str | None = None
    ) -> Session:
        """
        Update session state.

        Args:
            session_id: Session ID
            state: New state
            error_message: Optional error message

        Returns:
            Updated session
        """
        return await self.store.update_session_state(session_id, state, error_message)

    async def get_uploads_dir(self, session_id: str) -> Path:
        """
        Get uploads directory for a session.

        Args:
            session_id: Session ID

        Returns:
            Path to uploads directory
        """
        return self.store.get_session_uploads_dir(session_id)

    async def get_results_dir(self, session_id: str) -> Path:
        """
        Get results directory for a session.

        Args:
            session_id: Session ID

        Returns:
            Path to results directory
        """
        return self.store.get_session_results_dir(session_id)

    async def get_data_dir(self, session_id: str) -> Path:
        """
        Get data directory for a session.

        Args:
            session_id: Session ID

        Returns:
            Path to data directory
        """
        return self.store.get_session_data_dir(session_id)

    async def scan_existing_sessions(self) -> None:
        """
        Scan for existing sessions in the sessions directory.
        This method is called during application startup.
        Errors are caught and logged to prevent startup failures.
        """
        import asyncio

        logger.info("Scanning for existing sessions...")
        try:
            # Add overall timeout for scanning to prevent hanging
            await asyncio.wait_for(
                self.store.scan_existing_sessions(),
                timeout=60.0,  # 60 second total timeout
            )
            logger.info("Session scan completed")
        except TimeoutError:
            logger.warning("Session scanning timed out after 60 seconds")
        except Exception as e:
            logger.warning(f"Session scan failed (may be first run): {e}")
            # Don't re-raise - allow app to continue with empty session list

    # WebSocket Management Methods

    async def register_websocket(self, session_id: str, websocket: WebSocket) -> None:
        """Register a WebSocket connection for a session.

        Args:
            session_id: Session ID
            websocket: WebSocket connection
        """
        if session_id not in self._websocket_connections:
            self._websocket_connections[session_id] = []
        self._websocket_connections[session_id].append(websocket)
        logger.info(
            f"WebSocket registered for session {session_id}, total connections: {len(self._websocket_connections[session_id])}"
        )

    async def unregister_websocket(self, session_id: str, websocket: WebSocket) -> None:
        """Unregister a WebSocket connection for a session.

        Args:
            session_id: Session ID
            websocket: WebSocket connection
        """
        if session_id in self._websocket_connections:
            if websocket in self._websocket_connections[session_id]:
                self._websocket_connections[session_id].remove(websocket)
                logger.info(
                    f"WebSocket unregistered for session {session_id}, remaining connections: {len(self._websocket_connections[session_id])}"
                )
            if not self._websocket_connections[session_id]:
                del self._websocket_connections[session_id]

    async def send_progress_update(self, session_id: str, progress_data: dict) -> None:
        """Send progress update to all WebSocket connections for a session.

        Args:
            session_id: Session ID
            progress_data: Progress update data
        """
        if session_id not in self._websocket_connections:
            return

        message = {"type": "progress", "payload": progress_data}

        disconnected = []
        for websocket in self._websocket_connections[session_id]:
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send WebSocket message: {e}")
                disconnected.append(websocket)

        # Clean up disconnected websockets
        if disconnected:
            logger.warning(
                f"{len(disconnected)} WebSockets failed to receive progress for session {session_id}"
            )
            for websocket in disconnected:
                await self.unregister_websocket(session_id, websocket)

    async def send_complete_message(
        self, session_id: str, outputs: dict, duration: float
    ) -> None:
        """Send completion message to all WebSocket connections for a session.

        Args:
            session_id: Session ID
            outputs: Output file paths
            duration: Processing duration in seconds
        """
        logger.info(f"Attempting to send completion message for session {session_id}")
        logger.info(
            f"Current WebSocket connections: {list(self._websocket_connections.keys())}"
        )

        if session_id not in self._websocket_connections:
            logger.warning(
                f"No WebSocket connections for session {session_id}, cannot send completion message"
            )
            return

        logger.info(
            f"Found {len(self._websocket_connections[session_id])} WebSocket connections for session {session_id}"
        )

        message = {
            "type": "complete",
            "payload": {
                "session_id": session_id,
                "outputs": outputs,
                "duration": duration,
            },
        }

        disconnected = []
        for websocket in self._websocket_connections[session_id]:
            try:
                await websocket.send_json(message)
                logger.info(f"Sent completion message to session {session_id}")
            except Exception as e:
                logger.warning(f"Failed to send completion message: {e}")
                disconnected.append(websocket)

        # Clean up disconnected websockets
        for websocket in disconnected:
            await self.unregister_websocket(session_id, websocket)

    async def send_log_message(
        self, session_id: str, level: str, message: str, step: int | None = None
    ) -> None:
        """Send log message to all WebSocket connections for a session.

        Args:
            session_id: Session ID
            level: Log level (info, warning, error)
            message: Log message
            step: Optional step number
        """
        if session_id not in self._websocket_connections:
            return

        log_message = {
            "type": "log",
            "payload": {
                "level": level,
                "message": message,
                "timestamp": datetime.now(UTC).isoformat(),
                "step": step,
            },
        }

        disconnected = []
        for websocket in self._websocket_connections[session_id]:
            try:
                await websocket.send_json(log_message)
            except Exception as e:
                logger.warning(f"Failed to send log message: {e}")
                disconnected.append(websocket)

        # Clean up disconnected websockets
        for websocket in disconnected:
            await self.unregister_websocket(session_id, websocket)


# Global session manager instance
session_manager = SessionManager()
