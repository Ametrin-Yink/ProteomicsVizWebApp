"""Unit tests for DuckDB streaming DIA ingestion (Phase 1)."""

import logging
from pathlib import Path

import pandas as pd
import pytest
from app.services.data_processor import DataProcessor, ProcessingConfig

logging.basicConfig(level=logging.INFO)

duckdb = pytest.importorskip("duckdb")


def _make_test_files(tmp_path: Path, n_files: int = 3) -> tuple[list[Path], dict]:
    """Create test DIA CSV files and metadata matching the real DIA format."""
    file_paths = []
    metadata = {}
    for i in range(n_files):
        fname = f"test_sample_{i:02d}.txt"
        fpath = tmp_path / fname
        df = pd.DataFrame(
            {
                "Sequence": [f"PEPTIDE{j}" for j in range(10)],
                "Modifications": ["" for _ in range(10)],
                "Charge": [2 for _ in range(10)],
                "Contaminant": ["False" for _ in range(10)],
                "Master Protein Accessions": [f"P{i:05d}" for _ in range(10)],
                "Quan Info": ["Full" for _ in range(10)],
                "Quan Value": [1000.0 + j * 100 for j in range(10)],
                "Some Column With Spaces": [f"val{j}" for j in range(10)],
            }
        )
        df.to_csv(fpath, sep="\t", index=False)
        file_paths.append(fpath)
        metadata[fname] = {
            "experiment": "EXP001",
            "drug": f"Drug{i % 3}",
            "replicate": str((i % 3) + 1),
            "batch": "B1",
        }
    return file_paths, metadata


class TestDuckDBStreaming:
    """Tests for step1_2_duckdb_dia — streaming Steps 1-2 DIA ingestion."""

    def test_single_file(self, tmp_path):
        """DuckDB streaming works with a single DIA file."""
        file_paths, metadata = _make_test_files(tmp_path, n_files=1)
        output_path = tmp_path / "PSM_Combined.parquet"

        processor = DataProcessor(
            ProcessingConfig(remove_razor=False, strict_filtering=False)
        )
        processor.step1_2_duckdb_dia(
            file_paths=file_paths,
            metadata_columns=metadata,
            output_path=output_path,
        )

        assert output_path.exists(), "Output parquet not created"
        df = pd.read_parquet(output_path)
        assert len(df) > 0, "Output parquet is empty"
        assert "Abundance" in df.columns, "Abundance column missing"
        assert "Condition" in df.columns, "Condition column missing"
        assert "Unique_PSM" in df.columns, "Unique_PSM column missing"

    def test_contaminant_filter(self, tmp_path):
        """DuckDB correctly filters contaminant=True rows."""
        fpath = tmp_path / "test_contam.txt"
        df = pd.DataFrame(
            {
                "Sequence": [f"P{j}" for j in range(10)],
                "Modifications": ["" for _ in range(10)],
                "Charge": [2 for _ in range(10)],
                "Contaminant": ["True" if j % 2 == 0 else "False" for j in range(10)],
                "Master Protein Accessions": ["P001" for _ in range(10)],
                "Quan Info": ["Full" for _ in range(10)],
                "Quan Value": [1000.0 for _ in range(10)],
            }
        )
        df.to_csv(fpath, sep="\t", index=False)
        metadata = {"test_contam.txt": {"drug": "DMSO", "replicate": "1"}}
        output_path = tmp_path / "PSM_Combined.parquet"

        processor = DataProcessor(
            ProcessingConfig(remove_razor=False, strict_filtering=False)
        )
        processor.step1_2_duckdb_dia(
            file_paths=[fpath],
            metadata_columns=metadata,
            output_path=output_path,
        )

        result = pd.read_parquet(output_path)
        assert (
            len(result) == 5
        ), f"Expected 5 rows after contam filter, got {len(result)}"

    def test_low_abundance_filter(self, tmp_path):
        """DuckDB correctly filters Abundance < 1 rows."""
        fpath = tmp_path / "test_abund.txt"
        df = pd.DataFrame(
            {
                "Sequence": [f"P{j}" for j in range(10)],
                "Modifications": ["" for _ in range(10)],
                "Charge": [2 for _ in range(10)],
                "Contaminant": ["False" for _ in range(10)],
                "Master Protein Accessions": ["P001" for _ in range(10)],
                "Quan Info": ["Full" for _ in range(10)],
                "Quan Value": [0.5 if j < 3 else 1000.0 for j in range(10)],
            }
        )
        df.to_csv(fpath, sep="\t", index=False)
        metadata = {"test_abund.txt": {"drug": "DMSO", "replicate": "1"}}
        output_path = tmp_path / "PSM_Combined.parquet"

        processor = DataProcessor(
            ProcessingConfig(remove_razor=False, strict_filtering=False)
        )
        processor.step1_2_duckdb_dia(
            file_paths=[fpath],
            metadata_columns=metadata,
            output_path=output_path,
        )

        result = pd.read_parquet(output_path)
        assert (
            len(result) == 7
        ), f"Expected 7 rows after abundance filter, got {len(result)}"
        assert result["Abundance"].min() >= 1, "Found Abundance < 1"

    def test_dual_column_edge_case(self, tmp_path):
        """DuckDB handles files with both 'Quan Value' and 'Abundance' columns."""
        fpath = tmp_path / "test_dual.txt"
        df = pd.DataFrame(
            {
                "Sequence": [f"P{j}" for j in range(5)],
                "Modifications": ["" for _ in range(5)],
                "Charge": [2 for _ in range(5)],
                "Contaminant": ["False" for _ in range(5)],
                "Master Protein Accessions": ["P001" for _ in range(5)],
                "Quan Info": ["Full" for _ in range(5)],
                "Quan Value": [500.0 for _ in range(5)],
                "Abundance": [1000.0 for _ in range(5)],
            }
        )
        df.to_csv(fpath, sep="\t", index=False)
        metadata = {"test_dual.txt": {"drug": "DMSO", "replicate": "1"}}
        output_path = tmp_path / "PSM_Combined.parquet"

        processor = DataProcessor(
            ProcessingConfig(remove_razor=False, strict_filtering=False)
        )
        processor.step1_2_duckdb_dia(
            file_paths=[fpath],
            metadata_columns=metadata,
            output_path=output_path,
        )

        result = pd.read_parquet(output_path)
        # COALESCE("Quan Value", Abundance) should prefer "Quan Value"
        assert (
            result["Abundance"].iloc[0] == 500.0
        ), f"Expected COALESCE to prefer Quan Value (500), got {result['Abundance'].iloc[0]}"
