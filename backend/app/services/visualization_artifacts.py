"""
Materialize the versioned, pipeline-owned visualization data contract.

This module converts raw pipeline output files (TSV/CSV) into a set of
normalized Parquet artifacts that serve the visualization API.

Produced Artifact Files (all written to results_dir/):
    protein_abundance_long.parquet
        Columns: protein_accession, gene_name, sample_id, condition, replicate,
                 batch, processed_log2_abundance, provenance, observed_feature_count,
                 imputed_feature_count, imputation_fraction, pipeline, result_layer,
                 sample_order, condition_order
        Description: Long-format log2 abundances for every (protein, sample) pair.
                     Provenance distinguishes observed, imputed, model_estimated, missing.
                     result_layer tags the pipeline layer (protein|ptm|adjusted_ptm).

    peptide_abundance_long.parquet
        Columns: protein_accession, gene_name, peptide_id, sample_id, condition,
                 replicate, batch, processed_log2_abundance, provenance, pipeline,
                 result_layer, sample_order, condition_order
        Description: Long-format log2 abundances for every (peptide, sample) pair.
                     Used for PSM-level QC (CV, intensity distributions, completeness).

    sample_catalog.parquet
        Columns: sample_id, condition, replicate, batch, sample_order, condition_order
        Description: Indexed sample list with condition assignments derived from
                     the analysis config.

    comparison_catalog.parquet
        Columns: comparison_id, display_label, group1_json, group2_json,
                 group1_label, group2_label, comparison_order, tested_count,
                 significant_count, result_status, group1_sample_count,
                 group2_sample_count
        Description: All pairwise comparisons with DE status and sample counts.

    differential_results.parquet
        Columns: comparison_id, protein_accession, gene_name, log2_fold_change,
                 p_value, adjusted_p_value, standard_error, statistic, psm_count,
                 result_layer, pipeline
        Description: Differential expression test results. Non-finite float values
                     (inf, -inf, NaN) are replaced with NULL for JSON compliance.

    qc_sample_metrics.parquet
        Columns: sample_id, condition, replicate, batch, sample_order,
                 total_feature_count, present_count, missing_count,
                 observed_feature_count, imputed_feature_count, imputation_fraction,
                 median_log2_abundance, abundance_q1, abundance_q3,
                 abundance_min, abundance_max
        Description: Per-sample QC metrics derived from protein abundance data.

    qc_group_metrics.parquet
        Columns: group_by, group_value, sample_count, observation_count, q1, median,
                 q3, observed_count, imputed_count, missing_count, protein_cv_count,
                 protein_cv_q1, protein_cv_median, protein_cv_q3, peptide_cv_count,
                 peptide_cv_q1, peptide_cv_median, peptide_cv_q3, lowerfence, upperfence
        Description: Group-level (condition or batch) abundance summaries with
                     protein/peptide CV distribution statistics and clamped IQR fences.

    qc_comparison_metrics.parquet
        Columns: comparison_id, tested_count, significant_count, result_status
        Description: Lightweight per-comparison DE summary for the overview endpoint.

    qc_pca.parquet
        Columns: sample_id, pc1, pc2, condition
        Description: PCA coordinates extracted from QC_Results.json (legacy MSstats)
                     or computed by the pipeline.

    qc_psm_completeness.parquet
        Columns: sample_id, condition, result_layer, psm_total_count,
                 psm_present_count, psm_missing_count
        Description: Per-sample PSM detection completeness by result_layer.

    qc_psm_intensity.parquet
        Columns: result_layer, condition, replicate, sample_count, q1, median, q3
        Description: Per-(condition, replicate, result_layer) PSM intensity
                     boxplot statistics.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd

from app.models.analysis import AnalysisConfig
from app.services.data_processor import _sql_identifier

VISUALIZATION_SCHEMA_VERSION = 1
VISUALIZATION_MANIFEST = "visualization_artifacts.json"

PROTEIN_ARTIFACT = "protein_abundance_long.parquet"
PEPTIDE_ARTIFACT = "peptide_abundance_long.parquet"
SAMPLE_CATALOG = "sample_catalog.parquet"
COMPARISON_CATALOG = "comparison_catalog.parquet"
DIFFERENTIAL_ARTIFACT = "differential_results.parquet"
QC_SAMPLE_METRICS = "qc_sample_metrics.parquet"
QC_GROUP_METRICS = "qc_group_metrics.parquet"
QC_COMPARISON_METRICS = "qc_comparison_metrics.parquet"
QC_PCA = "qc_pca.parquet"
QC_PSM_COMPLETENESS = "qc_psm_completeness.parquet"
QC_PSM_INTENSITY = "qc_psm_intensity.parquet"


def _sql_literal(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _replace_file_with_retry(source: Path, destination: Path) -> None:
    """Tolerate short-lived Windows scanner locks on new artifacts."""
    for attempt in range(5):
        try:
            os.replace(source, destination)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.05 * (attempt + 1))


def _comparison_label(group: dict[str, str]) -> str:
    return "+".join(str(value) for value in group.values())


def _comparison_rows(config: AnalysisConfig) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, comparison in enumerate(config.comparisons):
        group1 = comparison.get("group1", {})
        group2 = comparison.get("group2", {})
        group1_label = _comparison_label(group1)
        group2_label = _comparison_label(group2)
        rows.append(
            {
                "comparison_id": f"{group1_label}_vs_{group2_label}",
                "display_label": f"{group1_label} vs {group2_label}",
                "group1_json": json.dumps(group1, separators=(",", ":")),
                "group2_json": json.dumps(group2, separators=(",", ":")),
                "group1_label": group1_label,
                "group2_label": group2_label,
                "comparison_order": index,
            }
        )
    return rows


def _condition_definitions(config: AnalysisConfig) -> list[tuple[str, str]]:
    definitions: list[tuple[str, str]] = []
    seen: set[str] = set()
    for comparison in config.comparisons:
        for group_name in ("group1", "group2"):
            group = comparison.get(group_name, {})
            label = _comparison_label(group)
            if not label or label in seen:
                continue
            seen.add(label)
            definitions.append(
                (label, "_".join(str(value) for value in group.values()))
            )
    return definitions


def _sample_metadata(
    sample_id: str,
    config: AnalysisConfig,
    condition_definitions: list[tuple[str, str]],
) -> tuple[str, str | None, str | None]:
    matches = [
        (label, prefix)
        for label, prefix in condition_definitions
        if sample_id == prefix or sample_id.startswith(f"{prefix}_")
    ]
    if matches:
        condition, prefix = max(matches, key=lambda item: len(item[1]))
        suffix = sample_id[len(prefix) :].lstrip("_")
        replicate = suffix or None
    else:
        parts = sample_id.rsplit("_", 1)
        condition = parts[0] if len(parts) == 2 and parts[1].isdigit() else sample_id
        replicate = parts[1] if len(parts) == 2 and parts[1].isdigit() else None

    batch = None
    metadata = config.metadata or {}
    for values in metadata.values():
        candidate_values = {
            str(value)
            for key, value in values.items()
            if key not in {"experiment", "replicate", "batch"}
        }
        condition_tokens = set(condition.replace("+", "_").split("_"))
        candidate_replicate = str(values.get("replicate", ""))
        if candidate_values and not candidate_values.issubset(condition_tokens):
            continue
        if replicate and candidate_replicate and candidate_replicate != replicate:
            continue
        batch_value = values.get("batch")
        batch = str(batch_value) if batch_value not in (None, "") else None
        break
    return condition, replicate, batch


def _protein_source_columns(path: Path) -> tuple[str, str | None, list[str]]:
    columns = pd.read_csv(path, sep="\t", nrows=0).columns.tolist()
    accession = next(
        (
            column
            for column in (
                "Master_Protein_Accessions",
                "Master Protein Accessions",
                "Protein",
            )
            if column in columns
        ),
        None,
    )
    if accession is None:
        raise ValueError(f"{path.name} has no protein accession column")
    gene = next(
        (column for column in ("Gene_Name", "Gene Name", "Gene") if column in columns),
        None,
    )
    metadata = {
        accession,
        "PSM_Count",
        "psm_count",
        "PSM Count",
    }
    if gene:
        metadata.add(gene)
    samples = [column for column in columns if column not in metadata]
    return accession, gene, samples


def _write_empty_parquet(
    connection: duckdb.DuckDBPyConnection, path: Path, sql: str
) -> None:
    connection.execute(
        f"COPY ({sql} LIMIT 0) TO {_sql_literal(path)} "
        "(FORMAT PARQUET, COMPRESSION ZSTD)"
    )


def _materialize_samples_and_proteins(
    connection: duckdb.DuckDBPyConnection,
    results_dir: Path,
    config: AnalysisConfig,
    pipeline: str,
) -> pd.DataFrame:
    source = results_dir / "Protein_Abundances.tsv"
    condition_definitions = _condition_definitions(config)
    if source.exists():
        accession, gene, samples = _protein_source_columns(source)
        sample_rows = []
        condition_order: dict[str, int] = {
            label: index for index, (label, _prefix) in enumerate(condition_definitions)
        }
        for sample_order, sample_id in enumerate(samples):
            condition, replicate, batch = _sample_metadata(
                sample_id, config, condition_definitions
            )
            if condition not in condition_order:
                condition_order[condition] = len(condition_order)
            sample_rows.append(
                {
                    "sample_id": sample_id,
                    "condition": condition,
                    "replicate": replicate,
                    "batch": batch,
                    "sample_order": sample_order,
                    "condition_order": condition_order[condition],
                }
            )
        sample_frame = pd.DataFrame(sample_rows)
        connection.register("sample_catalog_source", sample_frame)
        connection.execute(
            f"COPY (SELECT * FROM sample_catalog_source ORDER BY sample_order) "
            f"TO {_sql_literal(results_dir / SAMPLE_CATALOG)} "
            "(FORMAT PARQUET, COMPRESSION ZSTD)"
        )

        sample_identifiers = ", ".join(_sql_identifier(column) for column in samples)
        gene_sql = (
            f"CAST({_sql_identifier(gene)} AS VARCHAR)"
            if gene
            else "CAST(NULL AS VARCHAR)"
        )
        source_sql = (
            "read_csv_auto("
            f"{_sql_literal(source)}, delim='\\t', header=true, nullstr=['NA', 'NaN'])"
        )
        connection.execute(
            f"""
            COPY (
                SELECT
                    CAST(unpivoted.{_sql_identifier(accession)} AS VARCHAR) AS protein_accession,
                    {gene_sql.replace(_sql_identifier(gene), f'unpivoted.{_sql_identifier(gene)}') if gene else gene_sql} AS gene_name,
                    catalog.sample_id,
                    catalog.condition,
                    catalog.replicate,
                    catalog.batch,
                    CAST(unpivoted.processed_log2_abundance AS DOUBLE) AS processed_log2_abundance,
                    CASE
                        WHEN unpivoted.processed_log2_abundance IS NULL THEN 'missing'
                        ELSE 'model_estimated'
                    END AS provenance,
                    CAST(0 AS BIGINT) AS observed_feature_count,
                    CAST(0 AS BIGINT) AS imputed_feature_count,
                    CAST(NULL AS DOUBLE) AS imputation_fraction,
                    {_sql_literal(pipeline)} AS pipeline,
                    'protein' AS result_layer,
                    catalog.sample_order,
                    catalog.condition_order
                FROM (
                    SELECT * FROM {source_sql}
                    UNPIVOT INCLUDE NULLS (
                        processed_log2_abundance FOR sample_id IN ({sample_identifiers})
                    )
                ) AS unpivoted
                JOIN sample_catalog_source AS catalog
                  ON catalog.sample_id = unpivoted.sample_id
                ORDER BY protein_accession, catalog.sample_order
            ) TO {_sql_literal(results_dir / PROTEIN_ARTIFACT)}
            (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )
        connection.unregister("sample_catalog_source")
        return sample_frame

    summarized_sources = [
        (results_dir / "protein_summarized.tsv", "protein"),
        (results_dir / "ptm_site_summarized.tsv", "ptm"),
    ]
    frames: list[pd.DataFrame] = []
    for summarized, result_layer in summarized_sources:
        if not summarized.exists():
            continue
        frame = pd.read_csv(summarized, sep="\t")
        if not {"Protein", "BioReplicate", "Abundance"}.issubset(frame.columns):
            continue
        frame = frame.rename(
            columns={
                "Protein": "protein_accession",
                "BioReplicate": "sample_id",
                "Condition": "condition",
                "Abundance": "processed_log2_abundance",
            }
        )
        frame["gene_name"] = None
        frame["replicate"] = frame["sample_id"].astype(str).str.rsplit("_", n=1).str[-1]
        frame["batch"] = None
        frame["provenance"] = "model_estimated"
        frame["observed_feature_count"] = 0
        frame["imputed_feature_count"] = 0
        frame["imputation_fraction"] = None
        frame["pipeline"] = pipeline
        frame["result_layer"] = result_layer
        frames.append(frame)
    if not frames:
        raise ValueError("No processed protein abundance source was produced")

    proteins = pd.concat(frames, ignore_index=True)
    metadata_path = results_dir / "ptm_site_metadata.tsv"
    if metadata_path.exists():
        metadata = pd.read_csv(
            metadata_path,
            sep="\t",
            usecols=lambda column: column in {"ProteinAccession", "Gene"},
        )
        if {"ProteinAccession", "Gene"}.issubset(metadata.columns):
            gene_names = (
                metadata.dropna(subset=["ProteinAccession"])
                .drop_duplicates("ProteinAccession")
                .set_index("ProteinAccession")["Gene"]
                .to_dict()
            )
            proteins["gene_name"] = proteins["protein_accession"].map(gene_names)
    sample_frame = proteins[
        ["sample_id", "condition", "replicate", "batch"]
    ].drop_duplicates()
    sample_frame["sample_order"] = range(len(sample_frame))
    condition_order = {
        condition: index
        for index, condition in enumerate(sample_frame["condition"].drop_duplicates())
    }
    sample_frame["condition_order"] = sample_frame["condition"].map(condition_order)
    proteins = proteins.merge(
        sample_frame[["sample_id", "sample_order", "condition_order"]],
        on="sample_id",
        how="left",
    )
    protein_columns = [
        "protein_accession",
        "gene_name",
        "sample_id",
        "condition",
        "replicate",
        "batch",
        "processed_log2_abundance",
        "provenance",
        "observed_feature_count",
        "imputed_feature_count",
        "imputation_fraction",
        "pipeline",
        "result_layer",
        "sample_order",
        "condition_order",
    ]
    proteins[protein_columns].to_parquet(results_dir / PROTEIN_ARTIFACT, index=False)
    sample_frame.to_parquet(results_dir / SAMPLE_CATALOG, index=False)
    return sample_frame


def _materialize_peptides(
    connection: duckdb.DuckDBPyConnection,
    results_dir: Path,
    sample_frame: pd.DataFrame,
    pipeline: str,
) -> None:
    source = results_dir / "peptide_processed_long.tsv"
    if source.exists():
        connection.register("sample_catalog_source", sample_frame)
        connection.execute(
            f"""
            COPY (
                SELECT
                    CAST(source.ProteinAccession AS VARCHAR) AS protein_accession,
                    CAST(source.GeneName AS VARCHAR) AS gene_name,
                    CAST(source.PeptideId AS VARCHAR) AS peptide_id,
                    CAST(source.SampleId AS VARCHAR) AS sample_id,
                    catalog.condition AS condition,
                    COALESCE(CAST(source.Replicate AS VARCHAR), catalog.replicate) AS replicate,
                    catalog.batch,
                    CAST(source.ProcessedLog2Abundance AS DOUBLE) AS processed_log2_abundance,
                    CAST(source.Provenance AS VARCHAR) AS provenance,
                    {_sql_literal(pipeline)} AS pipeline,
                    COALESCE(CAST(source.ResultLayer AS VARCHAR), 'protein') AS result_layer,
                    catalog.sample_order,
                    catalog.condition_order
                FROM read_csv_auto(
                    {_sql_literal(source)}, delim='\\t', header=true,
                    nullstr=['NA', 'NaN']
                ) AS source
                LEFT JOIN sample_catalog_source AS catalog
                  ON catalog.sample_id = CAST(source.SampleId AS VARCHAR)
                ORDER BY protein_accession, peptide_id, catalog.sample_order
            ) TO {_sql_literal(results_dir / PEPTIDE_ARTIFACT)}
            (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )
        connection.unregister("sample_catalog_source")
        return

    ptm_sources = [
        (results_dir / "protein_feature_level.tsv", "protein"),
        (results_dir / "ptm_feature_level.tsv", "ptm"),
    ]
    frames: list[pd.DataFrame] = []
    for feature_path, result_layer in ptm_sources:
        if not feature_path.exists():
            continue
        frame = pd.read_csv(feature_path, sep="\t")
        required = {
            "ProteinName",
            "PeptideSequence",
            "BioReplicate",
            "Condition",
            "log2Intensity",
        }
        if not required.issubset(frame.columns):
            continue
        predicted = frame.get("predicted", pd.Series(index=frame.index, dtype=object))
        censored = frame.get("censored", False)
        is_imputed = predicted.notna() | pd.Series(censored, index=frame.index).fillna(
            False
        ).astype(bool)
        processed = pd.to_numeric(frame["log2Intensity"], errors="coerce")
        processed = processed.where(
            predicted.isna(), pd.to_numeric(predicted, errors="coerce")
        )
        frames.append(
            pd.DataFrame(
                {
                    "protein_accession": frame["ProteinName"].astype(str),
                    "gene_name": None,
                    "peptide_id": frame["PeptideSequence"]
                    .astype(str)
                    .str.split("|", n=1)
                    .str[-1],
                    "sample_id": frame["BioReplicate"].astype(str),
                    "condition": frame["Condition"].astype(str),
                    "replicate": frame["BioReplicate"]
                    .astype(str)
                    .str.rsplit("_", n=1)
                    .str[-1],
                    "batch": None,
                    "processed_log2_abundance": processed,
                    "provenance": is_imputed.map({True: "imputed", False: "observed"}),
                    "pipeline": pipeline,
                    "result_layer": result_layer,
                }
            )
        )
    peptide_columns = [
        "protein_accession",
        "gene_name",
        "peptide_id",
        "sample_id",
        "condition",
        "replicate",
        "batch",
        "processed_log2_abundance",
        "provenance",
        "pipeline",
        "result_layer",
        "sample_order",
        "condition_order",
    ]
    if frames:
        peptides = pd.concat(frames, ignore_index=True)
        peptides = peptides.merge(
            sample_frame[["sample_id", "sample_order", "condition_order"]],
            on="sample_id",
            how="left",
        )
        peptides[peptide_columns].to_parquet(
            results_dir / PEPTIDE_ARTIFACT, index=False
        )
    else:
        empty = pd.DataFrame(
            {
                "protein_accession": pd.Series(dtype="string"),
                "gene_name": pd.Series(dtype="string"),
                "peptide_id": pd.Series(dtype="string"),
                "sample_id": pd.Series(dtype="string"),
                "condition": pd.Series(dtype="string"),
                "replicate": pd.Series(dtype="string"),
                "batch": pd.Series(dtype="string"),
                "processed_log2_abundance": pd.Series(dtype="float64"),
                "provenance": pd.Series(dtype="string"),
                "pipeline": pd.Series(dtype="string"),
                "result_layer": pd.Series(dtype="string"),
                "sample_order": pd.Series(dtype="int64"),
                "condition_order": pd.Series(dtype="int64"),
            }
        )
        empty.to_parquet(results_dir / PEPTIDE_ARTIFACT, index=False)


def _annotate_protein_feature_provenance(
    connection: duckdb.DuckDBPyConnection,
    results_dir: Path,
) -> None:
    """Attach feature evidence counts without calling a protein value imputed."""
    protein_path = results_dir / PROTEIN_ARTIFACT
    peptide_path = results_dir / PEPTIDE_ARTIFACT
    temporary = results_dir / f".{PROTEIN_ARTIFACT}.{uuid.uuid4().hex}.tmp"
    try:
        connection.execute(
            f"""
            COPY (
                WITH feature_counts AS (
                    SELECT
                        protein_accession,
                        sample_id,
                        result_layer,
                        count(*) FILTER (WHERE provenance = 'observed') AS observed_count,
                        count(*) FILTER (WHERE provenance = 'imputed') AS imputed_count
                    FROM read_parquet({_sql_literal(peptide_path)})
                    GROUP BY protein_accession, sample_id, result_layer
                )
                SELECT
                    protein.protein_accession,
                    protein.gene_name,
                    protein.sample_id,
                    protein.condition,
                    protein.replicate,
                    protein.batch,
                    protein.processed_log2_abundance,
                    protein.provenance,
                    COALESCE(feature_counts.observed_count, 0) AS observed_feature_count,
                    COALESCE(feature_counts.imputed_count, 0) AS imputed_feature_count,
                    CASE
                        WHEN COALESCE(feature_counts.observed_count, 0) +
                             COALESCE(feature_counts.imputed_count, 0) > 0
                        THEN COALESCE(feature_counts.imputed_count, 0)::DOUBLE /
                             (COALESCE(feature_counts.observed_count, 0) +
                              COALESCE(feature_counts.imputed_count, 0))
                        ELSE NULL
                    END AS imputation_fraction,
                    protein.pipeline,
                    protein.result_layer,
                    protein.sample_order,
                    protein.condition_order
                FROM read_parquet({_sql_literal(protein_path)}) AS protein
                LEFT JOIN feature_counts
                  ON feature_counts.protein_accession = protein.protein_accession
                 AND feature_counts.sample_id = protein.sample_id
                 AND feature_counts.result_layer = protein.result_layer
                ORDER BY protein.protein_accession, protein.sample_order
            ) TO {_sql_literal(temporary)}
            (FORMAT PARQUET, COMPRESSION ZSTD)
            """
        )
        _replace_file_with_retry(temporary, protein_path)
    finally:
        temporary.unlink(missing_ok=True)


def _de_columns(path: Path) -> dict[str, str | None]:
    columns = pd.read_csv(path, sep="\t", nrows=0).columns.tolist()

    def first(*names: str) -> str | None:
        return next((name for name in names if name in columns), None)

    return {
        "protein": first("Master_Protein_Accessions", "ProteinAccession", "Protein"),
        "gene": first("Gene_Name", "GeneName", "Gene"),
        "logfc": first("logFC", "log2FC"),
        "pvalue": first("pval", "pvalue"),
        "adjusted": first("adjPval", "adj.pvalue", "adj_pvalue"),
        "se": first("se", "SE"),
        "statistic": first("t", "statistic", "Tvalue"),
        "comparison": first("Comparison", "Label"),
        "psm_count": first("PSM_Count", "psm_count", "PSM Count"),
    }


def _column_sql(column: str | None, cast: str) -> str:
    if column is None:
        return f"CAST(NULL AS {cast})"
    return f"TRY_CAST({_sql_identifier(column)} AS {cast})"


def _finite_double_sql(column: str | None) -> str:
    """Cast a column to DOUBLE, replacing non-finite values with NULL.

    MSstats groupComparison can produce inf/-inf/NaN in log2FC and p-value
    columns for proteins with complete group separation (all values censored
    in one condition).  These are not JSON-compliant and must be sanitised
    before reaching the API response layer.
    """
    if column is None:
        return "CAST(NULL AS DOUBLE)"
    col = _sql_identifier(column)
    return (
        f"CASE WHEN isfinite(TRY_CAST({col} AS DOUBLE)) "
        f"THEN TRY_CAST({col} AS DOUBLE) ELSE NULL END"
    )


def _materialize_differential_results(
    connection: duckdb.DuckDBPyConnection,
    results_dir: Path,
    config: AnalysisConfig,
    pipeline: str,
    comparison_rows: list[dict[str, Any]],
) -> None:
    connection.execute(
        """
        CREATE TEMP TABLE differential_results (
            comparison_id VARCHAR,
            protein_accession VARCHAR,
            gene_name VARCHAR,
            log2_fold_change DOUBLE,
            p_value DOUBLE,
            adjusted_p_value DOUBLE,
            standard_error DOUBLE,
            statistic DOUBLE,
            psm_count BIGINT,
            result_layer VARCHAR,
            pipeline VARCHAR
        )
        """
    )
    sources: list[tuple[Path, str, str | None]] = []
    for path in sorted(results_dir.glob("Differential_Results_*.tsv")):
        sources.append((path, "protein", None))
    for filename, layer in (
        ("protein_results.tsv", "protein"),
        ("ptm_site_results.tsv", "ptm"),
        ("adjusted_ptm_results.tsv", "adjusted_ptm"),
    ):
        path = results_dir / filename
        if path.exists():
            sources.append((path, layer, None))

    for path, result_layer, fixed_comparison in sources:
        columns = _de_columns(path)
        if not columns["protein"] or not columns["logfc"]:
            continue
        comparison_sql = (
            _column_sql(columns["comparison"], "VARCHAR")
            if columns["comparison"]
            else _sql_literal(fixed_comparison or "comparison")
        )
        connection.execute(
            f"""
            INSERT INTO differential_results
            SELECT
                {comparison_sql},
                {_column_sql(columns['protein'], 'VARCHAR')},
                {_column_sql(columns['gene'], 'VARCHAR')},
                {_finite_double_sql(columns['logfc'])},
                {_finite_double_sql(columns['pvalue'])},
                {_finite_double_sql(columns['adjusted'])},
                {_finite_double_sql(columns['se'])},
                {_finite_double_sql(columns['statistic'])},
                {_column_sql(columns['psm_count'], 'BIGINT')},
                {_sql_literal(result_layer)},
                {_sql_literal(pipeline)}
            FROM read_csv_auto(
                {_sql_literal(path)}, delim='\\t', header=true,
                nullstr=['NA', 'NaN']
            )
            """
        )
    psm_path = results_dir / "protein_msstats_input.tsv"
    if psm_path.exists():
        psm_columns = pd.read_csv(psm_path, sep="\t", nrows=0).columns
        if {"ProteinName", "PSM"}.issubset(psm_columns):
            connection.execute(
                f"""
                UPDATE differential_results
                   SET psm_count = counts.psm_count
                  FROM (
                      SELECT ProteinName, count(DISTINCT PSM) AS psm_count
                      FROM read_csv_auto(
                          {_sql_literal(psm_path)}, delim='\t', header=true
                      )
                      GROUP BY ProteinName
                  ) AS counts
                 WHERE differential_results.psm_count IS NULL
                   AND differential_results.protein_accession = counts.ProteinName
                """
            )
    metadata_path = results_dir / "ptm_site_metadata.tsv"
    if metadata_path.exists():
        metadata_columns = pd.read_csv(metadata_path, sep="\t", nrows=0).columns
        if {"ProteinAccession", "Gene"}.issubset(metadata_columns):
            connection.execute(
                f"""
                UPDATE differential_results
                   SET gene_name = annotations.Gene
                  FROM (
                      SELECT ProteinAccession, first(Gene) AS Gene
                      FROM read_csv_auto(
                          {_sql_literal(metadata_path)}, delim='\t', header=true
                      )
                      GROUP BY ProteinAccession
                  ) AS annotations
                 WHERE differential_results.gene_name IS NULL
                   AND differential_results.protein_accession = annotations.ProteinAccession
                """
            )
    connection.execute(
        f"COPY (SELECT * FROM differential_results ORDER BY comparison_id, protein_accession) "
        f"TO {_sql_literal(results_dir / DIFFERENTIAL_ARTIFACT)} "
        "(FORMAT PARQUET, COMPRESSION ZSTD)"
    )

    configured = pd.DataFrame(comparison_rows)
    produced = connection.execute(
        """
        SELECT comparison_id,
               count(*) AS tested_count,
               count(*) FILTER (WHERE adjusted_p_value < ?) AS significant_count
        FROM differential_results
        WHERE result_layer = 'protein'
        GROUP BY comparison_id
        """,
        [config.pvalue_threshold],
    ).fetchdf()
    if configured.empty:
        configured = produced[["comparison_id"]].copy()
        configured["display_label"] = configured["comparison_id"].str.replace(
            "_vs_", " vs ", regex=False
        )
        configured["group1_json"] = "{}"
        configured["group2_json"] = "{}"
        configured["group1_label"] = (
            configured["comparison_id"].str.split("_vs_").str[0]
        )
        configured["group2_label"] = (
            configured["comparison_id"].str.split("_vs_").str[-1]
        )
        configured["comparison_order"] = range(len(configured))
    configured = configured.merge(produced, on="comparison_id", how="left")
    configured["tested_count"] = configured["tested_count"].fillna(0).astype("int64")
    configured["significant_count"] = (
        configured["significant_count"].fillna(0).astype("int64")
    )
    configured["result_status"] = (
        configured["tested_count"].gt(0).map({True: "complete", False: "missing"})
    )
    sample_counts = connection.execute(
        f"SELECT condition, count(*) AS sample_count FROM read_parquet("
        f"{_sql_literal(results_dir / SAMPLE_CATALOG)}) GROUP BY condition"
    ).fetchdf()
    counts = dict(
        zip(sample_counts["condition"], sample_counts["sample_count"], strict=False)
    )
    configured["group1_sample_count"] = (
        configured["group1_label"].map(counts).fillna(0).astype("int64")
    )
    configured["group2_sample_count"] = (
        configured["group2_label"].map(counts).fillna(0).astype("int64")
    )
    configured.to_parquet(results_dir / COMPARISON_CATALOG, index=False)


def _materialize_qc_artifacts(
    connection: duckdb.DuckDBPyConnection,
    results_dir: Path,
) -> None:
    protein = _sql_literal(results_dir / PROTEIN_ARTIFACT)
    connection.execute(
        f"""
        COPY (
            SELECT
                sample_id,
                any_value(condition) AS condition,
                any_value(replicate) AS replicate,
                any_value(batch) AS batch,
                min(sample_order) AS sample_order,
                count(*) AS total_feature_count,
                count(*) FILTER (WHERE processed_log2_abundance IS NOT NULL) AS present_count,
                count(*) FILTER (WHERE processed_log2_abundance IS NULL) AS missing_count,
                sum(observed_feature_count) AS observed_feature_count,
                sum(imputed_feature_count) AS imputed_feature_count,
                CASE WHEN sum(observed_feature_count) + sum(imputed_feature_count) > 0
                     THEN sum(imputed_feature_count)::DOUBLE /
                          (sum(observed_feature_count) + sum(imputed_feature_count))
                     ELSE NULL END AS imputation_fraction,
                median(processed_log2_abundance) AS median_log2_abundance,
                quantile_cont(processed_log2_abundance, 0.25) AS abundance_q1,
                quantile_cont(processed_log2_abundance, 0.75) AS abundance_q3,
                min(processed_log2_abundance) AS abundance_min,
                max(processed_log2_abundance) AS abundance_max
            FROM read_parquet({protein})
            WHERE result_layer = 'protein'
            GROUP BY sample_id
            ORDER BY sample_order
        ) TO {_sql_literal(results_dir / QC_SAMPLE_METRICS)}
        (FORMAT PARQUET, COMPRESSION ZSTD)
        """
    )
    connection.execute(
        f"""
        COPY (
            WITH abundance_groups AS (
                SELECT
                    'condition' AS group_by,
                    CAST(condition AS VARCHAR) AS group_value,
                    count(DISTINCT sample_id) AS sample_count,
                    count(processed_log2_abundance) AS observation_count,
                    quantile_cont(processed_log2_abundance, 0.25) AS q1,
                    median(processed_log2_abundance) AS median,
                    quantile_cont(processed_log2_abundance, 0.75) AS q3,
                    sum(observed_feature_count) AS observed_count,
                    sum(imputed_feature_count) AS imputed_count,
                    count(*) FILTER (WHERE processed_log2_abundance IS NULL) AS missing_count,
                    min(condition_order) AS group_order,
                    min(processed_log2_abundance) AS min_val,
                    max(processed_log2_abundance) AS max_val
                FROM read_parquet({protein})
                WHERE result_layer = 'protein'
                GROUP BY condition
                UNION ALL
                SELECT
                    'batch' AS group_by,
                    CAST(batch AS VARCHAR) AS group_value,
                    count(DISTINCT sample_id) AS sample_count,
                    count(processed_log2_abundance) AS observation_count,
                    quantile_cont(processed_log2_abundance, 0.25) AS q1,
                    median(processed_log2_abundance) AS median,
                    quantile_cont(processed_log2_abundance, 0.75) AS q3,
                    sum(observed_feature_count) AS observed_count,
                    sum(imputed_feature_count) AS imputed_count,
                    count(*) FILTER (WHERE processed_log2_abundance IS NULL) AS missing_count,
                    dense_rank() OVER (ORDER BY batch) AS group_order,
                    min(processed_log2_abundance) AS min_val,
                    max(processed_log2_abundance) AS max_val
                FROM read_parquet({protein})
                WHERE result_layer = 'protein' AND batch IS NOT NULL
                GROUP BY batch
            ),
            protein_cv_values AS (
                SELECT group_by, group_value,
                       sqrt(exp(pow(sd_log2 * ln(2.0), 2)) - 1) * 100 AS cv
                FROM (
                    SELECT 'condition' AS group_by,
                           CAST(condition AS VARCHAR) AS group_value,
                           protein_accession,
                           stddev_samp(processed_log2_abundance) AS sd_log2
                    FROM read_parquet({protein})
                    WHERE result_layer = 'protein'
                      AND processed_log2_abundance IS NOT NULL
                    GROUP BY condition, protein_accession
                    HAVING count(*) >= 2
                    UNION ALL
                    SELECT 'batch' AS group_by,
                           CAST(batch AS VARCHAR) AS group_value,
                           protein_accession,
                           stddev_samp(processed_log2_abundance) AS sd_log2
                    FROM read_parquet({protein})
                    WHERE result_layer = 'protein' AND batch IS NOT NULL
                      AND processed_log2_abundance IS NOT NULL
                    GROUP BY batch, protein_accession
                    HAVING count(*) >= 2
                )
            ),
            protein_cv AS (
                SELECT group_by, group_value,
                       count(*) FILTER (WHERE isfinite(cv)) AS protein_cv_count,
                       quantile_cont(cv, 0.25) FILTER (WHERE isfinite(cv)) AS protein_cv_q1,
                       median(cv) FILTER (WHERE isfinite(cv)) AS protein_cv_median,
                       quantile_cont(cv, 0.75) FILTER (WHERE isfinite(cv)) AS protein_cv_q3
                FROM protein_cv_values
                GROUP BY group_by, group_value
            ),
            peptide_sample AS (
                SELECT protein_accession, peptide_id, sample_id,
                       any_value(condition) AS condition,
                       any_value(batch) AS batch,
                       avg(processed_log2_abundance) AS abundance
                FROM read_parquet({_sql_literal(results_dir / PEPTIDE_ARTIFACT)})
                WHERE result_layer = 'protein'
                  AND processed_log2_abundance IS NOT NULL
                GROUP BY protein_accession, peptide_id, sample_id
            ),
            peptide_cv_values AS (
                SELECT group_by, group_value,
                       sqrt(exp(pow(sd_log2 * ln(2.0), 2)) - 1) * 100 AS cv
                FROM (
                    SELECT 'condition' AS group_by,
                           CAST(condition AS VARCHAR) AS group_value,
                           protein_accession, peptide_id,
                           stddev_samp(abundance) AS sd_log2
                    FROM peptide_sample
                    GROUP BY condition, protein_accession, peptide_id
                    HAVING count(*) >= 2
                    UNION ALL
                    SELECT 'batch' AS group_by,
                           CAST(batch AS VARCHAR) AS group_value,
                           protein_accession, peptide_id,
                           stddev_samp(abundance) AS sd_log2
                    FROM peptide_sample
                    WHERE batch IS NOT NULL
                    GROUP BY batch, protein_accession, peptide_id
                    HAVING count(*) >= 2
                )
            ),
            peptide_cv AS (
                SELECT group_by, group_value,
                       count(*) FILTER (WHERE isfinite(cv)) AS peptide_cv_count,
                       quantile_cont(cv, 0.25) FILTER (WHERE isfinite(cv)) AS peptide_cv_q1,
                       median(cv) FILTER (WHERE isfinite(cv)) AS peptide_cv_median,
                       quantile_cont(cv, 0.75) FILTER (WHERE isfinite(cv)) AS peptide_cv_q3
                FROM peptide_cv_values
                GROUP BY group_by, group_value
            )
            SELECT abundance_groups.*,
                   protein_cv.protein_cv_count,
                   protein_cv.protein_cv_q1,
                   protein_cv.protein_cv_median,
                   protein_cv.protein_cv_q3,
                   peptide_cv.peptide_cv_count,
                   peptide_cv.peptide_cv_q1,
                   peptide_cv.peptide_cv_median,
                   peptide_cv.peptide_cv_q3,
                   GREATEST(
                       abundance_groups.q1 - 1.5 * (abundance_groups.q3 - abundance_groups.q1),
                       abundance_groups.min_val
                   ) AS lowerfence,
                   LEAST(
                       abundance_groups.q3 + 1.5 * (abundance_groups.q3 - abundance_groups.q1),
                       abundance_groups.max_val
                   ) AS upperfence
            FROM abundance_groups
            LEFT JOIN protein_cv USING (group_by, group_value)
            LEFT JOIN peptide_cv USING (group_by, group_value)
            ORDER BY abundance_groups.group_by, abundance_groups.group_order
        ) TO {_sql_literal(results_dir / QC_GROUP_METRICS)}
        (FORMAT PARQUET, COMPRESSION ZSTD)
        """
    )
    connection.execute(
        f"COPY (SELECT comparison_id, tested_count, significant_count, result_status "
        f"FROM read_parquet({_sql_literal(results_dir / COMPARISON_CATALOG)}) "
        f"ORDER BY comparison_order) TO {_sql_literal(results_dir / QC_COMPARISON_METRICS)} "
        "(FORMAT PARQUET, COMPRESSION ZSTD)"
    )

    peptide = _sql_literal(results_dir / PEPTIDE_ARTIFACT)

    # Per-sample PSM completeness — one row per (sample_id, result_layer)
    connection.execute(
        f"""
        COPY (
            WITH per_layer_total AS (
                SELECT result_layer,
                       count(DISTINCT peptide_id) AS total_psm_count
                FROM read_parquet({peptide})
                GROUP BY result_layer
            )
            SELECT
                sample.sample_id,
                sample.condition,
                sample.result_layer,
                totals.total_psm_count AS psm_total_count,
                count(DISTINCT sample.peptide_id)
                    FILTER (WHERE sample.processed_log2_abundance IS NOT NULL)
                    AS psm_present_count,
                totals.total_psm_count
                    - count(DISTINCT sample.peptide_id)
                        FILTER (WHERE sample.processed_log2_abundance IS NOT NULL)
                    AS psm_missing_count
            FROM read_parquet({peptide}) AS sample
            JOIN per_layer_total AS totals USING (result_layer)
            GROUP BY sample.sample_id, sample.condition, sample.result_layer,
                     totals.total_psm_count
            ORDER BY sample.sample_id, sample.result_layer
        ) TO {_sql_literal(results_dir / QC_PSM_COMPLETENESS)}
        (FORMAT PARQUET, COMPRESSION ZSTD)
        """
    )

    # Per-(condition, replicate, result_layer) PSM intensity boxplot stats
    # COALESCE with sample_id ensures each sample gets its own row when replicate is NULL
    connection.execute(
        f"""
        COPY (
            SELECT
                result_layer,
                condition,
                COALESCE(replicate, sample_id) AS replicate,
                count(DISTINCT sample_id) AS sample_count,
                quantile_cont(processed_log2_abundance, 0.25) AS q1,
                median(processed_log2_abundance) AS median,
                quantile_cont(processed_log2_abundance, 0.75) AS q3
            FROM read_parquet({peptide})
            WHERE processed_log2_abundance IS NOT NULL
            GROUP BY result_layer, condition, COALESCE(replicate, sample_id)
            ORDER BY result_layer, condition, COALESCE(replicate, sample_id)
        ) TO {_sql_literal(results_dir / QC_PSM_INTENSITY)}
        (FORMAT PARQUET, COMPRESSION ZSTD)
        """
    )

    qc_path = results_dir / "QC_Results.json"
    if qc_path.exists():
        try:
            qc = json.loads(qc_path.read_text(encoding="utf-8"))
            pca = qc.get("pca") or {}
            samples = pca.get("samples") or []
            pca_frame = pd.DataFrame(
                {
                    "sample_id": samples,
                    "pc1": pca.get("pc1") or [],
                    "pc2": pca.get("pc2") or [],
                    "condition": pca.get("conditions") or [],
                }
            )
        except (OSError, ValueError):
            pca_frame = pd.DataFrame()
    else:
        pca_frame = pd.DataFrame()
    if pca_frame.empty:
        pca_frame = pd.DataFrame(
            {
                "sample_id": pd.Series(dtype="string"),
                "pc1": pd.Series(dtype="float64"),
                "pc2": pd.Series(dtype="float64"),
                "condition": pd.Series(dtype="string"),
            }
        )
    pca_frame.to_parquet(results_dir / QC_PCA, index=False)


def _method_metadata(config: AnalysisConfig, pipeline: str) -> tuple[str, str]:
    if pipeline == "msstats":
        return (
            config.msstats_normalization,
            "MSstats model-based imputation" if config.msstats_impute else "none",
        )
    if pipeline == "ptm":
        return (
            config.ptm_normalization_method,
            "MSstatsPTM model-based imputation" if config.ptm_imputation else "none",
        )
    return config.msqrob2_normalization, config.msqrob2_imputation


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
        _replace_file_with_retry(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def materialize_visualization_artifacts(
    results_dir: Path,
    *,
    config: AnalysisConfig,
    pipeline: str,
) -> dict[str, Any]:
    """Build all current visualization artifacts from authoritative pipeline output."""
    results_dir = results_dir.resolve()
    results_dir.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect()
    try:
        sample_frame = _materialize_samples_and_proteins(
            connection, results_dir, config, pipeline
        )
        _materialize_peptides(connection, results_dir, sample_frame, pipeline)
        _annotate_protein_feature_provenance(connection, results_dir)
        comparison_rows = _comparison_rows(config)
        _materialize_differential_results(
            connection, results_dir, config, pipeline, comparison_rows
        )
        _materialize_qc_artifacts(connection, results_dir)
    finally:
        connection.close()

    normalization, imputation = _method_metadata(config, pipeline)
    manifest = {
        "schema_version": VISUALIZATION_SCHEMA_VERSION,
        "pipeline": pipeline,
        "available_result_layers": [
            "protein",
            *(["ptm", "adjusted_ptm"] if pipeline == "ptm" else []),
        ],
        "normalization_method": normalization,
        "imputation_method": imputation,
        "abundance_scale": "log2",
        "generated_at": datetime.now(UTC).isoformat(),
        "artifacts": {
            "protein_abundance": PROTEIN_ARTIFACT,
            "peptide_abundance": PEPTIDE_ARTIFACT,
            "samples": SAMPLE_CATALOG,
            "comparisons": COMPARISON_CATALOG,
            "differential_results": DIFFERENTIAL_ARTIFACT,
            "qc_sample_metrics": QC_SAMPLE_METRICS,
            "qc_group_metrics": QC_GROUP_METRICS,
            "qc_comparison_metrics": QC_COMPARISON_METRICS,
            "qc_pca": QC_PCA,
            "qc_psm_completeness": QC_PSM_COMPLETENESS,
            "qc_psm_intensity": QC_PSM_INTENSITY,
        },
    }
    _atomic_write_json(results_dir / VISUALIZATION_MANIFEST, manifest)
    return manifest


def load_visualization_artifact_manifest(results_dir: Path) -> dict[str, Any] | None:
    path = results_dir / VISUALIZATION_MANIFEST
    if not path.exists():
        return None
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if manifest.get("schema_version") != VISUALIZATION_SCHEMA_VERSION:
        return None
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        return None
    required = {
        PROTEIN_ARTIFACT,
        PEPTIDE_ARTIFACT,
        SAMPLE_CATALOG,
        COMPARISON_CATALOG,
        DIFFERENTIAL_ARTIFACT,
    }
    if not required.issubset(set(artifacts.values())):
        return None
    if any(not (results_dir / filename).is_file() for filename in artifacts.values()):
        return None
    return manifest
