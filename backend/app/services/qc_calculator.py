"""
QC metrics calculation service (Step 8).

Calculates quality control metrics including PCA, p-value distribution,
CV analysis, intensity distributions, and data completeness.
"""

import asyncio
import logging
from pathlib import Path
from typing import Optional

import pandas as pd
import numpy as np
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from app.models.data import QCData, PCAResult, PValueDistribution, DataCompleteness

logger = logging.getLogger("proteomics")


class QCCalculator:
    """
    Quality control metrics calculator.

    Implements step 8 of the pipeline: QC metrics calculation.
    """

    def __init__(self):
        """Initialize QC calculator."""
        pass

    async def calculate_all_metrics(
        self,
        protein_abundances_path: Path,
        diff_expression_paths: list[Path],
        psm_abundances_path: Optional[Path] = None,
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
                    pvalue_distributions[label] = self._calculate_pvalue_distribution(comp_df)
                except Exception:
                    logger.warning(f"Could not compute p-value distribution for {path.name}", exc_info=True)

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
            pvalue_distribution=next(iter(pvalue_distributions.values())) if pvalue_distributions else PValueDistribution(bins=[], counts=[]),
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

    def _calculate_cv(self, psm_df: pd.DataFrame) -> dict[str, list[float]]:
        """
        Calculate coefficient of variation per condition for PSM abundances.

        For each unique PSM, calculate CV across replicates within each condition.
        CV = std / mean for the abundance values across replicates.

        Note: PSM Abundance values are already in RAW format (not log2-transformed),
        so we calculate CV directly on these values.

        Args:
            psm_df: PSM abundances DataFrame

        Returns:
            Dictionary mapping condition to CV values (as percentages)
        """
        if psm_df is None or "Condition" not in psm_df.columns:
            return {}

        cv_by_condition = {}

        for condition in psm_df["Condition"].unique():
            condition_df = psm_df[psm_df["Condition"] == condition]
            grouped = condition_df.groupby("Unique_PSM")["Abundance"]
            agg = grouped.agg(std="std", mean="mean", count="count")
            valid = (agg["count"] >= 2) & (agg["mean"] > 0)
            agg = agg[valid]
            cvs = ((agg["std"] / agg["mean"]) * 100).tolist()
            cv_by_condition[str(condition)] = cvs

        return cv_by_condition

    def _calculate_protein_cv(self, protein_df: pd.DataFrame) -> dict[str, list[float]]:
        """
        Calculate coefficient of variation per condition for protein abundances.

        For each protein, calculate CV across replicates within each condition.
        CV = std / mean for the abundance values across replicates.

        Note: Abundance values are log2-transformed, so we convert to raw values
        before calculating CV to get meaningful results.

        Args:
            protein_df: Protein abundances DataFrame

        Returns:
            Dictionary mapping condition to CV values (as percentages)
        """
        if protein_df is None:
            return {}

        # Get abundance columns (exclude ID columns)
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

        # Group columns by condition (extract condition from sample names)
        condition_cols = {}
        for col in abundance_cols:
            condition = self._extract_condition(col)
            if condition not in condition_cols:
                condition_cols[condition] = []
            condition_cols[condition].append(col)

        # Calculate CV for each protein within each condition (vectorized)
        cv_by_condition = {}
        for condition, cols in condition_cols.items():
            # Extract matrix: (n_proteins, n_replicates)
            mat = protein_df[cols].values.astype(float)
            # Convert log2 abundances back to raw values
            raw = np.power(2, mat)
            # Row-wise mean and std (ddof=1 for sample std, matching pandas .std())
            means = np.nanmean(raw, axis=1)
            stds = np.nanstd(raw, axis=1, ddof=1)
            # CV = (std / mean) * 100, filter out invalid values
            cv_values = np.where(means > 0, (stds / means) * 100, np.nan)
            cv_by_condition[str(condition)] = cv_values[~np.isnan(cv_values)].tolist()

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

    def _calculate_intensity_distributions(
        self, protein_df: pd.DataFrame, psm_df: Optional[pd.DataFrame]
    ) -> dict:
        """
        Calculate intensity distributions.

        Args:
            protein_df: Protein abundances DataFrame
            psm_df: Optional PSM abundances DataFrame

        Returns:
            Dictionary with intensity distributions
        """
        result = {"psm": {}, "protein": {}}

        # PSM intensities by condition
        if psm_df is not None and "Condition" in psm_df.columns:
            has_replicate = "Replicate" in psm_df.columns
            group_cols = ["Condition", "Replicate"] if has_replicate else ["Condition"]

            # Vectorized median normalization via groupby transform (single pass)
            sample_medians = psm_df.groupby(group_cols)["Abundance"].transform("median")
            global_median = sample_medians.median()

            pos = psm_df["Abundance"] > 0
            norm = psm_df["Abundance"] * (global_median / sample_medians)
            log2_vals = np.where(pos, np.log2(np.where(pos, norm, 1)), np.nan)

            # Build result dict with pre-computed KDE curves
            for group_key, idx in psm_df.groupby(group_cols).groups.items():
                if not has_replicate:
                    condition = group_key
                    replicate = 1
                else:
                    condition, replicate = group_key
                vals = log2_vals[idx]
                valid = vals[np.isfinite(vals)]
                if len(valid) > 0:
                    result["psm"].setdefault(str(condition), {})[f"replicate_{replicate}"] = self._compute_kde(valid)

        # Protein intensities — per-sample KDE curves
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

        for col in abundance_cols:
            intensities = protein_df[col].dropna().values
            if len(intensities) > 0:
                result["protein"][col] = self._compute_kde(intensities)

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
        self, total: Optional[int], completeness: Optional[list]
    ) -> Optional[float]:
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

    def _calculate_average_cv(self, cv_by_condition: Optional[dict]) -> Optional[float]:
        """Calculate overall average CV across all conditions."""
        if cv_by_condition is None or len(cv_by_condition) == 0:
            return None
        all_cvs = []
        for cv_list in cv_by_condition.values():
            all_cvs.extend(cv_list)
        if len(all_cvs) == 0:
            return None
        return round(np.mean(all_cvs), 1)  # CVs are already percentages

    def _calculate_completeness_rate(self, completeness: list) -> Optional[float]:
        """Calculate overall completeness rate across all samples."""
        if not completeness:
            return None
        total_present = sum(c.present for c in completeness)
        total_missing = sum(c.missing for c in completeness)
        total = total_present + total_missing
        if total == 0:
            return None
        return round((total_present / total) * 100, 1)

    @staticmethod
    def _compute_kde(values: np.ndarray, n_points: int = 100) -> dict:
        """Compute Gaussian KDE curve with Silverman bandwidth.

        Returns a compact dict of {kde_x, kde_y} suitable for serialization
        and direct rendering — avoids shipping raw values to the frontend.
        """
        clean = values[np.isfinite(values)]
        if len(clean) < 2:
            return {"kde_x": [], "kde_y": []}

        std = float(np.std(clean, ddof=1))
        bandwidth = max(1e-10, 1.06 * std * len(clean) ** (-0.2))

        x_min, x_max = float(clean.min()), float(clean.max())
        if x_min == x_max:
            return {"kde_x": [x_min], "kde_y": [float(len(clean))]}

        x = np.linspace(x_min, x_max, n_points)
        y = np.zeros(n_points)
        denom = len(clean) * bandwidth * np.sqrt(2 * np.pi)

        # Chunked to limit memory for large datasets
        chunk_size = 5000
        for start in range(0, len(clean), chunk_size):
            chunk = clean[start : start + chunk_size]
            z = (x[:, np.newaxis] - chunk) / bandwidth
            y += np.exp(-0.5 * z * z).sum(axis=1)

        y /= denom

        return {"kde_x": x.tolist(), "kde_y": y.tolist()}

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
