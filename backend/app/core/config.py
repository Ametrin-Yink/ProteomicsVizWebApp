"""
Core configuration module for the Proteomics Visualization Web App.

Uses pydantic-settings for environment-based configuration with .env file support.
"""

import os
from pathlib import Path
from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Pipeline constants
# MIN_PROTEOMICS_FILES enforces a stricter check (3 replicates × 2 conditions = 6 minimum)
# than session_manager.py's per-condition validation. This provides defense-in-depth
# for the most common experimental design while still allowing the per-condition
# validator to handle edge cases with more conditions.
MIN_PROTEOMICS_FILES = 6  # At least 3 per condition, 2 conditions


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application settings
    app_name: str = Field(
        default="Proteomics Visualization API", description="Application name"
    )
    app_version: str = Field(default="1.0.0", description="Application version (sync with git tags on release)")
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
        default=7200,  # 2 hours — default for most R scripts
        description="R script execution timeout in seconds",
        ge=30,
        le=14400,  # Max 4 hours
    )

    r_data_process_timeout: int = Field(
        default=7200,  # 2 hours — MSstats dataProcess is the heaviest step
        description="Timeout for MSstats dataProcess (protein abundance) in seconds",
        ge=30,
        le=28800,
    )

    r_group_comparison_timeout: int = Field(
        default=3600,  # 1 hour — per-contrast modeling
        description="Timeout for MSstats groupComparison (differential expression) in seconds",
        ge=30,
        le=14400,
    )

    # --- MSstats Step 7 batching ---
    msstats_batch_size: int = Field(
        default=10, ge=1, le=50,
        description="Comparisons per R subprocess batch for Step 7",
    )

    msstats_max_workers: int = Field(
        default=min((os.cpu_count() or 4) // 2, 32), ge=1, le=64,
        description="Max concurrent R subprocesses for Step 7 batching",
    )

    msstats_n_cores_cap: int = Field(
        default=32, ge=1, le=64,
        description="Max BiocParallel cores per R subprocess",
    )

    r_msqrob2_data_process_timeout: int = Field(
        default=7200,  # 2 hours — QFeatures aggregateFeatures is the heaviest step
        description="Timeout for msqrob2 dataProcess (protein abundance) in seconds",
        ge=30,
        le=28800,
    )

    r_msqrob2_group_comparison_timeout: int = Field(
        default=3600,  # 1 hour — per-contrast msqrobLm modeling
        description="Timeout for msqrob2 groupComparison (differential expression) in seconds",
        ge=30,
        le=14400,
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

    # Performance optimization settings
    use_parquet: bool = Field(
        default=True,
        description="Use Parquet format for intermediate files (faster I/O)",
    )

    parquet_compression: str = Field(
        default="zstd",
        description="Parquet compression codec (zstd, snappy, gzip)",
    )

    # GSEA cache settings
    gsea_cache_enabled: bool = Field(
        default=True,
        description="Enable GSEA result caching",
    )

    gsea_cache_ttl_hours: int = Field(
        default=168,  # 7 days
        description="GSEA cache time-to-live in hours",
        ge=1,
        le=720,  # Max 30 days
    )

    @property
    def gsea_cache_dir(self) -> Path:
        """Directory for GSEA cache files."""
        return self.sessions_dir / ".cache" / "gsea"

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
        # Create GSEA cache directory if caching is enabled
        if self.gsea_cache_enabled:
            self.gsea_cache_dir.mkdir(parents=True, exist_ok=True)


# Global settings instance
settings = Settings()
