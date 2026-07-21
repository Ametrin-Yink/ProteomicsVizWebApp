"""PSM preprocessing pipeline (DuckDB-only).

Pipeline stages:
  Prepare PSMs: DuckDB streaming CSV -> Parquet
    - TMT: UNPIVOT wide-format channels -> long, join channel mapping
    - DIA: read_csv with filename, join metadata on basename
    Both: inline Unique_PSM + contaminant/Quan_Info/Abundance filters.
  Resolve shared peptides: distinct-PSM protein support in DuckDB.
  Coverage/protein eligibility: explicit missingness and minimum-PSM filters.
"""

import csv
import logging
import re
from dataclasses import dataclass
from pathlib import Path

import duckdb
import pyarrow.parquet as pq

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


def _read_columns(file_path: Path, delimiter: str | None = None) -> list[str]:
    """Read one delimited-file header without loading data rows."""
    delimiter = delimiter or _detect_delimiter(file_path)
    with open(file_path, encoding="utf-8", errors="replace") as f:
        return next(csv.reader(f, delimiter=delimiter))


def _sqlesc(s: str) -> str:
    """Escape single quotes for SQL string literals."""
    return str(s).replace("'", "''")


def _sql_identifier(s: str) -> str:
    """Quote a DuckDB identifier supplied by imported metadata."""
    return '"' + str(s).replace('"', '""') + '"'


@dataclass
class ProcessingConfig:
    """Configuration for data processing."""

    resolve_shared_peptides: bool | None = None
    max_missing_fraction_per_condition: float | None = None
    min_psms_per_protein: int | None = None
    expected_replicates_by_condition: dict[str, int] | None = None

    # Deprecated direct-construction compatibility. API/session migration is
    # handled by the Pydantic models; these aliases support older internal calls.
    remove_razor: bool | None = None
    strict_filtering: bool | None = None
    min_peptides_per_protein: int | None = None

    def __post_init__(self) -> None:
        if self.resolve_shared_peptides is None:
            self.resolve_shared_peptides = bool(self.remove_razor)
        if self.max_missing_fraction_per_condition is None:
            self.max_missing_fraction_per_condition = (
                0.20 if self.strict_filtering else 0.40
            )
        if self.min_psms_per_protein is None:
            migrated_min = self.min_peptides_per_protein or 1
            self.min_psms_per_protein = max(
                migrated_min, 2 if self.strict_filtering else 1
            )

        if not 0 <= self.max_missing_fraction_per_condition <= 1:
            raise ValueError(
                "max_missing_fraction_per_condition must be between 0 and 1"
            )
        if not 1 <= self.min_psms_per_protein <= 10:
            raise ValueError("min_psms_per_protein must be between 1 and 10")
        if self.expected_replicates_by_condition and any(
            int(count) < 1 for count in self.expected_replicates_by_condition.values()
        ):
            raise ValueError("Expected replicate counts must be at least 1")


class DataProcessor:
    """Processor for PSM preparation and shared scientific filters."""

    def __init__(self, config: ProcessingConfig):
        """Initialize processor with configuration.

        Args:
            config: Processing configuration
        """
        self.config = config

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
            filter_parts.append('("Quan_Info" IS NULL OR "Quan_Info" != \'No Value\')')
        where_clause = "\n              AND ".join(filter_parts)

        input_path_fwd = str(input_path).replace(chr(92), "/")
        output_path_fwd = str(output_path).replace(chr(92), "/")

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
            raise RuntimeError(f"DuckDB Step 4 failed: {output_path} not created")

        removed = initial_count - remaining_count
        logger.info(
            "Step 4 (DuckDB) complete: Removed %d low quality PSMs, %d remaining",
            removed,
            remaining_count,
        )

    def step2_resolve_shared_peptides_duckdb(
        self, input_path: Path, output_path: Path
    ) -> bool:
        """Assign each shared PSM to the candidate with most distinct PSM support.

        Candidate order in the original semicolon-separated accession string is
        the deterministic tie-breaker. The operation is entirely in DuckDB so it
        does not materialize a large PSM-to-protein mapping in Python.

        Returns ``False`` without writing when resolution is disabled, allowing
        callers to preserve the original Parquet file without a redundant copy.
        """
        if not self.config.resolve_shared_peptides:
            logger.info("Shared-peptide resolution disabled; preserving protein groups")
            return False

        logger.info("Resolving shared peptides by distinct PSM support")
        input_path_fwd = str(input_path).replace(chr(92), "/")
        output_path_fwd = str(output_path).replace(chr(92), "/")

        sql = f"""
            COPY (
                WITH psm_groups AS (
                    SELECT "Unique_PSM",
                           FIRST("Master_Protein_Accessions") AS protein_group
                    FROM read_parquet('{input_path_fwd}')
                    GROUP BY "Unique_PSM"
                ),
                candidates AS (
                    SELECT p."Unique_PSM",
                           TRIM(u.protein) AS protein,
                           u.protein_order
                    FROM psm_groups p,
                    UNNEST(STRING_SPLIT(p.protein_group, ';'))
                        WITH ORDINALITY AS u(protein, protein_order)
                    WHERE TRIM(u.protein) != ''
                ),
                protein_support AS (
                    SELECT protein, COUNT(DISTINCT "Unique_PSM") AS psm_count
                    FROM candidates
                    GROUP BY protein
                ),
                ranked AS (
                    SELECT c."Unique_PSM", c.protein,
                           ROW_NUMBER() OVER (
                               PARTITION BY c."Unique_PSM"
                               ORDER BY s.psm_count DESC, c.protein_order ASC
                           ) AS protein_rank
                    FROM candidates c
                    JOIN protein_support s USING (protein)
                ),
                best_protein AS (
                    SELECT "Unique_PSM", protein
                    FROM ranked
                    WHERE protein_rank = 1
                )
                SELECT r.* EXCLUDE ("Master_Protein_Accessions"),
                       COALESCE(
                           b.protein, r."Master_Protein_Accessions"
                       ) AS "Master_Protein_Accessions"
                FROM read_parquet('{input_path_fwd}') r
                LEFT JOIN best_protein b USING ("Unique_PSM")
            ) TO '{output_path_fwd}'
            (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)
        """

        con = duckdb.connect()
        try:
            con.execute(sql)
        finally:
            con.close()

        if not output_path.exists():
            raise RuntimeError(
                f"DuckDB shared-peptide resolution failed: {output_path} not created"
            )

        logger.info("Shared-peptide resolution complete")
        return True

    def resolve_shared_peptides_duckdb(
        self, input_path: Path, output_path: Path
    ) -> bool:
        """Compatibility alias for :meth:`step2_resolve_shared_peptides_duckdb`."""
        return self.step2_resolve_shared_peptides_duckdb(input_path, output_path)

    def step3_remove_razor_duckdb(self, input_path: Path, output_path: Path) -> bool:
        """Deprecated alias for :meth:`step2_resolve_shared_peptides_duckdb`."""
        return self.step2_resolve_shared_peptides_duckdb(input_path, output_path)

    def step3_filter_by_criteria_duckdb(
        self, input_path: Path, output_path: Path
    ) -> None:
        """Apply explicit per-condition coverage and protein eligibility filters.

        Expected replicate counts come from experiment design metadata supplied
        in ``ProcessingConfig``. Falling back to observed counts is retained only
        for compatibility with direct callers that do not have design metadata.
        """
        threshold = self.config.max_missing_fraction_per_condition
        min_psms = self.config.min_psms_per_protein
        logger.info(
            "Filtering PSMs (max missing fraction=%.2f, min PSMs/protein=%d)",
            threshold,
            min_psms,
        )

        input_path_fwd = str(input_path).replace(chr(92), "/")
        output_path_fwd = str(output_path).replace(chr(92), "/")

        expected_reps = self.config.expected_replicates_by_condition
        if expected_reps:
            design_rows = ", ".join(
                f"('{_sqlesc(condition)}', {int(count)})"
                for condition, count in expected_reps.items()
            )
            condition_cte = f"""design_reps("Condition", total_reps) AS (
                    VALUES {design_rows}
                )"""
        else:
            logger.warning(
                "Expected replicate design not provided; falling back to observed counts"
            )
            condition_cte = f"""design_reps AS (
                    SELECT "Condition", COUNT(DISTINCT "Replicate") AS total_reps
                    FROM read_parquet('{input_path_fwd}')
                    GROUP BY "Condition"
                )"""

        sql = f"""
            COPY (
                WITH {condition_cte},
                psm_detected AS (
                    SELECT "Unique_PSM", "Condition",
                           COUNT(DISTINCT "Replicate") AS detected_reps
                    FROM read_parquet('{input_path_fwd}')
                    WHERE "Abundance" IS NOT NULL
                    GROUP BY "Unique_PSM", "Condition"
                ),
                all_psm_conditions AS (
                    SELECT p."Unique_PSM", d."Condition", d.total_reps,
                           COALESCE(x.detected_reps, 0) AS detected_reps
                    FROM (
                        SELECT DISTINCT "Unique_PSM"
                        FROM read_parquet('{input_path_fwd}')
                    ) p
                    CROSS JOIN design_reps d
                    LEFT JOIN psm_detected x
                        ON p."Unique_PSM" = x."Unique_PSM"
                       AND d."Condition" = x."Condition"
                ),
                psm_pass AS (
                    SELECT "Unique_PSM"
                    FROM all_psm_conditions
                    GROUP BY "Unique_PSM"
                    HAVING BOOL_AND(
                        (total_reps - detected_reps)
                        <= CAST(FLOOR(total_reps * {threshold}) AS INTEGER)
                    )
                ),
                passing_proteins AS (
                    SELECT "Master_Protein_Accessions"
                    FROM read_parquet('{input_path_fwd}')
                    WHERE "Unique_PSM" IN (SELECT "Unique_PSM" FROM psm_pass)
                    GROUP BY "Master_Protein_Accessions"
                    HAVING COUNT(DISTINCT "Unique_PSM") >= {min_psms}
                )
                SELECT p.*
                FROM read_parquet('{input_path_fwd}') p
                WHERE p."Unique_PSM" IN (SELECT "Unique_PSM" FROM psm_pass)
                  AND p."Master_Protein_Accessions" IN (
                      SELECT "Master_Protein_Accessions" FROM passing_proteins
                  )
            ) TO '{output_path_fwd}'
            (FORMAT PARQUET, COMPRESSION UNCOMPRESSED, ROW_GROUP_SIZE 100000)
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
                f"DuckDB criteria filter failed: {output_path} not created"
            )

        logger.info(
            "Criteria filtering complete: %d -> %d rows (%.0f%% kept)",
            input_count,
            output_count,
            100.0 * output_count / input_count if input_count else 0,
        )

    def step5_filter_by_criteria_duckdb(
        self, input_path: Path, output_path: Path
    ) -> None:
        """Deprecated alias for :meth:`step3_filter_by_criteria_duckdb`."""
        self.step3_filter_by_criteria_duckdb(input_path, output_path)

    def step1_2_duckdb_dia(
        self,
        file_paths: list[Path],
        metadata_columns: dict[str, dict],
        output_path: Path,
    ) -> None:
        """Prepare DIA PSMs with a streaming DuckDB CSV-to-Parquet query.

        Reads and joins metadata, generates Unique_PSM, and applies shared
        input-quality filters in one pass.

        Args:
            file_paths: List of DIA file paths
            metadata_columns: Per-file metadata keyed by filename
            output_path: Path for output Parquet file
        """
        logger.info(
            "Preparing DIA PSMs (DuckDB): Streaming %d files -> %s",
            len(file_paths),
            output_path,
        )

        # Detect delimiter and get column names from first file
        delimiter = _detect_delimiter(file_paths[0])
        delim_sql = "'\\t'" if delimiter == "\t" else "','"
        first_cols = _read_columns(file_paths[0], delimiter)

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
            "(Contaminant IS NULL OR UPPER(TRIM(Contaminant)) NOT IN ('TRUE', '+'))",
            '("Master Protein Accessions" IS NOT NULL '
            "AND TRIM(\"Master Protein Accessions\") != '')",
            f"{abund_expr_typed} >= 1",
        ]
        if "Reverse" in first_cols:
            filter_parts.append(
                "(Reverse IS NULL OR UPPER(TRIM(Reverse)) NOT IN ('TRUE', '+'))"
            )
        if has_quan_info:
            filter_parts.append(
                '("Quan Info" IS NULL OR UPPER(TRIM("Quan Info")) != \'NO VALUE\')'
            )
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
                ) TO '{str(output_path).replace(chr(92), "/")}'
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
                   FROM read_parquet('{str(output_path).replace(chr(92), "/")}')"""
            ).fetchone()[0]
        finally:
            con.close()
        logger.info(
            "DIA PSM preparation complete: %d rows, %d conditions",
            num_rows,
            num_conditions,
        )

    def step1_2_duckdb_tmt(
        self,
        file_paths: list[Path],
        tmt_channel_mapping: dict[str, dict],
        output_path: Path,
    ) -> None:
        """Prepare TMT PSMs with streaming DuckDB QC and UNPIVOT.

        Filters raw PSM quality before reporter-channel expansion, then maps
        channels, generates Unique_PSM, and filters channel abundance.

        TMT files are wide-format with 16+ Abundance <N> columns.
        DuckDB UNPIVOT melts them into long format, then joins with
        channel mapping for condition/replicate assignment.

        Args:
            file_paths: List of TMT file paths (tab-delimited .txt)
            tmt_channel_mapping: Channel -> {group: value, ..., replicate: N}
            output_path: Path for output Parquet file
        """
        logger.info(
            "Preparing TMT PSMs (DuckDB): Streaming %d file(s) -> %s",
            len(file_paths),
            output_path,
        )

        # Validate channel mapping is non-empty BEFORE reading files
        if not tmt_channel_mapping:
            raise ValueError("tmt_channel_mapping is required for TMT input")

        # Detect delimiter and column names from first file
        delimiter = _detect_delimiter(file_paths[0])
        delim_sql = "'\\t'" if delimiter == "\t" else "','"
        first_cols = _read_columns(file_paths[0], delimiter)

        required_quality_cols = {
            "Average Reporter SN",
            "Normalized CHIMERYS Coefficient",
        }
        for file_path in file_paths:
            file_cols = set(_read_columns(file_path))
            missing_quality = sorted(required_quality_cols - file_cols)
            if missing_quality:
                raise ValueError(
                    f"Missing required TMT quality columns in {file_path.name}: "
                    f"{missing_quality}"
                )

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
            raise ValueError("No condition group columns found in tmt_channel_mapping")

        # Build channel mapping VALUES clause
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
        meta_cols_clause = ", ".join(_sql_identifier(col) for col in meta_cols)

        # Build non-abundance column SELECT list (rename spaces -> underscores)
        non_abundance_cols = [col for col in first_cols if col not in abundance_cols]
        select_parts = []
        for col in non_abundance_cols:
            qcol = f'"{col}"'
            new_name = col.replace(" ", "_")
            if new_name != col:
                select_parts.append(f'{qcol} AS "{new_name}"')
            else:
                select_parts.append(qcol)

        orig_cols_sql = ",\n            ".join(select_parts)

        # PSM-level filters run before UNPIVOT so failed PSMs never expand into
        # one row per reporter channel. Abundance remains a channel-level filter.
        has_quan_info = "Quan Info" in first_cols
        psm_filter_parts = [
            "(Contaminant IS NULL OR UPPER(TRIM(Contaminant)) NOT IN ('TRUE', '+'))",
            '("Master Protein Accessions" IS NOT NULL '
            "AND TRIM(\"Master Protein Accessions\") != '')",
            'TRY_CAST("Average Reporter SN" AS DOUBLE) >= 5',
            'TRY_CAST("Normalized CHIMERYS Coefficient" AS DOUBLE) >= 0.8',
        ]
        if "Reverse" in first_cols:
            psm_filter_parts.append(
                "(Reverse IS NULL OR UPPER(TRIM(Reverse)) NOT IN ('TRUE', '+'))"
            )
        if has_quan_info:
            psm_filter_parts.append(
                '("Quan Info" IS NULL OR UPPER(TRIM("Quan Info")) != \'NO VALUE\')'
            )
        psm_where_clause = " AND ".join(psm_filter_parts)

        # Build condition expression (group cols joined with _)
        condition_expr = " || '_' || ".join(
            f"m.{_sql_identifier(col)}" for col in group_cols
        )
        # Build group column SELECT suffix
        group_select_sql = ",\n            ".join(
            f"m.{_sql_identifier(col)} AS {_sql_identifier(col)}" for col in group_cols
        )

        # Build file list for read_csv
        file_list_sql = ", ".join(
            f"'{str(p).replace(chr(92), '/')}'" for p in file_paths
        )

        # Build the SQL
        # Use raw-string variables for regex patterns to avoid Python
        # f-string backslash escaping issues. DuckDB's regex engine (RE2)
        # needs single backslashes: \s \d \w etc.
        abundance_regex = r"Abundance\s+\d+[NC]?"
        channel_strip_regex = r"^Abundance\s+"
        sql = f"""
            COPY (
                WITH raw AS (
                    SELECT *
                    FROM read_csv([{file_list_sql}],
                        delim={delim_sql}, auto_detect=true,
                        all_varchar=true, header=true)
                ),
                filtered_raw AS (
                    SELECT *
                    FROM raw
                    WHERE {psm_where_clause}
                ),
                unpivoted AS (
                    UNPIVOT filtered_raw
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
                    TRY_CAST(Abundance AS DOUBLE) >= 1
            ) TO '{str(output_path).replace(chr(92), "/")}'
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
        if num_rows == 0:
            raise ValueError("No TMT PSM rows matched the configured reporter channels")

        con = duckdb.connect()
        try:
            num_conditions = con.execute(
                f"""SELECT COUNT(DISTINCT "Condition")
                   FROM read_parquet('{str(output_path).replace(chr(92), "/")}')"""
            ).fetchone()[0]
        finally:
            con.close()
        logger.info(
            "TMT PSM preparation complete: %d rows, %d conditions",
            num_rows,
            num_conditions,
        )
