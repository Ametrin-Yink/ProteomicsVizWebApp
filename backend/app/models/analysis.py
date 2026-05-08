"""
Analysis configuration and results models.

Defines Pydantic models for analysis configuration, processing parameters,
and various analysis results.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class AnalysisTemplate(str, Enum):
    """Available analysis templates."""

    MULTI_CONDITION = "multi_condition_comparison"
    MSSTATS = "msstats"


class PipelineTool(str, Enum):
    """Statistical pipelines available within a template."""

    MSQROB2 = "msqrob2"
    MSSTATS = "msstats"


class Organism(str, Enum):
    """Supported organisms."""

    HUMAN = "human"
    MOUSE = "mouse"
    RAT = "rat"
    YEAST = "yeast"


STEP_NAMES: dict[int, str] = {
    1: "combine_replicates",
    2: "generate_unique_psm",
    3: "remove_razor",
    4: "remove_low_quality",
    5: "filter",
    6: "protein_abundance",
    7: "differential_expression",
    8: "qc_metrics",
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
}


class AnalysisConfig(BaseModel):
    """Complete analysis configuration."""

    template: AnalysisTemplate = Field(default=AnalysisTemplate.MULTI_CONDITION)
    pipeline: PipelineTool = Field(default=PipelineTool.MSQROB2)
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
    msstats_n_top_feature: int = Field(
        default=3, description="Number of top features when featureSubset='topN'"
    )
    msstats_min_feature_count: int = Field(
        default=2, description="Minimum features per protein for summarization"
    )
    msstats_remove_uninformative_feature_outlier: bool = Field(
        default=False, description="Remove outlier features during feature selection"
    )
    msstats_equal_feature_var: bool = Field(
        default=True,
        description="Assume equal feature variances (linear summary method only)",
    )
    msstats_name_standards: Optional[str] = Field(
        default=None,
        description="Comma-separated standard protein names for GLOBALSTANDARDS normalization",
    )
    msstats_save_fitted_models: bool = Field(
        default=True, description="Save fitted linear models in groupComparison output"
    )
    msstats_n_cores: Optional[int] = Field(
        default=None,
        description="Number of CPU cores for parallel R processing. None = auto-calibrate.",
    )

    # msqrob2-specific parameters
    msqrob2_normalization: str = Field(
        default="center.median",
        description="Normalization method: center.median, center.mean, quantiles, quantiles.robust, vsn, div.median, none",
    )
    msqrob2_imputation: str = Field(
        default="none",
        description="Imputation method: none, knn, bpca, MinDet, MinProb, QRILC, MLE",
    )
    msqrob2_aggregation: str = Field(
        default="robustSummary",
        description="Protein aggregation method: robustSummary, medianPolish, sum, mean",
    )
    msqrob2_model: str = Field(
        default="msqrobLm",
        description="DE model type: msqrobLm (robust linear), msqrobGlm (generalized linear)",
    )
    msqrob2_robust: bool = Field(
        default=True,
        description="Use robust M-estimation (Huber weights) for DE model fitting",
    )
    msqrob2_ridge: bool = Field(
        default=False,
        description="Apply ridge penalty for high-dimensional/collinear designs",
    )
    msqrob2_adjust_method: str = Field(
        default="BH",
        description="Multiple testing correction: BH, bonferroni, holm, BY, fdr",
    )
    msqrob2_min_peptides: int = Field(
        default=1,
        ge=1,
        le=10,
        description="Minimum peptides per protein for aggregation",
    )
    msqrob2_n_cores: Optional[int] = Field(
        default=None,
        ge=1,
        description="Number of CPU cores for parallel msqrob2 processing. None = auto-calibrate.",
    )

    # Covariate columns (selected metadata columns used as model covariates)
    covariate_columns: Optional[list[str]] = Field(
        default=None, description="Metadata column names to use as covariates"
    )


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
