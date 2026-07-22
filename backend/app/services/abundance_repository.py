"""Predicate-scoped DuckDB access to canonical abundance Parquet artifacts."""

from __future__ import annotations

import base64
import math
from pathlib import Path
from typing import Any, Literal

import duckdb
import pandas as pd

from app.services.visualization_artifacts import (
    COMPARISON_CATALOG,
    PEPTIDE_ARTIFACT,
    PROTEIN_ARTIFACT,
    SAMPLE_CATALOG,
    load_visualization_artifact_manifest,
)

AbundanceEntity = Literal["protein", "peptide"]
DEFAULT_POINT_BUDGET = 100_000


def _encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(str(offset).encode()).decode().rstrip("=")


def _decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        padding = "=" * (-len(cursor) % 4)
        value = int(base64.urlsafe_b64decode(cursor + padding).decode())
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError("Invalid cursor") from error
    if value < 0:
        raise ValueError("Invalid cursor")
    return value


class AbundanceRepository:
    """Read one session or report's immutable abundance artifacts."""

    def __init__(self, results_dir: Path):
        self.results_dir = results_dir.resolve()
        self.manifest = load_visualization_artifact_manifest(self.results_dir)
        if self.manifest is None:
            raise ValueError("Visualization artifacts require reprocessing")

    def _artifact(self, entity: AbundanceEntity) -> Path:
        filename = PROTEIN_ARTIFACT if entity == "protein" else PEPTIDE_ARTIFACT
        return self.results_dir / filename

    def _comparison_conditions(
        self, connection: duckdb.DuckDBPyConnection, comparison_id: str
    ) -> list[str]:
        row = connection.execute(
            "SELECT group1_label, group2_label FROM read_parquet(?) "
            "WHERE comparison_id = ?",
            [str(self.results_dir / COMPARISON_CATALOG), comparison_id],
        ).fetchone()
        if row is None:
            raise ValueError(f"Unknown comparison: {comparison_id}")
        return [str(row[0]), str(row[1])]

    def first_comparison_id(self) -> str:
        connection = duckdb.connect()
        try:
            row = connection.execute(
                "SELECT comparison_id FROM read_parquet(?) "
                "ORDER BY comparison_order LIMIT 1",
                [str(self.results_dir / COMPARISON_CATALOG)],
            ).fetchone()
        finally:
            connection.close()
        if row is None:
            raise ValueError("No comparisons are available")
        return str(row[0])

    @staticmethod
    def _accession_predicate() -> str:
        return """
            (protein_accession = ? OR list_contains(
                string_split(replace(protein_accession, ' ', ''), ';'), ?
            ))
        """

    def get_summary(
        self,
        *,
        entity: AbundanceEntity,
        protein_accession: str,
        comparison_id: str,
        result_layer: str = "protein",
        point_budget: int = DEFAULT_POINT_BUDGET,
    ) -> dict[str, Any]:
        if point_budget < 0:
            raise ValueError("point_budget must be non-negative")
        connection = duckdb.connect()
        try:
            conditions = self._comparison_conditions(connection, comparison_id)
            path = str(self._artifact(entity))
            parameters: list[Any] = [
                path,
                protein_accession,
                protein_accession,
                result_layer,
                *conditions,
            ]
            where = (
                f"{self._accession_predicate()} AND result_layer = ? "
                "AND condition IN (?, ?) AND processed_log2_abundance IS NOT NULL"
            )
            summaries = connection.execute(
                f"""
                SELECT
                    condition,
                    min(condition_order) AS condition_order,
                    count(*) AS observation_count,
                    quantile_cont(processed_log2_abundance, 0.25) AS q1,
                    median(processed_log2_abundance) AS median,
                    quantile_cont(processed_log2_abundance, 0.75) AS q3,
                    count(*) FILTER (WHERE provenance = 'observed') AS observed_count,
                    count(*) FILTER (WHERE provenance = 'imputed') AS imputed_count,
                    count(*) FILTER (WHERE provenance = 'model_estimated') AS model_estimated_count
                FROM read_parquet(?)
                WHERE {where}
                GROUP BY condition
                ORDER BY condition_order
                """,
                parameters,
            ).fetchdf()
            group_map = {row["condition"]: row for row in summaries.to_dict("records")}
            groups = []
            for condition in conditions:
                row = group_map.get(condition)
                if row is None:
                    continue
                q1 = float(row["q1"])
                q3 = float(row["q3"])
                iqr = q3 - q1
                count = int(row["observation_count"])
                imputed_count = int(row["imputed_count"])
                groups.append(
                    {
                        "condition": condition,
                        "observation_count": count,
                        "q1": q1,
                        "median": float(row["median"]),
                        "q3": q3,
                        "lower_fence": q1 - 1.5 * iqr,
                        "upper_fence": q3 + 1.5 * iqr,
                        "observed_count": int(row["observed_count"]),
                        "imputed_count": imputed_count,
                        "model_estimated_count": int(row["model_estimated_count"]),
                        "imputation_fraction": imputed_count / count if count else 0.0,
                    }
                )

            total = sum(group["observation_count"] for group in groups)
            points: list[dict[str, Any]] = []
            if total <= point_budget:
                peptide_select = "peptide_id," if entity == "peptide" else ""
                point_frame = connection.execute(
                    f"""
                    SELECT sample_id, condition, replicate, batch,
                           {peptide_select}
                           processed_log2_abundance, provenance
                    FROM read_parquet(?)
                    WHERE {where}
                    ORDER BY condition_order, sample_order
                    """,
                    parameters,
                ).fetchdf()
                points = point_frame.to_dict("records")
            return {
                "protein_accession": protein_accession,
                "comparison_id": comparison_id,
                "result_layer": result_layer,
                "scale": self.manifest["abundance_scale"],
                "normalization_method": self.manifest["normalization_method"],
                "imputation_method": self.manifest["imputation_method"],
                "groups": groups,
                "points": points,
                "point_count": total,
                "points_truncated": total > point_budget,
            }
        finally:
            connection.close()

    def get_detail(
        self,
        *,
        entity: AbundanceEntity,
        protein_accession: str,
        comparison_id: str,
        result_layer: str = "protein",
        cursor: str | None,
        limit: int,
    ) -> dict[str, Any]:
        if limit < 1 or limit > 10_000:
            raise ValueError("limit must be between 1 and 10000")
        offset = _decode_cursor(cursor)
        connection = duckdb.connect()
        try:
            conditions = self._comparison_conditions(connection, comparison_id)
            path = str(self._artifact(entity))
            peptide_select = "peptide_id," if entity == "peptide" else ""
            rows = connection.execute(
                f"""
                SELECT sample_id, condition, replicate, batch,
                       {peptide_select}
                       processed_log2_abundance, provenance
                FROM read_parquet(?)
                WHERE {self._accession_predicate()}
                  AND result_layer = ?
                  AND condition IN (?, ?)
                  AND processed_log2_abundance IS NOT NULL
                ORDER BY condition_order, sample_order
                LIMIT ? OFFSET ?
                """,
                [
                    path,
                    protein_accession,
                    protein_accession,
                    result_layer,
                    *conditions,
                    limit + 1,
                    offset,
                ],
            ).fetchdf()
            has_more = len(rows) > limit
            items = rows.iloc[:limit].to_dict("records")
            return {
                "items": items,
                "next_cursor": _encode_cursor(offset + limit) if has_more else None,
            }
        finally:
            connection.close()

    def get_gene_heatmap(
        self,
        *,
        genes: list[str],
        comparison_id: str,
        result_layer: str = "protein",
    ) -> dict[str, Any]:
        """Return comparison-scoped processed abundance for up to 50 genes."""
        requested_genes = list(
            dict.fromkeys(gene.strip() for gene in genes if gene.strip())
        )[:50]
        if not requested_genes:
            return {
                "genes": [],
                "protein_accessions": [],
                "samples": [],
                "conditions": [],
                "replicates": [],
                "z_scores": [],
                "log2_abundances": [],
            }

        connection = duckdb.connect()
        try:
            conditions = self._comparison_conditions(connection, comparison_id)
            requested = pd.DataFrame(
                {
                    "gene": requested_genes,
                    "gene_order": range(len(requested_genes)),
                }
            )
            connection.register("requested_genes", requested)
            mappings = connection.execute(
                """
                WITH gene_tokens AS (
                    SELECT DISTINCT
                        protein_accession,
                        unnest(string_split(
                            upper(replace(coalesce(gene_name, ''), ' ', '')), ';'
                        )) AS gene_token
                    FROM read_parquet(?)
                    WHERE result_layer = ?
                )
                SELECT
                    requested.gene,
                    requested.gene_order,
                    min(gene_tokens.protein_accession) AS protein_accession
                FROM requested_genes AS requested
                JOIN gene_tokens
                  ON gene_tokens.gene_token = upper(requested.gene)
                GROUP BY requested.gene, requested.gene_order
                ORDER BY requested.gene_order
                """,
                [str(self._artifact("protein")), result_layer],
            ).fetchall()

            sample_rows = connection.execute(
                """
                SELECT sample_id, condition, replicate
                FROM read_parquet(?)
                WHERE condition IN (?, ?)
                ORDER BY
                    CASE condition WHEN ? THEN 0 WHEN ? THEN 1 ELSE 2 END,
                    sample_order
                """,
                [
                    str(self.results_dir / SAMPLE_CATALOG),
                    *conditions,
                    *conditions,
                ],
            ).fetchall()
            samples = [str(row[0]) for row in sample_rows]
            sample_index = {sample: index for index, sample in enumerate(samples)}

            abundance_rows = connection.execute(
                """
                SELECT
                    mapping.gene,
                    abundance.sample_id,
                    abundance.processed_log2_abundance
                FROM read_parquet(?) AS abundance
                JOIN (
                    SELECT
                        requested.gene,
                        min(tokens.protein_accession) AS protein_accession
                    FROM requested_genes AS requested
                    JOIN (
                        SELECT DISTINCT
                            protein_accession,
                            unnest(string_split(
                                upper(replace(coalesce(gene_name, ''), ' ', '')), ';'
                            )) AS gene_token
                        FROM read_parquet(?)
                        WHERE result_layer = ?
                    ) AS tokens
                      ON tokens.gene_token = upper(requested.gene)
                    GROUP BY requested.gene
                ) AS mapping
                  ON mapping.protein_accession = abundance.protein_accession
                WHERE abundance.result_layer = ?
                  AND abundance.condition IN (?, ?)
                """,
                [
                    str(self._artifact("protein")),
                    str(self._artifact("protein")),
                    result_layer,
                    result_layer,
                    *conditions,
                ],
            ).fetchall()
        finally:
            connection.close()

        values_by_gene: dict[str, list[float | None]] = {
            str(gene): [None] * len(samples) for gene, _order, _accession in mappings
        }
        for gene, sample_id, abundance in abundance_rows:
            if sample_id in sample_index and abundance is not None:
                values_by_gene[str(gene)][sample_index[str(sample_id)]] = float(
                    abundance
                )

        raw_rows = [values_by_gene[str(gene)] for gene, _order, _accession in mappings]
        z_rows: list[list[float | None]] = []
        for row in raw_rows:
            observed = [value for value in row if value is not None]
            mean = sum(observed) / len(observed) if observed else 0.0
            variance = (
                sum((value - mean) ** 2 for value in observed) / len(observed)
                if observed
                else 0.0
            )
            standard_deviation = math.sqrt(variance)
            z_rows.append(
                [
                    None
                    if value is None
                    else (value - mean) / standard_deviation
                    if standard_deviation > 0
                    else 0.0
                    for value in row
                ]
            )

        return {
            "genes": [str(row[0]) for row in mappings],
            "protein_accessions": [str(row[2]) for row in mappings],
            "samples": samples,
            "conditions": [str(row[1]) for row in sample_rows],
            "replicates": [
                None if row[2] is None else str(row[2]) for row in sample_rows
            ],
            "z_scores": z_rows,
            "log2_abundances": raw_rows,
        }
