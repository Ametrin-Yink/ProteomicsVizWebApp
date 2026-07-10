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

    def test_output_matches_pandas(self, tmp_path):
        """DuckDB streaming produces identical parquet to pandas path for same input."""
        file_paths, metadata = _make_test_files(tmp_path)
        output_duckdb = tmp_path / "PSM_Combined_duckdb.parquet"
        output_pandas = tmp_path / "PSM_Combined_pandas.parquet"

        processor = DataProcessor(
            ProcessingConfig(remove_razor=False, strict_filtering=False)
        )

        # DuckDB path
        processor.step1_2_duckdb_dia(
            file_paths=file_paths,
            metadata_columns=metadata,
            output_path=output_duckdb,
        )

        # Pandas path: replicate what DuckDB does (Steps 1-2 + filters)
        df_pd = processor.step1_combine_replicates_dia(file_paths, metadata)
        df_pd = processor.step2_generate_unique_psm(df_pd)
        df_pd["Contaminant"] = df_pd["Contaminant"].astype(str).str.lower()
        df_pd = df_pd[df_pd["Contaminant"] != "true"]
        if "Quan_Info" in df_pd.columns:
            df_pd = df_pd[df_pd["Quan_Info"] != "No Value"]
        df_pd["Abundance"] = pd.to_numeric(df_pd["Abundance"], errors="coerce")
        df_pd = df_pd[df_pd["Abundance"] >= 1]
        df_pd.to_parquet(
            output_pandas, engine="pyarrow", compression="zstd", index=False
        )

        df_dd = pd.read_parquet(output_duckdb)
        df_pd = pd.read_parquet(output_pandas)

        # Verify row counts match
        assert len(df_dd) == len(
            df_pd
        ), f"Row count mismatch: DuckDB={len(df_dd)} vs Pandas={len(df_pd)}"

        # Verify critical columns exist in DuckDB output
        critical_cols = {
            "Abundance",
            "Unique_PSM",
            "Condition",
            "Replicate",
            "Sample_Origination",
        }
        missing = critical_cols - set(df_dd.columns)
        assert not missing, f"DuckDB output missing critical columns: {missing}"

        # Verify metadata group columns are present
        sample_meta = next(iter(metadata.values()))
        reserved = {"experiment", "batch", "replicate"}
        group_cols = {k for k in sample_meta if k not in reserved}
        missing_group = group_cols - set(df_dd.columns)
        assert (
            not missing_group
        ), f"DuckDB output missing group columns: {missing_group}"

        # Verify ALL original CSV columns are preserved
        for fpath in file_paths:
            orig_cols = set(pd.read_csv(fpath, nrows=0, sep="\t").columns)
            missing_orig = orig_cols - set(df_dd.columns)
            if missing_orig:
                # DuckDB keeps original names with spaces instead of underscores,
                # so check that columns exist with either convention
                for col in list(missing_orig):
                    underscore_version = col.replace(" ", "_")
                    if underscore_version in df_dd.columns:
                        missing_orig.discard(col)
                if (
                    missing_orig
                    and "Quan Value" in missing_orig
                    and "Abundance" in df_dd.columns
                ):
                    missing_orig.discard("Quan Value")
            assert not missing_orig, f"DuckDB output missing original columns from {fpath.name}: {missing_orig}"

        # Verify DuckDB values for Abundance match pandas values row-by-row
        # Merge on (Unique_PSM, Condition) to align rows
        merged = df_dd.merge(
            df_pd,
            on=["Unique_PSM", "Condition"],
            how="inner",
            suffixes=("_dd", "_pd"),
        )
        assert len(merged) > 0, "Zero rows matched between DuckDB and pandas outputs"

        # Check Abundance values match
        abund_diff = (
            merged["Abundance_dd"].astype(float) - merged["Abundance_pd"].astype(float)
        ).abs()
        assert (
            abund_diff.max() < 0.01
        ), f"Abundance values differ: max diff={abund_diff.max()}"

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
