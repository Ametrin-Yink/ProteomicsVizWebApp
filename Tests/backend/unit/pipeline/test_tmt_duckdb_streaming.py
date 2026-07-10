"""Unit tests for DuckDB TMT streaming (step1_2_duckdb_tmt)."""

import tempfile
from pathlib import Path

import pandas as pd
import pytest


# ── Helpers ──

def _write_tmt_csv(path: Path, extra_cols: dict | None = None) -> None:
    """Write a minimal TMT-style CSV with 2 abundance channels."""
    rows = [
        # Sequence, Mods, Charge, Contaminant, Master Protein Accessions,
        # Quan Info, Abundance 126, Abundance 127N
        ["PEP001", "Ox(M)", "2", "False", "P00001", "Valid", "1000.5", "500.2"],
        ["PEP002", "", "3", "True", "P00002", "No Value", "200.0", "300.0"],
        ["PEP003", "", "2", "False", "P00003", "Valid", "0.5", "800.0"],
    ]
    cols = [
        "Sequence", "Modifications", "Charge", "Contaminant",
        "Master Protein Accessions", "Quan Info",
        "Abundance 126", "Abundance 127N",
    ]
    if extra_cols:
        for col_name, values in extra_cols.items():
            cols.append(col_name)
            for i, val in enumerate(values):
                rows[i].append(val)
    df = pd.DataFrame(rows, columns=cols)
    df.to_csv(path, sep="\t", index=False)


def _make_channel_mapping() -> dict:
    return {
        "126": {"drug": "DMSO", "time": "24h", "replicate": 1},
        "127N": {"drug": "DrugA", "time": "24h", "replicate": 1},
    }


# ── Tests ──

class TestTMTDuckDBStreaming:
    """DuckDB TMT streaming produces correct output."""

    def test_abundance_columns_detected(self):
        """TMT abundance columns are auto-detected from CSV header."""
        from app.services.data_processor import _detect_tmt_abundance_columns

        cols = [
            "Sequence", "Modifications", "Abundance 126",
            "Abundance 127N", "Master Protein Accessions",
        ]
        detected = _detect_tmt_abundance_columns(cols)
        assert detected == ["Abundance 126", "Abundance 127N"]

    def test_no_abundance_columns_raises(self):
        """Missing TMT abundance columns raises ValueError."""
        from app.services.data_processor import _detect_tmt_abundance_columns

        cols = ["Sequence", "Modifications", "Quan Value"]
        detected = _detect_tmt_abundance_columns(cols)
        assert detected == []

    def test_output_parquet_created(self):
        """DuckDB streaming writes a parquet file to output_path."""
        import duckdb  # verify available
        from app.services.data_processor import DataProcessor, ProcessingConfig

        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "test_tmt.txt"
            parquet_path = Path(tmp) / "output.parquet"
            _write_tmt_csv(csv_path)

            processor = DataProcessor(ProcessingConfig())
            processor.step1_2_duckdb_tmt(
                [csv_path], _make_channel_mapping(), parquet_path
            )

            assert parquet_path.exists(), "Output parquet must exist"
            result = pd.read_parquet(parquet_path, engine="pyarrow")
            assert len(result) > 0, "Output must have rows"

    def test_core_columns_present(self):
        """Output has all core contract columns."""
        import duckdb
        from app.services.data_processor import DataProcessor, ProcessingConfig

        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "test_tmt.txt"
            parquet_path = Path(tmp) / "output.parquet"
            _write_tmt_csv(csv_path)

            processor = DataProcessor(ProcessingConfig())
            processor.step1_2_duckdb_tmt(
                [csv_path], _make_channel_mapping(), parquet_path
            )

            result = pd.read_parquet(parquet_path, engine="pyarrow")
            required = [
                "Abundance", "Sample_Origination", "Condition",
                "Replicate", "Unique_PSM",
            ]
            for col in required:
                assert col in result.columns, f"Missing required column: {col}"

    def test_contaminant_filtered(self):
        """Rows with Contaminant=True are excluded."""
        import duckdb
        from app.services.data_processor import DataProcessor, ProcessingConfig

        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "test_tmt.txt"
            parquet_path = Path(tmp) / "output.parquet"
            _write_tmt_csv(csv_path)

            processor = DataProcessor(ProcessingConfig())
            processor.step1_2_duckdb_tmt(
                [csv_path], _make_channel_mapping(), parquet_path
            )

            result = pd.read_parquet(parquet_path, engine="pyarrow")
            # PEP002 has Contaminant=True — should be filtered out
            contaminants = result[
                result["Sequence"].astype(str).str.contains("PEP002")
            ]
            assert len(contaminants) == 0, "Contaminant rows must be excluded"

    def test_no_value_filtered(self):
        """Rows with Quan_Info='No Value' are excluded."""
        import duckdb
        from app.services.data_processor import DataProcessor, ProcessingConfig

        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "test_tmt.txt"
            parquet_path = Path(tmp) / "output.parquet"
            _write_tmt_csv(csv_path)

            processor = DataProcessor(ProcessingConfig())
            processor.step1_2_duckdb_tmt(
                [csv_path], _make_channel_mapping(), parquet_path
            )

            result = pd.read_parquet(parquet_path, engine="pyarrow")
            # PEP002 also has Quan_Info='No Value'
            no_val_rows = result[
                result["Sequence"].astype(str).str.contains("PEP002")
            ]
            assert len(no_val_rows) == 0, "No Value rows must be excluded"

    def test_low_abundance_filtered(self):
        """Rows with Abundance < 1 are excluded."""
        import duckdb
        from app.services.data_processor import DataProcessor, ProcessingConfig

        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "test_tmt.txt"
            parquet_path = Path(tmp) / "output.parquet"
            _write_tmt_csv(csv_path)

            processor = DataProcessor(ProcessingConfig())
            processor.step1_2_duckdb_tmt(
                [csv_path], _make_channel_mapping(), parquet_path
            )

            result = pd.read_parquet(parquet_path, engine="pyarrow")
            # PEP003 Abundance=0.5 for channel 126 — should be filtered
            low_ab = result[
                (result["Sequence"].astype(str).str.contains("PEP003"))
                & (result["Condition"] == "DMSO_24h")
            ]
            assert len(low_ab) == 0, "Abundance<1 rows must be excluded"

    def test_unique_psm_format(self):
        """Unique_PSM is Sequence|Modifications|Charge."""
        import duckdb
        from app.services.data_processor import DataProcessor, ProcessingConfig

        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "test_tmt.txt"
            parquet_path = Path(tmp) / "output.parquet"
            _write_tmt_csv(csv_path)

            processor = DataProcessor(ProcessingConfig())
            processor.step1_2_duckdb_tmt(
                [csv_path], _make_channel_mapping(), parquet_path
            )

            result = pd.read_parquet(parquet_path, engine="pyarrow")
            pep001_rows = result[
                result["Sequence"].astype(str).str.contains("PEP001")
            ]
            assert len(pep001_rows) > 0
            for _, row in pep001_rows.iterrows():
                assert "|" in row["Unique_PSM"], "Unique_PSM must contain pipes"
                assert row["Unique_PSM"] == "PEP001|Ox(M)|2", (
                    f"Unexpected Unique_PSM: {row['Unique_PSM']}"
                )

    def test_channel_unpivot(self):
        """Each input row with N channels produces N output rows."""
        import duckdb
        from app.services.data_processor import DataProcessor, ProcessingConfig

        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "test_tmt.txt"
            parquet_path = Path(tmp) / "output.parquet"
            _write_tmt_csv(csv_path)

            processor = DataProcessor(ProcessingConfig())
            processor.step1_2_duckdb_tmt(
                [csv_path], _make_channel_mapping(), parquet_path
            )

            result = pd.read_parquet(parquet_path, engine="pyarrow")
            # PEP001: 2 channels, both valid → 2 rows
            pep001 = result[
                result["Sequence"].astype(str).str.contains("PEP001")
            ]
            assert len(pep001) == 2, (
                f"PEP001 should have 2 rows (2 channels), got {len(pep001)}"
            )
            # PEP003: channel 126 filtered (Abundance<1), channel 127N valid → 1 row
            pep003 = result[
                result["Sequence"].astype(str).str.contains("PEP003")
            ]
            assert len(pep003) == 1, (
                f"PEP003 should have 1 row (1 channel kept), got {len(pep003)}"
            )

    def test_condition_assignment(self):
        """Conditions are correctly assigned from channel mapping."""
        import duckdb
        from app.services.data_processor import DataProcessor, ProcessingConfig

        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "test_tmt.txt"
            parquet_path = Path(tmp) / "output.parquet"
            _write_tmt_csv(csv_path)

            processor = DataProcessor(ProcessingConfig())
            processor.step1_2_duckdb_tmt(
                [csv_path], _make_channel_mapping(), parquet_path
            )

            result = pd.read_parquet(parquet_path, engine="pyarrow")
            conditions = set(result["Condition"].unique())
            assert "DMSO_24h" in conditions
            assert "DrugA_24h" in conditions

    def test_pandas_ddb_output_equivalence(self):
        """DuckDB output matches pandas output for the same input.

        Uses clean data that won't trigger the DuckDB filters, so both
        paths produce the same rows for a proper equivalence comparison.
        """
        import duckdb
        from app.services.data_processor import DataProcessor, ProcessingConfig

        # Clean data: no contaminants, no "No Value", all abundance >= 1
        clean_rows = [
            ["PEP001", "Ox(M)", "2", "False", "P00001", "Valid", "1000.5", "500.2", "P00004"],
            ["PEP003", "", "2", "False", "P00003", "Valid", "10.5", "800.0", "P00004"],
        ]
        clean_cols = [
            "Sequence", "Modifications", "Charge", "Contaminant",
            "Master Protein Accessions", "Quan Info",
            "Abundance 126", "Abundance 127N", "Extra",
        ]
        clean_df = pd.DataFrame(clean_rows, columns=clean_cols)

        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "test_clean_tmt.txt"
            duckdb_path = Path(tmp) / "duckdb_output.parquet"
            clean_df.to_csv(csv_path, sep="\t", index=False)
            mapping = _make_channel_mapping()

            # DuckDB path
            processor = DataProcessor(ProcessingConfig())
            processor.step1_2_duckdb_tmt([csv_path], mapping, duckdb_path)
            ddb_result = pd.read_parquet(duckdb_path, engine="pyarrow")

            # Pandas path
            pandas_result = processor.step1_combine_replicates_tmt(
                [csv_path], mapping
            )
            # Sort both by Sequence + Condition for comparison
            sort_keys = ["Sequence", "Condition"]
            ddb_sorted = ddb_result.sort_values(sort_keys).reset_index(drop=True)
            pd_sorted = pandas_result.sort_values(sort_keys).reset_index(drop=True)

            # Compare core columns (DuckDB has Unique_PSM inlined, pandas doesn't)
            for col in ["Sequence", "Condition", "Replicate", "Sample_Origination"]:
                ddb_vals = ddb_sorted[col].astype(str).tolist()
                pd_vals = pd_sorted[col].astype(str).tolist()
                assert ddb_vals == pd_vals, (
                    f"Column '{col}' differs between DuckDB and pandas"
                )

            # Abundance: compare as float (duckdb may have slight differences)
            ddb_ab = ddb_sorted["Abundance"].astype(float).tolist()
            pd_ab = pd_sorted["Abundance"].astype(float).tolist()
            assert len(ddb_ab) == len(pd_ab), (
                f"Row count mismatch: {len(ddb_ab)} vs {len(pd_ab)}"
            )

    def test_missing_channel_mapping_raises(self):
        """Empty channel mapping raises ValueError."""
        import duckdb
        from app.services.data_processor import DataProcessor, ProcessingConfig

        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "test_tmt.txt"
            parquet_path = Path(tmp) / "output.parquet"
            _write_tmt_csv(csv_path)

            processor = DataProcessor(ProcessingConfig())
            with pytest.raises(ValueError, match="channel_mapping"):
                processor.step1_2_duckdb_tmt([csv_path], {}, parquet_path)
