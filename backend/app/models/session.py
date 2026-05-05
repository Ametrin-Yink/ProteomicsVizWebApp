"""
Session data models with Pydantic.

Defines all session-related data structures including configuration,
file metadata, and session state.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class SessionState(str, Enum):
    """Session state enumeration."""

    CREATED = "created"
    CONFIGURING = "configuring"
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    ERROR = "error"
    CANCELLED = "cancelled"


class SessionConfig(BaseModel):
    """Session configuration model."""

    treatment: Optional[str] = Field(
        default=None, description="Treatment condition name"
    )
    control: Optional[str] = Field(default=None, description="Control condition name")
    organism: Optional[str] = Field(
        default=None,
        pattern=r"^(|[a-z]+)$",
        description="Organism identifier (e.g., 'human', 'mouse')",
    )
    remove_razor: bool = Field(
        default=False, description="Whether to remove razor peptides"
    )
    strict_filtering: bool = Field(
        default=False, description="Use strict filtering criteria"
    )
    # Multi-condition: explicit list of comparison pairs
    comparisons: Optional[list[dict[str, dict[str, str]]]] = Field(
        default=None,
        description="List of {group1: {col:val}, group2: {col:val}} comparison criteria",
    )
    # Multi-condition: per-sample metadata columns (filename -> {column -> value})
    metadata_columns: Optional[dict[str, dict[str, str]]] = Field(
        default=None, description="Custom metadata columns per sample file"
    )
    # MSstats-specific parameters (optional, used only for msstats templates)
    msstats_normalization: Optional[str] = Field(default=None)
    msstats_feature_selection: Optional[str] = Field(default=None)
    msstats_summary_method: Optional[str] = Field(default=None)
    msstats_impute: Optional[bool] = Field(default=None)
    msstats_log_base: Optional[int] = Field(default=None)
    msstats_censored_int: Optional[str] = Field(default=None)
    msstats_max_quantile: Optional[float] = Field(default=None)
    msstats_remove50missing: Optional[bool] = Field(default=None)

    # Shared advanced parameters (previously dropped by backend)
    pvalue_threshold: Optional[float] = Field(default=None, ge=0.001, le=0.5)
    logfc_threshold: Optional[float] = Field(default=None, ge=0.1, le=5.0)
    min_peptides_per_protein: Optional[int] = Field(default=None, ge=1, le=10)

    # MSstats advanced parameters (new)
    msstats_n_top_feature: Optional[int] = Field(default=None)
    msstats_min_feature_count: Optional[int] = Field(default=None)
    msstats_remove_uninformative_feature_outlier: Optional[bool] = Field(default=None)
    msstats_equal_feature_var: Optional[bool] = Field(default=None)
    msstats_name_standards: Optional[str] = Field(default=None)
    msstats_save_fitted_models: Optional[bool] = Field(default=None)

    # Covariate columns (selected metadata columns to use as model covariates)
    covariate_columns: Optional[list[str]] = Field(default=None)

    @field_validator("control")
    @classmethod
    def control_differs_from_treatment(cls, v, info):
        """Ensure control differs from treatment (when both are actually set)."""
        if not v:
            return v
        treatment = info.data.get("treatment") if info.data else None
        if treatment and v == treatment:
            raise ValueError("Control must differ from treatment")
        return v


class FileInfo(BaseModel):
    """File metadata model."""

    filename: str = Field(..., description="Original filename")
    size: int = Field(..., ge=0, description="File size in bytes")
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    columns: list[str] = Field(default_factory=list, description="CSV columns")


class ProteomicsFileInfo(FileInfo):
    """Proteomics file metadata with parsed filename info."""

    experiment: str = Field(..., description="Experiment name from filename")
    condition: str = Field(..., description="Condition from filename")
    replicate: int = Field(..., ge=1, description="Replicate number")


class SessionFiles(BaseModel):
    """Session files collection."""

    proteomics: list[ProteomicsFileInfo] = Field(default_factory=list)
    compound: Optional[FileInfo] = None


class Session(BaseModel):
    """Session model representing a complete analysis session."""

    id: str = Field(..., description="Unique session ID (UUID)")
    name: str = Field(..., min_length=1, description="Session name")
    template: str = Field(default="multi_condition_comparison")
    state: SessionState = Field(default=SessionState.CREATED)
    config: Optional[SessionConfig] = None
    files: SessionFiles = Field(default_factory=SessionFiles)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    error_message: Optional[str] = None
    markers: list[str] = Field(
        default_factory=list,
        description="Marked protein accessions for volcano plot labels",
    )
    volcano_filters: Optional[dict[str, Any]] = Field(
        default=None,
        description="Volcano plot filter settings (foldChange, pValue, adjPValue, s0)",
    )

    model_config = {
        "from_attributes": True,
        "json_schema_extra": {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "name": "DMSO vs Treatment Analysis",
                "template": "multi_condition_comparison",
                "state": "created",
                "config": None,
                "files": {"proteomics": [], "compound": None},
                "created_at": "2026-03-16T10:00:00Z",
                "updated_at": "2026-03-16T10:00:00Z",
            }
        },
    }


class SessionCreate(BaseModel):
    """Session creation request."""

    name: str = Field(..., min_length=1, max_length=200)
    template: str = Field(default="multi_condition_comparison")


class SessionUpdate(BaseModel):
    """Session update request."""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    config: Optional[SessionConfig] = None


class VisualizationStateUpdate(BaseModel):
    """Partial update for visualization state (markers + volcano filters)."""

    markers: Optional[list[str]] = None
    volcano_filters: Optional[dict[str, Any]] = None


class SessionSummary(BaseModel):
    """Session summary for list views."""

    id: str
    name: str
    state: SessionState
    created_at: datetime
    updated_at: datetime
    has_results: bool = False

    model_config = {"from_attributes": True}


class ProcessingStepStatus(BaseModel):
    """Status of a single processing step."""

    step: int = Field(..., ge=1, le=9)
    name: str
    status: str = Field(..., pattern=r"^(pending|in_progress|completed|failed)$")
    progress: int = Field(default=0, ge=0, le=100)
    message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None


class ProcessingStatus(BaseModel):
    """Complete processing status for a session."""

    state: SessionState
    current_step: Optional[int] = None
    step_name: Optional[str] = None
    progress: int = Field(default=0, ge=0, le=100)
    steps: list[ProcessingStepStatus] = Field(default_factory=list)
    started_at: Optional[datetime] = None
    estimated_completion: Optional[datetime] = None
    error_message: Optional[str] = None
    queue_position: Optional[int] = None
    queue_length: Optional[int] = None
