"""Versioned blockwise comparison-correlation artifacts for large DIA studies."""

from __future__ import annotations

import hashlib
import json
import math
import os
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
from scipy.sparse.linalg import LinearOperator, eigsh
from scipy.stats import spearmanr

from app.services.visualization_artifacts import (
    COMPARISON_CATALOG,
    DIFFERENTIAL_ARTIFACT,
    VISUALIZATION_MANIFEST,
)

CORRELATION_SCHEMA_VERSION = 1
MIN_SHARED_PROTEINS = 100
DEFAULT_BLOCK_SIZE = 128
DEFAULT_TILE_SIZE = 256


def _atomic_json(path: Path, data: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _cache_key(results_dir: Path, min_support: int, block_size: int) -> str:
    digest = hashlib.sha256()
    manifest = results_dir / VISUALIZATION_MANIFEST
    if manifest.exists():
        digest.update(manifest.read_bytes())
    differential = results_dir / DIFFERENTIAL_ARTIFACT
    stat = differential.stat()
    digest.update(f"{stat.st_size}:{stat.st_mtime_ns}".encode())
    digest.update(
        f"pearson:{min_support}:block:{block_size}:v{CORRELATION_SCHEMA_VERSION}".encode()
    )
    return digest.hexdigest()[:24]


def _artifact_root(results_dir: Path) -> Path:
    return (
        results_dir
        / "compare"
        / f"comparison-correlation-v{CORRELATION_SCHEMA_VERSION}"
    )


def _write_current(root: Path, cache_key: str) -> None:
    _atomic_json(root / "current.json", {"cache_key": cache_key})


def _load_fold_change_matrix(
    results_dir: Path,
    artifact_dir: Path,
    comparison_ids: list[str],
) -> tuple[np.memmap, int]:
    path = artifact_dir / "fold_changes.npy"
    connection = duckdb.connect()
    try:
        proteins = [
            str(row[0])
            for row in connection.execute(
                "SELECT DISTINCT protein_accession FROM read_parquet(?) "
                "WHERE result_layer = 'protein' AND protein_accession IS NOT NULL "
                "ORDER BY protein_accession",
                [str(results_dir / DIFFERENTIAL_ARTIFACT)],
            ).fetchall()
        ]
        matrix = np.lib.format.open_memmap(
            path,
            mode="w+",
            dtype=np.float32,
            shape=(len(proteins), len(comparison_ids)),
        )
        matrix[:] = np.nan
        protein_index = {protein: index for index, protein in enumerate(proteins)}
        comparison_index = {
            comparison: index for index, comparison in enumerate(comparison_ids)
        }
        cursor = connection.execute(
            "SELECT protein_accession, comparison_id, log2_fold_change "
            "FROM read_parquet(?) WHERE result_layer = 'protein' "
            "AND log2_fold_change IS NOT NULL",
            [str(results_dir / DIFFERENTIAL_ARTIFACT)],
        )
        while rows := cursor.fetchmany(100_000):
            for protein, comparison, value in rows:
                row_index = protein_index.get(str(protein))
                column_index = comparison_index.get(str(comparison))
                if row_index is not None and column_index is not None:
                    matrix[row_index, column_index] = float(value)
        matrix.flush()
        return matrix, len(proteins)
    finally:
        connection.close()


def _correlation_block(
    left: np.ndarray, right: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    left_mask = np.isfinite(left).astype(np.float64)
    right_mask = np.isfinite(right).astype(np.float64)
    left_values = np.nan_to_num(left, nan=0.0).astype(np.float64, copy=False)
    right_values = np.nan_to_num(right, nan=0.0).astype(np.float64, copy=False)

    support = left_mask.T @ right_mask
    sum_left = left_values.T @ right_mask
    sum_right = left_mask.T @ right_values
    sum_left_squared = (left_values * left_values).T @ right_mask
    sum_right_squared = left_mask.T @ (right_values * right_values)
    sum_products = left_values.T @ right_values
    numerator = support * sum_products - sum_left * sum_right
    denominator = np.sqrt(
        np.maximum(support * sum_left_squared - sum_left * sum_left, 0)
        * np.maximum(support * sum_right_squared - sum_right * sum_right, 0)
    )
    with np.errstate(divide="ignore", invalid="ignore"):
        correlation = numerator / denominator
    correlation[denominator == 0] = np.nan
    return correlation, support.astype(np.uint32)


def _embedding(correlation: np.memmap) -> np.ndarray:
    count = correlation.shape[0]
    if count == 1:
        return np.zeros((1, 2), dtype=np.float32)
    if count <= 2_000:
        dense = np.nan_to_num(np.asarray(correlation), nan=0.0)
        eigenvalues, eigenvectors = np.linalg.eigh(dense)
        order = np.argsort(eigenvalues)[-2:]
        values = np.maximum(eigenvalues[order], 0)
        coords = eigenvectors[:, order] * np.sqrt(values)
        if coords.shape[1] == 1:
            coords = np.column_stack([coords[:, 0], np.zeros(count)])
        return coords.astype(np.float32)

    def matrix_vector(vector: np.ndarray) -> np.ndarray:
        output = np.zeros(count, dtype=np.float64)
        for start in range(0, count, DEFAULT_TILE_SIZE):
            end = min(start + DEFAULT_TILE_SIZE, count)
            output[start:end] = np.nan_to_num(correlation[start:end], nan=0.0) @ vector
        return output

    operator = LinearOperator((count, count), matvec=matrix_vector, dtype=np.float64)
    values, vectors = eigsh(operator, k=2, which="LA")
    return (vectors * np.sqrt(np.maximum(values, 0))).astype(np.float32)


def build_comparison_correlation_artifact(
    results_dir: Path,
    *,
    min_support: int = MIN_SHARED_PROTEINS,
    block_size: int = DEFAULT_BLOCK_SIZE,
    tile_size: int = DEFAULT_TILE_SIZE,
    progress_callback: Callable[[int, int], None] | None = None,
    cancel_requested: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Build or resume the complete pairwise Pearson artifact."""
    results_dir = results_dir.resolve()
    if min_support < 2 or block_size < 1:
        raise ValueError("Invalid correlation build parameters")
    connection = duckdb.connect()
    try:
        comparison_ids = [
            str(row[0])
            for row in connection.execute(
                "SELECT comparison_id FROM read_parquet(?) ORDER BY comparison_order",
                [str(results_dir / COMPARISON_CATALOG)],
            ).fetchall()
        ]
    finally:
        connection.close()
    if not comparison_ids:
        raise ValueError("No comparisons are available")

    key = _cache_key(results_dir, min_support, block_size)
    root = _artifact_root(results_dir)
    artifact_dir = root / key
    artifact_dir.mkdir(parents=True, exist_ok=True)
    metadata_path = artifact_dir / "metadata.json"
    metadata = (
        json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata_path.exists()
        else {}
    )
    if metadata.get("status") == "completed":
        _write_current(root, key)
        return metadata

    matrix_path = artifact_dir / "fold_changes.npy"
    if matrix_path.exists() and metadata.get("feature_count") is not None:
        fold_changes = np.lib.format.open_memmap(matrix_path, mode="r")
        feature_count = int(metadata["feature_count"])
    else:
        fold_changes, feature_count = _load_fold_change_matrix(
            results_dir, artifact_dir, comparison_ids
        )

    count = len(comparison_ids)
    correlation_path = artifact_dir / "correlation.npy"
    support_path = artifact_dir / "support.npy"
    if correlation_path.exists() and support_path.exists():
        correlations = np.lib.format.open_memmap(correlation_path, mode="r+")
        supports = np.lib.format.open_memmap(support_path, mode="r+")
    else:
        correlations = np.lib.format.open_memmap(
            correlation_path, mode="w+", dtype=np.float32, shape=(count, count)
        )
        correlations[:] = np.nan
        supports = np.lib.format.open_memmap(
            support_path, mode="w+", dtype=np.uint32, shape=(count, count)
        )
        supports[:] = 0

    block_starts = list(range(0, count, block_size))
    block_pairs = [
        (left, right)
        for left in block_starts
        for right in block_starts
        if right >= left
    ]
    completed = set(metadata.get("completed_blocks", []))
    metadata = {
        "schema_version": CORRELATION_SCHEMA_VERSION,
        "cache_key": key,
        "status": "running",
        "method": "pearson",
        "min_support": min_support,
        "comparison_count": count,
        "feature_count": feature_count,
        "block_size": block_size,
        "tile_size": tile_size,
        "max_level": max(0, math.ceil(math.log2(max(1, count / tile_size)))),
        "comparison_ids": comparison_ids,
        "completed_blocks": sorted(completed),
    }
    _atomic_json(metadata_path, metadata)

    for left_start, right_start in block_pairs:
        block_key = f"{left_start}:{right_start}"
        if block_key in completed:
            if progress_callback:
                progress_callback(len(completed), len(block_pairs))
            continue
        if cancel_requested and cancel_requested():
            correlations.flush()
            supports.flush()
            raise RuntimeError("Comparison correlation cancelled")
        left_end = min(left_start + block_size, count)
        right_end = min(right_start + block_size, count)
        correlation_block, support_block = _correlation_block(
            fold_changes[:, left_start:left_end],
            fold_changes[:, right_start:right_end],
        )
        correlation_block[support_block < min_support] = np.nan
        correlations[left_start:left_end, right_start:right_end] = correlation_block
        supports[left_start:left_end, right_start:right_end] = support_block
        if right_start != left_start:
            correlations[right_start:right_end, left_start:left_end] = (
                correlation_block.T
            )
            supports[right_start:right_end, left_start:left_end] = support_block.T
        correlations.flush()
        supports.flush()
        completed.add(block_key)
        metadata["completed_blocks"] = sorted(completed)
        _atomic_json(metadata_path, metadata)
        if progress_callback:
            progress_callback(len(completed), len(block_pairs))

    coords = _embedding(correlations)
    metadata["embedding"] = [
        {
            "comparison_id": comparison,
            "x": float(coords[index, 0]),
            "y": float(coords[index, 1]),
        }
        for index, comparison in enumerate(comparison_ids)
    ]
    metadata["status"] = "completed"
    metadata.pop("completed_blocks", None)
    _atomic_json(metadata_path, metadata)
    _write_current(root, key)
    return metadata


class ComparisonCorrelationArtifact:
    """Read bounded views from the current complete correlation artifact."""

    def __init__(self, results_dir: Path):
        self.results_dir = results_dir.resolve()
        root = _artifact_root(self.results_dir)
        current_path = root / "current.json"
        if not current_path.exists():
            raise ValueError("No comparison correlation artifact is available")
        current = json.loads(current_path.read_text(encoding="utf-8"))
        self.artifact_dir = root / current["cache_key"]
        self.metadata = json.loads(
            (self.artifact_dir / "metadata.json").read_text(encoding="utf-8")
        )
        if self.metadata.get("status") != "completed":
            raise ValueError("Comparison correlation artifact is not complete")
        self.correlations = np.lib.format.open_memmap(
            self.artifact_dir / "correlation.npy", mode="r"
        )
        self.supports = np.lib.format.open_memmap(
            self.artifact_dir / "support.npy", mode="r"
        )
        self.comparison_ids = list(self.metadata["comparison_ids"])

    def public_metadata(self) -> dict[str, Any]:
        return {
            key: value
            for key, value in self.metadata.items()
            if key != "comparison_ids"
        }

    def get_cell(self, row_index: int, column_index: int) -> dict[str, Any]:
        count = len(self.comparison_ids)
        if not (0 <= row_index < count and 0 <= column_index < count):
            raise ValueError("Correlation cell index is out of range")
        correlation = float(self.correlations[row_index, column_index])
        support = int(self.supports[row_index, column_index])
        sufficient = support >= int(self.metadata["min_support"])
        return {
            "row_index": row_index,
            "column_index": column_index,
            "correlation": correlation
            if sufficient and math.isfinite(correlation)
            else None,
            "support_count": support,
            "sufficient_support": sufficient,
        }

    def get_tile(
        self, *, level: int, row: int, column: int, tile_size: int | None = None
    ) -> dict[str, Any]:
        configured_tile_size = int(self.metadata["tile_size"])
        size = tile_size or configured_tile_size
        if size < 1 or size > configured_tile_size:
            raise ValueError(f"tile_size must be between 1 and {configured_tile_size}")
        if (
            level < 0
            or level > int(self.metadata["max_level"])
            or row < 0
            or column < 0
        ):
            raise ValueError("Invalid correlation tile coordinates")
        factor = 2**level
        count = len(self.comparison_ids)
        grid_count = math.ceil(count / factor)
        row_grid_start = row * size
        column_grid_start = column * size
        if row_grid_start >= grid_count or column_grid_start >= grid_count:
            raise ValueError("Correlation tile is out of range")
        row_grid_end = min(row_grid_start + size, grid_count)
        column_grid_end = min(column_grid_start + size, grid_count)
        correlations: list[list[float | None]] = []
        support_counts: list[list[int]] = []
        for row_grid in range(row_grid_start, row_grid_end):
            correlation_row = []
            support_row = []
            source_row = slice(row_grid * factor, min((row_grid + 1) * factor, count))
            for column_grid in range(column_grid_start, column_grid_end):
                source_column = slice(
                    column_grid * factor, min((column_grid + 1) * factor, count)
                )
                values = np.asarray(self.correlations[source_row, source_column])
                finite = values[np.isfinite(values)]
                correlation_row.append(float(finite.mean()) if finite.size else None)
                support_values = np.asarray(self.supports[source_row, source_column])
                support_row.append(
                    int(support_values.max()) if support_values.size else 0
                )
            correlations.append(correlation_row)
            support_counts.append(support_row)
        return {
            "level": level,
            "row": row,
            "column": column,
            "factor": factor,
            "aggregation": "exact" if factor == 1 else "mean",
            "row_start": row_grid_start,
            "column_start": column_grid_start,
            "correlations": correlations,
            "support_counts": support_counts,
        }

    def lookup_reference(self, comparison_id: str, *, limit: int) -> dict[str, Any]:
        if limit < 1 or limit > 100:
            raise ValueError("limit must be between 1 and 100")
        try:
            index = self.comparison_ids.index(comparison_id)
        except ValueError as error:
            raise ValueError(f"Unknown comparison: {comparison_id}") from error
        candidates = []
        for other_index, other_id in enumerate(self.comparison_ids):
            if other_index == index:
                continue
            cell = self.get_cell(index, other_index)
            if cell["correlation"] is not None:
                candidates.append(
                    {
                        "comparison_id": other_id,
                        "correlation": cell["correlation"],
                        "support_count": cell["support_count"],
                    }
                )
        candidates.sort(key=lambda item: item["correlation"], reverse=True)
        return {
            "comparison_id": comparison_id,
            "nearest": candidates[:limit],
            "least_correlated": list(reversed(candidates[-limit:])),
        }

    def get_spearman(self, left: str, right: str) -> dict[str, Any]:
        if left not in self.comparison_ids or right not in self.comparison_ids:
            raise ValueError("Unknown comparison")
        connection = duckdb.connect()
        try:
            rows = connection.execute(
                """
                SELECT left_result.log2_fold_change, right_result.log2_fold_change
                FROM read_parquet(?) AS left_result
                JOIN read_parquet(?) AS right_result
                  ON right_result.protein_accession = left_result.protein_accession
                 AND right_result.result_layer = left_result.result_layer
                WHERE left_result.comparison_id = ?
                  AND right_result.comparison_id = ?
                  AND left_result.result_layer = 'protein'
                  AND left_result.log2_fold_change IS NOT NULL
                  AND right_result.log2_fold_change IS NOT NULL
                """,
                [
                    str(self.results_dir / DIFFERENTIAL_ARTIFACT),
                    str(self.results_dir / DIFFERENTIAL_ARTIFACT),
                    left,
                    right,
                ],
            ).fetchall()
        finally:
            connection.close()
        support = len(rows)
        correlation = None
        if support >= int(self.metadata["min_support"]):
            value = spearmanr(
                [float(row[0]) for row in rows],
                [float(row[1]) for row in rows],
            ).statistic
            if math.isfinite(float(value)):
                correlation = float(value)
        return {
            "left_comparison": left,
            "right_comparison": right,
            "method": "spearman",
            "correlation": correlation,
            "support_count": support,
            "sufficient_support": support >= int(self.metadata["min_support"]),
        }

    def get_fold_change_detail(
        self,
        comparison_ids: list[str],
        *,
        protein_ids: list[str] | None = None,
        max_proteins: int = 500,
    ) -> dict[str, Any]:
        """Return a bounded exact log2-fold-change detail heatmap."""
        comparison_ids = list(dict.fromkeys(comparison_ids))
        if not comparison_ids or len(comparison_ids) > 50:
            raise ValueError("Detail heatmaps require between 1 and 50 comparisons")
        if any(comparison not in self.comparison_ids for comparison in comparison_ids):
            raise ValueError("Unknown comparison")
        if max_proteins < 1 or max_proteins > 500:
            raise ValueError("max_proteins must be between 1 and 500")
        selected_proteins = list(dict.fromkeys(protein_ids or []))
        if len(selected_proteins) > 500:
            raise ValueError("Detail heatmaps may include at most 500 proteins")

        comparison_placeholders = ", ".join("?" for _ in comparison_ids)
        connection = duckdb.connect()
        try:
            parameters: list[Any] = [
                str(self.results_dir / DIFFERENTIAL_ARTIFACT),
                *comparison_ids,
            ]
            protein_filter = ""
            if selected_proteins:
                protein_placeholders = ", ".join("?" for _ in selected_proteins)
                protein_filter = f"AND protein_accession IN ({protein_placeholders})"
                parameters.extend(selected_proteins)
            frame = connection.execute(
                f"""
                WITH scoped AS (
                    SELECT comparison_id, protein_accession,
                           first(gene_name) AS gene_name,
                           avg(log2_fold_change) AS log2_fold_change
                    FROM read_parquet(?)
                    WHERE result_layer = 'protein'
                      AND comparison_id IN ({comparison_placeholders})
                      {protein_filter}
                    GROUP BY comparison_id, protein_accession
                ),
                selected AS (
                    SELECT protein_accession
                    FROM scoped
                    GROUP BY protein_accession
                    ORDER BY max(abs(log2_fold_change)) DESC, protein_accession
                    LIMIT ?
                )
                SELECT scoped.comparison_id, scoped.protein_accession,
                       scoped.gene_name, scoped.log2_fold_change
                FROM scoped
                JOIN selected USING (protein_accession)
                """,
                [*parameters, max_proteins],
            ).fetchdf()
        finally:
            connection.close()

        if frame.empty:
            return {"proteins": [], "comparisons": comparison_ids, "fold_changes": []}
        maximums = (
            frame.assign(absolute=frame["log2_fold_change"].abs())
            .groupby("protein_accession")["absolute"]
            .max()
            .sort_values(ascending=False)
        )
        proteins = maximums.index.tolist()
        annotations = (
            frame.drop_duplicates("protein_accession")
            .set_index("protein_accession")["gene_name"]
            .to_dict()
        )
        lookup = {
            (str(row.protein_accession), str(row.comparison_id)): None
            if row.log2_fold_change is None
            or not math.isfinite(float(row.log2_fold_change))
            else float(row.log2_fold_change)
            for row in frame.itertuples(index=False)
        }
        return {
            "proteins": [
                {
                    "accession": protein,
                    "gene_name": None
                    if annotations.get(protein) is None
                    else str(annotations[protein]),
                }
                for protein in proteins
            ],
            "comparisons": comparison_ids,
            "fold_changes": [
                [lookup.get((protein, comparison)) for comparison in comparison_ids]
                for protein in proteins
            ],
        }
