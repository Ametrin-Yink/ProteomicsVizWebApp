"""
QC metrics calculation service (Step 8).

Calculates quality control metrics including PCA, p-value distribution,
CV analysis, intensity distributions, and data completeness.
"""

import asyncio
import logging
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from app.models.data import DataCompleteness, PCAResult, PValueDistribution, QCData

logger = logging.getLogger("proteomics")


class QCCalculator:
    """
    Quality control metrics calculator.

    Implements step 8 of the pipeline: QC metrics calculation.
    """

    async def calculate_all_metrics(
        self,
        protein_abundances_path: Path,
        diff_expression_paths: list[Path],
        psm_abundances_path: Path | None = None,
    ) -> QCData:
        """
        Calculate all QC metrics.

        Args:
            protein_abundances_path: Path to Protein_Abundances.tsv
            diff_expression_paths: List of paths to Diff_Expression_*.tsv files
            psm_abundances_path: Optional path to PSM_Abundances.tsv

        Returns:
            QCData object with all metrics
        """
        logger.info("Step 8: Calculating QC metrics")

        # Load data
        protein_df = await asyncio.to_thread(
            pd.read_csv, protein_abundances_path, sep="\t"
        )

        # Compute per-comparison p-value distributions (parallel reads)
        async def _read_de_file(path: Path):
            return path, await asyncio.to_thread(pd.read_csv, path, sep="\t")

        pvalue_distributions: dict[str, PValueDistribution] = {}
        if diff_expression_paths:
            results = await asyncio.gather(
                *[_read_de_file(p) for p in diff_expression_paths],
                return_exceptions=True,
            )
            for result in results:
                if isinstance(result, Exception):
                    logger.warning(f"Could not read DE file: {result}", exc_info=True)
                    continue
                path, comp_df = result
                label = path.stem.replace("Diff_Expression_", "")
                try:
                    pvalue_distributions[label] = self._calculate_pvalue_distribution(
                        comp_df
                    )
                except Exception:
                    logger.warning(
                        f"Could not compute p-value distribution for {path.name}",
                        exc_info=True,
                    )

        psm_df = None
        if psm_abundances_path and psm_abundances_path.exists():
            if str(psm_abundances_path).endswith(".parquet"):
                psm_df = await asyncio.to_thread(pd.read_parquet, psm_abundances_path)
            else:
                psm_df = await asyncio.to_thread(
                    pd.read_csv, psm_abundances_path, sep="\t"
                )

        # Calculate all independent metrics concurrently on thread pool
        (
            protein_cv,
            data_completeness,
            pca_result,
            intensity_dist,
        ) = await asyncio.gather(
            asyncio.to_thread(self._calculate_protein_cv, protein_df),
            asyncio.to_thread(self._calculate_data_completeness, protein_df),
            asyncio.to_thread(self._calculate_pca, protein_df),
            asyncio.to_thread(
                self._calculate_intensity_distributions, protein_df, psm_df
            ),
        )

        if psm_df is not None:
            psm_cv, psm_completeness = await asyncio.gather(
                asyncio.to_thread(self._calculate_cv, psm_df),
                asyncio.to_thread(self._calculate_psm_completeness, psm_df),
            )
        else:
            psm_cv = None
            psm_completeness = None

        # Calculate summary statistics
        # MAJ-004: Count unique PSMs, not total rows
        total_psms = (
            psm_df["Unique_PSM"].nunique()
            if psm_df is not None and "Unique_PSM" in psm_df.columns
            else len(psm_df)
            if psm_df is not None
            else None
        )
        avg_psms_per_sample = self._calculate_avg_per_sample(
            total_psms, psm_completeness
        )
        total_proteins = len(protein_df)
        avg_proteins_per_sample = self._calculate_avg_proteins_per_sample(protein_df)
        # MIN-010: Calculate separate average CVs for protein and PSM
        average_protein_cv = self._calculate_average_cv(protein_cv)
        average_psm_cv = self._calculate_average_cv(psm_cv)
        completeness_rate = self._calculate_completeness_rate(data_completeness)

        qc_data = QCData(
            pca=pca_result,
            pvalue_distribution=next(iter(pvalue_distributions.values()))
            if pvalue_distributions
            else PValueDistribution(bins=[], counts=[]),
            pvalue_distributions=pvalue_distributions if pvalue_distributions else None,
            psm_cv=psm_cv,
            protein_cv=protein_cv,
            intensity_distributions=intensity_dist,
            data_completeness=data_completeness,
            psm_completeness=psm_completeness,
            # Summary statistics
            total_psms=total_psms,
            avg_psms_per_sample=avg_psms_per_sample,
            total_proteins=total_proteins,
            avg_proteins_per_sample=avg_proteins_per_sample,
            average_cv=average_protein_cv,  # Keep for backward compatibility
            average_protein_cv=average_protein_cv,
            average_psm_cv=average_psm_cv,
            completeness_rate=completeness_rate,
        )

        logger.info("Step 8 complete: QC metrics calculated")

        return qc_data

    def _calculate_pca(self, protein_df: pd.DataFrame) -> PCAResult:
        """
        Calculate PCA on protein abundances.

        Args:
            protein_df: Protein abundances DataFrame

        Returns:
            PCAResult with PCA data
        """
        # MAJ-006: Exclude PSM_Count and other ID columns from PCA
        # Get abundance columns (exclude ID columns - check both original and underscore versions)
        id_cols = [
            "Master Protein Accessions",
            "Gene_Name",
            "Protein",
            "Master_Protein_Accessions",
            "PSM_Count",
            "psm_count",
            "PSM Count",
            "psm count",
        ]
        abundance_cols = [
            col
            for col in protein_df.columns
            if col not in id_cols
            and protein_df[col].dtype in ["float64", "float32", "int64"]
            and not col.lower().endswith("count")  # Exclude any count columns
        ]

        if len(abundance_cols) < 2:
            logger.warning("Insufficient samples for PCA")
            return PCAResult(
                samples=[],
                pc1=[],
                pc2=[],
                conditions=[],
                pc1_variance=0.0,
                pc2_variance=0.0,
            )

        # Prepare data
        data = protein_df[abundance_cols].dropna()

        if len(data) == 0 or data.shape[1] < 2:
            logger.warning("No valid data for PCA")
            return PCAResult(
                samples=abundance_cols,
                pc1=[0.0] * len(abundance_cols),
                pc2=[0.0] * len(abundance_cols),
                conditions=[self._extract_condition(col) for col in abundance_cols],
                pc1_variance=0.0,
                pc2_variance=0.0,
            )

        # Transpose so samples are rows
        data_t = data.T

        # Standardize
        scaler = StandardScaler()
        scaled = scaler.fit_transform(data_t)

        # PCA
        n_components = min(2, len(abundance_cols) - 1)
        pca = PCA(n_components=n_components)
        components = pca.fit_transform(scaled)

        # Extract conditions from column names
        conditions = [self._extract_condition(col) for col in abundance_cols]

        return PCAResult(
            samples=abundance_cols,
            pc1=components[:, 0].tolist(),
            pc2=components[:, 1].tolist()
            if n_components > 1
            else [0.0] * len(abundance_cols),
            conditions=conditions,
            pc1_variance=pca.explained_variance_ratio_[0] * 100
            if len(pca.explained_variance_ratio_) > 0
            else 0.0,
            pc2_variance=pca.explained_variance_ratio_[1] * 100
            if len(pca.explained_variance_ratio_) > 1
            else 0.0,
        )

    def _extract_condition(self, sample_name: str) -> str:
        """Extract condition from sample name."""
        # Handle common patterns like:
        # - "Abundance F1 Sample_DMSO_1" -> "DMSO"
        # - "Abundance F2 Sample_INCZ_2" -> "INCZ"
        # - "Sample_DMSO_1" -> "DMSO"
        # - "DMSO_1" -> "DMSO"
        # - "Treatment_1" -> "Treatment"
        # - "Control_1" -> "Control"

        # First, try to extract from common patterns
        upper_name = sample_name.upper()

        # Check for DMSO (common control)
        if "DMSO" in upper_name:
            return "DMSO"

        # Check for INCZ (common treatment pattern)
        if "INCZ" in upper_name:
            # Extract the INCZ identifier (e.g., INCZ123456 from INCZ123456_1)
            parts = sample_name.split("_")
            for part in parts:
                if "INCZ" in part.upper():
                    # Return just the INCZ part (condition), not the replicate
                    return part
            return "INCZ"

        # Check for Control/Treatment
        if "CONTROL" in upper_name:
            return "Control"
        if "TREATMENT" in upper_name:
            return "Treatment"

        # Default: split by underscore and use first part(s)
        parts = sample_name.split("_")
        if len(parts) >= 2:
            # Try to detect if last part is a replicate number
            last_part = parts[-1]
            if last_part.isdigit():
                # Everything except the last numeric part
                return "_".join(parts[:-1])
            else:
                # Use first part as condition
                return parts[0]

        return sample_name

    def _calculate_pvalue_distribution(
        self, diff_df: pd.DataFrame, n_bins: int = 20
    ) -> PValueDistribution:
        """
        Calculate p-value distribution histogram.

        Args:
            diff_df: Differential expression DataFrame
            n_bins: Number of bins for histogram

        Returns:
            PValueDistribution with bins and counts
        """
        pval_col = "pval" if "pval" in diff_df.columns else None

        if pval_col is None or pval_col not in diff_df.columns:
            # Try alternative column names
            for col in diff_df.columns:
                if "pval" in col.lower():
                    pval_col = col
                    break

        if pval_col is None:
            logger.warning("No p-value column found")
            return PValueDistribution(bins=[], counts=[])

        pvals = diff_df[pval_col].dropna()
        pvals = pvals[(pvals >= 0) & (pvals <= 1)]

        if len(pvals) == 0:
            return PValueDistribution(bins=[], counts=[])

        # Create histogram
        counts, bin_edges = np.histogram(pvals, bins=n_bins, range=(0, 1))

        return PValueDistribution(bins=bin_edges.tolist(), counts=counts.tolist())

    def _calculate_cv(self, psm_df: pd.DataFrame) -> dict[str, dict]:
        """
        Calculate exact CV% per condition for PSM abundances.

        Aggregates duplicate (PSM, Condition, Replicate) rows by summing
        abundances — multiple MS fractions contribute to the same PSM in
        the same sample. Then log2-transforms, computes SD of log2 values
        across replicates per PSM, and converts to CV% via the exact
        log-normal formula: CV = sqrt(exp(σ_ln²) - 1)×100.

        Returns precomputed box-plot statistics per condition.
        """
        if psm_df is None or "Condition" not in psm_df.columns:
            return {}

        # Filter zeros and aggregate duplicates from multiple MS fractions.
        # Sum abundances for the same (PSM, Condition, Replicate) — each
        # fraction contributes a portion of the total peptide abundance.
        df = psm_df[psm_df["Abundance"] > 0].copy()
        group_cols = ["Unique_PSM", "Condition", "Replicate"]
        df = df.groupby(group_cols, as_index=False)["Abundance"].sum()

        df["log2_ab"] = np.log2(df["Abundance"])

        cv_by_condition = {}
        for condition in df["Condition"].unique():
            cond_df = df[df["Condition"] == condition]
            grouped = cond_df.groupby("Unique_PSM")["log2_ab"]
            agg = grouped.agg(std="std", count="count")
            valid = agg[agg["count"] >= 2]
            if len(valid) == 0:
                continue
            sd_log2 = valid["std"].values
            sd_ln = sd_log2 * np.log(2)
            cvs = np.sqrt(np.exp(sd_ln ** 2) - 1) * 100
            cv_by_condition[str(condition)] = self._compute_box_stats(cvs)

        return cv_by_condition

    def _calculate_protein_cv(self, protein_df: pd.DataFrame) -> dict[str, dict]:
        """
        Calculate variation per condition for protein abundances.

        Computes SD of log2 abundance × 100 across replicates.  Protein
        abundances are already log2-transformed, so no conversion is needed.
        SD_log2 × 100 gives an approximate CV% that is stable across the
        abundance range.
        """
        if protein_df is None:
            return {}

        # Get abundance columns (exclude ID columns)
        id_cols = {
            "Master Protein Accessions",
            "Gene_Name",
            "Protein",
            "Master_Protein_Accessions",
            "PSM_Count",
            "psm_count",
        }
        abundance_cols = [
            col
            for col in protein_df.columns
            if col not in id_cols
            and protein_df[col].dtype in ("float64", "float32", "int64")
        ]

        # Group columns by condition (extract condition from sample names)
        condition_cols = {}
        for col in abundance_cols:
            condition = self._extract_condition(col)
            condition_cols.setdefault(condition, []).append(col)

        # SD of log2 values × 100 per protein per condition (vectorized)
        cv_by_condition = {}
        for condition, cols in condition_cols.items():
            mat = protein_df[cols].values.astype(float)
            sd_log2 = np.nanstd(mat, axis=1, ddof=1)
            sd_ln = sd_log2 * np.log(2)
            # Exact CV for log-normal data
            cvs = np.sqrt(np.exp(np.maximum(sd_ln, 0) ** 2) - 1) * 100
            cv_by_condition[str(condition)] = self._compute_box_stats(
                cvs[~np.isnan(cvs)]
            )

        return cv_by_condition

    def _calculate_psm_completeness(
        self, psm_df: pd.DataFrame
    ) -> list[DataCompleteness]:
        """
        Calculate data completeness per sample for PSM data.

        Args:
            psm_df: PSM abundances DataFrame (long format with Unique_PSM column)

        Returns:
            List of DataCompleteness objects
        """
        if psm_df is None or "Abundance" not in psm_df.columns:
            return []

        # MAJ-005: Count unique PSMs per sample, not total rows
        # The PSM file is in long format - each row is one observation
        # We need to count unique Unique_PSM values per sample

        # Get total unique PSMs across the entire dataset first
        all_unique_psms = (
            set(psm_df["Unique_PSM"].unique())
            if "Unique_PSM" in psm_df.columns
            else set()
        )

        # Group by condition and replicate
        if "Replicate" in psm_df.columns and "Condition" in psm_df.columns:
            grouped = psm_df.groupby(["Condition", "Replicate"])
        elif "Condition" in psm_df.columns:
            grouped = psm_df.groupby("Condition")
        else:
            return []

        completeness = []
        for group_name, group_df in grouped:
            if isinstance(group_name, tuple):
                sample_name = f"{group_name[0]}_{group_name[1]}"
            else:
                sample_name = str(group_name)

            # Count unique PSMs with non-null abundance in this sample
            present_psms = (
                set(group_df[group_df["Abundance"].notna()]["Unique_PSM"].unique())
                if "Unique_PSM" in group_df.columns
                else set()
            )

            # Missing PSMs = all unique PSMs in dataset minus present in this sample
            missing_psms = all_unique_psms - present_psms

            present = len(present_psms)
            missing = len(missing_psms)

            completeness.append(
                DataCompleteness(sample=sample_name, missing=missing, present=present)
            )

        return completeness

    @staticmethod
    def _compute_box_stats(values: np.ndarray, max_outliers: int = 500) -> dict:
        """Compute box-plot statistics for a 1-D array of values.

        Returns q1, median, q3, lowerfence, upperfence, and the most extreme
        outlier values (capped). This avoids sending millions of raw data
        points to the frontend while keeping QC_Results.json compact.

        Args:
            values: 1-D numpy array of numeric values
            max_outliers: Maximum number of outlier points to include
        """
        valid = values[np.isfinite(values)]
        if len(valid) == 0:
            return {"q1": 0, "median": 0, "q3": 0, "lowerfence": 0, "upperfence": 0, "outliers": []}
        q1 = float(np.percentile(valid, 25))
        q3 = float(np.percentile(valid, 75))
        med = float(np.percentile(valid, 50))
        iqr = q3 - q1
        lf = float(np.maximum(valid.min(), q1 - 1.5 * iqr))
        uf = float(np.minimum(valid.max(), q3 + 1.5 * iqr))
        outlier_mask = (valid < lf) | (valid > uf)
        outlier_vals = valid[outlier_mask]
        # Keep only the most extreme outliers (furthest from fences)
        if len(outlier_vals) > max_outliers:
            dist = np.maximum(lf - outlier_vals, outlier_vals - uf)
            top_idx = np.argpartition(-dist, min(max_outliers, len(dist) - 1))[:max_outliers]
            outlier_vals = outlier_vals[top_idx]
        return {"q1": q1, "median": med, "q3": q3,
                "lowerfence": lf, "upperfence": uf, "outliers": outlier_vals.tolist()}

    def _calculate_intensity_distributions(
        self, protein_df: pd.DataFrame, psm_df: pd.DataFrame | None
    ) -> dict:
        """
        Calculate intensity distributions as precomputed box-plot statistics.

        Returns q1/median/q3/fences + outlier values instead of raw arrays
        to keep QC_Results.json small and frontend rendering fast.

        Args:
            protein_df: Protein abundances DataFrame
            psm_df: Optional PSM abundances DataFrame

        Returns:
            Dictionary with intensity distribution box-plot statistics
        """
        result = {"psm_boxplot": {}, "protein_boxplot": {}}

        # PSM intensities by condition — precomputed box stats
        if psm_df is not None and "Condition" in psm_df.columns:
            has_replicate = "Replicate" in psm_df.columns
            group_cols = ["Condition", "Replicate"] if has_replicate else ["Condition"]

            # Vectorized median normalization via groupby transform (single pass)
            sample_medians = psm_df.groupby(group_cols)["Abundance"].transform("median")
            global_median = sample_medians.median()

            pos = psm_df["Abundance"] > 0
            norm = psm_df["Abundance"] * (global_median / sample_medians)
            log2_vals = np.where(pos, np.log2(np.where(pos, norm, 1)), np.nan)

            for group_key, idx in psm_df.groupby(group_cols).groups.items():
                if not has_replicate:
                    condition = group_key
                    replicate = 1
                else:
                    condition, replicate = group_key
                stats = self._compute_box_stats(log2_vals[idx])
                cond_str = str(condition)
                rep_key = f"replicate_{replicate}"
                result["psm_boxplot"].setdefault(cond_str, {})[rep_key] = stats

        # Protein intensities — precomputed box stats per sample
        id_cols = {
            "Master Protein Accessions", "Gene_Name", "Protein",
            "Master_Protein_Accessions", "PSM_Count", "psm_count",
        }
        abundance_cols = [
            col
            for col in protein_df.columns
            if col not in id_cols
            and protein_df[col].dtype in ("float64", "float32", "int64")
        ]

        for col in abundance_cols:
            intensities = protein_df[col].dropna().values
            if len(intensities) > 0:
                result["protein_boxplot"][col] = self._compute_box_stats(intensities)

        return result

    def _calculate_data_completeness(
        self, protein_df: pd.DataFrame
    ) -> list[DataCompleteness]:
        """
        Calculate data completeness per sample.

        Args:
            protein_df: Protein abundances DataFrame

        Returns:
            List of DataCompleteness objects
        """
        id_cols = [
            "Master Protein Accessions",
            "Gene_Name",
            "Protein",
            "Master_Protein_Accessions",
            "PSM_Count",
            "psm_count",
        ]
        abundance_cols = [
            col
            for col in protein_df.columns
            if col not in id_cols
            and protein_df[col].dtype in ["float64", "float32", "int64"]
        ]

        completeness = []

        for col in abundance_cols:
            missing = protein_df[col].isna().sum()
            present = protein_df[col].notna().sum()

            completeness.append(
                DataCompleteness(sample=col, missing=int(missing), present=int(present))
            )

        return completeness

    def _calculate_avg_per_sample(
        self, total: int | None, completeness: list | None
    ) -> float | None:
        """Calculate average PSMs per sample from completeness data."""
        if completeness is None or len(completeness) == 0:
            return None
        # MAJ-011: Calculate average of present PSMs per sample
        # instead of total_unique / num_samples
        total_present = sum(c.present for c in completeness)
        return round(total_present / len(completeness), 1)

    def _calculate_avg_proteins_per_sample(self, protein_df: pd.DataFrame) -> int:
        """Calculate average proteins per sample."""
        id_cols = [
            "Master Protein Accessions",
            "Gene_Name",
            "Protein",
            "Master_Protein_Accessions",
            "PSM_Count",
            "psm_count",
        ]
        abundance_cols = [
            col
            for col in protein_df.columns
            if col not in id_cols
            and protein_df[col].dtype in ["float64", "float32", "int64"]
        ]
        if len(abundance_cols) == 0:
            return 0
        total_present = sum(protein_df[col].notna().sum() for col in abundance_cols)
        return total_present // len(abundance_cols)

    def _calculate_average_cv(self, cv_by_condition: dict | None) -> float | None:
        """Calculate overall average CV across all conditions.

        Each condition value is now a box-stats dict with a 'median' key
        (the median CV for that condition). We average those medians.
        """
        if cv_by_condition is None or len(cv_by_condition) == 0:
            return None
        medians = []
        for stats in cv_by_condition.values():
            if isinstance(stats, dict) and "median" in stats:
                medians.append(stats["median"])
        if len(medians) == 0:
            return None
        return round(float(np.mean(medians)), 1)

    def _calculate_completeness_rate(self, completeness: list) -> float | None:
        """Calculate overall completeness rate across all samples."""
        if not completeness:
            return None
        total_present = sum(c.present for c in completeness)
        total_missing = sum(c.missing for c in completeness)
        total = total_present + total_missing
        if total == 0:
            return None
        return round((total_present / total) * 100, 1)

    def save_qc_data(self, qc_data: QCData, output_path: Path) -> None:
        """
        Save QC data to JSON file.

        Args:
            qc_data: QCData object to save
            output_path: Path to save JSON
        """
        import json

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(qc_data.model_dump(), f, indent=2)
