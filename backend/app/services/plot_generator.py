"""
Plot Generator Service.

Prepares data for frontend plots and generates static plot images for PDF reports.
Supports volcano plots, QC plots, and GSEA plots.
"""

import base64
import io
import logging
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")  # Use non-interactive backend
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

try:
    import seaborn  # noqa: F401  # imported for runtime availability check

    HAS_SEABORN = True
except ImportError:
    HAS_SEABORN = False

from app.core.exceptions import ProcessingError
from app.models.data import QCData, PCAResult, GSEAResults, DifferentialExpressionResult
from app.models.analysis import VolcanoPlotPoint, VolcanoPlotData
from app.models.analysis import HeatmapData

logger = logging.getLogger("proteomics")


class PlotGenerator:
    """
    Generator for static plot images and frontend data.

    Creates publication-quality plots for PDF reports and
    prepares data for interactive frontend visualizations.
    """

    def __init__(self):
        """Initialize plot generator."""
        # Set default style
        try:
            plt.style.use("seaborn-v0_8-whitegrid")
        except Exception:
            plt.style.use("default")

        self.colors = {
            "upregulated": "#E74C3C",
            "downregulated": "#3498DB",
            "not_significant": "#95A5A6",
            "treatment": "#E74C3C",
            "control": "#3498DB",
            "highlight": "#F39C12",
        }

        self.diff_data: Optional[pd.DataFrame] = None
        self.protein_data: Optional[pd.DataFrame] = None

    async def load_data(
        self, diff_expression_path: Path, protein_abundances_path: Optional[Path] = None
    ) -> None:
        """
        Load data for plot generation.

        Args:
            diff_expression_path: Path to Diff_Expression.tsv
            protein_abundances_path: Optional path to Protein_Abundances.tsv
        """
        self.diff_data = await asyncio.to_thread(pd.read_csv, diff_expression_path, sep="\t")

        if protein_abundances_path and protein_abundances_path.exists():
            self.protein_data = await asyncio.to_thread(pd.read_csv, protein_abundances_path, sep="\t")

    # =========================================================================
    # Volcano Plot Functions
    # =========================================================================

    def prepare_volcano_data(
        self,
        diff_expression_df: pd.DataFrame,
        pvalue_threshold: float = 0.05,
        logfc_threshold: float = 1.0,
    ) -> dict[str, Any]:
        """
        Prepare volcano plot data for frontend.

        Args:
            diff_expression_df: Differential expression results DataFrame
            pvalue_threshold: P-value threshold for significance
            logfc_threshold: Log2 fold change threshold for significance

        Returns:
            Dictionary with plot data
        """
        # Determine column names
        logfc_col = "logFC" if "logFC" in diff_expression_df.columns else "log_fc"
        pval_col = "pval" if "pval" in diff_expression_df.columns else "adj.P.Val"
        protein_col = (
            "Protein"
            if "Protein" in diff_expression_df.columns
            else "master_protein_accessions"
        )
        gene_col = "Gene" if "Gene" in diff_expression_df.columns else "gene_name"

        df = diff_expression_df.copy()

        # Calculate -log10(p-value)
        df["neg_log_pval"] = -np.log10(df[pval_col].replace(0, 1e-300))

        # Determine significance (using parameters, not hardcoded)
        pval_threshold = pvalue_threshold
        logfc_threshold = logfc_threshold

        df["significant"] = (df[pval_col] < pval_threshold) & (
            abs(df[logfc_col]) > logfc_threshold
        )

        # Determine regulation
        df["regulation"] = "not_significant"
        df.loc[df["significant"] & (df[logfc_col] > 0), "regulation"] = "up"
        df.loc[df["significant"] & (df[logfc_col] < 0), "regulation"] = "down"

        # Count significant proteins
        up_count = (df["regulation"] == "up").sum()
        down_count = (df["regulation"] == "down").sum()

        return {
            "x": df[logfc_col].tolist(),
            "y": df["neg_log_pval"].tolist(),
            "protein": df[protein_col].tolist()
            if protein_col in df.columns
            else [""] * len(df),
            "gene": df[gene_col].tolist() if gene_col in df.columns else [""] * len(df),
            "significant": df["significant"].tolist(),
            "regulation": df["regulation"].tolist(),
            "thresholds": {"pvalue": pval_threshold, "logfc": logfc_threshold},
            "summary": {
                "total": len(df),
                "upregulated": int(up_count),
                "downregulated": int(down_count),
                "significant": int(up_count + down_count),
            },
        }

    def generate_volcano_plot_image(
        self,
        data: dict[str, Any],
        output_path: Optional[Path] = None,
        width: int = 10,
        height: int = 8,
        dpi: int = 150,
    ) -> Optional[str]:
        """
        Generate static volcano plot image for PDF.

        Args:
            data: Volcano plot data from prepare_volcano_data
            output_path: Path to save image (optional)
            width: Figure width in inches
            height: Figure height in inches
            dpi: Image resolution

        Returns:
            Base64 encoded PNG string if output_path is None, else None
        """
        fig, ax = plt.subplots(figsize=(width, height), dpi=dpi)

        x = np.array(data["x"])
        y = np.array(data["y"])
        regulation = data["regulation"]

        # Plot points by regulation
        up_mask = np.array([r == "up" for r in regulation])
        down_mask = np.array([r == "down" for r in regulation])
        ns_mask = np.array([r == "not_significant" for r in regulation])

        # Plot non-significant first (background)
        ax.scatter(
            x[ns_mask],
            y[ns_mask],
            c=self.colors["not_significant"],
            alpha=0.5,
            s=20,
            label="Not significant",
        )

        # Plot downregulated
        ax.scatter(
            x[down_mask],
            y[down_mask],
            c=self.colors["downregulated"],
            alpha=0.7,
            s=30,
            label="Downregulated",
        )

        # Plot upregulated
        ax.scatter(
            x[up_mask],
            y[up_mask],
            c=self.colors["upregulated"],
            alpha=0.7,
            s=30,
            label="Upregulated",
        )

        # Add threshold lines
        thresholds = data.get("thresholds", {"pvalue": 0.05, "logfc": 1.0})
        ax.axhline(
            y=-np.log10(thresholds["pvalue"]),
            color="gray",
            linestyle="--",
            alpha=0.5,
            linewidth=1,
        )
        ax.axvline(
            x=thresholds["logfc"], color="gray", linestyle="--", alpha=0.5, linewidth=1
        )
        ax.axvline(
            x=-thresholds["logfc"], color="gray", linestyle="--", alpha=0.5, linewidth=1
        )

        # Labels and title
        ax.set_xlabel("Log2 Fold Change", fontsize=12)
        ax.set_ylabel("-Log10 P-value", fontsize=12)
        ax.set_title("Volcano Plot", fontsize=14, fontweight="bold")

        # Legend
        ax.legend(loc="best", framealpha=0.9)

        # Summary text
        summary = data.get("summary", {})
        summary_text = f"Total: {summary.get('total', 0)} | "
        summary_text += f"Up: {summary.get('upregulated', 0)} | "
        summary_text += f"Down: {summary.get('downregulated', 0)}"
        ax.text(
            0.02,
            0.98,
            summary_text,
            transform=ax.transAxes,
            fontsize=10,
            verticalalignment="top",
            bbox=dict(boxstyle="round", facecolor="wheat", alpha=0.5),
        )

        plt.tight_layout()

        if output_path:
            plt.savefig(
                output_path,
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            return None
        else:
            # Return base64 encoded image
            buf = io.BytesIO()
            plt.savefig(
                buf,
                format="png",
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            buf.seek(0)
            return base64.b64encode(buf.read()).decode("utf-8")

    async def generate_volcano_plot_data(
        self, pvalue_threshold: float = 0.05, logfc_threshold: float = 1.0
    ) -> VolcanoPlotData:
        """
        Generate data for volcano plot.

        Args:
            pvalue_threshold: P-value threshold for significance
            logfc_threshold: LogFC threshold for significance

        Returns:
            VolcanoPlotData with points and thresholds
        """
        if self.diff_data is None:
            raise ProcessingError(
                message="Differential expression data not loaded",
                step=8,
                recoverable=True,
            )

        # Find columns
        gene_col = self._find_column(["gene", "symbol", "gene_name"])
        protein_col = self._find_column(["protein", "accession", "master_protein"])
        pval_col = self._find_column(["pval", "p-value", "pvalue"])
        logfc_col = self._find_column(["logfc", "log2fc", "log2_fold_change"])

        if not pval_col or not logfc_col:
            raise ProcessingError(
                message="Required columns not found for volcano plot",
                step=8,
                recoverable=True,
            )

        points = []
        up_count = 0
        down_count = 0
        not_sig_count = 0

        for _, row in self.diff_data.iterrows():
            protein_id = str(row.get(protein_col, "")) if protein_col else ""
            gene_name = str(row.get(gene_col, "")) if gene_col else protein_id

            log_fc = float(row.get(logfc_col, 0))
            pval = float(row.get(pval_col, 1))

            # Calculate -log10(p-value)
            neg_log_pval = -np.log10(pval) if pval > 0 else 0

            # Determine significance
            significant = pval < pvalue_threshold and abs(log_fc) >= logfc_threshold

            if significant:
                if log_fc > 0:
                    regulation = "up"
                    up_count += 1
                else:
                    regulation = "down"
                    down_count += 1
            else:
                regulation = "not_significant"
                not_sig_count += 1

            point = VolcanoPlotPoint(
                protein_id=protein_id,
                gene_name=gene_name if gene_name else None,
                log_fc=log_fc,
                neg_log_pval=neg_log_pval,
                significant=significant,
                regulation=regulation,
            )

            points.append(point)

        return VolcanoPlotData(
            points=points,
            thresholds={"pvalue": pvalue_threshold, "logfc": logfc_threshold},
            summary={
                "total": len(points),
                "up": up_count,
                "down": down_count,
                "not_significant": not_sig_count,
            },
        )

    # =========================================================================
    # QC Plot Functions
    # =========================================================================

    def generate_pca_plot(
        self,
        pca_data: PCAResult,
        output_path: Optional[Path] = None,
        width: int = 10,
        height: int = 8,
        dpi: int = 150,
    ) -> Optional[str]:
        """
        Generate PCA scatter plot.

        Args:
            pca_data: PCA results
            output_path: Path to save image (optional)
            width: Figure width in inches
            height: Figure height in inches
            dpi: Image resolution

        Returns:
            Base64 encoded PNG string if output_path is None, else None
        """
        fig, ax = plt.subplots(figsize=(width, height), dpi=dpi)

        # Get unique conditions and assign colors
        conditions = list(set(pca_data.conditions))
        colors = plt.cm.Set2(np.linspace(0, 1, len(conditions)))
        color_map = dict(zip(conditions, colors))

        # Plot points
        for i, sample in enumerate(pca_data.samples):
            condition = pca_data.conditions[i]
            ax.scatter(
                pca_data.pc1[i],
                pca_data.pc2[i],
                c=[color_map[condition]],
                s=100,
                alpha=0.7,
                edgecolors="black",
                linewidth=1,
            )

            # Add sample labels
            ax.annotate(
                sample,
                (pca_data.pc1[i], pca_data.pc2[i]),
                xytext=(5, 5),
                textcoords="offset points",
                fontsize=8,
                alpha=0.7,
            )

        # Labels
        ax.set_xlabel(f"PC1 ({pca_data.pc1_variance:.1f}%)", fontsize=12)
        ax.set_ylabel(f"PC2 ({pca_data.pc2_variance:.1f}%)", fontsize=12)
        ax.set_title("PCA Analysis", fontsize=14, fontweight="bold")

        # Legend
        legend_elements = [
            Patch(facecolor=color_map[c], edgecolor="black", label=c)
            for c in conditions
        ]
        ax.legend(handles=legend_elements, loc="best", title="Condition")

        plt.tight_layout()

        if output_path:
            plt.savefig(
                output_path,
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            return None
        else:
            buf = io.BytesIO()
            plt.savefig(
                buf,
                format="png",
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            buf.seek(0)
            return base64.b64encode(buf.read()).decode("utf-8")

    def generate_pvalue_distribution_plot(
        self,
        pvalue_data: dict[str, Any],
        output_path: Optional[Path] = None,
        width: int = 10,
        height: int = 6,
        dpi: int = 150,
    ) -> Optional[str]:
        """
        Generate p-value distribution histogram.

        Args:
            pvalue_data: P-value distribution data with bins and counts
            output_path: Path to save image (optional)
            width: Figure width in inches
            height: Figure height in inches
            dpi: Image resolution

        Returns:
            Base64 encoded PNG string if output_path is None, else None
        """
        fig, ax = plt.subplots(figsize=(width, height), dpi=dpi)

        bins = pvalue_data.get("bins", [])
        counts = pvalue_data.get("counts", [])

        if bins and counts:
            # Use bin centers for bar positions
            bin_centers = [(bins[i] + bins[i + 1]) / 2 for i in range(len(bins) - 1)]
            bin_width = bins[1] - bins[0] if len(bins) > 1 else 0.05

            ax.bar(
                bin_centers,
                counts,
                width=bin_width * 0.9,
                color="#3498DB",
                edgecolor="black",
                alpha=0.7,
            )

        ax.set_xlabel("P-value", fontsize=12)
        ax.set_ylabel("Count", fontsize=12)
        ax.set_title("P-value Distribution", fontsize=14, fontweight="bold")
        ax.set_xlim(0, 1)

        # Add uniform distribution reference line
        if counts:
            expected = sum(counts) / len(counts) if counts else 0
            ax.axhline(
                y=expected,
                color="red",
                linestyle="--",
                alpha=0.5,
                label="Uniform distribution",
            )
            ax.legend()

        plt.tight_layout()

        if output_path:
            plt.savefig(
                output_path,
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            return None
        else:
            buf = io.BytesIO()
            plt.savefig(
                buf,
                format="png",
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            buf.seek(0)
            return base64.b64encode(buf.read()).decode("utf-8")

    def generate_cv_plot(
        self,
        cv_data: dict[str, list[float]],
        output_path: Optional[Path] = None,
        width: int = 10,
        height: int = 6,
        dpi: int = 150,
    ) -> Optional[str]:
        """
        Generate coefficient of variation box plot.

        Args:
            cv_data: Dictionary mapping condition to CV values
            output_path: Path to save image (optional)
            width: Figure width in inches
            height: Figure height in inches
            dpi: Image resolution

        Returns:
            Base64 encoded PNG string if output_path is None, else None
        """
        fig, ax = plt.subplots(figsize=(width, height), dpi=dpi)

        conditions = list(cv_data.keys())
        values = [cv_data[c] for c in conditions]

        if values:
            bp = ax.boxplot(values, labels=conditions, patch_artist=True)

            # Color boxes
            colors = plt.cm.Set3(np.linspace(0, 1, len(conditions)))
            for patch, color in zip(bp["boxes"], colors):
                patch.set_facecolor(color)
                patch.set_alpha(0.7)

        ax.set_xlabel("Condition", fontsize=12)
        ax.set_ylabel("Coefficient of Variation", fontsize=12)
        ax.set_title(
            "PSM Coefficient of Variation by Condition", fontsize=14, fontweight="bold"
        )
        ax.tick_params(axis="x", rotation=45)

        plt.tight_layout()

        if output_path:
            plt.savefig(
                output_path,
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            return None
        else:
            buf = io.BytesIO()
            plt.savefig(
                buf,
                format="png",
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            buf.seek(0)
            return base64.b64encode(buf.read()).decode("utf-8")

    def generate_intensity_distribution_plot(
        self,
        intensity_data: dict[str, Any],
        output_path: Optional[Path] = None,
        width: int = 10,
        height: int = 6,
        dpi: int = 150,
    ) -> Optional[str]:
        """
        Generate intensity distribution plot.

        Args:
            intensity_data: Intensity distribution data
            output_path: Path to save image (optional)
            width: Figure width in inches
            height: Figure height in inches
            dpi: Image resolution

        Returns:
            Base64 encoded PNG string if output_path is None, else None
        """
        fig, ax = plt.subplots(figsize=(width, height), dpi=dpi)

        # Plot protein intensities
        protein_data = intensity_data.get("protein", {})

        if protein_data:
            conditions = list(protein_data.keys())
            for i, condition in enumerate(conditions):
                intensities = protein_data[condition]
                if intensities:
                    ax.hist(
                        intensities, bins=50, alpha=0.5, label=condition, density=True
                    )

        ax.set_xlabel("Log2 Intensity", fontsize=12)
        ax.set_ylabel("Density", fontsize=12)
        ax.set_title("Protein Intensity Distribution", fontsize=14, fontweight="bold")
        ax.legend(loc="best")

        plt.tight_layout()

        if output_path:
            plt.savefig(
                output_path,
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            return None
        else:
            buf = io.BytesIO()
            plt.savefig(
                buf,
                format="png",
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            buf.seek(0)
            return base64.b64encode(buf.read()).decode("utf-8")

    def generate_data_completeness_plot(
        self,
        completeness_data: list[dict[str, Any]],
        output_path: Optional[Path] = None,
        width: int = 12,
        height: int = 6,
        dpi: int = 150,
    ) -> Optional[str]:
        """
        Generate data completeness bar plot.

        Args:
            completeness_data: List of data completeness entries
            output_path: Path to save image (optional)
            width: Figure width in inches
            height: Figure height in inches
            dpi: Image resolution

        Returns:
            Base64 encoded PNG string if output_path is None, else None
        """
        fig, ax = plt.subplots(figsize=(width, height), dpi=dpi)

        if completeness_data:
            samples = [d["sample"] for d in completeness_data]
            present = [d["present"] for d in completeness_data]
            missing = [d["missing"] for d in completeness_data]

            x = np.arange(len(samples))
            width_bar = 0.35

            ax.bar(x, present, width_bar, label="Present", color="#27AE60")
            ax.bar(
                x, missing, width_bar, bottom=present, label="Missing", color="#E74C3C"
            )

            ax.set_xlabel("Sample", fontsize=12)
            ax.set_ylabel("Number of Proteins", fontsize=12)
            ax.set_title("Data Completeness by Sample", fontsize=14, fontweight="bold")
            ax.set_xticks(x)
            ax.set_xticklabels(samples, rotation=45, ha="right")
            ax.legend()

        plt.tight_layout()

        if output_path:
            plt.savefig(
                output_path,
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            return None
        else:
            buf = io.BytesIO()
            plt.savefig(
                buf,
                format="png",
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            buf.seek(0)
            return base64.b64encode(buf.read()).decode("utf-8")

    # =========================================================================
    # GSEA Plot Functions
    # =========================================================================

    def generate_gsea_bar_plot(
        self,
        gsea_results: GSEAResults,
        output_path: Optional[Path] = None,
        width: int = 12,
        height: int = 8,
        dpi: int = 150,
        top_n: int = 15,
    ) -> Optional[str]:
        """
        Generate GSEA bar plot of top pathways.

        Args:
            gsea_results: GSEA results
            output_path: Path to save image (optional)
            width: Figure width in inches
            height: Figure height in inches
            dpi: Image resolution
            top_n: Number of top pathways to show

        Returns:
            Base64 encoded PNG string if output_path is None, else None
        """
        fig, ax = plt.subplots(figsize=(width, height), dpi=dpi)

        # Get significant results
        significant = [r for r in gsea_results.results if r.significant]
        significant.sort(key=lambda x: abs(x.nes), reverse=True)

        if not significant:
            ax.text(
                0.5,
                0.5,
                "No significant pathways found",
                ha="center",
                va="center",
                fontsize=14,
            )
            ax.set_xlim(0, 1)
            ax.set_ylim(0, 1)
            ax.axis("off")
        else:
            # Take top N
            top = significant[:top_n]

            # Prepare data
            names = [r.name[:50] + "..." if len(r.name) > 50 else r.name for r in top]
            nes_values = [r.nes for r in top]
            colors = [
                self.colors["upregulated"] if n > 0 else self.colors["downregulated"]
                for n in nes_values
            ]

            # Create horizontal bar plot
            y_pos = np.arange(len(names))
            ax.barh(y_pos, nes_values, color=colors, alpha=0.7, edgecolor="black")

            ax.set_yticks(y_pos)
            ax.set_yticklabels(names, fontsize=9)
            ax.invert_yaxis()
            ax.set_xlabel("Normalized Enrichment Score (NES)", fontsize=12)
            ax.set_title(
                f"GSEA: {gsea_results.database}\nTop {len(top)} Significant Pathways",
                fontsize=14,
                fontweight="bold",
            )
            ax.axvline(x=0, color="black", linewidth=0.8)

            # Add NES values as text
            for i, (name, nes) in enumerate(zip(names, nes_values)):
                ax.text(nes, i, f" {nes:.2f}", va="center", fontsize=8)

        plt.tight_layout()

        if output_path:
            plt.savefig(
                output_path,
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            return None
        else:
            buf = io.BytesIO()
            plt.savefig(
                buf,
                format="png",
                dpi=dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
            plt.close(fig)
            buf.seek(0)
            return base64.b64encode(buf.read()).decode("utf-8")

    # =========================================================================
    # Combined QC Report
    # =========================================================================

    def generate_qc_report(
        self, qc_data: QCData, output_dir: Path, dpi: int = 150
    ) -> dict[str, Path]:
        """
        Generate all QC plots and save to directory.

        Args:
            qc_data: QC data
            output_dir: Directory to save plots
            dpi: Image resolution

        Returns:
            Dictionary mapping plot name to file path
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        plots = {}

        # PCA plot
        if qc_data.pca:
            pca_path = output_dir / "pca_plot.png"
            self.generate_pca_plot(qc_data.pca, pca_path, dpi=dpi)
            plots["pca"] = pca_path

        # P-value distribution
        if qc_data.pvalue_distribution:
            pval_path = output_dir / "pvalue_distribution.png"
            self.generate_pvalue_distribution_plot(
                qc_data.pvalue_distribution.model_dump(), pval_path, dpi=dpi
            )
            plots["pvalue_distribution"] = pval_path

        # CV plot
        if qc_data.psm_cv:
            cv_path = output_dir / "cv_plot.png"
            self.generate_cv_plot(qc_data.psm_cv, cv_path, dpi=dpi)
            plots["cv"] = cv_path

        # Intensity distribution
        if qc_data.intensity_distributions:
            intensity_path = output_dir / "intensity_distribution.png"
            self.generate_intensity_distribution_plot(
                qc_data.intensity_distributions.model_dump(), intensity_path, dpi=dpi
            )
            plots["intensity"] = intensity_path

        # Data completeness
        if qc_data.data_completeness:
            completeness_path = output_dir / "data_completeness.png"
            self.generate_data_completeness_plot(
                [c.model_dump() for c in qc_data.data_completeness],
                completeness_path,
                dpi=dpi,
            )
            plots["completeness"] = completeness_path

        return plots

    # =========================================================================
    # Heatmap Functions
    # =========================================================================

    async def generate_heatmap_data(
        self, top_n: int = 50, pvalue_threshold: float = 0.05
    ) -> Optional[HeatmapData]:
        """
        Generate data for heatmap.

        Args:
            top_n: Number of top proteins to include
            pvalue_threshold: P-value threshold for filtering

        Returns:
            HeatmapData or None
        """
        if self.diff_data is None or self.protein_data is None:
            return None

        # Find columns
        pval_col = self._find_column(["pval", "p-value", "pvalue"])
        protein_col = self._find_column(["protein", "accession", "master_protein"])
        gene_col = self._find_column(["gene", "symbol", "gene_name"])

        if not pval_col:
            return None

        # Filter significant proteins
        sig_df = self.diff_data[self.diff_data[pval_col] < pvalue_threshold].copy()

        if len(sig_df) == 0:
            return None

        # Sort by p-value and take top N
        sig_df = sig_df.nsmallest(top_n, pval_col)

        # Get protein IDs
        if protein_col:
            protein_ids = sig_df[protein_col].tolist()
        else:
            protein_ids = sig_df.iloc[:, 0].tolist()

        # Get gene names for labels
        if gene_col:
            row_labels = sig_df[gene_col].tolist()
        else:
            row_labels = protein_ids

        # Find abundance columns in protein data
        id_cols = ["Master Protein Accessions", "Gene_Name", "Protein"]
        abundance_cols = [
            col
            for col in self.protein_data.columns
            if col not in id_cols
            and self.protein_data[col].dtype in ["float64", "float32"]
        ]

        if len(abundance_cols) == 0:
            return None

        # Filter protein data to significant proteins
        protein_id_col = None
        for col in id_cols:
            if col in self.protein_data.columns:
                protein_id_col = col
                break

        if protein_id_col is None:
            protein_id_col = self.protein_data.columns[0]

        # Get values for heatmap
        values = []
        for protein_id in protein_ids:
            row = self.protein_data[self.protein_data[protein_id_col] == protein_id]
            if len(row) > 0:
                row_values = row[abundance_cols].iloc[0].tolist()
                values.append(row_values)
            else:
                values.append([np.nan] * len(abundance_cols))

        return HeatmapData(
            proteins=protein_ids,
            samples=abundance_cols,
            values=values,
            row_labels=row_labels,
            col_labels=abundance_cols,
        )

    # =========================================================================
    # Protein Results Functions
    # =========================================================================

    async def get_protein_results(
        self, significant_only: bool = False, pvalue_threshold: float = 0.05
    ) -> list[DifferentialExpressionResult]:
        """
        Get differential expression results.

        Args:
            significant_only: Return only significant results
            pvalue_threshold: P-value threshold

        Returns:
            List of DifferentialExpressionResult
        """
        if self.diff_data is None:
            return []

        # Find columns
        protein_col = self._find_column(["protein", "accession", "master_protein"])
        gene_col = self._find_column(["gene", "symbol", "gene_name"])
        pval_col = self._find_column(["pval", "p-value", "pvalue"])
        adj_pval_col = self._find_column(["adj_pval", "adj_pvalue", "padj", "fdr"])
        logfc_col = self._find_column(["logfc", "log2fc"])
        se_col = self._find_column(["se", "std_error"])
        df_col = self._find_column(["df", "degrees_freedom"])

        results = []

        for _, row in self.diff_data.iterrows():
            protein_id = str(row.get(protein_col, "")) if protein_col else ""
            gene_name = str(row.get(gene_col, "")) if gene_col else None

            pval = float(row.get(pval_col, 1)) if pval_col else 1.0
            adj_pval = float(row.get(adj_pval_col, 1)) if adj_pval_col else pval
            logfc = float(row.get(logfc_col, 0)) if logfc_col else 0.0
            se = float(row.get(se_col, 0)) if se_col else None
            df = float(row.get(df_col, 0)) if df_col else None

            significant = pval < pvalue_threshold

            if significant_only and not significant:
                continue

            result = DifferentialExpressionResult(
                master_protein_accessions=protein_id,
                gene_name=gene_name,
                log_fc=logfc,
                pval=pval,
                adj_pval=adj_pval,
                se=se,
                df=df,
                significant=significant,
            )

            results.append(result)

        return results

    def _find_column(self, possible_names: list[str]) -> Optional[str]:
        """
        Find column by possible names (case-insensitive).

        Args:
            possible_names: List of possible column names

        Returns:
            Column name if found, None otherwise
        """
        if self.diff_data is None:
            return None

        columns_lower = {col.lower(): col for col in self.diff_data.columns}

        for name in possible_names:
            if name.lower() in columns_lower:
                return columns_lower[name.lower()]

        return None


# Global plot generator instance
plot_generator = PlotGenerator()
