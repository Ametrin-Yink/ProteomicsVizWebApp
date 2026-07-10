"""Data processing pipeline - Steps 1-5 (DuckDB-only).

Pipeline stages:
  Steps 1-2: DuckDB streaming CSV -> Parquet
    - TMT: UNPIVOT wide-format channels -> long, join channel mapping
    - DIA: read_csv with filename, join metadata on basename
    Both: inline Unique_PSM + contaminant/Quan_Info/Abundance<1 filters.
  Step 3: DuckDB SQL + Python protein selection (razor peptides)
  Step 4: DuckDB SQL WHERE filter (low quality)
  Step 5: DuckDB SQL CTE filter (missing-value criteria)
"""

import csv
import logging
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

import duckdb
import pyarrow.parquet as pq

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


@dataclass
class ProcessingConfig:
    """Configuration for data processing."""

    remove_razor: bool = False
    strict_filtering: bool = False
    fasta_db: dict[str, str] | None = None


class DataProcessor:
    """Processor for PSM data - Steps 1-5 of pipeline."""

    def __init__(self, config: ProcessingConfig):
        """Initialize processor with configuration.

        Args:
            config: Processing configuration
        """
        self.config = config

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

    def step3_remove_razor_duckdb(
        self, input_path: Path, output_path: Path
    ) -> None:
        """DuckDB SQL + Python: remove razor peptides via protein-peptide counts.

        Two-phase approach per Spec Section 5.2:
        Phase 1 (DuckDB): Build protein->peptide_count map and
            first-occurrence PSM->protein-list map from input parquet.
        Python: Compute best_protein for each PSM using _select_best_protein()
            (handles FASTA tie-breaking per Spec Section 8.4).
        Phase 2 (DuckDB): Apply best_protein mapping via JOIN and COPY TO.

        If config.remove_razor is False, copies the file unchanged
        (shutil.copy2 -- same behavior as removed chunked method).

        Args:
            input_path: Source Parquet file
            output_path: Destination Parquet file
        """
        if not self.config.remove_razor:
            shutil.copy2(input_path, output_path)
            logger.info(
                "Step 3 (DuckDB): Skipping razor removal (disabled), copied file"
            )
            return

        logger.info("Step 3 (DuckDB): Two-phase razor removal")

        input_path_fwd = str(input_path).replace(chr(92), '/')
        output_path_fwd = str(output_path).replace(chr(92), '/')

        con = duckdb.connect()
        try:
            # Phase 1: Build protein->peptide count and PSM->protein maps
            con.execute(f"""
                CREATE TABLE _peptide_counts AS
                SELECT TRIM(protein) AS protein, COUNT(*) AS cnt
                FROM (
                    SELECT UNNEST(
                        STRING_SPLIT("Master_Protein_Accessions", ';')
                    ) AS protein
                    FROM read_parquet('{input_path_fwd}')
                ) sub
                WHERE TRIM(protein) != ''
                GROUP BY protein
            """)

            con.execute(f"""
                CREATE TABLE _psm_proteins AS
                SELECT "Unique_PSM",
                       FIRST("Master_Protein_Accessions") AS proteins
                FROM read_parquet('{input_path_fwd}')
                GROUP BY "Unique_PSM"
            """)

            # Python: Compute best protein for each PSM
            # Uses _select_best_protein() for FASTA tie-breaking (Spec Section 8.4)
            peptide_counts = {
                row[0]: row[1]
                for row in con.sql(
                    "SELECT protein, cnt FROM _peptide_counts"
                ).fetchall()
            }

            best_protein_map: dict[str, str] = {}
            for psm, proteins_str in con.sql(
                'SELECT "Unique_PSM", proteins FROM _psm_proteins'
            ).fetchall():
                if not proteins_str or not str(proteins_str).strip():
                    best_protein_map[psm] = ""
                    continue
                proteins = [
                    p.strip()
                    for p in str(proteins_str).split(";")
                    if p.strip()
                ]
                if len(proteins) <= 1:
                    best_protein_map[psm] = proteins[0] if proteins else ""
                else:
                    best_protein_map[psm] = self._select_best_protein(
                        proteins,
                        peptide_counts,
                        self.config.fasta_db,
                    )

            # Build mapping table
            def _sqlesc(s):
                return str(s).replace("'", "''")

            values_parts = [
                f"('{_sqlesc(psm)}', '{_sqlesc(best)}')"
                for psm, best in best_protein_map.items()
            ]
            values_clause = ",\n".join(values_parts)

            con.execute(f"""
                CREATE TABLE _best_protein_map AS
                SELECT * FROM (VALUES {values_clause})
                AS t("Unique_PSM", best_protein)
            """)

            # Phase 2: Apply mapping via JOIN + COPY
            con.execute(f"""
                COPY (
                    SELECT r.* EXCLUDE ("Master_Protein_Accessions"),
                           COALESCE(
                               m.best_protein, r."Master_Protein_Accessions"
                           ) AS "Master_Protein_Accessions"
                    FROM read_parquet('{input_path_fwd}') r
                    LEFT JOIN _best_protein_map m
                        ON r."Unique_PSM" = m."Unique_PSM"
                ) TO '{output_path_fwd}'
                (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)
            """)
        finally:
            con.close()

        if not output_path.exists():
            raise RuntimeError(
                f"DuckDB Step 3 failed: {output_path} not created"
            )

        logger.info("Step 3 (DuckDB) complete: Razor peptides resolved")

    def step5_filter_by_criteria_duckdb(
        self, input_path: Path, output_path: Path
    ) -> None:
        """DuckDB SQL: filter PSMs by missing-value criteria using CTEs.

        Per Spec Section 5.3:
        CTE chain: cond_reps -> psm_detected -> psm_pass -> COPY filtered output.
        Lenient (40% threshold, self.config.strict_filtering=False):
            removes PSMs with missing replicates exceeding
            CAST(total_reps * 0.4 AS INTEGER) in ANY condition.
        Strict (20% threshold, self.config.strict_filtering=True):
            additionally removes proteins with only 1 PSM among passing
            candidates via passing_protein_counts CTE.

        PSM must pass threshold in ALL conditions (HAVING COUNT(*) = n_conditions).

        Args:
            input_path: Source Parquet file
            output_path: Destination Parquet file
        """
        threshold = 0.2 if self.config.strict_filtering else 0.4
        logger.info(
            "Step 5 (DuckDB): Filtering by criteria (%s, threshold=%.1f)",
            "strict" if self.config.strict_filtering else "lenient",
            threshold,
        )

        # Build strict-mode CTE + WHERE extension (Spec Section 5.3 strict variant)
        strict_cte = ""
        strict_where = ""
        if self.config.strict_filtering:
            strict_cte = """,
        passing_protein_counts AS (
            SELECT "Master_Protein_Accessions", COUNT(*) AS psm_count
            FROM read_parquet('__INPUT__')
            WHERE "Unique_PSM" IN (SELECT "Unique_PSM" FROM psm_pass)
            GROUP BY "Master_Protein_Accessions"
            HAVING COUNT(*) > 1
        )"""
            strict_where = """
          AND p."Master_Protein_Accessions" IN (
              SELECT "Master_Protein_Accessions" FROM passing_protein_counts
          )"""

        input_path_fwd = str(input_path).replace(chr(92), '/')
        output_path_fwd = str(output_path).replace(chr(92), '/')

        # Replace placeholder with actual path for strict CTE subquery
        strict_cte = strict_cte.replace("__INPUT__", input_path_fwd)

        sql = f"""
            COPY (
                WITH cond_reps AS (
                    SELECT "Condition", COUNT(DISTINCT "Replicate") AS total_reps
                    FROM read_parquet('{input_path_fwd}')
                    GROUP BY "Condition"
                ),
                psm_detected AS (
                    SELECT "Unique_PSM", "Condition",
                           COUNT(DISTINCT "Replicate") AS detected_reps
                    FROM read_parquet('{input_path_fwd}')
                    WHERE "Abundance" IS NOT NULL
                    GROUP BY "Unique_PSM", "Condition"
                ),
                psm_pass AS (
                    SELECT d."Unique_PSM"
                    FROM psm_detected d
                    JOIN cond_reps c ON d."Condition" = c."Condition"
                    WHERE (c.total_reps - d.detected_reps)
                          <= CAST(FLOOR(c.total_reps * {threshold}) AS INTEGER)
                    GROUP BY d."Unique_PSM"
                    HAVING COUNT(*) = (SELECT COUNT(*) FROM cond_reps)
                ){strict_cte}
                SELECT p.*
                FROM read_parquet('{input_path_fwd}') p
                WHERE p."Unique_PSM" IN (SELECT "Unique_PSM" FROM psm_pass){strict_where}
            ) TO '{output_path_fwd}'
            (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)
        """

        con = duckdb.connect()
        try:
            input_count = con.sql(
                f"SELECT count(*) FROM read_parquet('{input_path_fwd}')"
            ).fetchone()[0]

            con.execute(sql)

            output_count = con.sql(
                f"SELECT count(*) FROM read_parquet('{output_path_fwd}')"
            ).fetchone()[0]
        finally:
            con.close()

        if not output_path.exists():
            raise RuntimeError(
                f"DuckDB Step 5 failed: {output_path} not created"
            )

        logger.info(
            "Step 5 (DuckDB) complete: %d -> %d rows (%.0f%% kept)",
            input_count,
            output_count,
            100.0 * output_count / input_count if input_count else 0,
        )

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
        logger.info(
            "Steps 1-2 (DuckDB): Streaming %d files -> %s",
            len(file_paths),
            output_path,
        )

        # Detect delimiter and get column names from first file
        delimiter = _detect_delimiter(file_paths[0])
        delim_sql = "'\\t'" if delimiter == "\t" else "','"
        with open(file_paths[0], encoding="utf-8", errors="replace") as f:
            reader = csv.reader(f, delimiter=delimiter)
            first_cols = next(reader)

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

        num_rows = pq.ParquetFile(output_path).metadata.num_rows
        con = duckdb.connect()
        try:
            num_conditions = con.execute(
                f"""SELECT COUNT(DISTINCT "Condition")
                   FROM read_parquet('{str(output_path).replace(chr(92), '/')}')"""
            ).fetchone()[0]
        finally:
            con.close()
        logger.info(
            "Steps 1-2 (DuckDB) complete: %d rows, %d conditions",
            num_rows,
            num_conditions,
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
        with open(file_paths[0], encoding="utf-8", errors="replace") as f:
            reader = csv.reader(f, delimiter=delimiter)
            first_cols = next(reader)

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

        num_rows = pq.ParquetFile(output_path).metadata.num_rows
        con = duckdb.connect()
        try:
            num_conditions = con.execute(
                f"""SELECT COUNT(DISTINCT "Condition")
                   FROM read_parquet('{str(output_path).replace(chr(92), '/')}')"""
            ).fetchone()[0]
        finally:
            con.close()
        logger.info(
            "Steps 1-2 (DuckDB TMT) complete: %d rows, %d conditions",
            num_rows,
            num_conditions,
        )
