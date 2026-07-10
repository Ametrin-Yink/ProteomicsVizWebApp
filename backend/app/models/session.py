"""
Session data models with Pydantic.

Defines all session-related data structures including configuration,
file metadata, and session state.
"""

from datetime import UTC, datetime
from enum import Enum
from typing import Any

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

    treatment: str | None = Field(default=None, description="Treatment condition name")
    control: str | None = Field(default=None, description="Control condition name")
    organism: str | None = Field(
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
    comparisons: list[dict[str, dict[str, str]]] | None = Field(
        default=None,
        description="List of {group1: {col:val}, group2: {col:val}} comparison criteria",
    )
    # Multi-condition: per-sample metadata columns (filename -> {column -> value})
    metadata_columns: dict[str, dict[str, str]] | None = Field(
        default=None, description="Custom metadata columns per sample file"
    )
    # MSstats-specific parameters (optional, used only for msstats templates)
    msstats_normalization: str | None = Field(default=None)
    msstats_feature_selection: str | None = Field(default=None)
    msstats_summary_method: str | None = Field(default=None)
    msstats_impute: bool | None = Field(default=None)
    msstats_log_base: int | None = Field(default=None)
    msstats_censored_int: str | None = Field(default=None)
    msstats_max_quantile: float | None = Field(default=None)
    msstats_remove50missing: bool | None = Field(default=None)

    # Shared advanced parameters (previously dropped by backend)
    pvalue_threshold: float | None = Field(default=None, ge=0.001, le=0.5)
    logfc_threshold: float | None = Field(default=None, ge=0.1, le=5.0)
    min_peptides_per_protein: int | None = Field(default=None, ge=1, le=10)

    # MSstats advanced parameters (new)
    msstats_n_top_feature: int | None = Field(default=None)
    msstats_min_feature_count: int | None = Field(default=None)
    msstats_remove_uninformative_feature_outlier: bool | None = Field(default=None)
    msstats_equal_feature_var: bool | None = Field(default=None)
    msstats_name_standards: str | None = Field(default=None)
    msstats_save_fitted_models: bool | None = Field(default=None)
    msstats_n_cores: int | None = Field(default=None)

    # msqrob2 advanced parameters
    msqrob2_ridge: bool | None = Field(default=None)
    msqrob2_normalization: str | None = Field(default=None)
    msqrob2_imputation: str | None = Field(default=None)
    msqrob2_aggregation: str | None = Field(default=None)
    msqrob2_adjust_method: str | None = Field(default=None)
    msqrob2_n_cores: int | None = Field(default=None)
    msqrob2_batch_column: str | None = Field(default=None)

    # Covariate columns (selected metadata columns to use as model covariates)
    covariate_columns: list[str] | None = Field(default=None)

    # Pipeline reform: file type and TMT channel mapping
    file_type: str | None = Field(default=None, description="Analysis type: 'tmt' or 'dia'")
    tmt_channel_mapping: dict[str, dict[str, str | int]] | None = Field(
        default=None,
        description="TMT channel → {group1: val1, ..., replicate: N} mapping",
    )


class FileInfo(BaseModel):
    """File metadata model."""

    filename: str = Field(..., description="Original filename")
    size: int = Field(..., ge=0, description="File size in bytes")
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    columns: list[str] = Field(default_factory=list, description="CSV columns")


class ProteomicsFileInfo(FileInfo):
    """Proteomics file metadata — user-provided, not filename-parsed."""

    experiment: str = Field(default="", description="Experiment name (user-provided)")
    replicate: int = Field(default=0, ge=0, description="Replicate number (user-provided)")
    batch: str | None = Field(default=None, description="Batch label for DIA batch correction")
    file_type: str | None = Field(default=None, description="Detected file type: 'tmt' or 'dia'")


class SessionFiles(BaseModel):
    """Session files collection."""

    proteomics: list[ProteomicsFileInfo] = Field(default_factory=list)
    ptm_enrichment: list[ProteomicsFileInfo] = Field(default_factory=list)
    global_proteome: list[ProteomicsFileInfo] = Field(default_factory=list)
    fasta: list[FileInfo] = Field(default_factory=list)


class Session(BaseModel):
    """Session model representing a complete analysis session."""

    id: str = Field(..., description="Unique session ID (UUID)")
    name: str = Field(..., min_length=1, description="Session name")
    template: str = Field(default="multi_condition_comparison")
    pipeline: str = Field(default="")
    state: SessionState = Field(default=SessionState.CREATED)
    config: SessionConfig | None = None
    files: SessionFiles = Field(default_factory=SessionFiles)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    error_message: str | None = None
    markers: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Marked protein accessions per comparison for volcano plot labels",
    )

    @field_validator("markers", mode="before")
    @classmethod
    def normalize_markers(cls, v: Any) -> dict[str, list[str]]:
        """Accept old flat list format and migrate to per-comparison dict."""
        if isinstance(v, list):
            return {"default": v}
        if isinstance(v, dict):
            return {k: v for k, v in v.items()}
        return {}

    volcano_filters: dict[str, Any] | None = Field(
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
                "pipeline": "msqrob2",
                "state": "created",
                "config": None,
                "files": {"proteomics": []},
                "created_at": "2026-03-16T10:00:00Z",
                "updated_at": "2026-03-16T10:00:00Z",
            }
        },
    }


class SessionCreate(BaseModel):
    """Session creation request."""

    name: str = Field(..., min_length=1, max_length=200)
    template: str = Field(default="multi_condition_comparison")
    pipeline: str = Field(default="msqrob2")


class SessionUpdate(BaseModel):
    """Session update request."""

    name: str | None = Field(None, min_length=1, max_length=200)
    config: SessionConfig | None = None


class VisualizationStateUpdate(BaseModel):
    """Partial update for visualization state (markers + volcano filters)."""

    markers: dict[str, list[str]] | None = None
    volcano_filters: dict[str, Any] | None = None


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
    message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None


class ProcessingStatus(BaseModel):
    """Complete processing status for a session."""

    state: SessionState
    current_step: int | None = None
    step_name: str | None = None
    progress: int = Field(default=0, ge=0, le=100)
    steps: list[ProcessingStepStatus] = Field(default_factory=list)
    started_at: datetime | None = None
    estimated_completion: datetime | None = None
    error_message: str | None = None
    queue_position: int | None = None
    queue_length: int | None = None
