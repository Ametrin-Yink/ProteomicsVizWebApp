"""
Session management service.

Provides high-level operations for session lifecycle management.
"""

import logging
from pathlib import Path
from typing import Optional, Dict, List

from fastapi import WebSocket

from app.core.exceptions import (
    SessionNotFoundError,
    ValidationError,
    InvalidFileFormatError
)
from app.db.session_store import SessionStore, session_store
from app.models.session import (
    Session,
    SessionCreate,
    SessionUpdate,
    SessionConfig,
    SessionFiles,
    SessionState,
    ProteomicsFileInfo,
    FileInfo
)
from app.utils.file_parser import (
    parse_psm_filename,
    parse_psm_csv,
    extract_columns_from_csv,
    get_file_size,
    parse_compound_csv
)
from app.utils.validators import (
    validate_session_name,
    validate_csv_extension,
    validate_psm_filename_pattern,
    validate_file_size
)
from app.utils.helpers import generate_uuid

logger = logging.getLogger("proteomics")


class SessionManager:
    """
    High-level session management service.

    Coordinates between the session store and business logic.
    """

    def __init__(self, store: Optional[SessionStore] = None):
        """
        Initialize session manager.

        Args:
            store: Session store instance (defaults to global)
        """
        self.store = store or session_store
        self._websocket_connections: Dict[str, List[WebSocket]] = {}
    
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
            state=SessionState.CREATED
        )
        
        # Persist session
        await self.store.create(session)
        
        logger.info(
            f"Session created: {session.id}",
            extra={"session_id": session.id, "name": session.name}
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
    
    async def update_session(
        self,
        session_id: str,
        data: SessionUpdate
    ) -> Session:
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
        
        logger.info(
            f"Session updated: {session_id}",
            extra={"session_id": session_id}
        )
        
        return session
    
    async def update_session_config(
        self,
        session_id: str,
        config: SessionConfig
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
            extra={"session_id": session_id, "config": config.model_dump()}
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
    
    async def add_proteomics_file(
        self,
        session_id: str,
        file_path: Path
    ) -> ProteomicsFileInfo:
        """
        Add a proteomics file to a session.
        
        Args:
            session_id: Session ID
            file_path: Path to uploaded file
            
        Returns:
            File info object
        """
        session = await self.store.get(session_id)
        
        # Validate file
        filename = file_path.name
        validate_csv_extension(filename)
        validate_psm_filename_pattern(filename)
        
        file_size = get_file_size(file_path)
        validate_file_size(file_size, filename)
        
        # Parse filename
        parsed = parse_psm_filename(filename)
        
        # Extract columns
        columns = extract_columns_from_csv(file_path)
        
        # Create file info
        file_info = ProteomicsFileInfo(
            filename=filename,
            size=file_size,
            columns=columns,
            experiment=parsed.experiment,
            condition=parsed.condition,
            replicate=parsed.replicate
        )
        
        # Add to session
        if session.files is None:
            session.files = SessionFiles()
        
        session.files.proteomics.append(file_info)
        await self.store.update(session)
        
        logger.info(
            f"Proteomics file added: {filename}",
            extra={
                "session_id": session_id,
                "filename": filename,
                "condition": parsed.condition,
                "replicate": parsed.replicate
            }
        )
        
        return file_info
    
    async def add_compound_file(
        self,
        session_id: str,
        file_path: Path
    ) -> FileInfo:
        """
        Add a compound file to a session.
        
        Args:
            session_id: Session ID
            file_path: Path to uploaded file
            
        Returns:
            File info object
        """
        session = await self.store.get(session_id)
        
        # Validate file
        filename = file_path.name
        validate_csv_extension(filename)
        
        file_size = get_file_size(file_path)
        validate_file_size(file_size, filename)
        
        # Try to parse compound CSV
        try:
            parse_compound_csv(file_path)
        except InvalidFileFormatError:
            raise
        
        # Extract columns
        columns = extract_columns_from_csv(file_path)
        
        # Create file info
        file_info = FileInfo(
            filename=filename,
            size=file_size,
            columns=columns
        )
        
        # Add to session
        if session.files is None:
            session.files = SessionFiles()
        
        session.files.compound = file_info
        await self.store.update(session)
        
        logger.info(
            f"Compound file added: {filename}",
            extra={"session_id": session_id, "filename": filename}
        )
        
        return file_info
    
    async def remove_proteomics_file(
        self,
        session_id: str,
        filename: str
    ) -> Session:
        """
        Remove a proteomics file from a session.
        
        Args:
            session_id: Session ID
            filename: Filename to remove
            
        Returns:
            Updated session
        """
        session = await self.store.get(session_id)
        
        if session.files and session.files.proteomics:
            session.files.proteomics = [
                f for f in session.files.proteomics
                if f.filename != filename
            ]
            await self.store.update(session)
        
        logger.info(
            f"Proteomics file removed: {filename}",
            extra={"session_id": session_id, "filename": filename}
        )
        
        return session
    
    async def remove_compound_file(self, session_id: str) -> Session:
        """
        Remove the compound file from a session.
        
        Args:
            session_id: Session ID
            
        Returns:
            Updated session
        """
        session = await self.store.get(session_id)
        
        if session.files:
            session.files.compound = None
            await self.store.update(session)
        
        logger.info(
            "Compound file removed",
            extra={"session_id": session_id}
        )
        
        return session
    
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
            state: New state
            error_message: Optional error message
            
        Returns:
            Updated session
        """
        return await self.store.update_session_state(
            session_id, state, error_message
        )
    
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
    
    async def is_session_ready_for_processing(self, session_id: str) -> bool:
        """
        Check if session is ready for processing.
        
        Requirements:
        - Has configuration
        - Has at least 2 proteomics files
        - Has at least 2 conditions
        - Has at least 1 replicate per condition
        
        Args:
            session_id: Session ID
            
        Returns:
            True if session is ready
        """
        try:
            session = await self.store.get(session_id)
        except SessionNotFoundError:
            return False
        
        # Check config
        if not session.config:
            return False
        
        # Check files
        if not session.files or not session.files.proteomics:
            return False
        
        # Need at least 2 files
        if len(session.files.proteomics) < 2:
            return False
        
        # Check conditions
        conditions = set(f.condition for f in session.files.proteomics)
        if len(conditions) < 2:
            return False
        
        # Check that treatment and control are present
        if session.config.treatment not in conditions:
            return False
        if session.config.control not in conditions:
            return False
        
        return True
    
    async def validate_session_for_processing(self, session_id: str) -> None:
        """
        Validate session is ready for processing.
        
        Args:
            session_id: Session ID
            
        Raises:
            ValidationError: If session is not ready
        """
        session = await self.store.get(session_id)
        
        if not session.config:
            raise ValidationError(
                message="Session configuration is required",
                details={"session_id": session_id}
            )
        
        if not session.files or not session.files.proteomics:
            raise ValidationError(
                message="At least one proteomics file is required",
                details={"session_id": session_id}
            )
        
        if len(session.files.proteomics) < 2:
            raise ValidationError(
                message="At least 2 proteomics files are required",
                details={
                    "session_id": session_id,
                    "file_count": len(session.files.proteomics)
                }
            )
        
        conditions = set(f.condition for f in session.files.proteomics)
        
        if len(conditions) < 2:
            raise ValidationError(
                message="At least 2 different conditions are required",
                details={
                    "session_id": session_id,
                    "conditions": list(conditions)
                }
            )
        
        if session.config.treatment not in conditions:
            raise ValidationError(
                message=f"Treatment condition '{session.config.treatment}' not found in files",
                details={
                    "session_id": session_id,
                    "treatment": session.config.treatment,
                    "available_conditions": list(conditions)
                }
            )
        
        if session.config.control not in conditions:
            raise ValidationError(
                message=f"Control condition '{session.config.control}' not found in files",
                details={
                    "session_id": session_id,
                    "control": session.config.control,
                    "available_conditions": list(conditions)
                }
            )
    
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
                timeout=60.0  # 60 second total timeout
            )
            logger.info("Session scan completed")
        except asyncio.TimeoutError:
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
        logger.info(f"WebSocket registered for session {session_id}, total connections: {len(self._websocket_connections[session_id])}")

    async def unregister_websocket(self, session_id: str, websocket: WebSocket) -> None:
        """Unregister a WebSocket connection for a session.

        Args:
            session_id: Session ID
            websocket: WebSocket connection
        """
        if session_id in self._websocket_connections:
            if websocket in self._websocket_connections[session_id]:
                self._websocket_connections[session_id].remove(websocket)
                logger.info(f"WebSocket unregistered for session {session_id}, remaining connections: {len(self._websocket_connections[session_id])}")
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

        message = {
            "type": "progress",
            "payload": progress_data
        }

        disconnected = []
        for websocket in self._websocket_connections[session_id]:
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send WebSocket message: {e}")
                disconnected.append(websocket)

        # Clean up disconnected websockets
        for websocket in disconnected:
            await self.unregister_websocket(session_id, websocket)


# Global session manager instance
session_manager = SessionManager()
