"""Tests for DuckDB Step 4: Remove Low Quality PSMs.

Spec ref: Section 5.1 — single COPY query with WHERE filters.
Edge cases: Quan_Info column optional (DIA files lack it),
column names use underscores (spaces already replaced by DuckDB streaming).
"""
import tempfile
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq
import pytest
from app.services.data_processor import DataProcessor, ProcessingConfig

duckdb = pytest.importorskip("duckdb")


def _write_test_parquet(path: Path, rows: list[dict]) -> None:
    """Write a test parquet file from a list of row dicts."""
    df = pd.DataFrame(rows)
    df.to_parquet(path, engine="pyarrow", compression="zstd", index=False)


class TestStep4DuckDB:
    """Tests for step4_remove_low_quality_duckdb()."""

    def test_removes_contaminants(self):
        """PSMs with Contaminant='true' are removed."""
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            _write_test_parquet(input_path, [
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "true", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Abundance": 1000.0, "Condition": "A", "Replicate": 1},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P2",
                 "Quan_Info": "Valid", "Abundance": 2000.0, "Condition": "A", "Replicate": 1},
            ])

            processor = DataProcessor(ProcessingConfig())
            processor.step4_remove_low_quality_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            assert len(result) == 1
            assert result["Sequence"].iloc[0] == "PEP2"

    def test_removes_no_value_quan_info(self):
        """PSMs with Quan_Info='No Value' are removed."""
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            _write_test_parquet(input_path, [
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "No Value", "Abundance": 1000.0, "Condition": "A", "Replicate": 1},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P2",
                 "Quan_Info": "Valid", "Abundance": 2000.0, "Condition": "A", "Replicate": 1},
            ])

            processor = DataProcessor(ProcessingConfig())
            processor.step4_remove_low_quality_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            assert len(result) == 1
            assert result["Sequence"].iloc[0] == "PEP2"

    def test_removes_low_abundance(self):
        """PSMs with Abundance < 1 are removed."""
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            _write_test_parquet(input_path, [
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Abundance": 0.5, "Condition": "A", "Replicate": 1},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P2",
                 "Quan_Info": "Valid", "Abundance": 2000.0, "Condition": "A", "Replicate": 1},
            ])

            processor = DataProcessor(ProcessingConfig())
            processor.step4_remove_low_quality_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            assert len(result) == 1
            assert result["Sequence"].iloc[0] == "PEP2"

    def test_dia_without_quan_info(self):
        """DIA files without Quan_Info column — filter clause omitted, no error.

        Spec edge case 8.1: DIA files lack Quan_Info column.
        Method checks schema before building SQL WHERE clause.
        """
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            df = pd.DataFrame({
                "Sequence": ["PEP1", "PEP2"],
                "Modifications": ["", ""],
                "Charge": [2, 2],
                "Contaminant": ["false", "true"],
                "Master_Protein_Accessions": ["P1", "P2"],
                "Abundance": [1000.0, 2000.0],
                "Condition": ["A", "A"],
                "Replicate": [1, 1],
            })
            df.to_parquet(input_path, engine="pyarrow", compression="zstd", index=False)

            processor = DataProcessor(ProcessingConfig())
            processor.step4_remove_low_quality_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            assert len(result) == 1  # contaminant removed, no Quan_Info filter applied
            assert result["Sequence"].iloc[0] == "PEP1"

    def test_output_row_count_preserved(self):
        """All rows pass — output has same count as input."""
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            _write_test_parquet(input_path, [
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Abundance": 100.0, "Condition": "A", "Replicate": 1},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P2",
                 "Quan_Info": "Valid", "Abundance": 200.0, "Condition": "A", "Replicate": 1},
            ])

            processor = DataProcessor(ProcessingConfig())
            processor.step4_remove_low_quality_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            assert len(result) == 2
            assert output_path.exists()

    def test_output_parquet_has_row_groups(self):
        """Output parquet uses 100K row group size from COPY statement."""
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            _write_test_parquet(input_path, [
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Abundance": 100.0, "Condition": "A", "Replicate": 1},
            ])

            processor = DataProcessor(ProcessingConfig())
            processor.step4_remove_low_quality_duckdb(input_path, output_path)

            metadata = pq.read_metadata(output_path)
            assert metadata.num_rows == 1
            assert metadata.num_row_groups >= 1
