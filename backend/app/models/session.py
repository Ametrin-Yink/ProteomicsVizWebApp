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
    
    treatment: str = Field(
        ...,
        min_length=1,
        description="Treatment condition name"
    )
    control: str = Field(
        ...,
        min_length=1,
        description="Control condition name"
    )
    organism: str = Field(
        ...,
        pattern=r'^[a-z]+$',
        description="Organism identifier (e.g., 'human', 'mouse')"
    )
    remove_razor: bool = Field(
        default=False,
        description="Whether to remove razor peptides"
    )
    strict_filtering: bool = Field(
        default=False,
        description="Use strict filtering criteria"
    )
    
    @field_validator('control')
    @classmethod
    def control_differs_from_treatment(cls, v: str, info) -> str:
        """Ensure control differs from treatment."""
        values = info.data
        if 'treatment' in values and v == values['treatment']:
            raise ValueError('Control must differ from treatment')
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
    template: str = Field(default="protein_pairwise_comparison")
    state: SessionState = Field(default=SessionState.CREATED)
    config: Optional[SessionConfig] = None
    files: SessionFiles = Field(default_factory=SessionFiles)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    error_message: Optional[str] = None
    markers: list[str] = Field(default_factory=list, description="Marked protein accessions for volcano plot labels")
    volcano_filters: Optional[dict[str, Any]] = Field(default=None, description="Volcano plot filter settings (foldChange, pValue, adjPValue, s0)")
    
    model_config = {
        "from_attributes": True,
        "json_schema_extra": {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "name": "DMSO vs Treatment Analysis",
                "template": "protein_pairwise_comparison",
                "state": "created",
                "config": None,
                "files": {"proteomics": [], "compound": None},
                "created_at": "2026-03-16T10:00:00Z",
                "updated_at": "2026-03-16T10:00:00Z"
            }
        }
    }


class SessionCreate(BaseModel):
    """Session creation request."""
    
    name: str = Field(..., min_length=1, max_length=200)
    template: str = Field(default="protein_pairwise_comparison")


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
    status: str = Field(..., pattern=r'^(pending|in_progress|completed|failed)$')
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


class PipelineState(BaseModel):
    """Pipeline execution state for persistence."""
    
    current_step: int = Field(default=0, ge=0, le=9)
    completed_steps: list[int] = Field(default_factory=list)
    failed_step: Optional[int] = None
    error: Optional[str] = None
    outputs: dict[str, str] = Field(default_factory=dict)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    
    def mark_completed(self, step: int, output_path: str) -> None:
        """Mark a step as completed."""
        if step not in self.completed_steps:
            self.completed_steps.append(step)
        self.outputs[f"step_{step}"] = output_path
        self.current_step = step
    
    def mark_failed(self, step: int, error: str) -> None:
        """Mark a step as failed."""
        self.failed_step = step
        self.error = error
    
    def is_step_completed(self, step: int) -> bool:
        """Check if a step is completed."""
        return step in self.completed_steps
