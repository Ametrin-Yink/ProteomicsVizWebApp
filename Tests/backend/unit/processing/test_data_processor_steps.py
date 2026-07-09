"""
Integration tests for processing pipeline.

Tests DataProcessor with actual file operations.
"""

import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def processor():
    """Create DataProcessor with default config."""
    from app.services.data_processor import DataProcessor, ProcessingConfig

    config = ProcessingConfig()
    return DataProcessor(config)


@pytest.fixture
def processor_with_razor():
    """Create DataProcessor with razor removal enabled."""
    from app.services.data_processor import DataProcessor, ProcessingConfig

    config = ProcessingConfig(remove_razor=True)
    return DataProcessor(config)


@pytest.fixture
def processor_strict():
    """Create DataProcessor with strict filtering."""
    from app.services.data_processor import DataProcessor, ProcessingConfig

    config = ProcessingConfig(strict_filtering=True)
    return DataProcessor(config)


class TestStep2GenerateUniquePsm:
    """Test Step 2: Generate Unique PSM."""

    def test_generate_unique_psm(self, processor):
        """Generate unique PSM identifiers."""
        df = pd.DataFrame(
            {
                "Sequence": ["PEPTIDE1", "PEPTIDE2"],
                "Modifications": ["", "Oxidation"],
                "Charge": [2, 3],
            }
        )

        result = processor.step2_generate_unique_psm(df)

        assert "Unique_PSM" in result.columns
        assert result["Unique_PSM"].nunique() == 2
        assert result["Unique_PSM"].iloc[0] == "PEPTIDE1||2"
        assert result["Unique_PSM"].iloc[1] == "PEPTIDE2|Oxidation|3"


class TestStep3RemoveRazor:
    """Test Step 3: Remove Razor Peptides."""

    def test_remove_razor_disabled(self, processor):
        """When remove_razor=False, keep multiple protein mappings."""
        df = pd.DataFrame(
            {
                "Sequence": ["PEP1", "PEP2"],
                "Modifications": ["", ""],
                "Charge": [2, 2],
                "Master_Protein_Accessions": ["P1; P2", "P3"],
                "Unique_PSM": ["PEP1||2", "PEP2||2"],
            }
        )

        result = processor.step3_remove_razor(df)

        # Should keep original mappings
        assert len(result) == 2
        # P1; P2 should remain unchanged
        assert "P1; P2" in result["Master_Protein_Accessions"].values

    def test_remove_razor_enabled(self, processor_with_razor):
        """When remove_razor=True, resolve to single protein."""
        df = pd.DataFrame(
            {
                "Sequence": ["PEP1", "PEP2"],
                "Modifications": ["", ""],
                "Charge": [2, 2],
                "Master_Protein_Accessions": ["P1; P2", "P3"],
                "Unique_PSM": ["PEP1||2", "PEP2||2"],
            }
        )

        result = processor_with_razor.step3_remove_razor(df)

        # All should have single protein
        assert len(result) == 2
        for protein in result["Master_Protein_Accessions"]:
            assert ";" not in str(protein)


class TestStep4RemoveLowQuality:
    """Test Step 4: Remove Low Quality PSMs."""

    def test_remove_contaminants(self, processor):
        """Remove contaminant PSMs."""
        df = pd.DataFrame(
            {
                "Sequence": ["PEP1", "PEP2", "PEP3"],
                "Modifications": ["", "", ""],
                "Charge": [2, 2, 2],
                "Contaminant": ["true", "false", "false"],
                "Master_Protein_Accessions": ["P1", "P2", "P3"],
                "Quan_Info": ["Valid", "Valid", "Valid"],
                "Abundance": [1000.0, 2000.0, 3000.0],
            }
        )

        result = processor.step4_remove_low_quality(df)

        assert len(result) == 2
        assert "PEP1" not in result["Sequence"].values

    def test_remove_no_value_quan(self, processor):
        """Remove PSMs with 'No Value' in Quan Info."""
        df = pd.DataFrame(
            {
                "Sequence": ["PEP1", "PEP2", "PEP3"],
                "Modifications": ["", "", ""],
                "Charge": [2, 2, 2],
                "Contaminant": ["false", "false", "false"],
                "Master_Protein_Accessions": ["P1", "P2", "P3"],
                "Quan_Info": ["No Value", "Valid", "Valid"],
                "Abundance": [1000.0, 2000.0, 3000.0],
            }
        )

        result = processor.step4_remove_low_quality(df)

        assert len(result) == 2
        assert "PEP1" not in result["Sequence"].values

    def test_remove_low_abundance(self, processor):
        """Remove PSMs with abundance < 1."""
        df = pd.DataFrame(
            {
                "Sequence": ["PEP1", "PEP2", "PEP3"],
                "Modifications": ["", "", ""],
                "Charge": [2, 2, 2],
                "Contaminant": ["false", "false", "false"],
                "Master_Protein_Accessions": ["P1", "P2", "P3"],
                "Quan_Info": ["Valid", "Valid", "Valid"],
                "Abundance": [0.5, 2000.0, 3000.0],
            }
        )

        result = processor.step4_remove_low_quality(df)

        assert len(result) == 2
        assert "PEP1" not in result["Sequence"].values


class TestStep5FilterByCriteria:
    """Test Step 5: Filter by Criteria."""

    def test_lenient_filtering(self, processor):
        """Lenient filtering allows 40% missing values."""
        # 5 replicates, threshold=0.4, max_missing=int(5*0.4)=2
        # PEP1: detected in 4/5 replicates (1 missing <= 2, PASS)
        # PEP2: detected in 1/5 replicates (4 missing > 2, FAIL)
        df = pd.DataFrame(
            {
                "Sequence": ["PEP1"] * 5 + ["PEP2"] * 5,
                "Modifications": [""] * 10,
                "Charge": [2] * 10,
                "Contaminant": [False] * 10,
                "Master_Protein_Accessions": ["P1"] * 5 + ["P2"] * 5,
                "Quan_Info": ["Valid"] * 10,
                "Unique_PSM": ["PEP1||2"] * 5 + ["PEP2||2"] * 5,
                "Condition": ["DMSO"] * 10,
                "Replicate": [1, 2, 3, 4, 5, 1, 2, 3, 4, 5],
                "Abundance": [
                    100.0,
                    200.0,
                    300.0,
                    400.0,
                    np.nan,  # PEP1 missing in rep 5
                    100.0,
                    np.nan,
                    np.nan,
                    np.nan,
                    np.nan,
                ],  # PEP2 missing in reps 2-5
            }
        )

        result = processor.step5_filter_by_criteria(df)

        # Only PEP1 should remain (5 rows: 4 valid + 1 NaN)
        assert len(result) == 5
        assert "PEP1" in result["Sequence"].values
        assert "PEP2" not in result["Sequence"].values

    def test_strict_filtering(self, processor_strict):
        """Strict filtering allows only 20% missing values."""
        # 5 replicates, threshold=0.2, max_missing=int(5*0.2)=1
        # PEP1: 0 missing (PASS), PEP2: 0 missing (PASS), P1 has 2 PSMs -> stays
        # PEP3: 4 missing (> 1, FAIL), PEP4: 4 missing (> 1, FAIL)
        df = pd.DataFrame(
            {
                "Sequence": ["PEP1"] * 5 + ["PEP2"] * 5 + ["PEP3"] * 5 + ["PEP4"] * 5,
                "Modifications": [""] * 20,
                "Charge": [2] * 20,
                "Contaminant": [False] * 20,
                "Master_Protein_Accessions": ["P1"] * 5
                + ["P1"] * 5
                + ["P2"] * 5
                + ["P3"] * 5,
                "Quan_Info": ["Valid"] * 20,
                "Unique_PSM": ["PEP1||2"] * 5
                + ["PEP2||2"] * 5
                + ["PEP3||2"] * 5
                + ["PEP4||2"] * 5,
                "Condition": ["DMSO"] * 20,
                "Replicate": list(range(1, 6)) * 4,
                "Abundance": [
                    *[100.0, 200.0, 300.0, 400.0, 500.0],  # PEP1 all detected
                    *[150.0, 250.0, 350.0, 450.0, 550.0],  # PEP2 all detected
                    *[100.0, np.nan, np.nan, np.nan, np.nan],  # PEP3 only rep 1
                    *[100.0, np.nan, np.nan, np.nan, np.nan],
                ],  # PEP4 only rep 1
            }
        )

        result = processor_strict.step5_filter_by_criteria(df)

        # P1 has 0% missing and 2 PSMs, should remain
        # P2 and P3 have >20% missing, should be removed
        # After filtering, only PEP1 and PEP2 (both mapping to P1) should remain
        assert len(result) == 10
        assert "PEP1" in result["Sequence"].values
        assert "PEP2" in result["Sequence"].values

    def test_strict_removes_single_psm_proteins(self, processor_strict):
        """Strict filtering removes proteins with only 1 PSM."""
        # 2 replicates, threshold=0.2, max_missing=int(2*0.2)=0
        # PEP1: detected in 2/2 (PASS), PEP2: detected in 2/2 (PASS)
        # PEP3: detected in 1/2 (1 missing > 0, FAIL)
        # After missing filter: P1 has 2 PSMs, P2 has 0 PSMs -> P2 removed
        df = pd.DataFrame(
            {
                "Sequence": ["PEP1"] * 2 + ["PEP2"] * 2 + ["PEP3"] * 2,
                "Modifications": [""] * 6,
                "Charge": [2] * 6,
                "Contaminant": [False] * 6,
                "Master_Protein_Accessions": ["P1"] * 2 + ["P1"] * 2 + ["P2"] * 2,
                "Quan_Info": ["Valid"] * 6,
                "Unique_PSM": ["PEP1||2"] * 2 + ["PEP2||2"] * 2 + ["PEP3||2"] * 2,
                "Condition": ["DMSO"] * 6,
                "Replicate": [1, 2, 1, 2, 1, 2],
                "Abundance": [100.0, 200.0, 300.0, 400.0, 300.0, np.nan],
            }
        )

        result = processor_strict.step5_filter_by_criteria(df)

        # P1 has 2 PSMs, P2 has 1 PSM (PEP3 filtered out by missing check)
        # P2 should be removed in strict mode
        assert len(result) == 4
        assert "P2" not in result["Master_Protein_Accessions"].values


class TestProcessingConfig:
    """Test ProcessingConfig behavior."""

    def test_default_config(self):
        """Default config has sensible values."""
        from app.services.data_processor import ProcessingConfig

        config = ProcessingConfig()

        assert config.remove_razor is False
        assert config.strict_filtering is False
        assert config.fasta_db is None

    def test_config_with_razor(self):
        """Config with razor removal enabled."""
        from app.services.data_processor import ProcessingConfig

        config = ProcessingConfig(remove_razor=True)

        assert config.remove_razor is True

    def test_config_strict_filtering(self):
        """Config with strict filtering enabled."""
        from app.services.data_processor import ProcessingConfig

        config = ProcessingConfig(strict_filtering=True)

        assert config.strict_filtering is True
