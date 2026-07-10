"""Tests for DuckDB Step 3: Remove Razor Peptides.

Spec ref: Section 5.2 — two-phase approach.
Phase 1 (DuckDB): build protein->peptide counts + PSM->protein maps.
Python: compute best_protein via _select_best_protein() (FASTA tie-breaking).
Phase 2 (DuckDB): apply mapping via JOIN + COPY TO.

Edge cases: razor disabled (file copy), single-protein PSMs (unchanged),
protein selection by peptide count, FASTA length tie-breaking.
"""

import tempfile
from pathlib import Path

import pandas as pd
import pytest
from app.services.data_processor import DataProcessor, ProcessingConfig

duckdb = pytest.importorskip("duckdb")


def _write_test_parquet(path: Path, rows: list[dict]) -> None:
    df = pd.DataFrame(rows)
    df.to_parquet(path, engine="pyarrow", compression="zstd", index=False)


class TestStep3DuckDB:
    """Tests for step3_remove_razor_duckdb()."""

    def test_razor_disabled_copies_file(self):
        """When remove_razor=False, output is identical to input.

        Spec: 'When config.remove_razor is False: Copy the input file unchanged.'
        """
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            _write_test_parquet(
                input_path,
                [
                    {
                        "Sequence": "PEP1",
                        "Modifications": "",
                        "Charge": 2,
                        "Contaminant": "false",
                        "Master_Protein_Accessions": "P1; P2",
                        "Unique_PSM": "PEP1||2",
                        "Condition": "A",
                        "Replicate": 1,
                        "Abundance": 100.0,
                    },
                ],
            )

            processor = DataProcessor(ProcessingConfig(remove_razor=False))
            processor.step3_remove_razor_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            assert len(result) == 1
            assert result["Master_Protein_Accessions"].iloc[0] == "P1; P2"

    def test_razor_enabled_selects_best_protein(self):
        """Ambiguous PSMs resolve to protein with highest peptide count.

        P1 appears in 3 PSMs, P2 in 1 PSM. PEP1||2 matches both -> P1 selected.
        """
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            _write_test_parquet(
                input_path,
                [
                    {
                        "Sequence": "PEP1",
                        "Modifications": "",
                        "Charge": 2,
                        "Contaminant": "false",
                        "Master_Protein_Accessions": "P1; P2",
                        "Unique_PSM": "PEP1||2",
                        "Condition": "A",
                        "Replicate": 1,
                        "Abundance": 100.0,
                    },
                    {
                        "Sequence": "PEP2",
                        "Modifications": "",
                        "Charge": 2,
                        "Contaminant": "false",
                        "Master_Protein_Accessions": "P1",
                        "Unique_PSM": "PEP2||2",
                        "Condition": "A",
                        "Replicate": 1,
                        "Abundance": 200.0,
                    },
                    {
                        "Sequence": "PEP3",
                        "Modifications": "",
                        "Charge": 2,
                        "Contaminant": "false",
                        "Master_Protein_Accessions": "P1",
                        "Unique_PSM": "PEP3||2",
                        "Condition": "A",
                        "Replicate": 1,
                        "Abundance": 300.0,
                    },
                    {
                        "Sequence": "PEP4",
                        "Modifications": "",
                        "Charge": 2,
                        "Contaminant": "false",
                        "Master_Protein_Accessions": "P2",
                        "Unique_PSM": "PEP4||2",
                        "Condition": "A",
                        "Replicate": 1,
                        "Abundance": 400.0,
                    },
                ],
            )

            processor = DataProcessor(ProcessingConfig(remove_razor=True))
            processor.step3_remove_razor_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            for _, row in result.iterrows():
                assert ";" not in str(row["Master_Protein_Accessions"]), (
                    f"Razor not resolved for {row['Unique_PSM']}"
                )

    def test_single_protein_unchanged(self):
        """PSMs with single-protein mappings are not modified."""
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            _write_test_parquet(
                input_path,
                [
                    {
                        "Sequence": "PEP1",
                        "Modifications": "",
                        "Charge": 2,
                        "Contaminant": "false",
                        "Master_Protein_Accessions": "P12345",
                        "Unique_PSM": "PEP1||2",
                        "Condition": "A",
                        "Replicate": 1,
                        "Abundance": 100.0,
                    },
                ],
            )

            processor = DataProcessor(ProcessingConfig(remove_razor=True))
            processor.step3_remove_razor_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            assert result["Master_Protein_Accessions"].iloc[0] == "P12345"

    def test_output_has_all_columns(self):
        """Output parquet preserves column schema.

        Master_Protein_Accessions may change but all other columns preserved.
        """
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            _write_test_parquet(
                input_path,
                [
                    {
                        "Sequence": "PEP1",
                        "Modifications": "",
                        "Charge": 2,
                        "Contaminant": "false",
                        "Master_Protein_Accessions": "P1; P2",
                        "Unique_PSM": "PEP1||2",
                        "Quan_Info": "Valid",
                        "Condition": "A",
                        "Replicate": 1,
                        "Abundance": 100.0,
                    },
                ],
            )

            processor = DataProcessor(ProcessingConfig(remove_razor=True))
            processor.step3_remove_razor_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            expected_cols = {
                "Sequence",
                "Modifications",
                "Charge",
                "Contaminant",
                "Master_Protein_Accessions",
                "Unique_PSM",
                "Quan_Info",
                "Condition",
                "Replicate",
                "Abundance",
            }
            assert expected_cols.issubset(set(result.columns)), (
                f"Missing columns: {expected_cols - set(result.columns)}"
            )
