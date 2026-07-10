"""Tests for DuckDB Step 5: Filter by Criteria.

Spec ref: Section 5.3 — CTE-based SQL with cond_reps, psm_detected,
psm_pass, and optional passing_protein_counts (strict mode).

Covers: lenient (40%) / strict (20%) thresholds, sparse PSM rejection
regression (Q9NYC9/ATADKLK case), multi-condition PSMs must pass all,
strict single-PSM protein removal.
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


class TestStep5DuckDB:
    """Tests for step5_filter_by_criteria_duckdb()."""

    def test_lenient_filtering(self):
        """Lenient (40% threshold): PSM with 1/5 missing passes, 4/5 missing fails.

        5 replicates: max_missing = int(5*0.4) = 2.
        PEP1: detected in 4/5 replicates (1 missing <= 2, PASS).
        PEP2: detected in 1/5 replicates (4 missing > 2, FAIL).
        """
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            _write_test_parquet(input_path, [
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 1, "Abundance": 100.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 2, "Abundance": 200.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 3, "Abundance": 300.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 4, "Abundance": 400.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 5, "Abundance": None},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P2",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP2||2",
                 "Condition": "DMSO", "Replicate": 1, "Abundance": 100.0},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P2",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP2||2",
                 "Condition": "DMSO", "Replicate": 2, "Abundance": None},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P2",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP2||2",
                 "Condition": "DMSO", "Replicate": 3, "Abundance": None},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P2",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP2||2",
                 "Condition": "DMSO", "Replicate": 4, "Abundance": None},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P2",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP2||2",
                 "Condition": "DMSO", "Replicate": 5, "Abundance": None},
            ])

            processor = DataProcessor(ProcessingConfig(strict_filtering=False))
            processor.step5_filter_by_criteria_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            result_psms = set(result["Unique_PSM"].unique())
            assert "PEP1||2" in result_psms, "PEP1 should pass lenient filter"
            assert "PEP2||2" not in result_psms, "PEP2 should fail lenient filter"

    def test_strict_filtering(self):
        """Strict (20%): only PSMs with 0/5 missing pass, remove single-PSM proteins.

        5 replicates: max_missing = int(5*0.2) = 1.
        PEP1+PEP2: 0 missing each, both pass, protein has 2 PSMs -> stays.
        PEP3: 4 missing (>1), fails missing threshold.
        Protein P3 has only 1 PSM among passing (PEP3 failed), so nothing left.
        """
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            _write_test_parquet(input_path, [
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 1, "Abundance": 100.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 2, "Abundance": 200.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 3, "Abundance": 300.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 4, "Abundance": 400.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 5, "Abundance": 500.0},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP2||2",
                 "Condition": "DMSO", "Replicate": 1, "Abundance": 150.0},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP2||2",
                 "Condition": "DMSO", "Replicate": 2, "Abundance": 250.0},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP2||2",
                 "Condition": "DMSO", "Replicate": 3, "Abundance": 350.0},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP2||2",
                 "Condition": "DMSO", "Replicate": 4, "Abundance": 450.0},
                {"Sequence": "PEP2", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP2||2",
                 "Condition": "DMSO", "Replicate": 5, "Abundance": 550.0},
                {"Sequence": "PEP3", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P3",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP3||2",
                 "Condition": "DMSO", "Replicate": 1, "Abundance": 100.0},
                {"Sequence": "PEP3", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P3",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP3||2",
                 "Condition": "DMSO", "Replicate": 2, "Abundance": None},
                {"Sequence": "PEP3", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P3",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP3||2",
                 "Condition": "DMSO", "Replicate": 3, "Abundance": None},
                {"Sequence": "PEP3", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P3",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP3||2",
                 "Condition": "DMSO", "Replicate": 4, "Abundance": None},
                {"Sequence": "PEP3", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P3",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP3||2",
                 "Condition": "DMSO", "Replicate": 5, "Abundance": None},
            ])

            processor = DataProcessor(ProcessingConfig(strict_filtering=True))
            processor.step5_filter_by_criteria_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            result_psms = set(result["Unique_PSM"].unique())
            assert "PEP1||2" in result_psms
            assert "PEP2||2" in result_psms
            assert "PEP3||2" not in result_psms, "PEP3 fails strict threshold"

    def test_sparse_psm_rejected(self):
        """Regression: PSM detected in only 1 replicate per condition is rejected.

        Spec Section 6.1 note: MUST preserve sparse PSM rejection behavior
        from removed test_step5_sparse_psm_rejected.
        Simulates Q9NYC9/ATADKLK case: 4 DMSO + 3 INCB replicates.
        Sparse PSM: DMSO rep 4 only (3 missing) + INCB rep 3 only (2 missing).
        Lenient (40%): DMSO max_missing=1, INCB max_missing=1 -> both fail.
        """
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"

            rows = []
            for rep in range(1, 5):
                rows.append({
                    "Sequence": "FULL", "Modifications": "", "Charge": 2,
                    "Contaminant": "false", "Master_Protein_Accessions": "P0",
                    "Quan_Info": "Valid", "Unique_PSM": f"FULL||2_{rep}",
                    "Condition": "DMSO_24h", "Replicate": rep, "Abundance": 100.0,
                })
            for rep in range(1, 4):
                rows.append({
                    "Sequence": "FULL", "Modifications": "", "Charge": 2,
                    "Contaminant": "false", "Master_Protein_Accessions": "P0",
                    "Quan_Info": "Valid", "Unique_PSM": f"FULL||2_{rep}_t",
                    "Condition": "INCB231845_24h", "Replicate": rep, "Abundance": 100.0,
                })
            rows.append({
                "Sequence": "SPARSE", "Modifications": "", "Charge": 3,
                "Contaminant": "false", "Master_Protein_Accessions": "Q9NYC9",
                "Quan_Info": "Valid", "Unique_PSM": "SPARSE||3",
                "Condition": "DMSO_24h", "Replicate": 4, "Abundance": 62212.0,
            })
            rows.append({
                "Sequence": "SPARSE", "Modifications": "", "Charge": 3,
                "Contaminant": "false", "Master_Protein_Accessions": "Q9NYC9",
                "Quan_Info": "Valid", "Unique_PSM": "SPARSE||3",
                "Condition": "INCB231845_24h", "Replicate": 3, "Abundance": 144067.0,
            })

            _write_test_parquet(input_path, rows)

            processor = DataProcessor(ProcessingConfig(strict_filtering=False))
            processor.step5_filter_by_criteria_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            assert "SPARSE||3" not in result["Unique_PSM"].values, (
                "Sparse PSM should be rejected (regression test)"
            )

    def test_multi_condition_psm_must_pass_all(self):
        """PSM must pass threshold in ALL conditions to be kept.

        PEP1: DMSO (4/4 reps = 0 missing), Drug (2/4 reps = 2 missing).
        Lenient: max_missing=int(4*0.4)=1, 2 missing > 1 -> fails Drug -> removed.
        """
        with tempfile.TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "input.parquet"
            output_path = Path(tmp) / "output.parquet"
            _write_test_parquet(input_path, [
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 1, "Abundance": 100.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 2, "Abundance": 200.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 3, "Abundance": 300.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "DMSO", "Replicate": 4, "Abundance": 400.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "Drug", "Replicate": 1, "Abundance": 100.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "Drug", "Replicate": 2, "Abundance": 200.0},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "Drug", "Replicate": 3, "Abundance": None},
                {"Sequence": "PEP1", "Modifications": "", "Charge": 2,
                 "Contaminant": "false", "Master_Protein_Accessions": "P1",
                 "Quan_Info": "Valid", "Unique_PSM": "PEP1||2",
                 "Condition": "Drug", "Replicate": 4, "Abundance": None},
            ])

            processor = DataProcessor(ProcessingConfig(strict_filtering=False))
            processor.step5_filter_by_criteria_duckdb(input_path, output_path)

            result = pd.read_parquet(output_path, engine="pyarrow")
            result_psms = set(result["Unique_PSM"].unique())
            assert "PEP1||2" not in result_psms, (
                "PEP1 fails Drug condition (2 missing > 1 threshold)"
            )
