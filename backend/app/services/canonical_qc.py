"""Bounded QC summaries and PCA from canonical visualization artifacts."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
import pandas as pd
from sklearn.decomposition import PCA, IncrementalPCA

from app.services.data_processor import _sql_identifier
from app.services.visualization_artifacts import (
    PROTEIN_ARTIFACT,
    QC_GROUP_METRICS,
    QC_PCA,
    QC_SAMPLE_METRICS,
    SAMPLE_CATALOG,
    _atomic_write_json,
    load_visualization_artifact_manifest,
)

EXACT_PCA_ELEMENT_LIMIT = 5_000_000
PCA_SAMPLE_BATCH_SIZE = 1024
PCA_FEATURE_WRITE_BATCH = 32


def _reader_sql(path: Path) -> str:
    if path.suffix.lower() == ".parquet":
        return "read_parquet(?)"
    return "read_csv_auto(?, delim='\\t', header=true, nullstr=['NA', 'NaN'])"


def _psm_summary(
    connection: duckdb.DuckDBPyConnection, psm_path: Path | None
) -> tuple[int | None, float | None]:
    if psm_path is None or not psm_path.is_file():
        return None, None
    reader = _reader_sql(psm_path)
    columns = {
        str(row[0])
        for row in connection.execute(
            f"DESCRIBE SELECT * FROM {reader}", [str(psm_path)]
        ).fetchall()
    }
    if "Unique_PSM" not in columns:
        return None, None
    psm = _sql_identifier("Unique_PSM")
    total = connection.execute(
        f"SELECT count(DISTINCT {psm}) FROM {reader}", [str(psm_path)]
    ).fetchone()[0]
    if not {"Condition", "Replicate"}.issubset(columns):
        return int(total), None
    condition = _sql_identifier("Condition")
    replicate = _sql_identifier("Replicate")
    average = connection.execute(
        f"""
        SELECT avg(present_count)
        FROM (
            SELECT {condition}, {replicate}, count(DISTINCT {psm}) AS present_count
            FROM {reader}
            WHERE {psm} IS NOT NULL
            GROUP BY {condition}, {replicate}
        )
        """,
        [str(psm_path)],
    ).fetchone()[0]
    return int(total), round(float(average), 1) if average is not None else None


def _sample_ranges(sample_count: int) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    start = 0
    while start < sample_count:
        end = min(start + PCA_SAMPLE_BATCH_SIZE, sample_count)
        if sample_count - end == 1:
            end = sample_count
        ranges.append((start, end))
        start = end
    return ranges


def _zero_pca(samples: pd.DataFrame) -> tuple[pd.DataFrame, str, float, float]:
    return (
        pd.DataFrame(
            {
                "sample_id": samples["sample_id"],
                "pc1": np.zeros(len(samples)),
                "pc2": np.zeros(len(samples)),
                "condition": samples["condition"],
            }
        ),
        "unavailable",
        0.0,
        0.0,
    )


def _calculate_pca(
    connection: duckdb.DuckDBPyConnection, results_dir: Path
) -> tuple[pd.DataFrame, str, float, float]:
    samples = connection.execute(
        "SELECT sample_id, condition FROM read_parquet(?) ORDER BY sample_order",
        [str(results_dir / SAMPLE_CATALOG)],
    ).fetchdf()
    sample_count = len(samples)
    if sample_count < 2:
        return _zero_pca(samples)

    connection.execute(
        """
        CREATE OR REPLACE TEMP TABLE pca_features AS
        SELECT protein_accession,
               row_number() OVER (ORDER BY protein_accession) - 1 AS feature_order
        FROM (
            SELECT protein_accession
            FROM read_parquet(?)
            WHERE result_layer = 'protein'
            GROUP BY protein_accession
            HAVING count(*) = ?
               AND count(processed_log2_abundance) = ?
        )
        """,
        [str(results_dir / PROTEIN_ARTIFACT), sample_count, sample_count],
    )
    feature_count = int(
        connection.execute("SELECT count(*) FROM pca_features").fetchone()[0]
    )
    if feature_count < 2:
        return _zero_pca(samples)

    matrix_bytes = sample_count * feature_count * np.dtype("float64").itemsize
    if shutil.disk_usage(results_dir).free < matrix_bytes + 64 * 1024 * 1024:
        raise ValueError(
            "Insufficient free space for bounded QC PCA workspace: "
            f"{matrix_bytes:,} bytes required"
        )

    workspace = results_dir / f".qc_pca_matrix.{uuid.uuid4().hex}.dat"
    matrix: np.memmap | None = None
    try:
        matrix = np.memmap(
            workspace,
            dtype="float64",
            mode="w+",
            shape=(feature_count, sample_count),
        )
        cursor = connection.execute(
            """
            SELECT protein.processed_log2_abundance
            FROM read_parquet(?) AS protein
            JOIN pca_features AS feature USING (protein_accession)
            WHERE protein.result_layer = 'protein'
            ORDER BY feature.feature_order, protein.sample_order
            """,
            [str(results_dir / PROTEIN_ARTIFACT)],
        )
        reader = cursor.to_arrow_reader(
            max(sample_count, sample_count * PCA_FEATURE_WRITE_BATCH)
        )
        pending = np.empty(0, dtype="float64")
        feature_offset = 0
        for record_batch in reader:
            values = np.asarray(
                record_batch.column(0).to_numpy(zero_copy_only=False),
                dtype="float64",
            )
            if pending.size:
                values = np.concatenate((pending, values))
            complete_rows = values.size // sample_count
            if complete_rows:
                end = feature_offset + complete_rows
                matrix[feature_offset:end, :] = values[
                    : complete_rows * sample_count
                ].reshape(complete_rows, sample_count)
                feature_offset = end
            pending = values[complete_rows * sample_count :]
        if pending.size or feature_offset != feature_count:
            raise ValueError("Canonical protein abundance matrix is incomplete")
        matrix.flush()

        element_count = sample_count * feature_count
        if element_count <= EXACT_PCA_ELEMENT_LIMIT:
            sample_matrix = np.asarray(matrix).T.copy()
            means = sample_matrix.mean(axis=0)
            scales = sample_matrix.std(axis=0)
            scales[scales == 0] = 1.0
            scaled = (sample_matrix - means) / scales
            model = PCA(n_components=2)
            coordinates = model.fit_transform(scaled)
            method = "exact"
        else:
            means = np.empty(feature_count, dtype="float64")
            scales = np.empty(feature_count, dtype="float64")
            for start in range(0, feature_count, PCA_FEATURE_WRITE_BATCH):
                end = min(start + PCA_FEATURE_WRITE_BATCH, feature_count)
                feature_block = np.asarray(matrix[start:end, :]).copy()
                means[start:end] = feature_block.mean(axis=1)
                scales[start:end] = feature_block.std(axis=1)
            scales[scales == 0] = 1.0
            model = IncrementalPCA(
                n_components=2,
                batch_size=PCA_SAMPLE_BATCH_SIZE,
            )
            ranges = _sample_ranges(sample_count)
            for start, end in ranges:
                block = (np.asarray(matrix[:, start:end]).T.copy() - means) / scales
                model.partial_fit(block)
            coordinates = np.empty((sample_count, 2), dtype="float64")
            for start, end in ranges:
                block = (np.asarray(matrix[:, start:end]).T.copy() - means) / scales
                coordinates[start:end, :] = model.transform(block)
            method = "incremental"

        variance = model.explained_variance_ratio_ * 100
        return (
            pd.DataFrame(
                {
                    "sample_id": samples["sample_id"],
                    "pc1": coordinates[:, 0],
                    "pc2": coordinates[:, 1],
                    "condition": samples["condition"],
                }
            ),
            method,
            float(variance[0]),
            float(variance[1]),
        )
    finally:
        if matrix is not None:
            matrix.flush()
            matrix._mmap.close()
            del matrix
        workspace.unlink(missing_ok=True)


def generate_canonical_qc(
    results_dir: Path, psm_path: Path | None = None
) -> dict[str, Any]:
    """Generate compact QC JSON and PCA coordinates from canonical Parquet."""
    results_dir = results_dir.resolve()
    if load_visualization_artifact_manifest(results_dir) is None:
        raise ValueError("Visualization artifacts require reprocessing")

    connection = duckdb.connect()
    try:
        pca, pca_method, pc1_variance, pc2_variance = _calculate_pca(
            connection, results_dir
        )
        pca.to_parquet(results_dir / QC_PCA, index=False)
        protein_summary = connection.execute(
            """
            SELECT count(DISTINCT protein_accession)
            FROM read_parquet(?)
            WHERE result_layer = 'protein'
            """,
            [str(results_dir / PROTEIN_ARTIFACT)],
        ).fetchone()
        sample_summary = connection.execute(
            """
            SELECT avg(present_count), sum(present_count), sum(total_feature_count)
            FROM read_parquet(?)
            """,
            [str(results_dir / QC_SAMPLE_METRICS)],
        ).fetchone()
        cv_summary = connection.execute(
            """
            SELECT avg(protein_cv_median), avg(peptide_cv_median)
            FROM read_parquet(?)
            WHERE group_by = 'condition'
            """,
            [str(results_dir / QC_GROUP_METRICS)],
        ).fetchone()
        total_psms, avg_psms_per_sample = _psm_summary(connection, psm_path)
    finally:
        connection.close()

    present = int(sample_summary[1] or 0)
    total = int(sample_summary[2] or 0)
    protein_cv = round(float(cv_summary[0]), 1) if cv_summary[0] is not None else None
    peptide_cv = round(float(cv_summary[1]), 1) if cv_summary[1] is not None else None
    summary: dict[str, Any] = {
        "schema_version": 1,
        "pca_method": pca_method,
        "pc1_variance": pc1_variance,
        "pc2_variance": pc2_variance,
        "total_psms": total_psms,
        "avg_psms_per_sample": avg_psms_per_sample,
        "total_proteins": int(protein_summary[0] or 0),
        "avg_proteins_per_sample": int(sample_summary[0] or 0),
        "average_cv": protein_cv,
        "average_protein_cv": protein_cv,
        "average_psm_cv": peptide_cv,
        "completeness_rate": round(present / total * 100, 1) if total else None,
    }
    _atomic_write_json(results_dir / "QC_Results.json", summary)
    return summary
