"""Predicate-scoped access to canonical differential-result Parquet."""

from __future__ import annotations

import math
import os
import uuid
from pathlib import Path
from typing import Any

import duckdb

from app.services.visualization_artifacts import DIFFERENTIAL_ARTIFACT


def _sql_literal(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _sanitize_float(value: object) -> float | None:
    """Cast to float, returning None for non-finite values (inf, -inf, NaN).

    Exists as defence-in-depth alongside the parquet-materialisation fix in
    ``visualization_artifacts._finite_double_sql``, so that sessions built
    before the fix can still be loaded.
    """
    if value is None:
        return None
    try:
        f = float(value)
    except (ValueError, TypeError):
        return None
    return f if math.isfinite(f) else None


class DifferentialRepository:
    """Read one immutable canonical differential-result artifact."""

    def __init__(self, results_dir: Path):
        self.results_dir = results_dir.resolve()
        self.path = self.results_dir / DIFFERENTIAL_ARTIFACT
        if not self.path.is_file():
            raise ValueError("Visualization artifacts require reprocessing")

    def _require_comparison(
        self,
        connection: duckdb.DuckDBPyConnection,
        comparison_id: str,
        result_layer: str,
    ) -> None:
        row = connection.execute(
            "SELECT 1 FROM read_parquet(?) "
            "WHERE comparison_id = ? AND result_layer = ? LIMIT 1",
            [str(self.path), comparison_id, result_layer],
        ).fetchone()
        if row is None:
            raise ValueError(f"Unknown comparison: {comparison_id}")

    def _resolve_comparison(
        self,
        connection: duckdb.DuckDBPyConnection,
        comparison_id: str,
        result_layer: str,
    ) -> str:
        if comparison_id:
            self._require_comparison(connection, comparison_id, result_layer)
            return comparison_id
        row = connection.execute(
            "SELECT min(comparison_id) FROM read_parquet(?) " "WHERE result_layer = ?",
            [str(self.path), result_layer],
        ).fetchone()
        if row is None or row[0] is None:
            raise ValueError("No differential results are available")
        return str(row[0])

    def validate_comparisons(
        self, comparison_ids: list[str], *, result_layer: str = "protein"
    ) -> list[str]:
        """Return unknown comparison identifiers using one bounded query."""
        if not comparison_ids:
            return []
        connection = duckdb.connect()
        try:
            rows = connection.execute(
                "SELECT DISTINCT comparison_id FROM read_parquet(?) "
                "WHERE result_layer = ? AND comparison_id IN "
                f"({', '.join('?' for _ in comparison_ids)})",
                [str(self.path), result_layer, *comparison_ids],
            ).fetchall()
        finally:
            connection.close()
        available = {str(row[0]) for row in rows}
        return [item for item in comparison_ids if item not in available]

    def list_comparison_ids(self, *, result_layer: str = "protein") -> list[str]:
        connection = duckdb.connect()
        try:
            rows = connection.execute(
                "SELECT DISTINCT comparison_id FROM read_parquet(?) "
                "WHERE result_layer = ? ORDER BY comparison_id",
                [str(self.path), result_layer],
            ).fetchall()
        finally:
            connection.close()
        return [str(row[0]) for row in rows]

    def list_results(
        self,
        comparison_id: str,
        *,
        page: int,
        page_size: int,
        sort_by: str = "adj_pvalue",
        sort_order: str = "asc",
        significant_only: bool = False,
        search: str = "",
        result_layer: str = "protein",
    ) -> dict[str, Any]:
        """Query one comparison without loading its result table into Python."""
        sort_columns = {
            "master_protein_accessions": "protein_accession",
            "gene_name": "gene_name",
            "log_fc": "log2_fold_change",
            "pval": "p_value",
            "adj_pvalue": "adjusted_p_value",
            "adj_pval": "adjusted_p_value",
            "se": "standard_error",
            "t_statistic": "statistic",
            "psm_count": "psm_count",
            "significant": "adjusted_p_value",
        }
        sort_column = sort_columns.get(sort_by, "adjusted_p_value")
        direction = "DESC" if sort_order.lower() == "desc" else "ASC"

        connection = duckdb.connect()
        try:
            resolved = self._resolve_comparison(connection, comparison_id, result_layer)
            filters = ["comparison_id = ?", "result_layer = ?"]
            parameters: list[object] = [resolved, result_layer]
            if significant_only:
                filters.append("adjusted_p_value < 0.05")
            if search:
                filters.append(
                    "(contains(lower(coalesce(protein_accession, '')), lower(?)) "
                    "OR contains(lower(coalesce(gene_name, '')), lower(?)))"
                )
                parameters.extend([search, search])
            where_sql = " AND ".join(filters)
            summary = connection.execute(
                f"""
                SELECT
                    count(*) AS total,
                    count(*) FILTER (WHERE adjusted_p_value < 0.05) AS significant,
                    count(*) FILTER (
                        WHERE adjusted_p_value < 0.05 AND log2_fold_change > 0
                    ) AS upregulated,
                    count(*) FILTER (
                        WHERE adjusted_p_value < 0.05 AND log2_fold_change < 0
                    ) AS downregulated
                FROM read_parquet(?)
                WHERE {where_sql}
                """,
                [str(self.path), *parameters],
            ).fetchone()
            assert summary is not None
            total = int(summary[0])
            rows = connection.execute(
                f"""
                SELECT
                    coalesce(protein_accession, ''),
                    coalesce(gene_name, ''),
                    coalesce(log2_fold_change, 0),
                    coalesce(p_value, 1),
                    coalesce(adjusted_p_value, 1),
                    standard_error,
                    statistic,
                    adjusted_p_value < 0.05,
                    coalesce(psm_count, 0)
                FROM read_parquet(?)
                WHERE {where_sql}
                ORDER BY {sort_column} {direction} NULLS LAST, protein_accession
                LIMIT ? OFFSET ?
                """,
                [
                    str(self.path),
                    *parameters,
                    page_size,
                    (page - 1) * page_size,
                ],
            ).fetchall()
        finally:
            connection.close()

        results = [
            {
                "master_protein_accessions": str(row[0]),
                "gene_name": str(row[1]),
                "log_fc": _sanitize_float(row[2]),
                "pval": _sanitize_float(row[3]),
                "adj_pval": _sanitize_float(row[4]),
                "se": _sanitize_float(row[5]),
                "t_statistic": _sanitize_float(row[6]),
                "significant": bool(row[7]),
                "psm_count": int(row[8]),
            }
            for row in rows
        ]
        return {
            "comparison": resolved,
            "results": results,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total else 0,
            "total_proteins": total,
            "significant_proteins": int(summary[1]),
            "upregulated": int(summary[2]),
            "downregulated": int(summary[3]),
        }

    def get_ranked_genes(
        self, comparison_id: str, *, result_layer: str = "protein"
    ) -> list[dict[str, Any]]:
        connection = duckdb.connect()
        try:
            self._require_comparison(connection, comparison_id, result_layer)
            rows = connection.execute(
                """
                SELECT gene_name, protein_accession, log2_fold_change, p_value
                FROM read_parquet(?)
                WHERE comparison_id = ? AND result_layer = ?
                  AND gene_name IS NOT NULL AND gene_name != ''
                  AND p_value > 0 AND p_value <= 1
                  AND log2_fold_change IS NOT NULL
                ORDER BY
                    (-log10(p_value) * sign(log2_fold_change)) DESC,
                    protein_accession
                """,
                [str(self.path), comparison_id, result_layer],
            ).fetchall()
        finally:
            connection.close()

        ranking = []
        for gene_name, accession, log2_fold_change, p_value in rows:
            gene = str(gene_name).split(";", 1)[0].strip()
            if not gene:
                continue
            ranking.append(
                {
                    "gene": gene,
                    "protein_accession": str(accession),
                    "metric": -math.log10(float(p_value))
                    * (1 if float(log2_fold_change) > 0 else -1),
                }
            )
        return ranking

    def export_comparison_tsv(
        self,
        comparison_id: str,
        destination: Path,
        *,
        result_layer: str = "protein",
    ) -> Path:
        """Write one bounded compatibility table at a subprocess boundary."""
        destination = destination.resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
        connection = duckdb.connect()
        try:
            self._require_comparison(connection, comparison_id, result_layer)
            connection.execute(
                f"""
                COPY (
                    SELECT
                        protein_accession AS Master_Protein_Accessions,
                        gene_name AS Gene_Name,
                        log2_fold_change AS logFC,
                        p_value AS pval,
                        adjusted_p_value AS adjPval,
                        standard_error AS se,
                        statistic AS t
                    FROM read_parquet(?)
                    WHERE comparison_id = ? AND result_layer = ?
                    ORDER BY protein_accession
                ) TO {_sql_literal(temporary)}
                (FORMAT CSV, DELIMITER '\t', HEADER)
                """,
                [str(self.path), comparison_id, result_layer],
            )
            os.replace(temporary, destination)
        finally:
            connection.close()
            temporary.unlink(missing_ok=True)
        return destination
