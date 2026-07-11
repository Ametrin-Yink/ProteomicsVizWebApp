"""
Analysis configuration and results models.

Defines Pydantic models for analysis configuration, processing parameters,
and various analysis results.
"""

from datetime import UTC, datetime
from enum import Enum

from pydantic import BaseModel, Field


class AnalysisTemplate(str, Enum):
    """Available analysis templates."""

    MULTI_CONDITION = "multi_condition_comparison"
    MSSTATS = "msstats"


class PipelineTool(str, Enum):
    """Statistical pipelines available within a template."""

    MSQROB2 = "msqrob2"
    MSSTATS = "msstats"
    PTM = "ptm"


class Organism(str, Enum):
    """Supported organisms."""

    HUMAN = "human"
    MOUSE = "mouse"
    RAT = "rat"
    YEAST = "yeast"


STEP_DISPLAY_NAMES: dict[str, dict[int, str]] = {
    PipelineTool.MSQROB2: {
        1: "Combine Replicates",
        2: "Generate Unique PSM",
        3: "Remove Razor Peptides",
        4: "Remove Low Quality",
        5: "Filter by Criteria",
        6: "Protein Abundance (msqrob2/QFeatures)",
        7: "Differential Expression (msqrob2)",
        8: "QC Metrics",
    },
    PipelineTool.MSSTATS: {
        1: "Combine Replicates",
        2: "Generate Unique PSM",
        3: "Remove Razor Peptides",
        4: "Remove Low Quality",
        5: "Filter by Criteria",
        6: "Protein Abundance (MSstats)",
        7: "Differential Expression (MSstats)",
        8: "QC Metrics",
    },
    PipelineTool.PTM: {
        1: "Prepare PTM Data",
        2: "PTM Summarization (MSstatsPTM)",
        3: "PTM Group Comparison (MSstatsPTM)",
        4: "PTM QC Metrics",
    },
}


class AnalysisConfig(BaseModel):
    """Complete analysis configuration."""

    template: AnalysisTemplate = Field(default=AnalysisTemplate.MULTI_CONDITION)
    pipeline: PipelineTool = Field(default=PipelineTool.MSQROB2)
    treatment: str | None = Field(default="")
    control: str | None = Field(default="")
    organism: Organism = Field(default=Organism.HUMAN)
    remove_razor: bool = Field(default=False)
    strict_filtering: bool = Field(default=False)

    # Multi-condition: explicit list of comparison pairs
    comparisons: list[dict[str, dict[str, str]]] = Field(default_factory=list)
    # Multi-condition: per-sample metadata (filename -> {column -> value})
    metadata: dict[str, dict[str, str]] | None = Field(default=None)

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
    msstats_name_standards: str | None = Field(
        default=None,
        description="Comma-separated standard protein names for GLOBALSTANDARDS normalization",
    )
    msstats_save_fitted_models: bool = Field(
        default=True, description="Save fitted linear models in groupComparison output"
    )
    msstats_n_cores: int | None = Field(
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
        description="[DEPRECATED in v1.16] msqrob() replaces msqrobLm; no msqrobGlm. Value ignored.",
    )
    msqrob2_robust: bool = Field(
        default=True,
        description="[DEPRECATED in v1.16] msqrob() always uses robust regression. Value ignored.",
    )
    msqrob2_ridge: bool = Field(
        default=False,  # ridge requires 5+ replicates; 3 reps causes boundary singular fits
        description="Apply ridge penalty for high-dimensional/collinear designs (requires 5+ replicates)",
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
    msqrob2_n_cores: int | None = Field(
        default=None,
        ge=1,
        description="Number of CPU cores for parallel msqrob2 processing. None = auto-calibrate.",
    )

    # Batch correction (msqrob2)
    msqrob2_batch_column: str | None = Field(
        default=None, description="Metadata column to use as batch variable in limma"
    )

    # Covariate columns (selected metadata columns used as model covariates)
    covariate_columns: list[str] | None = Field(
        default=None, description="Metadata column names to use as covariates"
    )

    # Pipeline reform: file type and TMT channel mapping
    file_type: str | None = Field(
        default=None, description="Analysis type: 'tmt' or 'dia'"
    )
    tmt_channel_mapping: dict[str, dict[str, str | int]] | None = Field(
        default=None,
        description="TMT channel -> {group1: val1, ..., replicate: N} mapping",
    )

    # PTM-specific parameters
    ptm_labeling_type: str = Field(
        default="LF",
        description="Labeling type for PTM experiment: LF or TMT",
    )
    ptm_mod_ids: list[str] = Field(
        default_factory=list,
        description="PTM modification types to analyze (e.g., ['Phospho'])",
    )
    ptm_which_proteinid: str = Field(
        default="Protein.Group.Accessions",
        description="PD column for protein name",
    )
    ptm_which_quantification: str = Field(
        default="Precursor.Area",
        description="PD column for quantification: Precursor.Area, Intensity, or Area",
    )
    ptm_normalization: str = Field(
        default="equalizeMedians",
        description="Normalization method for PTM summarization",
    )
    ptm_summary_method: str = Field(
        default="TMP",
        description="Summary method for PTM summarization: TMP or linear",
    )
    ptm_mbimpute: bool = Field(
        default=True,
        description="Use accelerated failure model for missing value imputation",
    )
    ptm_save_fitted_models: bool = Field(
        default=True,
        description="Save fitted linear models in groupComparison output",
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
    completed_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    # File paths
    psm_abundances_path: str | None = None
    protein_abundances_path: str | None = None
    diff_expression_path: str | None = None
    qc_results_path: str | None = None
    gsea_results_path: str | None = None

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
    message: str | None = None
    overall_progress: int = Field(..., ge=0, le=100)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
