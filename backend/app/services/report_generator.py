"""
PDF Report Generator Service.

Generates comprehensive PDF reports from analysis results using HTML → PDF
conversion via Playwright for professional styling. Plots are captured from
the frontend as base64 PNG images to ensure the report matches what the user sees.
"""

import asyncio
import json
import logging
import numpy as np
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import pandas as pd
from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.config import settings
from app.core.exceptions import ProcessingError
from app.models.session import Session
from app.models.analysis import AnalysisResult, ReportRequest
from app.models.data import QCData, GSEAResults, PCAResult

logger = logging.getLogger("proteomics")


class ReportGenerator:
    """
    PDF report generator using HTML → Playwright → PDF approach.

    Generates professional scientific reports with all analysis sections
    and embedded matplotlib plot images.
    """

    def __init__(self):
        """Initialize report generator."""
        self.template_dir = settings.base_dir / "templates"
        self.env = Environment(
            loader=FileSystemLoader(self.template_dir),
            autoescape=select_autoescape(['html', 'xml'])
        )

    async def generate_report(
        self,
        session: Session,
        analysis_result: AnalysisResult,
        report_request: Optional[ReportRequest] = None,
        qc_data: Optional[QCData] = None,
        gsea_results: Optional[dict[str, GSEAResults]] = None,
        output_path: Optional[Path] = None
    ) -> Path:
        """
        Generate complete PDF report.

        Args:
            session: Session object with metadata
            analysis_result: Analysis results
            report_request: Report configuration (optional, uses defaults)
            qc_data: QC metrics data (optional)
            gsea_results: GSEA results by database (optional)
            output_path: Output PDF path (optional, auto-generated)

        Returns:
            Path to generated PDF file

        Raises:
            ProcessingError: If report generation fails
        """
        if report_request is None:
            report_request = ReportRequest()

        if output_path is None:
            output_path = self._get_default_output_path(session.id)

        logger.info(f"Generating report for session {session.id}")

        try:
            # Prepare report data (includes generating plot images)
            report_data = await self._prepare_report_data(
                session=session,
                analysis_result=analysis_result,
                report_request=report_request,
                qc_data=qc_data,
                gsea_results=gsea_results
            )

            # Generate HTML
            html_content = await self._generate_html(report_data)

            # Convert to PDF
            await self._html_to_pdf(html_content, output_path)

            logger.info(f"Report generated: {output_path}")
            return output_path

        except Exception as e:
            logger.error(f"Report generation failed: {e}")
            raise ProcessingError(
                message=f"Failed to generate report: {str(e)}",
                step=0,
                recoverable=True
            )

    def _get_default_output_path(self, session_id: str) -> Path:
        """Get default output path for report."""
        results_dir = settings.sessions_dir / session_id / "results"
        results_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return results_dir / f"report_{timestamp}.pdf"

    async def _prepare_report_data(
        self,
        session: Session,
        analysis_result: AnalysisResult,
        report_request: ReportRequest,
        qc_data: Optional[QCData] = None,
        gsea_results: Optional[dict[str, GSEAResults]] = None
    ) -> dict[str, Any]:
        """
        Prepare all data needed for the report, including plot images.
        """
        images = report_request.images or {}

        data = {
            "report_title": f"Proteomics Analysis Report - {session.name}",
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "session": session,
            "analysis_result": analysis_result,
            "report_request": report_request,
        }

        # Section 1: Sample Information
        data["sample_info"] = self._prepare_sample_info(session)

        # Section 2: User Configuration
        data["user_config"] = self._prepare_user_config(session)

        # Section 3: Results (with frontend-captured volcano plot image)
        if report_request.include_volcano_plot or report_request.include_protein_table:
            data["results"] = await self._prepare_results_section(
                analysis_result, report_request
            )

        # Section 4: QC Plots (with frontend-captured plot images)
        if report_request.include_qc_plots and qc_data:
            data["qc_data"] = await self._prepare_qc_section(qc_data, images)

        # Section 5: Bioinformatics Analysis
        if report_request.include_gsea_results and gsea_results:
            data["gsea_results"] = self._prepare_gsea_section(gsea_results, images)

        return data

    def _prepare_sample_info(self, session: Session) -> dict[str, Any]:
        """Prepare sample information section."""
        files = session.files

        condition_counts: dict[str, int] = {}
        if files and files.proteomics:
            for f in files.proteomics:
                condition_counts[f.condition] = condition_counts.get(f.condition, 0) + 1

        return {
            "session_name": session.name,
            "session_id": session.id,
            "created_at": session.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "uploaded_files": [
                {
                    "filename": f.filename,
                    "condition": f.condition,
                    "replicate": f.replicate,
                    "size_mb": round(f.size / (1024 * 1024), 2)
                }
                for f in (files.proteomics if files else [])
            ],
            "conditions": list(condition_counts.keys()),
            "replicate_counts": condition_counts,
            "total_files": len(files.proteomics) if files else 0,
            "has_compound_file": files.compound is not None if files else False,
        }

    def _prepare_user_config(self, session: Session) -> dict[str, Any]:
        """Prepare user configuration section."""
        config = session.config

        if not config:
            return {
                "treatment": "N/A",
                "control": "N/A",
                "organism": "N/A",
                "remove_razor": "N/A",
                "strict_filtering": "N/A",
            }

        return {
            "treatment": config.treatment,
            "control": config.control,
            "organism": config.organism.capitalize(),
            "remove_razor": "Yes" if config.remove_razor else "No",
            "strict_filtering": "Yes" if config.strict_filtering else "No",
        }

    async def _prepare_results_section(
        self,
        analysis_result: AnalysisResult,
        report_request: ReportRequest
    ) -> dict[str, Any]:
        """Prepare results section using frontend-captured volcano plot image."""
        images = report_request.images or {}
        results: dict[str, Any] = {}

        # Use frontend-captured volcano plot image if provided
        if report_request.include_volcano_plot and "volcano_plot" in images:
            results["volcano_plot_image"] = images["volcano_plot"][0]

        if analysis_result.diff_expression_path:
            diff_path = Path(analysis_result.diff_expression_path)
            if diff_path.exists():
                df = await asyncio.to_thread(pd.read_csv, diff_path, sep='\t')

                # Total proteins = rows in diff expression table (matches Protein_Abundances)
                results["total_proteins"] = len(df)

                # Calculate significant count using user filters
                fc = report_request.fold_change
                pval_thresh = report_request.p_value
                s0 = report_request.s0 * fc

                pcol = self._find_col(df, ['pval', 'adj.P.Val', 'p_value', 'P.Value'])
                fcol = self._find_col(df, ['logFC', 'log_fc', 'Log2FC', 'log2fc'])

                if pcol and fcol:
                    if s0 == 0:
                        sig_mask = (df[pcol] <= pval_thresh) & (abs(df[fcol]) >= fc)
                    else:
                        plog10_thresh = -np.log10(pval_thresh)
                        c = plog10_thresh * (fc - s0)
                        abs_x = abs(df[fcol])
                        y = -df[pcol].apply(lambda x: np.log10(max(x, 1e-300)))
                        sig_mask = (abs_x > s0) & (y > plog10_thresh + c / (abs_x - s0))
                    results["significant_proteins"] = int(sig_mask.sum())
                    results["upregulated"] = int((sig_mask & (df[fcol] > 0)).sum())
                    results["downregulated"] = int((sig_mask & (df[fcol] < 0)).sum())

                # Prepare top significant proteins table (top 50 by p-value)
                if report_request.include_protein_table:
                    results["top_proteins"] = self._prepare_top_proteins_table(
                        df, n=50, fc=fc, pval_thresh=pval_thresh,
                        adj_pval_thresh=report_request.adj_p_value,
                        s0=s0,
                    )

        return results

    @staticmethod
    def _find_col(df: pd.DataFrame, candidates: list[str]) -> Optional[str]:
        """Find first matching column name."""
        for c in candidates:
            if c in df.columns:
                return c
        return None

    @staticmethod
    def _is_significant(log_fc: float, pval: float, adj_pval: float,
                        fc: float, pval_thresh: float, adj_pval_thresh: float, s0: float) -> bool:
        """Check significance using hyperbolic S0-factor cutoff, matching frontend isSignificantVolcano."""
        if s0 == 0:
            return abs(log_fc) >= fc and pval <= pval_thresh and adj_pval <= adj_pval_thresh
        plog10_thresh = -np.log10(pval_thresh)
        c = plog10_thresh * (fc - s0)
        y = -np.log10(max(pval, 1e-300))
        abs_x = abs(log_fc)
        if abs_x <= s0:
            return False
        return y > plog10_thresh + c / (abs_x - s0)

    def _prepare_top_proteins_table(
        self,
        df: pd.DataFrame,
        n: int = 50,
        fc: float = 1.0,
        pval_thresh: float = 0.05,
        adj_pval_thresh: float = 1.0,
        s0: float = 0.0,
    ) -> list[dict[str, Any]]:
        """Prepare top significant proteins table, ranked by significance score."""
        logfc_col = self._find_col(df, ['logFC', 'log_fc', 'Log2FC', 'log2fc'])
        pval_col = self._find_col(df, ['pval', 'adj.P.Val', 'adjPval', 'p_value', 'P.Value'])
        protein_col = self._find_col(df, ['Master_Protein_Accessions', 'Protein', 'master_protein_accessions', 'protein'])
        gene_col = self._find_col(df, ['Gene_Name', 'Gene', 'gene_name', 'gene'])
        adjpval_col = self._find_col(df, ['adjPval', 'adj.P.Val', 'P.Value', 'adj_pval'])
        if logfc_col is None:
            logfc_col = 'logFC'
        if pval_col is None:
            pval_col = 'pval'

        # Rank by significance: significant proteins first, then by p-value within each group
        df = df.copy()
        df['_is_sig'] = df.apply(
            lambda r: self._is_significant(
                r.get(logfc_col, 0), r.get(pval_col, 1),
                r.get(adjpval_col, r.get(pval_col, 1)) if adjpval_col else r.get(pval_col, 1),
                fc, pval_thresh, adj_pval_thresh, s0
            ),
            axis=1,
        )
        df['_pval_sort'] = df[pval_col].clip(lower=1e-300)
        df_sorted = df.sort_values(['_is_sig', '_pval_sort'], ascending=[False, True]).head(n)

        table_data = []
        for _, row in df_sorted.iterrows():
            row_log_fc = row.get(logfc_col, 0)
            row_pval = row.get(pval_col, 1)
            row_adj_pval = row.get(adjpval_col, row_pval) if adjpval_col else row_pval
            is_sig = self._is_significant(row_log_fc, row_pval, row_adj_pval,
                                          fc, pval_thresh, adj_pval_thresh, s0)
            entry = {
                "protein": row.get(protein_col, "N/A") if protein_col else "N/A",
                "gene": row.get(gene_col, "N/A") if gene_col else "N/A",
                "log_fc": round(row_log_fc, 3),
                "pval": f"{row_pval:.2e}" if pval_col in row else "N/A",
                "adj_pval": f"{row_adj_pval:.2e}" if adjpval_col and adjpval_col in row else "N/A",
                "significant": is_sig,
            }
            table_data.append(entry)

        return table_data

    async def _prepare_qc_section(self, qc_data: QCData, images: Optional[dict[str, list[str]]] = None) -> dict[str, Any]:
        """Prepare QC plots section using frontend-captured plot images."""
        images = images or {}
        qc_section = {}

        # PCA plot
        if qc_data.pca:
            qc_section["pca"] = {
                "samples": qc_data.pca.samples,
                "pc1": qc_data.pca.pc1,
                "pc2": qc_data.pca.pc2,
                "conditions": qc_data.pca.conditions,
                "pc1_variance": round(qc_data.pca.pc1_variance, 2),
                "pc2_variance": round(qc_data.pca.pc2_variance, 2),
                "plot_image": images.get("qc_pca", [None])[0],
            }

        # P-value distribution
        if qc_data.pvalue_distribution:
            qc_section["pvalue_distribution"] = {
                "bins": qc_data.pvalue_distribution.bins,
                "counts": qc_data.pvalue_distribution.counts,
                "plot_image": images.get("qc_pvalue", [None])[0],
            }

        # CV data (PSM + Protein)
        if qc_data.psm_cv:
            qc_section["psm_cv_data"] = qc_data.psm_cv
            qc_section["psm_cv_plot_image"] = images.get("qc_psm_cv", [None])[0]

        if qc_data.protein_cv:
            qc_section["protein_cv_data"] = qc_data.protein_cv
            qc_section["protein_cv_plot_image"] = images.get("qc_protein_cv", [None])[0]

        # Intensity distributions (PSM + Protein)
        if qc_data.intensity_distributions:
            qc_section["intensity_distributions"] = qc_data.intensity_distributions
            qc_section["psm_intensity_plot_image"] = images.get("qc_psm_intensity", [None])[0]
            qc_section["protein_intensity_plot_image"] = images.get("qc_protein_intensity", [None])[0]

        # Data completeness (Protein + PSM)
        if qc_data.data_completeness:
            qc_section["data_completeness"] = [
                {
                    "sample": dc.sample,
                    "missing": dc.missing,
                    "present": dc.present,
                    "completeness_pct": round(dc.completeness_pct, 2)
                }
                for dc in qc_data.data_completeness
            ]
            qc_section["completeness_plot_image"] = images.get("qc_completeness", [None])[0]

        if qc_data.psm_completeness:
            qc_section["psm_completeness"] = [
                {
                    "sample": dc.sample,
                    "missing": dc.missing,
                    "present": dc.present,
                    "completeness_pct": round(dc.completeness_pct, 2)
                }
                for dc in qc_data.psm_completeness
            ]
            qc_section["psm_completeness_plot_image"] = images.get("qc_psm_completeness", [None])[0]

        return qc_section

    @staticmethod
    def _format_pval(val: float) -> str:
        """Format p-value, handling zero values gracefully."""
        if val == 0:
            return "< 1.0e-300"
        return f"{val:.2e}"

    def _prepare_gsea_section(
        self,
        gsea_results: dict[str, GSEAResults],
        images: Optional[dict[str, list[str]]] = None,
    ) -> dict[str, Any]:
        """Prepare GSEA results section."""
        images = images or {}
        gsea_section = {
            "databases": []
        }

        for db_name, results in gsea_results.items():
            db_data = {
                "name": db_name,
                "total_pathways": results.total_pathways,
                "significant_pathways": results.significant_pathways,
                "overrepresented": results.overrepresented,
                "underrepresented": results.underrepresented,
                "top_pathways": []
            }

            # Get top 10 significant pathways
            significant = [r for r in results.results if r.significant]
            significant.sort(key=lambda x: x.fdr)

            for result in significant[:10]:
                db_data["top_pathways"].append({
                    "term": result.term,
                    "name": result.name,
                    "nes": round(result.nes, 3),
                    "pval": self._format_pval(result.pval),
                    "fdr": self._format_pval(result.fdr),
                    "direction": result.enrichment_direction,
                    "matched_genes": result.matched_genes,
                })

            gsea_section["databases"].append(db_data)

        # Add GSEA dashboard image if provided
        if "gsea_dashboard" in images:
            gsea_section["dashboard_image"] = images["gsea_dashboard"][0]

        return gsea_section

    async def _generate_html(self, report_data: dict[str, Any]) -> str:
        """
        Generate HTML from template and data.

        Args:
            report_data: Dictionary with all report data

        Returns:
            HTML string
        """
        template = self.env.get_template("report_template.html")
        return template.render(**report_data)

    async def _html_to_pdf(self, html_content: str, output_path: Path) -> None:
        """
        Convert HTML to PDF using Playwright in a separate process.

        We use a dedicated Python subprocess to bypass the ProactorEventLoop
        incompatibility with Playwright's subprocess management on Windows.

        Args:
            html_content: HTML string
            output_path: Output PDF path

        Raises:
            ProcessingError: If PDF conversion fails
        """
        try:
            import subprocess
            import tempfile

            # Write HTML to temp file
            tmp_html = tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False, encoding='utf-8')
            tmp_html.write(html_content)
            tmp_html.close()

            # Run Playwright via a dedicated Python process (uses default ProactorEventLoop)
            helper_script = str(Path(__file__).parent / "pdf_converter.py")
            python_exe = settings.base_dir / ".venv" / "Scripts" / "python.exe"
            result = subprocess.run(
                [str(python_exe), helper_script, tmp_html.name, str(output_path)],
                capture_output=True, text=True, timeout=120, cwd=settings.base_dir
            )

            import os
            os.unlink(tmp_html.name)

            if result.returncode != 0:
                raise RuntimeError(f"Playwright failed: {result.stderr}")

        except Exception as e:
            raise ProcessingError(
                message=f"PDF conversion failed: {str(e)}",
                step=0,
                recoverable=True
            )

    async def generate_report_from_files(
        self,
        session: Session,
        diff_expression_path: Path,
        protein_abundances_path: Optional[Path] = None,
        qc_data_path: Optional[Path] = None,
        gsea_results_path: Optional[Path] = None,
        output_path: Optional[Path] = None,
        report_request: Optional[ReportRequest] = None
    ) -> Path:
        """
        Generate report directly from result files.
        """
        if report_request is None:
            report_request = ReportRequest()

        # Create analysis result from files
        analysis_result = AnalysisResult(
            session_id=session.id,
            diff_expression_path=str(diff_expression_path),
            protein_abundances_path=str(protein_abundances_path) if protein_abundances_path else None,
        )

        # Load QC data if available
        qc_data = None
        if qc_data_path and qc_data_path.exists():
            with open(qc_data_path, encoding='utf-8') as f:
                qc_data = QCData.model_validate_json(f.read())

        # Load GSEA results if available
        gsea_results = None
        if gsea_results_path and gsea_results_path.exists():
            with open(gsea_results_path, encoding='utf-8') as f:
                gsea_data = json.load(f)
                gsea_results = {
                    db: GSEAResults.model_validate(data)
                    for db, data in gsea_data.items()
                }

        return await self.generate_report(
            session=session,
            analysis_result=analysis_result,
            report_request=report_request,
            qc_data=qc_data,
            gsea_results=gsea_results,
            output_path=output_path
        )


# Global report generator instance
report_generator = ReportGenerator()
