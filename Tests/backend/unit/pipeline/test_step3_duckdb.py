"""Tests for DuckDB Step 2: Resolve Shared Peptides.

Spec ref: Section 5.2 — two-phase approach.
Phase 1 (DuckDB): build protein->peptide counts + PSM->protein maps.
Python: compute best protein from distinct PSM support and accession order.
Phase 2 (DuckDB): apply mapping via JOIN + COPY TO.

Edge cases: resolution disabled, single-protein PSMs, distinct PSM support,
and original-accession-order tie-breaking.
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


class TestResolveSharedPeptidesDuckDB:
    """Tests for step2_resolve_shared_peptides_duckdb()."""

    def test_resolution_disabled_preserves_protein_group(self):
        """Disabled resolution keeps the original protein group unchanged."""
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

            processor = DataProcessor(ProcessingConfig(resolve_shared_peptides=False))
            wrote_output = processor.step2_resolve_shared_peptides_duckdb(
                input_path, output_path
            )

            assert wrote_output is False
            assert not output_path.exists()
            result = pd.read_parquet(input_path, engine="pyarrow")
            assert len(result) == 1
            assert result["Master_Protein_Accessions"].iloc[0] == "P1; P2"

    def test_resolution_enabled_selects_best_protein(self):
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

            processor = DataProcessor(ProcessingConfig(resolve_shared_peptides=True))
            processor.step2_resolve_shared_peptides_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            for _, row in result.iterrows():
                assert ";" not in str(
                    row["Master_Protein_Accessions"]
                ), f"Razor not resolved for {row['Unique_PSM']}"

    def test_support_counts_distinct_psms_not_expanded_rows(self):
        """Repeated condition/channel rows cannot inflate protein support."""
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            rows = [
                {
                    "Master_Protein_Accessions": "P1; P2",
                    "Unique_PSM": "SHARED||2",
                    "Condition": condition,
                    "Abundance": 100.0,
                }
                for condition in ["A", "B", "C"]
            ]
            rows.extend(
                {
                    "Master_Protein_Accessions": "P1",
                    "Unique_PSM": "P1_ONLY||2",
                    "Condition": condition,
                    "Abundance": 100.0,
                }
                for condition in ["A", "B", "C", "D", "E"]
            )
            rows.extend(
                [
                    {
                        "Master_Protein_Accessions": "P2",
                        "Unique_PSM": "P2_FIRST||2",
                        "Condition": "A",
                        "Abundance": 100.0,
                    },
                    {
                        "Master_Protein_Accessions": "P2",
                        "Unique_PSM": "P2_SECOND||2",
                        "Condition": "A",
                        "Abundance": 100.0,
                    },
                ]
            )
            _write_test_parquet(input_path, rows)

            processor = DataProcessor(ProcessingConfig(resolve_shared_peptides=True))
            wrote_output = processor.step2_resolve_shared_peptides_duckdb(
                input_path, output_path
            )

            assert wrote_output is True
            result = pd.read_parquet(output_path, engine="pyarrow")
            shared = result.loc[
                result["Unique_PSM"] == "SHARED||2", "Master_Protein_Accessions"
            ]
            assert set(shared) == {"P2"}

    def test_tie_break_uses_original_accession_order(self):
        """A count tie must not fall back to a lower-count first accession."""
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            _write_test_parquet(
                input_path,
                [
                    {
                        "Master_Protein_Accessions": "LOW; HIGH1; HIGH2",
                        "Unique_PSM": "AMBIGUOUS||2",
                    },
                    {
                        "Master_Protein_Accessions": "HIGH1",
                        "Unique_PSM": "HIGH1_ONLY||2",
                    },
                    {
                        "Master_Protein_Accessions": "HIGH2",
                        "Unique_PSM": "HIGH2_ONLY||2",
                    },
                ],
            )

            processor = DataProcessor(ProcessingConfig(resolve_shared_peptides=True))
            processor.step2_resolve_shared_peptides_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            ambiguous = result.loc[
                result["Unique_PSM"] == "AMBIGUOUS||2",
                "Master_Protein_Accessions",
            ].item()
            assert ambiguous == "HIGH1"

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

            processor = DataProcessor(ProcessingConfig(resolve_shared_peptides=True))
            processor.step2_resolve_shared_peptides_duckdb(input_path, output_path)

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

            processor = DataProcessor(ProcessingConfig(resolve_shared_peptides=True))
            processor.step2_resolve_shared_peptides_duckdb(input_path, output_path)

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
            assert expected_cols.issubset(
                set(result.columns)
            ), f"Missing columns: {expected_cols - set(result.columns)}"
