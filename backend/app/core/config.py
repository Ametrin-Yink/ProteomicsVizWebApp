"""
Core configuration module for the Proteomics Visualization Web App.

Uses pydantic-settings for environment-based configuration with .env file support.
"""

from pathlib import Path
from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application settings
    app_name: str = Field(default="Proteomics Visualization API", description="Application name")
    app_version: str = Field(default="1.0.0", description="Application version")
    debug: bool = Field(default=False, description="Debug mode")

    # Server settings
    host: str = Field(default="0.0.0.0", description="Server host")
    port: int = Field(default=8000, description="Server port")

    # File upload settings
    max_upload_size_mb: int = Field(
        default=500,
        description="Maximum file upload size in MB",
        ge=1,
        le=2048,
    )

    @property
    def max_upload_size_bytes(self) -> int:
        """Convert MB to bytes."""
        return self.max_upload_size_mb * 1024 * 1024

    # Directory paths
    base_dir: Path = Field(
        default=Path(__file__).resolve().parent.parent.parent,
        description="Base backend directory",
    )

    sessions_dir: Path = Field(
        default=Path(__file__).resolve().parent.parent.parent / "sessions",
        description="Directory for session storage",
    )

    protein_database_dir: Path = Field(
        default=Path(__file__).resolve().parent.parent.parent / "protein_database",
        description="Directory containing protein database files",
    )

    # CORS settings
    cors_origins: List[str] = Field(
        default=[
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://[::1]:3000",  # IPv6 localhost
            "null",  # For Playwright/file:// scenarios
        ],
        description="Allowed CORS origins",
    )

    # R integration settings
    r_executable: str = Field(
        default="Rscript",
        description="Path to R executable",
    )

    r_script_timeout: int = Field(
        default=1800,  # 30 minutes for large datasets
        description="R script execution timeout in seconds",
        ge=30,
        le=7200,  # Max 2 hours
    )

    # WebSocket settings
    websocket_ping_interval: int = Field(
        default=20,
        description="WebSocket ping interval in seconds",
    )

    websocket_ping_timeout: int = Field(
        default=20,
        description="WebSocket ping timeout in seconds",
    )

    @field_validator("sessions_dir", "protein_database_dir", mode="before")
    @classmethod
    def resolve_path(cls, v: Optional[Path | str]) -> Path:
        """Ensure paths are resolved Path objects."""
        if v is None:
            return v
        if isinstance(v, str):
            v = Path(v)
        return v.resolve()

    def ensure_directories(self) -> None:
        """Ensure required directories exist."""
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        self.protein_database_dir.mkdir(parents=True, exist_ok=True)


# Global settings instance
settings = Settings()
