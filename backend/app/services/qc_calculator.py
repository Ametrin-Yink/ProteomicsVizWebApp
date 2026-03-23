"""
QC metrics calculation service (Step 8).

Calculates quality control metrics including PCA, p-value distribution,
CV analysis, intensity distributions, and data completeness.
"""

import logging
from pathlib import Path
from typing import Optional

import pandas as pd
import numpy as np
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from app.core.exceptions import ProcessingError
from app.models.data import QCData, PCAResult, PValueDistribution, DataCompleteness

logger = logging.getLogger("proteomics")


class QCCalculator:
    """
    Quality control metrics calculator.
    
    Implements step 8 of the pipeline: QC metrics calculation.
    """
    
    def __init__(self):
        """Initialize QC calculator."""
        self.qc_data: Optional[QCData] = None
    
    async def calculate_all_metrics(
        self,
        protein_abundances_path: Path,
        diff_expression_path: Path,
        psm_abundances_path: Optional[Path] = None
    ) -> QCData:
        """
        Calculate all QC metrics.
        
        Args:
            protein_abundances_path: Path to Protein_Abundances.tsv
            diff_expression_path: Path to Diff_Expression.tsv
            psm_abundances_path: Optional path to PSM_Abundances.tsv
            
        Returns:
            QCData object with all metrics
        """
        logger.info("Step 8: Calculating QC metrics")
        
        # Load data
        protein_df = pd.read_csv(protein_abundances_path, sep='\t')
        diff_df = pd.read_csv(diff_expression_path, sep='\t')
        
        psm_df = None
        if psm_abundances_path and psm_abundances_path.exists():
            psm_df = pd.read_csv(psm_abundances_path, sep='\t')
        
        # Calculate metrics
        psm_cv = self._calculate_cv(psm_df) if psm_df is not None else None
        protein_cv = self._calculate_protein_cv(protein_df)
        data_completeness = self._calculate_data_completeness(protein_df)
        psm_completeness = self._calculate_psm_completeness(psm_df) if psm_df is not None else None

        # Calculate summary statistics
        total_psms = len(psm_df) if psm_df is not None else None
        avg_psms_per_sample = self._calculate_avg_per_sample(total_psms, psm_completeness)
        total_proteins = len(protein_df)
        avg_proteins_per_sample = self._calculate_avg_proteins_per_sample(protein_df)
        average_cv = self._calculate_average_cv(protein_cv)
        completeness_rate = self._calculate_completeness_rate(data_completeness)

        self.qc_data = QCData(
            pca=self._calculate_pca(protein_df),
            pvalue_distribution=self._calculate_pvalue_distribution(diff_df),
            psm_cv=psm_cv,
            protein_cv=protein_cv,
            intensity_distributions=self._calculate_intensity_distributions(
                protein_df, psm_df
            ),
            data_completeness=data_completeness,
            psm_completeness=psm_completeness,
            # Summary statistics
            total_psms=total_psms,
            avg_psms_per_sample=avg_psms_per_sample,
            total_proteins=total_proteins,
            avg_proteins_per_sample=avg_proteins_per_sample,
            average_cv=average_cv,
            completeness_rate=completeness_rate
        )
        
        logger.info("Step 8 complete: QC metrics calculated")
        
        return self.qc_data
    
    def _calculate_pca(self, protein_df: pd.DataFrame) -> PCAResult:
        """
        Calculate PCA on protein abundances.
        
        Args:
            protein_df: Protein abundances DataFrame
            
        Returns:
            PCAResult with PCA data
        """
        # Get abundance columns (exclude ID columns)
        id_cols = ['Master Protein Accessions', 'Gene_Name', 'Protein']
        abundance_cols = [
            col for col in protein_df.columns
            if col not in id_cols and protein_df[col].dtype in ['float64', 'float32', 'int64']
        ]
        
        if len(abundance_cols) < 2:
            logger.warning("Insufficient samples for PCA")
            return PCAResult(
                samples=[],
                pc1=[],
                pc2=[],
                conditions=[],
                pc1_variance=0.0,
                pc2_variance=0.0
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
                pc2_variance=0.0
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
            pc2=components[:, 1].tolist() if n_components > 1 else [0.0] * len(abundance_cols),
            conditions=conditions,
            pc1_variance=pca.explained_variance_ratio_[0] * 100 if len(pca.explained_variance_ratio_) > 0 else 0.0,
            pc2_variance=pca.explained_variance_ratio_[1] * 100 if len(pca.explained_variance_ratio_) > 1 else 0.0
        )
    
    def _extract_condition(self, sample_name: str) -> str:
        """Extract condition from sample name."""
        # Try common patterns
        parts = sample_name.split('_')
        if len(parts) >= 2:
            return '_'.join(parts[:-1])  # Everything except last part (replicate)
        return sample_name
    
    def _calculate_pvalue_distribution(
        self,
        diff_df: pd.DataFrame,
        n_bins: int = 20
    ) -> PValueDistribution:
        """
        Calculate p-value distribution histogram.
        
        Args:
            diff_df: Differential expression DataFrame
            n_bins: Number of bins for histogram
            
        Returns:
            PValueDistribution with bins and counts
        """
        pval_col = 'pval' if 'pval' in diff_df.columns else 'pval' if 'pval' in diff_df.columns else None
        
        if pval_col is None or pval_col not in diff_df.columns:
            # Try alternative column names
            for col in diff_df.columns:
                if 'pval' in col.lower():
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
        
        return PValueDistribution(
            bins=bin_edges.tolist(),
            counts=counts.tolist()
        )
    
    def _calculate_cv(self, psm_df: pd.DataFrame) -> dict[str, list[float]]:
        """
        Calculate coefficient of variation per condition.
        
        Args:
            psm_df: PSM abundances DataFrame
            
        Returns:
            Dictionary mapping condition to CV values
        """
        if psm_df is None or 'Condition' not in psm_df.columns:
            return {}
        
        cv_by_condition = {}
        
        for condition in psm_df['Condition'].unique():
            condition_df = psm_df[psm_df['Condition'] == condition]
            
            # Group by Unique_PSM and calculate CV
            cv_values = []
            for unique_psm, group in condition_df.groupby('Unique_PSM'):
                abundances = group['Abundance'].dropna()
                if len(abundances) > 1:
                    mean = abundances.mean()
                    std = abundances.std()
                    if mean > 0:
                        cv = std / mean
                        cv_values.append(cv)
            
            cv_by_condition[str(condition)] = cv_values

        return cv_by_condition

    def _calculate_protein_cv(self, protein_df: pd.DataFrame) -> dict[str, list[float]]:
        """
        Calculate coefficient of variation per condition for protein abundances.

        Args:
            protein_df: Protein abundances DataFrame

        Returns:
            Dictionary mapping condition to CV values
        """
        if protein_df is None:
            return {}

        # Get abundance columns (exclude ID columns)
        id_cols = ['Master Protein Accessions', 'Gene_Name', 'Protein']
        abundance_cols = [
            col for col in protein_df.columns
            if col not in id_cols and protein_df[col].dtype in ['float64', 'float32', 'int64']
        ]

        # Group columns by condition
        condition_cols = {}
        for col in abundance_cols:
            condition = self._extract_condition(col)
            if condition not in condition_cols:
                condition_cols[condition] = []
            condition_cols[condition].append(col)

        # Calculate CV for each protein within each condition
        cv_by_condition = {}
        for condition, cols in condition_cols.items():
            cv_values = []
            for _, row in protein_df.iterrows():
                abundances = row[cols].dropna()
                if len(abundances) > 1:
                    mean = abundances.mean()
                    std = abundances.std()
                    if mean > 0:
                        cv = std / mean
                        cv_values.append(cv)
            cv_by_condition[str(condition)] = cv_values

        return cv_by_condition

    def _calculate_psm_completeness(self, psm_df: pd.DataFrame) -> list[DataCompleteness]:
        """
        Calculate data completeness per sample for PSM data.

        Args:
            psm_df: PSM abundances DataFrame

        Returns:
            List of DataCompleteness objects
        """
        if psm_df is None or 'Abundance' not in psm_df.columns:
            return []

        # Group by condition and replicate
        if 'Replicate' in psm_df.columns:
            grouped = psm_df.groupby(['Condition', 'Replicate'])
        else:
            grouped = psm_df.groupby('Condition')

        completeness = []
        for group_name, group_df in grouped:
            if isinstance(group_name, tuple):
                sample_name = f"{group_name[0]}_{group_name[1]}"
            else:
                sample_name = str(group_name)

            missing = group_df['Abundance'].isna().sum()
            present = group_df['Abundance'].notna().sum()

            completeness.append(DataCompleteness(
                sample=sample_name,
                missing=int(missing),
                present=int(present)
            ))

        return completeness

    def _calculate_intensity_distributions(
        self,
        protein_df: pd.DataFrame,
        psm_df: Optional[pd.DataFrame]
    ) -> dict:
        """
        Calculate intensity distributions.
        
        Args:
            protein_df: Protein abundances DataFrame
            psm_df: Optional PSM abundances DataFrame
            
        Returns:
            Dictionary with intensity distributions
        """
        result = {
            "psm": {},
            "protein": {}
        }
        
        # PSM intensities by condition
        if psm_df is not None and 'Condition' in psm_df.columns:
            for condition in psm_df['Condition'].unique():
                condition_df = psm_df[psm_df['Condition'] == condition]
                
                # Group by replicate
                replicates = {}
                for replicate in condition_df.get('Replicate', pd.Series([1])).unique():
                    rep_df = condition_df[condition_df.get('Replicate', pd.Series([1])) == replicate]
                    intensities = rep_df['Abundance'].dropna().tolist()
                    replicates[f"replicate_{replicate}"] = intensities
                
                result["psm"][str(condition)] = replicates
        
        # Protein intensities
        id_cols = ['Master Protein Accessions', 'Gene_Name', 'Protein']
        abundance_cols = [
            col for col in protein_df.columns
            if col not in id_cols and protein_df[col].dtype in ['float64', 'float32', 'int64']
        ]
        
        # Group columns by condition
        condition_cols = {}
        for col in abundance_cols:
            condition = self._extract_condition(col)
            if condition not in condition_cols:
                condition_cols[condition] = []
            condition_cols[condition].append(col)
        
        for condition, cols in condition_cols.items():
            all_intensities = []
            for col in cols:
                intensities = protein_df[col].dropna().tolist()
                all_intensities.extend(intensities)
            result["protein"][condition] = all_intensities
        
        return result
    
    def _calculate_data_completeness(
        self,
        protein_df: pd.DataFrame
    ) -> list[DataCompleteness]:
        """
        Calculate data completeness per sample.
        
        Args:
            protein_df: Protein abundances DataFrame
            
        Returns:
            List of DataCompleteness objects
        """
        id_cols = ['Master Protein Accessions', 'Gene_Name', 'Protein']
        abundance_cols = [
            col for col in protein_df.columns
            if col not in id_cols and protein_df[col].dtype in ['float64', 'float32', 'int64']
        ]
        
        completeness = []
        
        for col in abundance_cols:
            missing = protein_df[col].isna().sum()
            present = protein_df[col].notna().sum()
            
            completeness.append(DataCompleteness(
                sample=col,
                missing=int(missing),
                present=int(present)
            ))
        
        return completeness

    def _calculate_avg_per_sample(self, total: Optional[int], completeness: Optional[list]) -> Optional[float]:
        """Calculate average count per sample."""
        if total is None or completeness is None or len(completeness) == 0:
            return None
        return round(total / len(completeness), 1)

    def _calculate_avg_proteins_per_sample(self, protein_df: pd.DataFrame) -> int:
        """Calculate average proteins per sample."""
        id_cols = ['Master Protein Accessions', 'Gene_Name', 'Protein']
        abundance_cols = [
            col for col in protein_df.columns
            if col not in id_cols and protein_df[col].dtype in ['float64', 'float32', 'int64']
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
        return round(np.mean(all_cvs) * 100, 1)  # Return as percentage

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

    def get_qc_data(self) -> Optional[QCData]:
        """
        Get calculated QC data.
        
        Returns:
            QCData object or None
        """
        return self.qc_data
    
    def save_qc_data(self, output_path: Path) -> None:
        """
        Save QC data to JSON file.
        
        Args:
            output_path: Path to save JSON
        """
        if self.qc_data is None:
            raise ProcessingError(
                message="QC data not calculated",
                step=8,
                recoverable=True
            )
        
        import json
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(self.qc_data.model_dump(), f, indent=2)


# Global calculator instance
qc_calculator = QCCalculator()
