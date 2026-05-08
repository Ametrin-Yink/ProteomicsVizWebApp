"""Data processing pipeline - Steps 1-5.

This module implements the initial data processing steps:
1. Combine Replicates
2. Generate Unique PSM
3. Remove Razor Information (optional)
4. Remove Low Quality
5. Filter by Criteria
"""

import logging
import re
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass

import pandas as pd

logger = logging.getLogger(__name__)


@dataclass
class PSMFilenameParsed:
    """Parsed PSM filename components."""

    experiment: str
    condition: str
    replicate: int


@dataclass
class ProcessingConfig:
    """Configuration for data processing."""

    remove_razor: bool = False
    strict_filtering: bool = False
    fasta_db: Optional[Dict[str, str]] = None


class DataProcessor:
    """Processor for PSM data - Steps 1-5 of pipeline."""

    # Required columns from input CSV
    REQUIRED_COLUMNS = [
        "Sequence",
        "Modifications",
        "Charge",
        "Contaminant",
        "Master Protein Accessions",
        "Quan Info",
    ]

    def __init__(self, config: ProcessingConfig):
        """Initialize processor with configuration.

        Args:
            config: Processing configuration
        """
        self.config = config

    def parse_psm_filename(self, filename: str) -> PSMFilenameParsed:
        """Parse PSM filename to extract metadata.

        Format: PSM_ExperimentName_Condition_ReplicateNumber.csv
        Example: PSM_SampleData_DMSO_1.csv

        Args:
            filename: Name of the PSM file

        Returns:
            Parsed filename components

        Raises:
            ValueError: If filename doesn't match expected pattern
        """
        # Pattern: PSM_<Experiment>_<Condition>_<Replicate>.csv
        pattern = r"PSM_(.+?)_(.+?)_(\d+)\.csv$"
        match = re.match(pattern, filename)

        if not match:
            raise ValueError(
                f"Filename '{filename}' doesn't match pattern "
                "PSM_ExperimentName_Condition_ReplicateNumber.csv"
            )

        return PSMFilenameParsed(
            experiment=match.group(1),
            condition=match.group(2),
            replicate=int(match.group(3)),
        )

    def find_abundance_column(self, columns: List[str]) -> str:
        """Find the abundance column in the data.

        Pattern: Abundance F{code} Sample (may be quoted in CSV)
        Examples: Abundance F49 Sample, "Abundance F49 Sample"

        Args:
            columns: List of column names

        Returns:
            Name of the abundance column

        Raises:
            ValueError: If no abundance column found
        """
        pattern = r'^"?Abundance F[\dA-Za-z]+ Sample"?$'
        for col in columns:
            if re.match(pattern, col):
                return col

        raise ValueError(
            f"No abundance column found matching pattern 'Abundance F{{code}} Sample'. "
            f"Available columns: {columns}"
        )

    def step1_combine_replicates(self, file_paths: List[Path]) -> pd.DataFrame:
        """Step 1: Combine multiple PSM files into single DataFrame.

        Args:
            file_paths: List of paths to PSM CSV files

        Returns:
            Combined DataFrame with all replicates
        """
        logger.info(f"Step 1: Combining {len(file_paths)} replicate files")

        combined = []

        for file_path in file_paths:
            # Parse filename for metadata
            parsed = self.parse_psm_filename(file_path.name)

            # Read CSV with encoding fallback
            try:
                df = pd.read_csv(file_path, encoding="utf-8")
            except UnicodeDecodeError:
                df = pd.read_csv(file_path, encoding="latin-1")

            # Find abundance column BEFORE filtering (it may have quotes)
            abundance_col = self.find_abundance_column(list(df.columns))

            # Validate required columns exist
            missing_cols = set(self.REQUIRED_COLUMNS) - set(df.columns)
            if missing_cols:
                raise ValueError(
                    f"File {file_path.name} missing required columns: {missing_cols}"
                )

            # Select required columns PLUS the abundance column
            columns_to_keep = self.REQUIRED_COLUMNS + [abundance_col]

            # Include Total # PSMs if present
            psm_col = "Total # PSMs"
            if psm_col in df.columns:
                columns_to_keep.append(psm_col)

            df = df[columns_to_keep].copy()

            # Rename columns to snake_case for consistency
            df.columns = [col.replace(" ", "_") for col in df.columns]

            # Get the renamed abundance column
            abundance_col_renamed = abundance_col.replace(" ", "_")

            # Rename to unified 'Abundance' column
            df = df.rename(columns={abundance_col_renamed: "Abundance"})

            # Add sample origination column
            df["Sample_Origination"] = f"{parsed.condition}_{parsed.replicate}"
            df["Condition"] = parsed.condition
            df["Replicate"] = parsed.replicate

            combined.append(df)
            logger.info(
                f"  Loaded {file_path.name}: {len(df)} rows, "
                f"condition={parsed.condition}, replicate={parsed.replicate}"
            )

        result = pd.concat(combined, ignore_index=True)
        logger.info(f"Step 1 complete: {len(result)} total rows combined")

        return result

    def step2_generate_unique_psm(self, df: pd.DataFrame) -> pd.DataFrame:
        """Step 2: Generate unique PSM identifier.

        Creates Unique_PSM column by combining Sequence, Modifications, and Charge.

        Args:
            df: DataFrame from Step 1

        Returns:
            DataFrame with Unique_PSM column added
        """
        logger.info("Step 2: Generating unique PSM identifiers")

        # Create unique PSM identifier
        df["Unique_PSM"] = (
            df["Sequence"].astype(str)
            + "|"
            + df["Modifications"].astype(str)
            + "|"
            + df["Charge"].astype(str)
        )

        unique_count = df["Unique_PSM"].nunique()
        logger.info(f"Step 2 complete: {unique_count} unique PSMs")

        return df

    def step3_remove_razor(self, df: pd.DataFrame) -> pd.DataFrame:
        """Step 3: Remove razor peptides by selecting best protein match (vectorized).

        For peptides matching multiple proteins, selects the best match based on:
        1. Most peptides matched
        2. Longest sequence (tie-breaker)
        3. First in list (final tie-breaker)

        This is applied globally across all samples (not per-sample) to ensure
        consistent protein assignments.

        Args:
            df: DataFrame from Step 2

        Returns:
            DataFrame with razor peptides resolved
        """
        if not self.config.remove_razor:
            logger.info("Step 3: Skipping razor removal (disabled)")
            return df

        logger.info("Step 3: Removing razor peptides (vectorized)")

        # Count peptides per protein across ALL samples
        protein_peptide_counts = self._count_peptides_per_protein(df)

        # Get unique PSMs with their protein lists (first occurrence)
        unique_psm_df = df.drop_duplicates(subset=["Unique_PSM"])[
            ["Unique_PSM", "Master_Protein_Accessions"]
        ]

        # Vectorized selection of best protein for each unique PSM
        def select_best_for_psm(proteins_str) -> str:
            if pd.isna(proteins_str):
                return ""
            proteins = [p.strip() for p in str(proteins_str).split(";") if p.strip()]
            if len(proteins) <= 1:
                return proteins[0] if proteins else ""
            # Multiple proteins - select best one
            return self._select_best_protein(
                proteins, protein_peptide_counts, self.config.fasta_db
            )

        # Apply vectorized function to get best protein for each unique PSM
        unique_psm_df["Best_Protein"] = unique_psm_df[
            "Master_Protein_Accessions"
        ].apply(select_best_for_psm)

        # Create mapping and apply to all rows
        psm_to_best_protein = unique_psm_df.set_index("Unique_PSM")[
            "Best_Protein"
        ].to_dict()
        df["Master_Protein_Accessions"] = df["Unique_PSM"].map(psm_to_best_protein)

        logger.info(f"Step 3 complete: Razor peptides resolved, {len(df)} rows")

        return df

    def _count_peptides_per_protein(self, df: pd.DataFrame) -> Dict[str, int]:
        """Count peptides per protein across all samples (vectorized).

        Args:
            df: DataFrame with protein accessions

        Returns:
            Dictionary mapping protein ID to peptide count
        """
        # Vectorized: split and explode all protein accessions at once
        protein_counts = (
            df["Master_Protein_Accessions"]
            .str.split(";")
            .explode()
            .str.strip()
            .loc[lambda x: x != ""]
            .value_counts()
            .to_dict()
        )

        return protein_counts

    def _select_best_protein(
        self,
        proteins: List[str],
        peptide_counts: Dict[str, int],
        fasta_db: Optional[Dict[str, str]],
    ) -> str:
        """Select best protein from list of candidates.

        Selection criteria:
        1. Most peptides matched
        2. Longest sequence (tie-breaker)
        3. First in list (final tie-breaker)

        Args:
            proteins: List of protein accessions
            peptide_counts: Dictionary of peptide counts per protein
            fasta_db: Optional FASTA database for sequence lengths

        Returns:
            Best protein accession
        """
        if len(proteins) == 1:
            return proteins[0]

        # Get peptide counts for candidates
        candidate_counts = {p: peptide_counts.get(p, 0) for p in proteins}
        max_count = max(candidate_counts.values())
        candidates = [p for p, c in candidate_counts.items() if c == max_count]

        if len(candidates) == 1:
            return candidates[0]

        # Tie-breaker: longest sequence from FASTA
        if fasta_db:
            lengths = {p: len(fasta_db.get(p, "")) for p in candidates}
            max_length = max(lengths.values())
            candidates = [p for p, length in lengths.items() if length == max_length]

            if len(candidates) == 1:
                return candidates[0]

        # Final tie-breaker: first in original list
        return proteins[0]

    def step4_remove_low_quality(self, df: pd.DataFrame) -> pd.DataFrame:
        """Step 4: Remove low quality PSMs.

        Filters applied:
        - Remove Contaminant=True
        - Remove Quan_Info="No Value"
        - Remove Abundance < 1

        Args:
            df: DataFrame from Step 3

        Returns:
            Filtered DataFrame
        """
        logger.info("Step 4: Removing low quality PSMs")

        initial_count = len(df)

        # Remove contaminants
        # Handle both boolean and string representations
        df["Contaminant"] = df["Contaminant"].astype(str).str.lower()
        df = df[df["Contaminant"] != "true"].copy()

        # Remove "No Value" quantification
        df = df[df["Quan_Info"] != "No Value"].copy()

        # Remove low abundance (< 1)
        df["Abundance"] = pd.to_numeric(df["Abundance"], errors="coerce")
        df = df[df["Abundance"] >= 1].copy()

        removed = initial_count - len(df)
        logger.info(
            f"Step 4 complete: Removed {removed} low quality PSMs, {len(df)} remaining"
        )

        return df

    def step5_filter_by_criteria(self, df: pd.DataFrame) -> pd.DataFrame:
        """Step 5: Filter PSMs based on criteria.

        Strict filtering (strict_filtering=True):
        - Remove PSMs with >20% missing values per condition
        - Remove proteins with only 1 PSM

        Lenient filtering (strict_filtering=False):
        - Remove PSMs with >40% missing values per condition

        Args:
            df: DataFrame from Step 4

        Returns:
            Filtered DataFrame
        """
        logger.info("Step 5: Filtering by criteria")

        # Set missing value threshold
        threshold = 0.2 if self.config.strict_filtering else 0.4
        logger.info(
            f"  Using {'strict' if self.config.strict_filtering else 'lenient'} filtering (threshold={threshold})"
        )

        initial_count = len(df)

        # Calculate missing values per condition
        conditions = df["Condition"].unique()

        for condition in conditions:
            condition_df = df[df["Condition"] == condition]
            replicates = condition_df["Replicate"].nunique()
            max_missing = int(replicates * threshold)

            logger.info(
                f"  Condition '{condition}': {replicates} replicates, "
                f"max {max_missing} missing allowed"
            )

        # Pre-compute total replicates per condition from the full dataset
        total_replicates_per_condition = (
            df.groupby("Condition")["Replicate"].nunique().to_dict()
        )

        # Vectorized: count detected replicates per (Unique_PSM, Condition)
        # Only count rows where abundance was actually detected (non-NaN).
        # A PSM row with NaN abundance means it was not detected in that replicate.
        detected = (
            df.dropna(subset=["Abundance"])
            .groupby(["Unique_PSM", "Condition"])["Replicate"]
            .nunique()
            .reset_index()
        )
        detected.columns = ["Unique_PSM", "Condition", "detected_replicates"]
        detected["total_replicates"] = detected["Condition"].map(
            total_replicates_per_condition
        )
        detected["missing_count"] = (
            detected["total_replicates"] - detected["detected_replicates"]
        )
        detected["max_missing"] = (detected["total_replicates"] * threshold).astype(int)

        # PSM passes only if missing_count <= max_missing for ALL conditions
        passing_psms = (
            detected[detected["missing_count"] <= detected["max_missing"]]
            .groupby("Unique_PSM")
            .size()
            .reset_index(name="conditions_met")
        )
        # Number of conditions the PSM appears in must match total conditions
        passing_psms = passing_psms[passing_psms["conditions_met"] == len(conditions)][
            "Unique_PSM"
        ]

        df = df[df["Unique_PSM"].isin(passing_psms)].copy()

        # Strict only: Remove proteins with only 1 PSM
        if self.config.strict_filtering:
            logger.info("  Applying strict filter: removing proteins with only 1 PSM")

            psm_counts = df.groupby("Master_Protein_Accessions").size()
            valid_proteins = psm_counts[psm_counts > 1].index

            removed_proteins = len(psm_counts) - len(valid_proteins)
            df = df[df["Master_Protein_Accessions"].isin(valid_proteins)].copy()

            logger.info(f"  Removed {removed_proteins} proteins with only 1 PSM")

        filtered_count = len(df)
        logger.info(
            f"Step 5 complete: {initial_count - filtered_count} PSMs removed, "
            f"{filtered_count} remaining"
        )

        return df

    def process(self, file_paths: List[Path], output_path: Path) -> pd.DataFrame:
        """Run complete Steps 1-5 processing pipeline.

        Args:
            file_paths: List of PSM CSV file paths
            output_path: Path to save output TSV file

        Returns:
            Processed DataFrame
        """
        logger.info("Starting Steps 1-5 data processing pipeline")

        # Step 1: Combine replicates
        df = self.step1_combine_replicates(file_paths)

        # Step 2: Generate unique PSM
        df = self.step2_generate_unique_psm(df)

        # Step 3: Remove razor (optional)
        df = self.step3_remove_razor(df)

        # Step 4: Remove low quality
        df = self.step4_remove_low_quality(df)

        # Step 5: Filter by criteria
        df = self.step5_filter_by_criteria(df)

        # Save output with UTF-8 encoding to handle special characters
        output_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(output_path, sep="\t", index=False, encoding="utf-8")
        logger.info(f"Saved processed data to {output_path}")

        return df
