"""
Unit tests for data processing pipeline (Steps 1-5).

Tests the DataProcessor class methods.
"""

import pandas as pd
import pytest
from app.services.data_processor import DataProcessor, ProcessingConfig


class TestDataProcessor:
    """Test DataProcessor class."""

    @pytest.fixture
    def processor(self):
        """Create a DataProcessor instance."""
        config = ProcessingConfig()
        return DataProcessor(config)

    @pytest.fixture
    def sample_psm_data(self):
        """Create sample PSM data for testing."""
        return pd.DataFrame(
            {
                "Sequence": ["PEPTIDE1", "PEPTIDE2", "PEPTIDE3"],
                "Modifications": ["", "", ""],
                "Charge": [2, 2, 2],
                "Contaminant": [False, False, False],
                "Master Protein Accessions": ["P12345", "P67890", "P11111"],
                "Quan Info": ["Valid", "Valid", "Valid"],
                "Abundance F1 Sample": [100.0, 200.0, 300.0],
            }
        )

    def test_parse_psm_filename_valid(self, processor):
        """Parse valid PSM filename."""
        result = processor.parse_psm_filename("PSM_SampleData_DMSO_1.csv")

        assert result.experiment == "SampleData"
        assert result.conditions == ["DMSO"]
        assert result.replicate == 1

    def test_parse_psm_filename_invalid(self, processor):
        """Reject invalid PSM filename."""
        with pytest.raises(ValueError) as exc_info:
            processor.parse_psm_filename("invalid_file.csv")

        assert "doesn't match pattern" in str(exc_info.value)

    def test_find_abundance_column(self, processor):
        """Find abundance column in columns list."""
        columns = ["Sequence", "Abundance F1 Sample", "Charge"]
        result = processor.find_abundance_column(columns)

        assert result == "Abundance F1 Sample"

    def test_find_abundance_column_not_found(self, processor):
        """Raise error when abundance column not found."""
        columns = ["Sequence", "Charge"]

        with pytest.raises(ValueError) as exc_info:
            processor.find_abundance_column(columns)

        assert "No abundance column" in str(exc_info.value)

    def test_step2_generate_unique_psm(self, processor, sample_psm_data):
        """Generate unique PSM identifiers."""
        result = processor.step2_generate_unique_psm(sample_psm_data)

        # Column name uses underscore in actual implementation
        assert "Unique_PSM" in result.columns
        assert len(result) == 3
        # Check format: Sequence|Modifications|Charge
        assert result["Unique_PSM"].iloc[0] == "PEPTIDE1||2"

    def test_step4_remove_contaminants(self, processor):
        """Remove contaminant PSMs."""
        df = pd.DataFrame(
            {
                "Sequence": ["PEP1", "PEP2", "PEP3"],
                "Modifications": ["", "", ""],
                "Charge": [2, 2, 2],
                "Contaminant": [True, False, False],
                "Master Protein Accessions": ["P1", "P2", "P3"],
                "Quan_Info": ["Valid", "Valid", "Valid"],
                "Abundance": [100.0, 200.0, 300.0],  # Note: renamed to Abundance
                "Abundance F1 Sample": [100.0, 200.0, 300.0],
            }
        )

        result = processor.step4_remove_low_quality(df)

        assert len(result) == 2
        assert "PEP1" not in result["Sequence"].values

    def test_step4_remove_no_value_quan(self, processor):
        """Remove PSMs with no value in Quan Info."""
        df = pd.DataFrame(
            {
                "Sequence": ["PEP1", "PEP2", "PEP3"],
                "Modifications": ["", "", ""],
                "Charge": [2, 2, 2],
                "Contaminant": [False, False, False],
                "Master Protein Accessions": ["P1", "P2", "P3"],
                "Quan_Info": ["No Value", "Valid", "Valid"],
                "Abundance": [100.0, 200.0, 300.0],
                "Abundance F1 Sample": [100.0, 200.0, 300.0],
            }
        )

        result = processor.step4_remove_low_quality(df)

        assert len(result) == 2
        assert "PEP1" not in result["Sequence"].values

    def test_step4_remove_low_abundance(self, processor):
        """Remove PSMs with abundance < 1."""
        df = pd.DataFrame(
            {
                "Sequence": ["PEP1", "PEP2", "PEP3"],
                "Modifications": ["", "", ""],
                "Charge": [2, 2, 2],
                "Contaminant": [False, False, False],
                "Master Protein Accessions": ["P1", "P2", "P3"],
                "Quan_Info": ["Valid", "Valid", "Valid"],
                "Abundance": [0.5, 200.0, 300.0],
                "Abundance F1 Sample": [0.5, 200.0, 300.0],
            }
        )

        result = processor.step4_remove_low_quality(df)

        assert len(result) == 2
        assert "PEP1" not in result["Sequence"].values

    def test_step5_lenient_filtering(self, processor):
        """Test lenient filtering (allows more missing values)."""
        # Lenient: 40% threshold, 4 replicates → max 1 missing allowed
        # Dataset must include rows spanning all 4 replicates so totals are correct.
        # PSM_PASS: detected in 3/4 replicates → missing 1 ≤ 1 → pass
        # PSM_FAIL: detected in 2/4 replicates → missing 2 > 1 → fail
        # PSM_FULL defines all 4 replicates exist in the experiment.
        df = pd.DataFrame(
            {
                "Sequence": ["FULL"] * 4 + ["PASS"] * 3 + ["FAIL"] * 2,
                "Modifications": [""] * 9,
                "Charge": [2] * 9,
                "Contaminant": [False] * 9,
                "Master Protein Accessions": ["P0"] * 4 + ["P1"] * 3 + ["P2"] * 2,
                "Quan_Info": ["Valid"] * 9,
                "Unique_PSM": ["FULL||2"] * 4 + ["PASS||2"] * 3 + ["FAIL||2"] * 2,
                "Condition": ["DMSO"] * 9,
                "Replicate": [1, 2, 3, 4, 1, 2, 3, 1, 2],
                "Abundance": [100.0] * 9,
            }
        )

        result = processor.step5_filter_by_criteria(df)

        # FULL (4/4) and PASS (3/4) pass, FAIL (2/4, missing 2 > 1) is removed
        assert len(result) == 7
        assert set(result["Unique_PSM"].unique()) == {"FULL||2", "PASS||2"}

    def test_step5_strict_filtering(self):
        """Test strict filtering (20% threshold, very few missing allowed)."""
        strict_proc = DataProcessor(ProcessingConfig(strict_filtering=True))

        # Strict: 20% threshold, 4 replicates → max 0 missing allowed
        # PSM_FULL: detected in 4/4 → pass
        # PSM_MISSING1: detected in 3/4 → missing 1 > 0 → fail
        # PSM_FULL also ensures strict filter (>1 PSM per protein) is met
        df = pd.DataFrame(
            {
                "Sequence": ["FULL"] * 4 + ["FULL"] * 4 + ["MISS"] * 3,
                "Modifications": [""] * 11,
                "Charge": [2] * 11,
                "Contaminant": [False] * 11,
                "Master_Protein_Accessions": ["P0"] * 8 + ["P1"] * 3,
                "Quan_Info": ["Valid"] * 11,
                "Unique_PSM": ["FULL_A||2"] * 4 + ["FULL_B||2"] * 4 + ["MISS||2"] * 3,
                "Condition": ["DMSO"] * 11,
                "Replicate": [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3],
                "Abundance": [100.0] * 11,
            }
        )

        result = strict_proc.step5_filter_by_criteria(df)

        # FULL_A and FULL_B pass (0/4 missing ≤ 0), MISS fails (1/4 > 0)
        # Also protein P1 has only 1 PSM → removed by strict 1-PSM filter
        assert len(result) == 8
        assert set(result["Unique_PSM"].unique()) == {"FULL_A||2", "FULL_B||2"}

    def test_step5_sparse_psm_rejected(self):
        """PSM detected in only 1 replicate per condition should be rejected.

        Regression test: PSMs like Q9NYC9/ATADKLK that appear in only
        DMSO_24h_4 and INCB231845_24h_3 (2 of 7 total samples) were
        incorrectly passing because the filter counted NAs in existing
        rows instead of checking actual replicate coverage.
        """
        proc = DataProcessor(ProcessingConfig(strict_filtering=False))

        # Build dataset that defines all 7 samples (4 DMSO + 3 INCB)
        full_psms = []
        for rep in range(1, 5):
            full_psms.append(
                {
                    "Sequence": "FULL",
                    "Modifications": "",
                    "Charge": 2,
                    "Contaminant": False,
                    "Master Protein Accessions": "P0",
                    "Quan_Info": "Valid",
                    "Unique_PSM": f"FULL||2_rep{rep}",
                    "Condition": "DMSO_24h",
                    "Replicate": rep,
                    "Abundance": 100.0,
                }
            )
        for rep in range(1, 4):
            full_psms.append(
                {
                    "Sequence": "FULL",
                    "Modifications": "",
                    "Charge": 2,
                    "Contaminant": False,
                    "Master Protein Accessions": "P0",
                    "Quan_Info": "Valid",
                    "Unique_PSM": f"FULL||2_rep{rep}_t",
                    "Condition": "INCB231845_24h",
                    "Replicate": rep,
                    "Abundance": 100.0,
                }
            )
        # Sparse PSM: only in DMSO_24h_4 and INCB231845_24h_3
        sparse_rows = [
            {
                "Sequence": "SPARSE",
                "Modifications": "",
                "Charge": 3,
                "Contaminant": False,
                "Master Protein Accessions": "Q9NYC9",
                "Quan_Info": "Valid",
                "Unique_PSM": "SPARSE||3",
                "Condition": "DMSO_24h",
                "Replicate": 4,
                "Abundance": 62212.0,
            },
            {
                "Sequence": "SPARSE",
                "Modifications": "",
                "Charge": 3,
                "Contaminant": False,
                "Master Protein Accessions": "Q9NYC9",
                "Quan_Info": "Valid",
                "Unique_PSM": "SPARSE||3",
                "Condition": "INCB231845_24h",
                "Replicate": 3,
                "Abundance": 144067.0,
            },
        ]
        df = pd.DataFrame(full_psms + sparse_rows)

        result = proc.step5_filter_by_criteria(df)
        # DMSO: 4 replicates, max_missing=int(4*0.4)=1, sparse has 3 missing → fail
        # INCB: 3 replicates, max_missing=int(3*0.4)=1, sparse has 2 missing → fail
        assert "SPARSE||3" not in result["Unique_PSM"].values

    def test_processing_config_defaults(self):
        """Test ProcessingConfig default values."""
        config = ProcessingConfig()

        assert config.remove_razor is False
        assert config.strict_filtering is False

    def test_processing_config_custom(self):
        """Test ProcessingConfig with custom values."""
        config = ProcessingConfig(remove_razor=True, strict_filtering=True)

        assert config.remove_razor is True
        assert config.strict_filtering is True
