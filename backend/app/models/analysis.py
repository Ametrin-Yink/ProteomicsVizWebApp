"""
Analysis configuration and results models.

Defines Pydantic models for analysis configuration, processing parameters,
and various analysis results.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class AnalysisTemplate(str, Enum):
    """Available analysis templates."""

    MULTI_CONDITION = "multi_condition_comparison"
    MSSTATS = "msstats"
    TIME_SERIES = "time_series_analysis"  # reserved for future


class Organism(str, Enum):
    """Supported organisms."""

    HUMAN = "human"
    MOUSE = "mouse"
    RAT = "rat"
    YEAST = "yeast"


class ProcessingStep(str, Enum):
    """Processing pipeline steps."""

    COMBINE_REPLICATES = "combine_replicates"
    GENERATE_UNIQUE_PSM = "generate_unique_psm"
    REMOVE_RAZOR = "remove_razor"
    REMOVE_LOW_QUALITY = "remove_low_quality"
    FILTER = "filter"
    PROTEIN_ABUNDANCE = "protein_abundance"
    DIFFERENTIAL_EXPRESSION = "differential_expression"
    QC_METRICS = "qc_metrics"
    GSEA = "gsea"


STEP_NAMES: dict[int, str] = {
    1: "combine_replicates",
    2: "generate_unique_psm",
    3: "remove_razor",
    4: "remove_low_quality",
    5: "filter",
    6: "protein_abundance",
    7: "differential_expression",
    8: "qc_metrics",
    9: "gsea",
}

STEP_DISPLAY_NAMES: dict[int, str] = {
    1: "Combine Replicates",
    2: "Generate Unique PSM",
    3: "Remove Razor Peptides",
    4: "Remove Low Quality",
    5: "Filter by Criteria",
    6: "Protein Abundance",
    7: "Differential Expression",
    8: "QC Metrics",
    9: "GSEA Analysis",
}


class AnalysisConfig(BaseModel):
    """Complete analysis configuration."""

    template: AnalysisTemplate = Field(default=AnalysisTemplate.MULTI_CONDITION)
    treatment: Optional[str] = Field(default="")
    control: Optional[str] = Field(default="")
    organism: Organism = Field(default=Organism.HUMAN)
    remove_razor: bool = Field(default=False)
    strict_filtering: bool = Field(default=False)

    # Multi-condition: explicit list of comparison pairs
    comparisons: list[dict[str, dict[str, str]]] = Field(default_factory=list)
    # Multi-condition: per-sample metadata (filename -> {column -> value})
    metadata: Optional[dict[str, dict[str, str]]] = Field(default=None)

    # Advanced parameters
    pvalue_threshold: float = Field(default=0.05, ge=0.001, le=0.5)
    logfc_threshold: float = Field(default=1.0, ge=0.1, le=5.0)
    min_peptides_per_protein: int = Field(default=1, ge=1, le=10)

    # MSstats-specific parameters
    msstats_normalization: str = Field(default="equalizeMedians")
    msstats_feature_selection: str = Field(default="all")
    msstats_summary_method: str = Field(default="TMP")
    msstats_impute: bool = Field(default=True)
    msstats_log_base: int = Field(default=2)
    msstats_censored_int: str = Field(default="NA")
    msstats_max_quantile: float = Field(default=0.999)
    msstats_remove50missing: bool = Field(default=False)

    # MSstats advanced parameters (new in 4.16.1)
    msstats_n_top_feature: int = Field(default=3, description="Number of top features when featureSubset='topN'")
    msstats_min_feature_count: int = Field(default=2, description="Minimum features per protein for summarization")
    msstats_remove_uninformative_feature_outlier: bool = Field(default=False, description="Remove outlier features during feature selection")
    msstats_equal_feature_var: bool = Field(default=True, description="Assume equal feature variances (linear summary method only)")
    msstats_name_standards: Optional[str] = Field(default=None, description="Comma-separated standard protein names for GLOBALSTANDARDS normalization")
    msstats_save_fitted_models: bool = Field(default=True, description="Save fitted linear models in groupComparison output")
    msstats_n_cores: int = Field(default=32, ge=1, description="Number of CPU cores for parallel R processing")

    # Covariate columns (selected metadata columns used as model covariates)
    covariate_columns: Optional[list[str]] = Field(default=None, description="Metadata column names to use as covariates")

    @field_validator("control")
    @classmethod
    def control_differs_from_treatment(cls, v: str, info) -> str:
        """Ensure control differs from treatment."""
        values = info.data
        if "treatment" in values and v == values["treatment"]:
            raise ValueError("Control must differ from treatment")
        return v


class VolcanoPlotPoint(BaseModel):
    """Single point for volcano plot."""

    protein_id: str
    gene_name: Optional[str]
    log_fc: float
    neg_log_pval: float
    significant: bool
    regulation: str  # "up", "down", "not_significant"


class VolcanoPlotData(BaseModel):
    """Data for volcano plot visualization."""

    points: list[VolcanoPlotPoint]
    thresholds: dict[str, float]
    summary: dict[str, int]


class HeatmapData(BaseModel):
    """Data for heatmap visualization."""

    proteins: list[str]
    samples: list[str]
    values: list[list[float]]  # 2D array
    row_labels: list[str]  # Gene names or protein IDs
    col_labels: list[str]  # Sample names


class BoxPlotData(BaseModel):
    """Data for box plot."""

    categories: list[str]
    data: list[dict[str, Any]]  # Box plot statistics per category


class DatabaseType(str, Enum):
    """GSEA database types."""

    GO_BP = "go_bp"
    GO_MF = "go_mf"
    GO_CC = "go_cc"
    KEGG = "kegg"
    REACTOME = "reactome"


DATABASE_NAMES: dict[DatabaseType, str] = {
    DatabaseType.GO_BP: "GO_Biological_Process_2021",
    DatabaseType.GO_MF: "GO_Molecular_Function_2021",
    DatabaseType.GO_CC: "GO_Cellular_Component_2021",
    DatabaseType.KEGG: "KEGG_2021_Human",
    DatabaseType.REACTOME: "Reactome_2022",
}


class AnalysisResult(BaseModel):
    """Complete analysis result."""

    session_id: str
    completed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # File paths
    psm_abundances_path: Optional[str] = None
    protein_abundances_path: Optional[str] = None
    diff_expression_path: Optional[str] = None
    qc_results_path: Optional[str] = None
    gsea_results_path: Optional[str] = None

    # Statistics
    total_psms: int = 0
    total_proteins: int = 0
    significant_proteins: int = 0

    # Processing info
    processing_time_seconds: float = 0.0
    steps_completed: list[int] = Field(default_factory=list)


class ProcessingProgress(BaseModel):
    """Processing progress update."""

    step: int = Field(..., ge=1, le=9)
    step_name: str
    status: str = Field(..., pattern=r"^(started|in_progress|completed|failed)$")
    progress: int = Field(..., ge=0, le=100)
    message: Optional[str] = None
    overall_progress: int = Field(..., ge=0, le=100)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ReportRequest(BaseModel):
    """PDF report generation request."""

    include_volcano_plot: bool = Field(default=True)
    include_heatmap: bool = Field(default=True)
    include_qc_plots: bool = Field(default=True)
    include_gsea_results: bool = Field(default=True)
    include_protein_table: bool = Field(default=True)
    sections: list[str] = Field(
        default_factory=lambda: [
            "summary",
            "volcano_plot",
            "protein_table",
            "qc_analysis",
            "gsea_analysis",
        ]
    )
    # User-adjustable volcano plot filters
    fold_change: float = Field(default=1.0, description="log2 Fold Change threshold")
    p_value: float = Field(default=0.05, description="P-value threshold")
    adj_p_value: float = Field(default=1.0, description="Adjusted P-value threshold")
    s0: float = Field(default=0.1, description="S0 factor as fraction of fold_change")
    # Frontend-captured plot images (base64 data URLs)
    images: Optional[dict[str, list[str]]] = Field(
        default=None, description="{key: [base64 data URLs]}"
    )


class ReportStatus(BaseModel):
    """Report generation status."""

    report_id: str
    status: str = Field(..., pattern=r"^(pending|generating|completed|failed)$")
    progress: int = Field(default=0, ge=0, le=100)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    download_url: Optional[str] = None
