"""
Data structures for proteomics data.

Defines Pydantic models for proteomics data structures including
PSM data, protein abundances, differential expression results, and QC metrics.
"""

from typing import Optional

from pydantic import BaseModel, Field


class PSMData(BaseModel):
    """Peptide-Spectrum Match data row."""

    sequence: str = Field(..., alias="Sequence")
    modifications: str = Field(..., alias="Modifications")
    charge: int = Field(..., alias="Charge")
    contaminant: bool = Field(..., alias="Contaminant")
    master_protein_accessions: str = Field(..., alias="Master Protein Accessions")
    quan_info: str = Field(..., alias="Quan Info")
    abundance: float = Field(..., alias="Abundance")
    sample_origination: str = Field(..., alias="Sample_Origination")
    unique_psm: Optional[str] = Field(None, alias="Unique_PSM")

    model_config = {"populate_by_name": True}


class ProteinAbundance(BaseModel):
    """Protein abundance data."""

    master_protein_accessions: str = Field(..., description="Protein accession ID")
    gene_name: Optional[str] = Field(None, description="Gene symbol")
    abundances: dict[str, float] = Field(
        default_factory=dict, description="Abundance values per sample"
    )


class DifferentialExpressionResult(BaseModel):
    """Differential expression analysis result for a single protein."""

    master_protein_accessions: str = Field(..., description="Protein accession ID")
    gene_name: Optional[str] = Field(None, description="Gene symbol")
    log_fc: float = Field(..., description="Log2 fold change")
    pval: float = Field(..., ge=0, le=1, description="Raw p-value")
    adj_pval: float = Field(..., ge=0, le=1, description="Adjusted p-value (BH)")
    se: Optional[float] = Field(None, description="Standard error")
    df: Optional[float] = Field(None, description="Degrees of freedom")
    significant: bool = Field(False, description="Whether protein is significant")
    psm_count: Optional[int] = Field(
        None, description="Number of PSMs for this protein"
    )

    @property
    def regulation(self) -> str:
        """Return regulation direction."""
        if not self.significant:
            return "not_significant"
        return "up" if self.log_fc > 0 else "down"


class DEResultsSummary(BaseModel):
    """Summary of differential expression results."""

    total_proteins: int = Field(..., ge=0)
    significant_proteins: int = Field(..., ge=0)
    upregulated: int = Field(..., ge=0)
    downregulated: int = Field(..., ge=0)
    results: list[DifferentialExpressionResult] = Field(default_factory=list)


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


class CVData(BaseModel):
    """Coefficient of variation data per condition."""

    condition: str
    cv_values: list[float]


class KDECurve(BaseModel):
    """Pre-computed Gaussian KDE curve points."""

    kde_x: list[float]
    kde_y: list[float]


class IntensityDistribution(BaseModel):
    """Intensity distribution data — KDE curves and raw values for box plots."""

    psm: dict[str, dict[str, KDECurve]] = Field(
        default_factory=dict, description="PSM KDE curves by condition and replicate"
    )
    protein: dict[str, KDECurve] = Field(
        default_factory=dict, description="Protein KDE curves by sample"
    )
    psm_boxplot: dict[str, dict[str, list[float]]] = Field(
        default_factory=dict, description="PSM raw log2 intensities for box plots: condition -> replicate -> values"
    )
    protein_boxplot: dict[str, list[float]] = Field(
        default_factory=dict, description="Protein raw intensities for box plots by sample"
    )


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
    intensity_distributions: Optional[IntensityDistribution] = None
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


class CompoundInfo(BaseModel):
    """Compound information from compound ID file."""

    corp_id: str = Field(..., description="Corporate compound ID")
    smiles: Optional[str] = Field(None, description="SMILES string")
    molecular_weight: Optional[float] = None
    formula: Optional[str] = None


class UploadedFileMetadata(BaseModel):
    """Metadata for uploaded files."""

    filename: str
    original_filename: str
    size: int
    content_type: Optional[str] = None
    uploaded_at: str
    path: str
