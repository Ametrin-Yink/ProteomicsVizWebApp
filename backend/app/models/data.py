"""
Data structures for proteomics data.

Defines Pydantic models for proteomics data structures including
PSM data, protein abundances, differential expression results, and QC metrics.
"""

from typing import Optional

from pydantic import BaseModel, Field


class PCAResult(BaseModel):
    """PCA analysis results."""

    samples: list[str] = Field(..., description="Sample names")
    pc1: list[float] = Field(..., description="First principal component")
    pc2: list[float] = Field(..., description="Second principal component")
    conditions: list[str] = Field(..., description="Condition for each sample")
    pc1_variance: float = Field(..., description="PC1 explained variance %")
    pc2_variance: float = Field(..., description="PC2 explained variance %")


class PValueDistribution(BaseModel):
    """P-value distribution histogram data."""

    bins: list[float] = Field(..., description="Bin edges")
    counts: list[int] = Field(..., description="Counts per bin")


class DataCompleteness(BaseModel):
    """Data completeness per sample."""

    sample: str
    missing: int
    present: int

    @property
    def completeness_pct(self) -> float:
        """Calculate completeness percentage."""
        total = self.missing + self.present
        if total == 0:
            return 0.0
        return (self.present / total) * 100


class QCData(BaseModel):
    """Complete QC metrics data."""

    pca: Optional[PCAResult] = None
    pvalue_distribution: Optional[PValueDistribution] = None
    psm_cv: Optional[dict[str, list[float]]] = None
    protein_cv: Optional[dict[str, list[float]]] = None
    data_completeness: Optional[list[DataCompleteness]] = None
    psm_completeness: Optional[list[DataCompleteness]] = None
    pvalue_distributions: Optional[dict[str, PValueDistribution]] = None
    # Summary statistics
    total_psms: Optional[int] = None
    avg_psms_per_sample: Optional[float] = None
    total_proteins: Optional[int] = None
    avg_proteins_per_sample: Optional[int] = None
    average_cv: Optional[float] = None
    average_protein_cv: Optional[float] = None
    average_psm_cv: Optional[float] = None
    completeness_rate: Optional[float] = None


class GSEAResult(BaseModel):
    """GSEA result for a single pathway/term."""

    term: str = Field(..., description="Pathway/term identifier")
    name: str = Field(..., description="Pathway/term name")
    es: float = Field(..., description="Enrichment score")
    nes: float = Field(..., description="Normalized enrichment score")
    pval: float = Field(..., ge=0, le=1, description="P-value")
    fdr: float = Field(..., ge=0, le=1, description="False discovery rate")
    lead_genes: list[str] = Field(
        default_factory=list, description="Leading edge genes"
    )
    matched_genes: int = Field(..., ge=0, description="Number of matched genes")
    # Running enrichment score curve data for plotting
    running_es_curve: Optional[list[tuple[int, float]]] = Field(
        default=None, description="Running ES curve as list of (rank, es) tuples"
    )
    rank_metric_positions: Optional[list[tuple[str, int, float]]] = Field(
        default=None,
        description="Gene positions in ranked list: (gene_name, rank, metric_value)",
    )
    # Heatmap data for z-score transformed protein intensities
    heatmap_data: Optional[dict] = Field(
        default=None,
        description="Heatmap data for leading edge genes: {genes: [], samples: [], z_scores: [[],...]}",
    )

    @property
    def significant(self) -> bool:
        """Check if result is significant (|NES| >= 1 and FDR < 0.25)."""
        return abs(self.nes) >= 1.0 and self.fdr < 0.25

    @property
    def enrichment_direction(self) -> str:
        """Return enrichment direction."""
        if self.nes > 0:
            return "overrepresented"
        elif self.nes < 0:
            return "underrepresented"
        return "neutral"


class GSEAResults(BaseModel):
    """GSEA results for a database."""

    database: str = Field(..., description="Database name")
    total_pathways: int = Field(..., ge=0)
    significant_pathways: int = Field(..., ge=0)
    overrepresented: int = Field(..., ge=0)
    underrepresented: int = Field(..., ge=0)
    results: list[GSEAResult] = Field(default_factory=list)


class UploadedFileMetadata(BaseModel):
    """Metadata for uploaded files."""

    filename: str
    original_filename: str
    size: int
    content_type: Optional[str] = None
    uploaded_at: str
    path: str
