"""
Integration tests for processing pipeline.

Tests DataProcessor with actual file operations.
"""

import pytest
import pandas as pd
import numpy as np
from pathlib import Path


@pytest.fixture
def sample_data_dir():
    """Return path to sample data directory."""
    return Path(__file__).parent.parent.parent.parent / "SampleData"


@pytest.fixture
def temp_session_dir(tmp_path):
    """Create temporary session directory."""
    session_dir = tmp_path / "sessions" / "test-session"
    session_dir.mkdir(parents=True)
    return session_dir


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


class TestStep1CombineReplicates:
    """Test Step 1: Combine Replicates."""

    def test_combine_sample_data_files(self, processor, sample_data_dir, temp_session_dir):
        """Combine actual sample data files."""
        files = [
            sample_data_dir / "PSM_SampleData_DMSO_1.csv",
            sample_data_dir / "PSM_SampleData_DMSO_2.csv",
        ]

        # Skip if sample files don't exist
        if not all(f.exists() for f in files):
            pytest.skip("Sample data files not found")

        result = processor.step1_combine_replicates(files)

        assert len(result) > 0
        assert 'Sample_Origination' in result.columns
        assert 'Condition' in result.columns
        assert 'Replicate' in result.columns
        assert 'Abundance' in result.columns
        # Should have data from both files
        assert result['Sample_Origination'].nunique() == 2

    def test_combine_multiple_conditions(self, processor, sample_data_dir, temp_session_dir):
        """Combine files from multiple conditions."""
        files = [
            sample_data_dir / "PSM_SampleData_DMSO_1.csv",
            sample_data_dir / "PSM_SampleData_INCZ123456_1.csv",
        ]

        # Skip if sample files don't exist
        if not all(f.exists() for f in files):
            pytest.skip("Sample data files not found")

        result = processor.step1_combine_replicates(files)

        origination_values = result['Sample_Origination'].unique()
        assert 'DMSO_1' in origination_values
        assert 'INCZ123456_1' in origination_values


class TestStep2GenerateUniquePsm:
    """Test Step 2: Generate Unique PSM."""

    def test_generate_unique_psm(self, processor):
        """Generate unique PSM identifiers."""
        df = pd.DataFrame({
            'Sequence': ['PEPTIDE1', 'PEPTIDE2'],
            'Modifications': ['', 'Oxidation'],
            'Charge': [2, 3],
        })

        result = processor.step2_generate_unique_psm(df)

        assert 'Unique_PSM' in result.columns
        assert result['Unique_PSM'].nunique() == 2
        assert result['Unique_PSM'].iloc[0] == 'PEPTIDE1||2'
        assert result['Unique_PSM'].iloc[1] == 'PEPTIDE2|Oxidation|3'


class TestStep3RemoveRazor:
    """Test Step 3: Remove Razor Peptides."""

    def test_remove_razor_disabled(self, processor):
        """When remove_razor=False, keep multiple protein mappings."""
        df = pd.DataFrame({
            'Sequence': ['PEP1', 'PEP2'],
            'Modifications': ['', ''],
            'Charge': [2, 2],
            'Master_Protein_Accessions': ['P1; P2', 'P3'],
            'Unique_PSM': ['PEP1||2', 'PEP2||2'],
        })

        result = processor.step3_remove_razor(df)

        # Should keep original mappings
        assert len(result) == 2
        # P1; P2 should remain unchanged
        assert 'P1; P2' in result['Master_Protein_Accessions'].values

    def test_remove_razor_enabled(self, processor_with_razor):
        """When remove_razor=True, resolve to single protein."""
        df = pd.DataFrame({
            'Sequence': ['PEP1', 'PEP2'],
            'Modifications': ['', ''],
            'Charge': [2, 2],
            'Master_Protein_Accessions': ['P1; P2', 'P3'],
            'Unique_PSM': ['PEP1||2', 'PEP2||2'],
        })

        result = processor_with_razor.step3_remove_razor(df)

        # All should have single protein
        assert len(result) == 2
        for protein in result['Master_Protein_Accessions']:
            assert ';' not in str(protein)


class TestStep4RemoveLowQuality:
    """Test Step 4: Remove Low Quality PSMs."""

    def test_remove_contaminants(self, processor):
        """Remove contaminant PSMs."""
        df = pd.DataFrame({
            'Sequence': ['PEP1', 'PEP2', 'PEP3'],
            'Modifications': ['', '', ''],
            'Charge': [2, 2, 2],
            'Contaminant': ['true', 'false', 'false'],
            'Master_Protein_Accessions': ['P1', 'P2', 'P3'],
            'Quan_Info': ['Valid', 'Valid', 'Valid'],
            'Abundance': [1000.0, 2000.0, 3000.0],
        })

        result = processor.step4_remove_low_quality(df)

        assert len(result) == 2
        assert 'PEP1' not in result['Sequence'].values

    def test_remove_no_value_quan(self, processor):
        """Remove PSMs with 'No Value' in Quan Info."""
        df = pd.DataFrame({
            'Sequence': ['PEP1', 'PEP2', 'PEP3'],
            'Modifications': ['', '', ''],
            'Charge': [2, 2, 2],
            'Contaminant': ['false', 'false', 'false'],
            'Master_Protein_Accessions': ['P1', 'P2', 'P3'],
            'Quan_Info': ['No Value', 'Valid', 'Valid'],
            'Abundance': [1000.0, 2000.0, 3000.0],
        })

        result = processor.step4_remove_low_quality(df)

        assert len(result) == 2
        assert 'PEP1' not in result['Sequence'].values

    def test_remove_low_abundance(self, processor):
        """Remove PSMs with abundance < 1."""
        df = pd.DataFrame({
            'Sequence': ['PEP1', 'PEP2', 'PEP3'],
            'Modifications': ['', '', ''],
            'Charge': [2, 2, 2],
            'Contaminant': ['false', 'false', 'false'],
            'Master_Protein_Accessions': ['P1', 'P2', 'P3'],
            'Quan_Info': ['Valid', 'Valid', 'Valid'],
            'Abundance': [0.5, 2000.0, 3000.0],
        })

        result = processor.step4_remove_low_quality(df)

        assert len(result) == 2
        assert 'PEP1' not in result['Sequence'].values


class TestStep5FilterByCriteria:
    """Test Step 5: Filter by Criteria."""

    def test_lenient_filtering(self, processor):
        """Lenient filtering allows 40% missing values."""
        df = pd.DataFrame({
            'Sequence': ['PEP1', 'PEP2'],
            'Modifications': ['', ''],
            'Charge': [2, 2],
            'Contaminant': [False, False],
            'Master_Protein_Accessions': ['P1', 'P2'],
            'Quan_Info': ['Valid', 'Valid'],
            'Unique_PSM': ['PEP1||2', 'PEP2||2'],
            'Condition': ['DMSO', 'DMSO'],
            'Replicate': [1, 2],
            'Abundance': [100.0, np.nan],  # 50% missing
        })

        result = processor.step5_filter_by_criteria(df)

        # PEP1 has 0% missing, PEP2 has 50% missing (>40%)
        # Only PEP1 should remain
        assert len(result) == 1
        assert 'PEP1' in result['Sequence'].values

    def test_strict_filtering(self, processor_strict):
        """Strict filtering allows only 20% missing values."""
        df = pd.DataFrame({
            'Sequence': ['PEP1', 'PEP2', 'PEP3', 'PEP4'],
            'Modifications': ['', '', '', ''],
            'Charge': [2, 2, 2, 2],
            'Contaminant': [False, False, False, False],
            'Master_Protein_Accessions': ['P1', 'P1', 'P2', 'P3'],  # P1 has 2 PSMs
            'Quan_Info': ['Valid', 'Valid', 'Valid', 'Valid'],
            'Unique_PSM': ['PEP1||2', 'PEP2||2', 'PEP3||2', 'PEP4||2'],
            'Condition': ['DMSO', 'DMSO', 'DMSO', 'DMSO'],
            'Replicate': [1, 2, 1, 2],
            'Abundance': [100.0, 200.0, np.nan, np.nan],  # P1 has 0% missing, P2 has 100%, P3 has 100%
        })

        result = processor_strict.step5_filter_by_criteria(df)

        # P1 has 0% missing and 2 PSMs, should remain
        # P2 and P3 have >20% missing, should be removed
        # After filtering, only PEP1 and PEP2 (both mapping to P1) should remain
        assert len(result) == 2
        assert 'PEP1' in result['Sequence'].values
        assert 'PEP2' in result['Sequence'].values

    def test_strict_removes_single_psm_proteins(self, processor_strict):
        """Strict filtering removes proteins with only 1 PSM."""
        df = pd.DataFrame({
            'Sequence': ['PEP1', 'PEP2', 'PEP3'],
            'Modifications': ['', '', ''],
            'Charge': [2, 2, 2],
            'Contaminant': [False, False, False],
            'Master_Protein_Accessions': ['P1', 'P1', 'P2'],
            'Quan_Info': ['Valid', 'Valid', 'Valid'],
            'Unique_PSM': ['PEP1||2', 'PEP2||2', 'PEP3||2'],
            'Condition': ['DMSO', 'DMSO', 'DMSO'],
            'Replicate': [1, 2, 3],
            'Abundance': [100.0, 200.0, 300.0],
        })

        result = processor_strict.step5_filter_by_criteria(df)

        # P1 has 2 PSMs, P2 has 1 PSM
        # P2 should be removed in strict mode
        assert len(result) == 2
        assert 'P2' not in result['Master_Protein_Accessions'].values


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
