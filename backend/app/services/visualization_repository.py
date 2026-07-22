"""Bounded catalog and QC queries over immutable visualization Parquet."""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

import duckdb

from app.services.visualization_artifacts import (
    COMPARISON_CATALOG,
    DIFFERENTIAL_ARTIFACT,
    QC_GROUP_METRICS,
    QC_PCA,
    QC_SAMPLE_METRICS,
    SAMPLE_CATALOG,
    load_visualization_artifact_manifest,
)


def _encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(str(offset).encode()).decode().rstrip("=")


def _decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        padding = "=" * (-len(cursor) % 4)
        offset = int(base64.urlsafe_b64decode(cursor + padding).decode())
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError("Invalid cursor") from error
    if offset < 0:
        raise ValueError("Invalid cursor")
    return offset


class VisualizationRepository:
    """Query one current session/report visualization snapshot."""

    def __init__(self, results_dir: Path):
        self.results_dir = results_dir.resolve()
        self.manifest = load_visualization_artifact_manifest(self.results_dir)
        if self.manifest is None:
            raise ValueError("Visualization artifacts require reprocessing")

    @staticmethod
    def _page(frame, *, offset: int, limit: int) -> dict[str, Any]:
        has_more = len(frame) > limit
        return {
            "items": frame.iloc[:limit].to_dict("records"),
            "next_cursor": _encode_cursor(offset + limit) if has_more else None,
        }

    def list_comparisons(
        self, *, search: str | None, cursor: str | None, limit: int
    ) -> dict[str, Any]:
        if limit < 1 or limit > 100:
            raise ValueError("limit must be between 1 and 100")
        offset = _decode_cursor(cursor)
        connection = duckdb.connect()
        try:
            where = ""
            parameters: list[Any] = [str(self.results_dir / COMPARISON_CATALOG)]
            if search:
                where = "WHERE comparison_id ILIKE ? OR display_label ILIKE ?"
                pattern = f"%{search}%"
                parameters.extend([pattern, pattern])
            parameters.extend([limit + 1, offset])
            frame = connection.execute(
                f"""
                SELECT comparison_id, display_label, group1_label, group2_label,
                       group1_sample_count, group2_sample_count, result_status,
                       tested_count, significant_count
                FROM read_parquet(?)
                {where}
                ORDER BY comparison_order
                LIMIT ? OFFSET ?
                """,
                parameters,
            ).fetchdf()
        finally:
            connection.close()
        return self._page(frame, offset=offset, limit=limit)

    def list_samples(
        self, *, search: str | None, cursor: str | None, limit: int
    ) -> dict[str, Any]:
        if limit < 1 or limit > 500:
            raise ValueError("limit must be between 1 and 500")
        offset = _decode_cursor(cursor)
        connection = duckdb.connect()
        try:
            where = ""
            parameters: list[Any] = [str(self.results_dir / SAMPLE_CATALOG)]
            if search:
                where = (
                    "WHERE sample_id ILIKE ? OR condition ILIKE ? "
                    "OR CAST(batch AS VARCHAR) ILIKE ?"
                )
                pattern = f"%{search}%"
                parameters.extend([pattern, pattern, pattern])
            parameters.extend([limit + 1, offset])
            frame = connection.execute(
                f"""
                SELECT sample_id, condition, replicate, batch
                FROM read_parquet(?)
                {where}
                ORDER BY sample_order
                LIMIT ? OFFSET ?
                """,
                parameters,
            ).fetchdf()
        finally:
            connection.close()
        return self._page(frame, offset=offset, limit=limit)

    def list_qc_samples(
        self, *, search: str | None, cursor: str | None, limit: int
    ) -> dict[str, Any]:
        """Return one bounded page of exact per-sample health metrics."""
        if limit < 1 or limit > 500:
            raise ValueError("limit must be between 1 and 500")
        offset = _decode_cursor(cursor)
        connection = duckdb.connect()
        try:
            where = ""
            parameters: list[Any] = [str(self.results_dir / QC_SAMPLE_METRICS)]
            if search:
                where = (
                    "WHERE sample_id ILIKE ? OR condition ILIKE ? "
                    "OR CAST(batch AS VARCHAR) ILIKE ?"
                )
                pattern = f"%{search}%"
                parameters.extend([pattern, pattern, pattern])
            parameters.extend([limit + 1, offset])
            frame = connection.execute(
                f"""
                SELECT sample_id, condition, replicate, batch,
                       total_feature_count, present_count, missing_count,
                       observed_feature_count, imputed_feature_count,
                       imputation_fraction, median_log2_abundance
                FROM read_parquet(?)
                {where}
                ORDER BY sample_order
                LIMIT ? OFFSET ?
                """,
                parameters,
            ).fetchdf()
        finally:
            connection.close()
        return self._page(frame, offset=offset, limit=limit)

    def get_qc_overview(
        self,
        *,
        group_by: str,
        search: str | None,
        cursor: str | None,
        limit: int,
    ) -> dict[str, Any]:
        if group_by not in {"condition", "batch"}:
            raise ValueError("group_by must be condition or batch")
        if limit < 1 or limit > 50:
            raise ValueError("QC plots may display at most 50 groups")
        offset = _decode_cursor(cursor)
        connection = duckdb.connect()
        try:
            where = "WHERE group_by = ? AND group_value IS NOT NULL"
            parameters: list[Any] = [str(self.results_dir / QC_GROUP_METRICS), group_by]
            if search:
                where += " AND group_value ILIKE ?"
                parameters.append(f"%{search}%")
            counts = connection.execute(
                """
                SELECT
                    count(*) FILTER (WHERE group_by = ? AND group_value IS NOT NULL),
                    count(*) FILTER (
                        WHERE group_by = ? AND group_value IS NOT NULL
                          AND (? IS NULL OR group_value ILIKE ?)
                    )
                FROM read_parquet(?)
                """,
                [
                    group_by,
                    group_by,
                    search,
                    f"%{search}%" if search else None,
                    str(self.results_dir / QC_GROUP_METRICS),
                ],
            ).fetchone()
            parameters.extend([limit + 1, offset])
            groups = connection.execute(
                f"""
                SELECT group_by, group_value, sample_count, observation_count,
                       q1, median, q3, observed_count, imputed_count, missing_count,
                       protein_cv_count, protein_cv_q1, protein_cv_median,
                       protein_cv_q3, peptide_cv_count, peptide_cv_q1,
                       peptide_cv_median, peptide_cv_q3
                FROM read_parquet(?)
                {where}
                ORDER BY group_order
                LIMIT ? OFFSET ?
                """,
                parameters,
            ).fetchdf()
            pca = connection.execute(
                "SELECT sample_id, pc1, pc2, condition FROM read_parquet(?)",
                [str(self.results_dir / QC_PCA)],
            ).fetchdf()
        finally:
            connection.close()
        page = self._page(groups, offset=offset, limit=limit)
        return {
            "group_by": group_by,
            "groups": page["items"],
            "next_cursor": page["next_cursor"],
            "group_count": int(counts[0] or 0),
            "matching_group_count": int(counts[1] or 0),
            "pca": pca.to_dict("records"),
            "normalization_method": self.manifest["normalization_method"],
            "imputation_method": self.manifest["imputation_method"],
            "abundance_scale": self.manifest["abundance_scale"],
        }

    def get_qc_differential(self, comparison_id: str) -> dict[str, Any]:
        connection = duckdb.connect()
        try:
            exists = connection.execute(
                "SELECT 1 FROM read_parquet(?) WHERE comparison_id = ? LIMIT 1",
                [str(self.results_dir / COMPARISON_CATALOG), comparison_id],
            ).fetchone()
            if exists is None:
                raise ValueError(f"Unknown comparison: {comparison_id}")
            summary = connection.execute(
                """
                SELECT
                    count(*) FILTER (WHERE p_value IS NOT NULL) AS tested_count,
                    count(*) FILTER (WHERE adjusted_p_value < 0.05) AS significant_count,
                    count(*) FILTER (WHERE p_value IS NULL) AS failed_count
                FROM read_parquet(?)
                WHERE comparison_id = ? AND result_layer = 'protein'
                """,
                [str(self.results_dir / DIFFERENTIAL_ARTIFACT), comparison_id],
            ).fetchone()
            counts = connection.execute(
                """
                WITH values_in_range AS (
                    SELECT least(floor(p_value * 20)::INTEGER, 19) AS bin
                    FROM read_parquet(?)
                    WHERE comparison_id = ? AND result_layer = 'protein'
                      AND p_value BETWEEN 0 AND 1
                )
                SELECT bins.bin, count(values_in_range.bin) AS count
                FROM range(20) AS bins(bin)
                LEFT JOIN values_in_range ON values_in_range.bin = bins.bin
                GROUP BY bins.bin
                ORDER BY bins.bin
                """,
                [str(self.results_dir / DIFFERENTIAL_ARTIFACT), comparison_id],
            ).fetchall()
        finally:
            connection.close()
        return {
            "comparison_id": comparison_id,
            "tested_count": int(summary[0] or 0),
            "significant_count": int(summary[1] or 0),
            "failed_count": int(summary[2] or 0),
            "pvalue_distribution": {
                "bins": [index / 20 for index in range(20)],
                "counts": [int(row[1]) for row in counts],
            },
        }
