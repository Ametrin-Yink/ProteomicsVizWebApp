"""Data processing pipeline - Steps 1-5.

This module implements the initial data processing steps:
1. Combine Replicates (TMT and DIA variants)
2. Generate Unique PSM
3. Remove Razor Information (optional)
4. Remove Low Quality
5. Filter by Criteria
"""

import logging
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from app.core.config import settings

logger = logging.getLogger(__name__)


def _detect_delimiter(file_path) -> str:
    """Auto-detect tab vs comma delimiter from first line."""
    with open(file_path, encoding="utf-8", errors="replace") as f:
        first_line = f.readline()
    if "\t" in first_line:
        return "\t"
    return ","


def _detect_tmt_abundance_columns(columns: list[str]) -> list[str]:
    """Detect columns matching 'Abundance <number>[NC]?' pattern."""
    pattern = re.compile(r"^Abundance\s+\d+[NC]?$")
    return [col for col in columns if pattern.match(col)]


def _sanitize_filename(name: str) -> str:
    """Strip non-alphanumeric characters and lowercase for comparison."""
    return re.sub(r"[^a-zA-Z0-9]", "", name).lower()


@dataclass
class PSMFilenameParsed:
    """Parsed PSM filename components."""

    experiment: str
    conditions: list[str]
    replicate: int


@dataclass
class ProcessingConfig:
    """Configuration for data processing."""

    remove_razor: bool = False
    strict_filtering: bool = False
    fasta_db: dict[str, str] | None = None


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

        Format: PSM_ExperimentName_Cond1_Cond2_..._CondN_ReplicateNumber.csv
        Example: PSM_SampleData_DMSO_1.csv

        Args:
            filename: Name of the PSM file

        Returns:
            Parsed filename components

        Raises:
            ValueError: If filename doesn't match expected pattern
        """
        # Pattern: PSM_<everything>_<Replicate>.csv
        pattern = r"PSM_(.+)_(\d+)\.csv$"
        match = re.match(pattern, filename)

        if not match:
            raise ValueError(
                f"Filename '{filename}' doesn't match pattern "
                "PSM_ExperimentName_Condition_ReplicateNumber.csv"
            )

        parts = match.group(1).split("_")
        if len(parts) < 2:
            raise ValueError(
                f"Filename '{filename}' must have at least experiment and one condition"
            )

        return PSMFilenameParsed(
            experiment=parts[0],
            conditions=parts[1:],
            replicate=int(match.group(2)),
        )

    def find_abundance_column(self, columns: list[str]) -> str:
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

    def step1_combine_replicates(self, file_paths: list[Path]) -> pd.DataFrame:
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
            columns_to_keep = [*self.REQUIRED_COLUMNS, abundance_col]

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

            # Join multiple conditions with underscore for backward compatibility
            condition_str = "_".join(parsed.conditions)

            # Add sample origination column
            df["Sample_Origination"] = f"{condition_str}_{parsed.replicate}"
            df["Condition"] = condition_str
            df["Replicate"] = parsed.replicate

            combined.append(df)
            logger.info(
                f"  Loaded {file_path.name}: {len(df)} rows, "
                f"condition={condition_str}, replicate={parsed.replicate}"
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

        # Create unique PSM identifier (fillna to handle pd.NA propagation in string dtype)
        df["Unique_PSM"] = (
            df["Sequence"].fillna("").astype(str)
            + "|"
            + df["Modifications"].fillna("").astype(str)
            + "|"
            + df["Charge"].fillna("").astype(str)
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

    def _count_peptides_per_protein(self, df: pd.DataFrame) -> dict[str, int]:
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
        proteins: list[str],
        peptide_counts: dict[str, int],
        fasta_db: dict[str, str] | None,
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

        # Remove "No Value" quantification (skip if column absent — DIA files lack Quan_Info)
        if "Quan_Info" in df.columns:
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

    # ── Chunked Parquet I/O (Task 4) ──────────────────────────────────────

    @staticmethod
    def _parquet_chunked_reader(file_path: Path, chunksize: int = 100_000):
        """Generator: yield DataFrame chunks from a Parquet file.

        Args:
            file_path: Path to Parquet file
            chunksize: Number of rows per chunk

        Yields:
            pandas DataFrame for each row group / batch
        """
        import pyarrow.parquet as pq

        pf = pq.ParquetFile(file_path)
        for batch in pf.iter_batches(batch_size=chunksize):
            yield batch.to_pandas()

    def step3_remove_razor_chunked(self, input_path: Path, output_path: Path) -> None:
        """Chunked two-pass: scan proteins, then apply best-protein selection.

        Pass 1: scan all chunks to build protein -> peptide_count map and
                collect first-occurrence PSM -> Master_Protein_Accessions.
        Pass 2: apply best-protein selection per chunk using pre-computed map.

        If config.remove_razor is False, copies input file unchanged.

        Args:
            input_path: Source Parquet file
            output_path: Destination Parquet file
        """
        if not self.config.remove_razor:
            import shutil

            shutil.copy2(input_path, output_path)
            logger.info(
                "Step 3 (chunked): Skipping razor removal (disabled), copied file"
            )
            return

        logger.info("Step 3 (chunked): Two-pass razor removal")

        # ── Pass 1: build protein->peptide map and PSM->protein map ──
        protein_peptide_counts: Counter = Counter()
        psm_to_protein: dict[str, str] = {}
        seen_psms: set[str] = set()

        for chunk_df in self._parquet_chunked_reader(input_path):
            # Count peptides per protein across this chunk
            chunk_counts = (
                chunk_df["Master_Protein_Accessions"]
                .str.split(";")
                .explode()
                .str.strip()
                .value_counts()
            )
            for prot, count in chunk_counts.items():
                if prot:
                    protein_peptide_counts[prot] += count

            # Collect first occurrence of each Unique_PSM's protein string
            new_mask = ~chunk_df["Unique_PSM"].isin(seen_psms)
            if new_mask.any():
                new_psms = (
                    chunk_df.loc[new_mask, ["Unique_PSM", "Master_Protein_Accessions"]]
                    .set_index("Unique_PSM")["Master_Protein_Accessions"]
                    .to_dict()
                )
                psm_to_protein.update(new_psms)
                seen_psms.update(new_psms.keys())

        # Compute best protein for each unique PSM
        best_protein_map: dict[str, str] = {}
        for psm, proteins_str in psm_to_protein.items():
            if pd.isna(proteins_str) or not str(proteins_str).strip():
                best_protein_map[psm] = ""
            else:
                proteins = [
                    p.strip() for p in str(proteins_str).split(";") if p.strip()
                ]
                if len(proteins) <= 1:
                    best_protein_map[psm] = proteins[0] if proteins else ""
                else:
                    best_protein_map[psm] = self._select_best_protein(
                        proteins,
                        dict(protein_peptide_counts),
                        self.config.fasta_db,
                    )

        # ── Pass 2: apply best-protein per chunk and write output ──
        import pyarrow as pa
        import pyarrow.parquet as pq

        writer = None
        try:
            pf = pq.ParquetFile(input_path)
            for batch in pf.iter_batches(batch_size=100_000):
                df = batch.to_pandas()
                df["Master_Protein_Accessions"] = df["Unique_PSM"].map(best_protein_map)
                table = pa.Table.from_pandas(df)
                if writer is None:
                    writer = pq.ParquetWriter(
                        output_path,
                        table.schema,
                        compression=settings.parquet_compression,
                    )
                writer.write_table(table)
        finally:
            if writer is not None:
                writer.close()

        logger.info("Step 3 (chunked) complete: Razor peptides resolved")

    def step4_remove_low_quality_chunked(
        self, input_path: Path, output_path: Path
    ) -> None:
        """Chunked single-pass: filter each chunk, write to output.

        Applies row-level filters (Contaminant, Quan_Info, Abundance) to each
        chunk independently and streams results to a new Parquet file.

        Args:
            input_path: Source Parquet file
            output_path: Destination Parquet file
        """
        import pyarrow as pa
        import pyarrow.parquet as pq

        logger.info("Step 4 (chunked): Removing low quality PSMs")

        pf = pq.ParquetFile(input_path)
        has_quan_info = "Quan_Info" in pf.schema_arrow.names

        initial_count = 0
        remaining_count = 0
        writer = None
        try:
            for batch in pf.iter_batches(batch_size=100_000):
                df = batch.to_pandas()
                initial_count += len(df)

                # Remove contaminants
                df["Contaminant"] = df["Contaminant"].astype(str).str.lower()
                df = df[df["Contaminant"] != "true"].copy()

                # Remove "No Value" quantification (optional column)
                if has_quan_info and "Quan_Info" in df.columns:
                    df = df[df["Quan_Info"] != "No Value"].copy()

                # Remove low abundance
                df["Abundance"] = pd.to_numeric(df["Abundance"], errors="coerce")
                df = df[df["Abundance"] >= 1].copy()

                remaining_count += len(df)

                table = pa.Table.from_pandas(df)
                if writer is None:
                    writer = pq.ParquetWriter(
                        output_path,
                        table.schema,
                        compression=settings.parquet_compression,
                    )
                writer.write_table(table)
        finally:
            if writer is not None:
                writer.close()

        removed = initial_count - remaining_count
        logger.info(
            "Step 4 (chunked) complete: Removed %d low quality PSMs, %d remaining",
            removed,
            remaining_count,
        )

    def step4_remove_low_quality_duckdb(
        self, input_path: Path, output_path: Path
    ) -> None:
        """DuckDB SQL: filter contaminants, No Value, Abundance < 1 in one pass.

        Reads input parquet, applies row-level filters via DuckDB WHERE clause,
        and streams output directly to a new Parquet file using COPY TO.

        Handles the optional Quan_Info column (absent in DIA files) by checking
        the parquet schema before building the SQL.

        Args:
            input_path: Source Parquet file
            output_path: Destination Parquet file
        """
        import duckdb
        import pyarrow.parquet as pq

        logger.info("Step 4 (DuckDB): Removing low quality PSMs")

        pf = pq.ParquetFile(input_path)
        has_quan_info = "Quan_Info" in pf.schema_arrow.names

        filter_parts = [
            "(Contaminant IS NULL OR LOWER(Contaminant) != 'true')",
            'TRY_CAST("Abundance" AS DOUBLE) >= 1',
        ]
        if has_quan_info:
            filter_parts.append(
                '("Quan_Info" IS NULL OR "Quan_Info" != \'No Value\')'
            )
        where_clause = "\n              AND ".join(filter_parts)

        input_path_fwd = str(input_path).replace(chr(92), '/')
        output_path_fwd = str(output_path).replace(chr(92), '/')

        sql = f"""
            COPY (
                SELECT *
                FROM read_parquet('{input_path_fwd}')
                WHERE {where_clause}
            ) TO '{output_path_fwd}'
            (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)
        """

        con = duckdb.connect()
        try:
            initial_count = con.sql(
                f"SELECT count(*) FROM read_parquet('{input_path_fwd}')"
            ).fetchone()[0]

            con.execute(sql)

            remaining_count = con.sql(
                f"SELECT count(*) FROM read_parquet('{output_path_fwd}')"
            ).fetchone()[0]
        finally:
            con.close()

        if not output_path.exists():
            raise RuntimeError(
                f"DuckDB Step 4 failed: {output_path} not created"
            )

        removed = initial_count - remaining_count
        logger.info(
            "Step 4 (DuckDB) complete: Removed %d low quality PSMs, %d remaining",
            removed,
            remaining_count,
        )

    def step5_filter_by_criteria_chunked(
        self, input_path: Path, output_path: Path
    ) -> None:
        """Chunked two/three-pass: compute criteria, then filter and write.

        Pass 1 (all chunks): compute per-condition replicate counts and
        identify the set of PSMs that pass the missing-value threshold.
        If strict_filtering is True, also counts PSMs per protein among
        passing candidates.
        Final pass: filter chunks to only passing rows and write output.

        Args:
            input_path: Source Parquet file
            output_path: Destination Parquet file
        """
        logger.info("Step 5 (chunked): Filtering by criteria")

        threshold = 0.2 if self.config.strict_filtering else 0.4
        logger.info(
            "  Using %s filtering (threshold=%.1f)",
            "strict" if self.config.strict_filtering else "lenient",
            threshold,
        )

        import pyarrow as pa
        import pyarrow.parquet as pq

        # ── Pass 1a: total replicates per condition and detected counts ──
        rep_sets: dict[str, set[int]] = defaultdict(set)
        psm_cond_detected: dict[tuple[str, str], set[int]] = {}

        for chunk_df in self._parquet_chunked_reader(input_path):
            # Accumulate unique replicate IDs per condition across all chunks
            for cond, group in chunk_df.groupby("Condition"):
                rep_sets[cond].update(group["Replicate"].unique().tolist())

            # Count detected (non-NaN) abundance per (PSM, Condition)
            detected = chunk_df.dropna(subset=["Abundance"])
            for psm, cond, rep in zip(
                detected["Unique_PSM"],
                detected["Condition"],
                detected["Replicate"],
                strict=False,
            ):
                key = (psm, cond)
                if key not in psm_cond_detected:
                    psm_cond_detected[key] = set()
                psm_cond_detected[key].add(int(rep))

        # Convert accumulated sets to counts after pass completes
        total_reps_per_cond = {cond: len(reps) for cond, reps in rep_sets.items()}

        # ── Pass 1b: determine which PSMs pass the threshold ──
        passing: set[str] = set()
        failing: set[str] = set()
        for (psm, cond), detected_reps in psm_cond_detected.items():
            total = total_reps_per_cond.get(cond, 1)
            max_missing = int(total * threshold)
            missing_count = total - len(detected_reps)
            if missing_count <= max_missing:
                passing.add(psm)
            else:
                failing.add(psm)

        # PSMs that fail ANY condition are excluded
        psms_to_keep = passing - failing

        conditions = list(total_reps_per_cond.keys())
        logger.info(
            "  %d conditions, %d unique PSMs, %d pass criteria",
            len(conditions),
            len(passing) + len(failing),
            len(psms_to_keep),
        )

        # ── Strict: count rows per protein among passing PSMs ──
        valid_proteins: set[str] | None = None
        if self.config.strict_filtering:
            logger.info("  Counting PSMs per protein for strict filter")
            row_counts: dict[str, int] = {}
            for chunk_df in self._parquet_chunked_reader(input_path):
                kept = chunk_df[chunk_df["Unique_PSM"].isin(psms_to_keep)]
                for prot, cnt in (
                    kept.groupby("Master_Protein_Accessions").size().items()
                ):
                    pkey = str(prot) if pd.notna(prot) else ""
                    if pkey:
                        row_counts[pkey] = row_counts.get(pkey, 0) + cnt

            valid_proteins = {p for p, c in row_counts.items() if c > 1}
            logger.info(
                "  Strict: %d proteins with >1 PSM",
                len(valid_proteins),
            )

        # ── Final pass: write filtered output ──
        total_input = 0
        total_output = 0
        writer = None
        try:
            pf = pq.ParquetFile(input_path)
            for batch in pf.iter_batches(batch_size=100_000):
                df = batch.to_pandas()
                total_input += len(df)
                mask = df["Unique_PSM"].isin(psms_to_keep)
                if valid_proteins is not None:
                    mask &= df["Master_Protein_Accessions"].isin(valid_proteins)
                df = df[mask].copy().reset_index(drop=True)
                total_output += len(df)

                table = pa.Table.from_pandas(df)
                if writer is None:
                    writer = pq.ParquetWriter(
                        output_path,
                        table.schema,
                        compression=settings.parquet_compression,
                    )
                writer.write_table(table)
        finally:
            if writer is not None:
                writer.close()

        logger.info(
            "Step 5 (chunked) complete: %d -> %d rows (%.0f%% kept)",
            total_input,
            total_output,
            100.0 * total_output / total_input if total_input else 0,
        )

    def process(self, file_paths: list[Path], output_path: Path) -> pd.DataFrame:
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

    def step1_combine_replicates_tmt(
        self,
        file_paths: list[Path],
        tmt_channel_mapping: dict[str, dict],
    ) -> pd.DataFrame:
        """Step 1 (TMT): Read TMT file(s), melt channels, map to conditions.

        Args:
            file_paths: List of TMT file paths (tab-delimited .txt)
            tmt_channel_mapping: Channel -> {group: value, ..., replicate: N} mapping

        Returns:
            Melted and mapped DataFrame with Abundance, Condition, Sample_Origination, etc.
        """
        logger.info(f"Step 1 (TMT): Processing {len(file_paths)} file(s)")

        all_dfs = []
        for file_path in file_paths:
            delimiter = _detect_delimiter(file_path)
            df = pd.read_csv(
                file_path,
                sep=delimiter,
                encoding="utf-8",
                low_memory=False,
            )

            abundance_cols = _detect_tmt_abundance_columns(list(df.columns))
            if not abundance_cols:
                raise ValueError(
                    f"No TMT abundance columns found in {file_path.name}. "
                    f"Pattern: 'Abundance <number>[NC]?'"
                )

            non_abundance_cols = [
                col for col in df.columns if col not in abundance_cols
            ]

            # Melt wide format to long format
            melted = pd.melt(
                df,
                id_vars=non_abundance_cols,
                value_vars=abundance_cols,
                var_name="Channel",
                value_name="Abundance",
            )

            # Extract channel label
            melted["Channel"] = melted["Channel"].str.extract(
                r"Abundance\s+(.+)", expand=False
            )

            # Map channel to condition groups
            mapping_df = pd.DataFrame.from_dict(
                tmt_channel_mapping, orient="index"
            ).reset_index()
            mapping_df = mapping_df.rename(columns={"index": "Channel"})
            mapping_df["Channel"] = mapping_df["Channel"].astype(str)
            melted = melted.merge(mapping_df, on="Channel", how="left")

            # Drop Channel column after mapping
            melted = melted.drop(columns=["Channel"])

            # Rename replicate (lowercase from mapping) to Replicate (uppercase) for consistency
            if "replicate" in melted.columns:
                melted = melted.rename(columns={"replicate": "Replicate"})

            # Clean abundance
            melted["Abundance"] = pd.to_numeric(melted["Abundance"], errors="coerce")
            melted = melted.dropna(subset=["Abundance"])
            melted = melted[melted["Abundance"] != 0]

            # Build Condition from group columns
            sample_mapping = next(iter(tmt_channel_mapping.values()))
            group_cols = [k for k in sample_mapping if k != "replicate"]

            melted["Condition"] = melted[group_cols[0]].astype(str)
            for col in group_cols[1:]:
                melted["Condition"] = (
                    melted["Condition"] + "_" + melted[col].astype(str)
                )

            # Build Sample_Origination and ensure Replicate is int
            melted["Replicate"] = pd.to_numeric(
                melted["Replicate"], errors="coerce"
            ).astype(int)
            melted["Sample_Origination"] = (
                melted["Condition"].astype(str) + "_" + melted["Replicate"].astype(str)
            )

            # Rename spaces to underscores in non-abundance columns
            rename_map = {
                col: col.replace(" ", "_")
                for col in melted.columns
                if " " in col and col not in abundance_cols
            }
            melted = melted.rename(columns=rename_map)

            all_dfs.append(melted)

        result = pd.concat(all_dfs, ignore_index=True)
        logger.info(
            f"Step 1 (TMT) complete: {len(result)} rows, "
            f"{result['Condition'].nunique()} conditions"
        )
        return result

    def step1_combine_replicates_dia(
        self,
        file_paths: list[Path],
        metadata_columns: dict[str, dict],
    ) -> pd.DataFrame:
        """Step 1 (DIA): Read N DIA files, apply per-file metadata.

        Args:
            file_paths: List of DIA file paths
            metadata_columns: Per-file metadata keyed by sanitized filename

        Returns:
            Combined DataFrame with Abundance, Condition, Sample_Origination, etc.
        """
        logger.info(f"Step 1 (DIA): Processing {len(file_paths)} file(s)")

        all_dfs = []
        for file_path in file_paths:
            delimiter = _detect_delimiter(file_path)
            df = pd.read_csv(
                file_path,
                sep=delimiter,
                encoding="utf-8",
                low_memory=False,
            )

            # Look up metadata for this file
            file_meta = None
            file_name = file_path.name
            file_sanitized = _sanitize_filename(file_name)
            file_stem = file_path.stem
            file_stem_sanitized = _sanitize_filename(file_stem)

            for key, meta in metadata_columns.items():
                key_sanitized = _sanitize_filename(key)
                key_stem_sanitized = _sanitize_filename(
                    key.rsplit(".", 1)[0] if "." in key else key
                )
                if key_sanitized in (
                    file_sanitized,
                    file_stem_sanitized,
                ) or key_stem_sanitized in (file_stem_sanitized, file_sanitized):
                    file_meta = meta
                    break

            if file_meta is None:
                raise ValueError(
                    f"No metadata found for file '{file_name}'. "
                    f"Available keys: {list(metadata_columns.keys())}"
                )

            # Rename Quan Value -> Abundance FIRST
            if "Quan Value" in df.columns and "Abundance" in df.columns:
                logger.warning(
                    f"File '{file_name}' has both 'Quan Value' and 'Abundance'. "
                    f"Renaming 'Quan Value' to 'Abundance_DIA'."
                )
                df = df.rename(columns={"Quan Value": "Abundance_DIA"})
            elif "Quan Value" in df.columns:
                df = df.rename(columns={"Quan Value": "Abundance"})

            # Rename spaces to underscores in all other columns
            rename_map = {
                col: col.replace(" ", "_")
                for col in df.columns
                if " " in col and col != "Abundance"
            }
            df = df.rename(columns=rename_map)

            # Ensure Abundance is numeric
            abund_col = (
                "Abundance"
                if "Abundance" in df.columns
                else "Abundance_DIA"
                if "Abundance_DIA" in df.columns
                else None
            )
            if abund_col is None:
                raise ValueError(f"No abundance column found in {file_name}")
            df[abund_col] = pd.to_numeric(df[abund_col], errors="coerce")
            df = df.dropna(subset=[abund_col])

            # Build Condition and Sample_Origination from metadata
            meta_keys = list(file_meta.keys())
            reserved = {"experiment", "batch", "replicate"}
            group_cols = [k for k in meta_keys if k not in reserved]

            if not group_cols:
                raise ValueError(
                    f"No condition group columns in metadata for '{file_name}'"
                )

            # Build Condition by joining group values with "_"
            df["Condition"] = str(file_meta[group_cols[0]])
            for col in group_cols[1:]:
                df["Condition"] = (
                    df["Condition"].astype(str) + "_" + str(file_meta[col])
                )

            replicate = int(file_meta.get("replicate", 1))
            df["Replicate"] = replicate
            df["Sample_Origination"] = (
                df["Condition"].astype(str) + "_" + str(replicate)
            )

            # Add condition group columns to DataFrame
            for col in group_cols:
                df[col] = file_meta[col]

            all_dfs.append(df)

        result = pd.concat(all_dfs, ignore_index=True)
        logger.info(
            f"Step 1 (DIA) complete: {len(result)} rows, "
            f"{result['Condition'].nunique()} conditions"
        )
        return result

    def step1_2_duckdb_dia(
        self,
        file_paths: list[Path],
        metadata_columns: dict[str, dict],
        output_path: Path,
    ) -> None:
        """Steps 1-2 (DIA): Streaming CSV -> Parquet via DuckDB.

        Performs Steps 1 (read + metadata join), 2 (Unique_PSM), and
        low-quality filters (contaminants, Quan_Info, Abundance<1)
        as a single streaming DuckDB query.

        Args:
            file_paths: List of DIA file paths
            metadata_columns: Per-file metadata keyed by filename
            output_path: Path for output Parquet file
        """
        import duckdb

        logger.info(
            "Steps 1-2 (DuckDB): Streaming %d files -> %s",
            len(file_paths),
            output_path,
        )

        # Detect delimiter and get column names from first file
        delimiter = _detect_delimiter(file_paths[0])
        delim_sql = "'\\t'" if delimiter == "\t" else "','"
        first_cols = pd.read_csv(
            file_paths[0],
            nrows=0,
            sep=delimiter,
        ).columns.tolist()

        # Validate at least one abundance column exists
        has_quan_value = "Quan Value" in first_cols
        has_abundance = "Abundance" in first_cols
        if not has_quan_value and not has_abundance:
            raise ValueError(
                f"No abundance column found in {file_paths[0].name}. "
                f"Expected 'Quan Value' or 'Abundance'. "
                f"Available columns: {first_cols}"
            )

        # Determine group columns from metadata
        reserved = {"experiment", "batch", "replicate"}
        group_cols = None
        for meta in metadata_columns.values():
            cols = [k for k in meta if k not in reserved]
            if group_cols is None:
                group_cols = cols
            elif cols != group_cols:
                logger.warning("Inconsistent group columns across metadata entries")
        if group_cols is None:
            raise ValueError("No condition group columns found in metadata")

        # Build metadata rows
        meta_rows = []
        for fname, meta in metadata_columns.items():
            condition = "_".join(str(meta[c]) for c in group_cols)
            replicate = int(meta.get("replicate", 1))
            sample_orig = f"{condition}_{replicate}"
            row = [fname, condition, replicate, sample_orig]
            for c in group_cols:
                row.append(str(meta[c]))
            meta_rows.append(tuple(row))

        all_meta_cols = [
            "filename",
            "condition",
            "replicate",
            "sample_origination",
            *group_cols,
        ]

        def _sqlesc(s):
            return s.replace("'", "''")

        # Build VALUES clause for metadata table
        values_parts = []
        for row in meta_rows:
            vals = []
            for i, v in enumerate(row):
                col = all_meta_cols[i]
                if col == "replicate":
                    vals.append(str(v))
                else:
                    vals.append(f"'{_sqlesc(str(v))}'")
            values_parts.append("(" + ", ".join(vals) + ")")

        values_clause = ",\n".join(values_parts)
        meta_cols_clause = ", ".join(all_meta_cols)

        # Build explicit file list (avoid glob picking up unrelated files)
        file_list_sql = ", ".join(
            f"'{str(p).replace(chr(92), '/')}'" for p in file_paths
        )

        # Build the SELECT column list for original CSV columns
        select_parts = []
        for col in first_cols:
            if col in ("Quan Value", "Abundance"):
                # Handled via abundance expression below, skip raw column
                continue
            qcol = f'"{col}"'
            new_name = col.replace(" ", "_")
            if new_name != col:
                select_parts.append(f'{qcol} AS "{new_name}"')
            else:
                select_parts.append(qcol)

        orig_cols_sql = ",\n            ".join(select_parts)

        # Build abundance expression with explicit DOUBLE cast
        if has_quan_value and has_abundance:
            abund_expr = 'COALESCE("Quan Value", Abundance)'
        elif has_quan_value:
            abund_expr = '"Quan Value"'
        else:
            abund_expr = "Abundance"
        abund_expr_typed = f"TRY_CAST({abund_expr} AS DOUBLE)"

        # Build metadata column JOIN references
        meta_from_cols = ", ".join(f"m.{c}" for c in all_meta_cols[1:])

        # Build group columns SELECT suffix
        group_select_sql = ""
        if group_cols:
            group_select_sql = ",\n" + ",\n".join(
                f"            {c}" for c in group_cols
            )

        # Build WHERE clause — "Quan Info" column is optional
        has_quan_info = "Quan Info" in first_cols
        filter_parts = [
            "(Contaminant IS NULL OR LOWER(Contaminant) != 'true')",
            f"{abund_expr_typed} >= 1",
        ]
        if has_quan_info:
            filter_parts.append('("Quan Info" IS NULL OR "Quan Info" != \'No Value\')')
        where_clause = " AND ".join(filter_parts)

        con = duckdb.connect()
        try:
            # Create in-memory metadata table
            con.execute(f"""
                CREATE TABLE _meta AS
                SELECT * FROM (VALUES {values_clause})
                AS t({meta_cols_clause})
            """)

            # Streaming COPY: read_csv -> join metadata -> rename -> filter -> parquet
            sql = f"""
                COPY (
                    WITH raw AS (
                        SELECT *,
                            regexp_replace(filename, '^.*[\\/\\\\]', '')
                                AS basename
                        FROM read_csv([{file_list_sql}],
                            delim={delim_sql}, auto_detect=true,
                            all_varchar=true, header=true, filename=true)
                    ),
                    joined AS (
                        SELECT r.* EXCLUDE (filename),
                               {meta_from_cols}
                        FROM raw r
                        JOIN _meta m
                            ON r.basename = m.filename
                    )
                    SELECT
                        {orig_cols_sql},
                        {abund_expr_typed} AS "Abundance",
                        COALESCE(Sequence, '')
                            || '|' || COALESCE(Modifications, '')
                            || '|' || COALESCE(Charge, '')
                            AS "Unique_PSM",
                        condition AS "Condition",
                        replicate AS "Replicate",
                        sample_origination AS "Sample_Origination"{group_select_sql}
                    FROM joined
                    WHERE
                        {where_clause}
                ) TO '{str(output_path).replace(chr(92), '/')}'
                (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)
            """

            con.execute(sql)
        finally:
            con.close()

        if not output_path.exists():
            raise RuntimeError(f"DuckDB streaming failed: {output_path} not created")

        result_df = pd.read_parquet(output_path, engine="pyarrow")
        logger.info(
            "Steps 1-2 (DuckDB) complete: %d rows, %d conditions",
            len(result_df),
            result_df["Condition"].nunique(),
        )

    def step1_2_duckdb_tmt(
        self,
        file_paths: list[Path],
        tmt_channel_mapping: dict[str, dict],
        output_path: Path,
    ) -> None:
        """Steps 1-2 (TMT): Streaming CSV -> Parquet via DuckDB UNPIVOT.

        Performs Steps 1 (read + melt channels + map conditions),
        2 (Unique_PSM), and low-quality filters (contaminants,
        Quan_Info, Abundance<1) as a single streaming DuckDB query.

        TMT files are wide-format with 16+ Abundance <N> columns.
        DuckDB UNPIVOT melts them into long format, then joins with
        channel mapping for condition/replicate assignment.

        Args:
            file_paths: List of TMT file paths (tab-delimited .txt)
            tmt_channel_mapping: Channel -> {group: value, ..., replicate: N}
            output_path: Path for output Parquet file
        """
        import duckdb

        logger.info(
            "Steps 1-2 (DuckDB TMT): Streaming %d file(s) -> %s",
            len(file_paths),
            output_path,
        )

        # Validate channel mapping is non-empty BEFORE reading files
        if not tmt_channel_mapping:
            raise ValueError("tmt_channel_mapping is required for TMT input")

        # Detect delimiter and column names from first file
        delimiter = _detect_delimiter(file_paths[0])
        delim_sql = "'\\t'" if delimiter == "\t" else "','"
        first_cols = pd.read_csv(
            file_paths[0],
            nrows=0,
            sep=delimiter,
        ).columns.tolist()

        # Validate TMT abundance columns exist
        abundance_cols = _detect_tmt_abundance_columns(first_cols)
        if not abundance_cols:
            raise ValueError(
                f"No TMT abundance columns found in {file_paths[0].name}. "
                f"Pattern: 'Abundance <number>[NC]?'"
            )

        # Determine group columns from channel mapping (all keys except 'replicate')
        sample_mapping = next(iter(tmt_channel_mapping.values()))
        group_cols = [k for k in sample_mapping if k != "replicate"]
        if not group_cols:
            raise ValueError(
                "No condition group columns found in tmt_channel_mapping"
            )

        # Build channel mapping VALUES clause
        def _sqlesc(s):
            return str(s).replace("'", "''")

        values_parts = []
        for channel, info in tmt_channel_mapping.items():
            condition = "_".join(str(info[c]) for c in group_cols)
            replicate = int(info.get("replicate", 1))
            vals = [
                f"'{_sqlesc(channel)}'",
                f"'{_sqlesc(condition)}'",
                str(replicate),
            ]
            for c in group_cols:
                vals.append(f"'{_sqlesc(str(info[c]))}'")
            values_parts.append("(" + ", ".join(vals) + ")")

        values_clause = ",\n".join(values_parts)
        meta_cols = ["channel", "condition", "replicate", *group_cols]
        meta_cols_clause = ", ".join(meta_cols)

        # Build non-abundance column SELECT list (rename spaces -> underscores)
        non_abundance_cols = [
            col for col in first_cols if col not in abundance_cols
        ]
        select_parts = []
        for col in non_abundance_cols:
            qcol = f'"{col}"'
            new_name = col.replace(" ", "_")
            if new_name != col:
                select_parts.append(f'{qcol} AS "{new_name}"')
            else:
                select_parts.append(qcol)

        orig_cols_sql = ",\n            ".join(select_parts)

        # Build WHERE clause
        has_quan_info = "Quan Info" in first_cols
        filter_parts = [
            "(Contaminant IS NULL OR LOWER(Contaminant) != 'true')",
            "TRY_CAST(Abundance AS DOUBLE) >= 1",
        ]
        if has_quan_info:
            filter_parts.append(
                '("Quan Info" IS NULL OR "Quan Info" != \'No Value\')'
            )
        where_clause = " AND ".join(filter_parts)

        # Build condition expression (group cols joined with _)
        condition_expr = " || '_' || ".join(
            f"m.{c}" for c in group_cols
        )
        # Build group column SELECT suffix
        group_select_sql = ",\n            ".join(
            f"m.{c} AS \"{c}\"" for c in group_cols
        )

        # Build file list for read_csv
        file_list_sql = ", ".join(
            f"'{str(p).replace(chr(92), '/')}'" for p in file_paths
        )

        # Build the SQL
        # Use raw-string variables for regex patterns to avoid Python
        # f-string backslash escaping issues. DuckDB's regex engine (RE2)
        # needs single backslashes: \s \d \w etc.
        abundance_regex = r'Abundance\s+\d+[NC]?'
        channel_strip_regex = r'^Abundance\s+'
        sql = f"""
            COPY (
                WITH raw AS (
                    SELECT *
                    FROM read_csv([{file_list_sql}],
                        delim={delim_sql}, auto_detect=true,
                        all_varchar=true, header=true)
                ),
                unpivoted AS (
                    UNPIVOT raw
                    ON COLUMNS('{abundance_regex}')
                    INTO NAME Channel VALUE Abundance
                ),
                mapped AS (
                    SELECT
                        u.* EXCLUDE (Channel),
                        regexp_replace(
                            Channel, '{channel_strip_regex}', ''
                        ) AS _channel_label
                    FROM unpivoted u
                )
                SELECT
                    {orig_cols_sql},
                    TRY_CAST(Abundance AS DOUBLE) AS "Abundance",
                    COALESCE(Sequence, '')
                        || '|' || COALESCE(Modifications, '')
                        || '|' || COALESCE(Charge, '')
                        AS "Unique_PSM",
                    {condition_expr} AS "Condition",
                    m.replicate AS "Replicate",
                    {condition_expr}
                        || '_' || CAST(m.replicate AS VARCHAR)
                        AS "Sample_Origination",
                    {group_select_sql}
                FROM mapped r
                JOIN _channel_map m
                    ON r._channel_label = m.channel
                WHERE
                    {where_clause}
            ) TO '{str(output_path).replace(chr(92), '/')}'
            (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)
        """

        con = duckdb.connect()
        try:
            # Create in-memory channel mapping table
            con.execute(f"""
                CREATE TABLE _channel_map AS
                SELECT * FROM (VALUES {values_clause})
                AS t({meta_cols_clause})
            """)

            con.execute(sql)
        finally:
            con.close()

        if not output_path.exists():
            raise RuntimeError(
                f"DuckDB TMT streaming failed: {output_path} not created"
            )

        result_df = pd.read_parquet(output_path, engine="pyarrow")
        logger.info(
            "Steps 1-2 (DuckDB TMT) complete: %d rows, %d conditions",
            len(result_df),
            result_df["Condition"].nunique(),
        )
