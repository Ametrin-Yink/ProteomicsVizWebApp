"""
Unit tests for data processing pipeline (Steps 1-5).

Tests the DataProcessor class methods.
"""

import pytest
import pandas as pd
import numpy as np
from pathlib import Path


class TestDataProcessor:
    """Test DataProcessor class."""

    @pytest.fixture
    def processor(self):
        """Create a DataProcessor instance."""
        from app.services.data_processor import DataProcessor, ProcessingConfig
        config = ProcessingConfig()
        return DataProcessor(config)

    @pytest.fixture
    def sample_psm_data(self):
        """Create sample PSM data for testing."""
        return pd.DataFrame({
            'Sequence': ['PEPTIDE1', 'PEPTIDE2', 'PEPTIDE3'],
            'Modifications': ['', '', ''],
            'Charge': [2, 2, 2],
            'Contaminant': [False, False, False],
            'Master Protein Accessions': ['P12345', 'P67890', 'P11111'],
            'Quan Info': ['Valid', 'Valid', 'Valid'],
            'Abundance F1 Sample': [100.0, 200.0, 300.0],
        })

    def test_parse_psm_filename_valid(self, processor):
        """Parse valid PSM filename."""
        result = processor.parse_psm_filename("PSM_SampleData_DMSO_1.csv")

        assert result.experiment == "SampleData"
        assert result.condition == "DMSO"
        assert result.replicate == 1

    def test_parse_psm_filename_invalid(self, processor):
        """Reject invalid PSM filename."""
        with pytest.raises(ValueError) as exc_info:
            processor.parse_psm_filename("invalid_file.csv")

        assert "doesn't match pattern" in str(exc_info.value)

    def test_find_abundance_column(self, processor):
        """Find abundance column in columns list."""
        columns = ['Sequence', 'Abundance F1 Sample', 'Charge']
        result = processor.find_abundance_column(columns)

        assert result == 'Abundance F1 Sample'

    def test_find_abundance_column_not_found(self, processor):
        """Raise error when abundance column not found."""
        columns = ['Sequence', 'Charge']

        with pytest.raises(ValueError) as exc_info:
            processor.find_abundance_column(columns)

        assert "No abundance column" in str(exc_info.value)

    def test_step2_generate_unique_psm(self, processor, sample_psm_data):
        """Generate unique PSM identifiers."""
        result = processor.step2_generate_unique_psm(sample_psm_data)

        # Column name uses underscore in actual implementation
        assert 'Unique_PSM' in result.columns
        assert len(result) == 3
        # Check format: Sequence|Modifications|Charge
        assert result['Unique_PSM'].iloc[0] == 'PEPTIDE1||2'

    def test_step4_remove_contaminants(self, processor):
        """Remove contaminant PSMs."""
        df = pd.DataFrame({
            'Sequence': ['PEP1', 'PEP2', 'PEP3'],
            'Modifications': ['', '', ''],
            'Charge': [2, 2, 2],
            'Contaminant': [True, False, False],
            'Master Protein Accessions': ['P1', 'P2', 'P3'],
            'Quan_Info': ['Valid', 'Valid', 'Valid'],
            'Abundance': [100.0, 200.0, 300.0],  # Note: renamed to Abundance
            'Abundance F1 Sample': [100.0, 200.0, 300.0],
        })

        result = processor.step4_remove_low_quality(df)

        assert len(result) == 2
        assert 'PEP1' not in result['Sequence'].values

    def test_step4_remove_no_value_quan(self, processor):
        """Remove PSMs with no value in Quan Info."""
        df = pd.DataFrame({
            'Sequence': ['PEP1', 'PEP2', 'PEP3'],
            'Modifications': ['', '', ''],
            'Charge': [2, 2, 2],
            'Contaminant': [False, False, False],
            'Master Protein Accessions': ['P1', 'P2', 'P3'],
            'Quan_Info': ['No Value', 'Valid', 'Valid'],
            'Abundance': [100.0, 200.0, 300.0],
            'Abundance F1 Sample': [100.0, 200.0, 300.0],
        })

        result = processor.step4_remove_low_quality(df)

        assert len(result) == 2
        assert 'PEP1' not in result['Sequence'].values

    def test_step4_remove_low_abundance(self, processor):
        """Remove PSMs with abundance < 1."""
        df = pd.DataFrame({
            'Sequence': ['PEP1', 'PEP2', 'PEP3'],
            'Modifications': ['', '', ''],
            'Charge': [2, 2, 2],
            'Contaminant': [False, False, False],
            'Master Protein Accessions': ['P1', 'P2', 'P3'],
            'Quan_Info': ['Valid', 'Valid', 'Valid'],
            'Abundance': [0.5, 200.0, 300.0],
            'Abundance F1 Sample': [0.5, 200.0, 300.0],
        })

        result = processor.step4_remove_low_quality(df)

        assert len(result) == 2
        assert 'PEP1' not in result['Sequence'].values

    def test_step5_lenient_filtering(self, processor):
        """Test lenient filtering (allows more missing values)."""
        # Create data with some missing values - needs Unique_PSM, Condition and Replicate columns
        df = pd.DataFrame({
            'Sequence': ['PEP1', 'PEP2', 'PEP3', 'PEP4'],
            'Modifications': ['', '', '', ''],
            'Charge': [2, 2, 2, 2],
            'Contaminant': [False, False, False, False],
            'Master Protein Accessions': ['P1', 'P2', 'P3', 'P4'],
            'Quan_Info': ['Valid', 'Valid', 'Valid', 'Valid'],
            'Unique_PSM': ['PEP1||2', 'PEP2||2', 'PEP3||2', 'PEP4||2'],
            'Condition': ['DMSO', 'DMSO', 'DMSO', 'DMSO'],
            'Replicate': [1, 2, 3, 4],
            'Abundance': [100.0, 200.0, 300.0, 400.0],
            'Abundance F1 Sample': [100.0, np.nan, 300.0, 400.0],
            'Abundance F2 Sample': [100.0, 200.0, np.nan, 400.0],
        })

        result = processor.step5_filter_by_criteria(df)

        # Should keep rows with lenient filtering
        assert len(result) > 0

    def test_processing_config_defaults(self):
        """Test ProcessingConfig default values."""
        from app.services.data_processor import ProcessingConfig

        config = ProcessingConfig()

        assert config.remove_razor is False
        assert config.strict_filtering is False

    def test_processing_config_custom(self):
        """Test ProcessingConfig with custom values."""
        from app.services.data_processor import ProcessingConfig

        config = ProcessingConfig(remove_razor=True, strict_filtering=True)

        assert config.remove_razor is True
        assert config.strict_filtering is True
