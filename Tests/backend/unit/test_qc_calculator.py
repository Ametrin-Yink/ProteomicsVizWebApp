"""Unit tests for QC calculator functions."""

import numpy as np
import pandas as pd
import pytest

from app.services.qc_calculator import QCCalculator


@pytest.fixture
def calculator():
    """Fixture for QCCalculator instance."""
    return QCCalculator()


class TestCalculatePCA:
    """Tests for _calculate_pca."""

    def test_returns_pca_result_with_2d_coordinates(self, calculator):
        """PCA with 3+ abundance columns produces 2D coordinates and variance > 0."""
        rng = np.random.default_rng(42)
        data = {
            "Master Protein Accessions": ["Prot1", "Prot2", "Prot3", "Prot4", "Prot5"],
            "Gene_Name": ["GeneA", "GeneB", "GeneC", "GeneD", "GeneE"],
            "DMSO_1": rng.uniform(20, 30, 5),
            "DMSO_2": rng.uniform(20, 30, 5),
            "DMSO_3": rng.uniform(20, 30, 5),
            "Treatment_1": rng.uniform(25, 35, 5),
            "Treatment_2": rng.uniform(25, 35, 5),
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_pca(df)

        assert len(result.samples) == 5
        assert len(result.pc1) == 5
        assert len(result.pc2) == 5
        assert len(result.conditions) == 5
        assert 0 < result.pc1_variance <= 100
        assert 0 <= result.pc2_variance <= 100

    def test_excludes_metadata_columns(self, calculator):
        """ID/metadata columns like PSM_Count, Gene_Name are excluded from PCA."""
        rng = np.random.default_rng(42)
        data = {
            "Master Protein Accessions": ["Prot1", "Prot2", "Prot3"],
            "Gene_Name": ["GeneA", "GeneB", "GeneC"],
            "PSM_Count": [10, 20, 15],
            "Master_Protein_Accessions": ["A1", "A2", "A3"],
            "Protein": ["P1", "P2", "P3"],
            "DMSO_1": rng.uniform(20, 30, 3),
            "DMSO_2": rng.uniform(20, 30, 3),
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_pca(df)

        assert len(result.samples) == 2
        assert result.samples == ["DMSO_1", "DMSO_2"]

    def test_insufficient_samples_returns_empty(self, calculator):
        """Fewer than 2 abundance columns returns empty PCAResult."""
        data = {
            "Master Protein Accessions": ["Prot1", "Prot2"],
            "DMSO_1": [25.0, 26.0],
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_pca(df)

        assert result.samples == []
        assert result.pc1 == []
        assert result.pc2 == []
        assert result.conditions == []
        assert result.pc1_variance == 0.0
        assert result.pc2_variance == 0.0

    def test_handles_nan_values(self, calculator):
        """NaN values are dropped before PCA, should not crash."""
        data = {
            "DMSO_1": [25.0, np.nan, 27.0, np.nan, 29.0],
            "DMSO_2": [30.0, 31.0, np.nan, 33.0, 34.0],
            "INCZ_1": [35.0, 36.0, 37.0, np.nan, 39.0],
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_pca(df)

        assert len(result.samples) == 3
        assert len(result.pc1) == 3

    def test_single_sample_after_nan_drop_returns_zeroed(self, calculator):
        """If dropping NaN leaves only one sample, PCA returns zeroed result."""
        data = {
            "DMSO_1": [25.0, np.nan, np.nan],
            "DMSO_2": [30.0, 31.0, np.nan],
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_pca(df)

        # After dropna, only 1 row remains for DMSO_2, data_t shape is (2,1)
        # PCA n_components becomes min(2, 1) = 1 -> pc2 all zeros
        assert len(result.samples) == 2
        assert len(result.pc2) == 2

    def test_variance_explained_is_percentage(self, calculator):
        """Variance explained values are between 0 and 100."""
        rng = np.random.default_rng(42)
        data = {
            "A_1": rng.normal(0, 1, 20),
            "A_2": rng.normal(0, 2, 20),
            "A_3": rng.normal(0, 3, 20),
            "B_1": rng.normal(5, 1, 20),
            "B_2": rng.normal(5, 2, 20),
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_pca(df)

        assert 0 < result.pc1_variance <= 100
        assert 0 <= result.pc2_variance <= 100


class TestExtractCondition:
    """Tests for _extract_condition."""

    def test_extracts_dmso(self, calculator):
        """DMSO pattern is detected."""
        assert calculator._extract_condition("DMSO_1") == "DMSO"
        assert calculator._extract_condition("DMSO_2") == "DMSO"
        assert calculator._extract_condition("Sample_DMSO_1") == "DMSO"
        assert calculator._extract_condition("Abundance F1 Sample_DMSO_1") == "DMSO"

    def test_extracts_incz_with_identifier(self, calculator):
        """INCZ identifier with number is preserved."""
        assert calculator._extract_condition("INCZ123456_2") == "INCZ123456"
        assert calculator._extract_condition("INCZ789_1") == "INCZ789"

    def test_extracts_incz_without_number(self, calculator):
        """INCZ without a following number returns 'INCZ'."""
        assert calculator._extract_condition("INCZ_1") == "INCZ"
        assert calculator._extract_condition("Sample_INCZ_1") == "INCZ"

    def test_extracts_control(self, calculator):
        """Control pattern is detected."""
        assert calculator._extract_condition("Control_1") == "Control"
        assert calculator._extract_condition("Control_2") == "Control"

    def test_extracts_dmso_case_insensitive(self, calculator):
        """DMSO detection is case-insensitive."""
        assert calculator._extract_condition("dmso_1") == "DMSO"

    def test_default_behavior_with_underscore_replicate(self, calculator):
        """Unknown patterns with _N suffix strip the replicate number."""
        assert calculator._extract_condition("Vehicle_1") == "Vehicle"
        assert calculator._extract_condition("Treatment_3") == "Treatment"

    def test_default_behavior_without_replicate(self, calculator):
        """Unknown patterns without _N return first part."""
        assert calculator._extract_condition("Unknown_ABC") == "Unknown"

    def test_default_no_underscore(self, calculator):
        """Single word without underscore returns as-is."""
        assert calculator._extract_condition("JustWord") == "JustWord"

    def test_multi_part_condition_with_digit_suffix(self, calculator):
        """Multi-part condition with trailing digit strips only the digit."""
        assert calculator._extract_condition("My_Condition_1") == "My_Condition"

    def test_extracts_treatment(self, calculator):
        """Treatment pattern is detected."""
        assert calculator._extract_condition("Treatment_1") == "Treatment"
        assert calculator._extract_condition("TREATMENT_2") == "Treatment"


class TestCalculateDataCompleteness:
    """Tests for _calculate_data_completeness."""

    def test_all_present_returns_zero_missing(self, calculator):
        """When all values are non-null, missing=0 and present=row count."""
        data = {
            "Master Protein Accessions": ["Prot1", "Prot2", "Prot3"],
            "DMSO_1": [25.0, 26.0, 27.0],
            "DMSO_2": [30.0, 31.0, 32.0],
        }
        df = pd.DataFrame(data)

        results = calculator._calculate_data_completeness(df)

        assert len(results) == 2
        for r in results:
            assert r.missing == 0, f"{r.sample} should have 0 missing"
            assert r.present == 3, f"{r.sample} should have 3 present"

    def test_with_some_nan_values(self, calculator):
        """NaN values are counted as missing."""
        data = {
            "DMSO_1": [25.0, 26.0, np.nan],
            "DMSO_2": [np.nan, 31.0, 32.0],
            "DMSO_3": [40.0, np.nan, np.nan],
        }
        df = pd.DataFrame(data)

        results = calculator._calculate_data_completeness(df)

        results_by_sample = {r.sample: r for r in results}
        assert results_by_sample["DMSO_1"].missing == 1
        assert results_by_sample["DMSO_1"].present == 2
        assert results_by_sample["DMSO_2"].missing == 1
        assert results_by_sample["DMSO_2"].present == 2
        assert results_by_sample["DMSO_3"].missing == 2
        assert results_by_sample["DMSO_3"].present == 1

    def test_returns_list_of_datacompleteness_objects(self, calculator):
        """Returns list of DataCompleteness objects."""
        data = {"A_1": [1.0, 2.0], "B_1": [3.0, np.nan]}
        df = pd.DataFrame(data)

        results = calculator._calculate_data_completeness(df)

        assert len(results) == 2
        for r in results:
            assert hasattr(r, "sample")
            assert hasattr(r, "missing")
            assert hasattr(r, "present")

    def test_excludes_metadata_columns(self, calculator):
        """Metadata columns are excluded from completeness calculation."""
        data = {
            "Master Protein Accessions": ["Prot1", "Prot2", "Prot3", "Prot4"],
            "Gene_Name": ["A", "B", "C", "D"],
            "PSM_Count": [10, 20, 15, 8],
            "Protein": ["P1", "P2", "P3", "P4"],
            "DMSO_1": [25.0, 26.0, 27.0, 28.0],
        }
        df = pd.DataFrame(data)

        results = calculator._calculate_data_completeness(df)

        samples = [r.sample for r in results]
        assert "DMSO_1" in samples
        assert "Master Protein Accessions" not in samples
        assert "Gene_Name" not in samples
        assert "PSM_Count" not in samples
        assert "Protein" not in samples


class TestCalculatePValueDistribution:
    """Tests for _calculate_pvalue_distribution."""

    def test_with_uniform_p_values(self, calculator):
        """Uniform p-values produce roughly equal counts across bins."""
        rng = np.random.default_rng(42)
        data = {
            "Protein": [f"Prot{i}" for i in range(100)],
            "pval": rng.uniform(0, 1, 100),
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_pvalue_distribution(df)

        assert len(result.bins) == 21  # 20 bins -> 21 edges
        assert len(result.counts) == 20
        assert sum(result.counts) == 100
        assert all(c >= 0 for c in result.counts)

    def test_all_significant_p_values(self, calculator):
        """All p-values near 0 produce counts concentrated in first bin."""
        rng = np.random.default_rng(42)
        data = {
            "Protein": [f"Prot{i}" for i in range(50)],
            "pval": rng.uniform(0, 0.05, 50),
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_pvalue_distribution(df)

        assert sum(result.counts) == 50
        # Most counts should be in the first few bins
        assert result.counts[0] > 0

    def test_handles_missing_pval_column(self, calculator):
        """No p-value column returns empty PValueDistribution."""
        data = {"Protein": ["Prot1", "Prot2"], "logFC": [1.0, -0.5]}
        df = pd.DataFrame(data)

        result = calculator._calculate_pvalue_distribution(df)

        assert result.bins == []
        assert result.counts == []

    def test_handles_empty_data(self, calculator):
        """Empty DataFrame returns empty PValueDistribution."""
        data = {"Protein": [], "pval": []}
        df = pd.DataFrame(data)

        result = calculator._calculate_pvalue_distribution(df)

        assert result.bins == []
        assert result.counts == []

    def test_filters_out_of_range_pvalues(self, calculator):
        """P-values outside [0, 1] are excluded."""
        data = {
            "Protein": ["Prot1", "Prot2", "Prot3", "Prot4", "Prot5"],
            "pval": [0.1, -0.5, 1.5, 0.5, 0.9],
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_pvalue_distribution(df)

        assert sum(result.counts) == 3  # -0.5 and 1.5 are filtered out

    def test_uses_alternative_pval_column_name(self, calculator):
        """Finds p-value column by 'pval' substring in column name."""
        data = {
            "Protein": [f"Prot{i}" for i in range(50)],
            "pvalue": np.random.uniform(0, 1, 50),
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_pvalue_distribution(df)

        assert len(result.bins) == 21
        assert len(result.counts) == 20
        assert sum(result.counts) == 50

    def test_custom_bin_count(self, calculator):
        """n_bins parameter controls the number of bins."""
        rng = np.random.default_rng(42)
        data = {"pval": rng.uniform(0, 1, 100)}
        df = pd.DataFrame(data)

        result = calculator._calculate_pvalue_distribution(df, n_bins=10)

        assert len(result.bins) == 11
        assert len(result.counts) == 10
        assert sum(result.counts) == 100


class TestCalculateCV:
    """Tests for _calculate_cv."""

    def test_identical_values_cv_zero(self, calculator):
        """Identical abundance values produce CV of 0 — returns box stats."""
        data = {
            "Unique_PSM": ["PSM1", "PSM1", "PSM1", "PSM2", "PSM2", "PSM2"],
            "Condition": ["DMSO", "DMSO", "DMSO", "DMSO", "DMSO", "DMSO"],
            "Abundance": [100.0, 100.0, 100.0, 200.0, 200.0, 200.0],
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_cv(df)

        assert "DMSO" in result
        stats = result["DMSO"]
        assert stats["q1"] == 0.0
        assert stats["median"] == 0.0
        assert stats["q3"] == 0.0

    def test_varied_values_cv_positive(self, calculator):
        """Different abundance values produce positive CV — returns box stats."""
        rng = np.random.default_rng(42)
        data = {
            "Unique_PSM": ["PSM1"] * 3 + ["PSM2"] * 3,
            "Condition": ["DMSO"] * 6,
            "Abundance": rng.uniform(50, 150, 6).tolist(),
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_cv(df)

        assert "DMSO" in result
        stats = result["DMSO"]
        assert stats["q3"] > 0
        assert "outliers" in stats
        assert "lowerfence" in stats

    def test_zero_mean_handled(self, calculator):
        """PSMs with abundance=0 are excluded (log2(0) is undefined)."""
        data = {
            "Unique_PSM": ["PSM1", "PSM1", "PSM1"],
            "Condition": ["DMSO", "DMSO", "DMSO"],
            "Abundance": [0.0, 0.0, 0.0],
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_cv(df)

        # Zero-abundance PSMs filtered out — no valid data for this condition
        assert result == {}

    def test_multiple_conditions(self, calculator):
        """Returns separate box stats per condition."""
        data = {
            "Unique_PSM": ["PSM1", "PSM1", "PSM2", "PSM2"],
            "Condition": ["DMSO", "DMSO", "Drug", "Drug"],
            "Abundance": [100.0, 110.0, 200.0, 210.0],
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_cv(df)

        assert "DMSO" in result
        assert "Drug" in result
        assert "q1" in result["DMSO"]

    def test_requires_minimum_two_replicates(self, calculator):
        """PSMs with fewer than 2 replicates are excluded — returns valid stats."""
        data = {
            "Unique_PSM": ["PSM1", "PSM1", "PSM1", "PSM2"],
            "Condition": ["DMSO", "DMSO", "DMSO", "DMSO"],
            "Abundance": [100.0, 100.0, 100.0, 200.0],
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_cv(df)

        assert "DMSO" in result
        stats = result["DMSO"]
        # PSM2 excluded (1 replicate), PSM1 CV=0 → all stats zero
        assert stats["q1"] == 0.0

    def test_no_condition_column_returns_empty(self, calculator):
        """Missing 'Condition' column returns empty dict."""
        data = {
            "Unique_PSM": ["PSM1", "PSM1"],
            "Abundance": [100.0, 110.0],
        }
        df = pd.DataFrame(data)

        result = calculator._calculate_cv(df)

        assert result == {}


class TestCalculateCompletenessRate:
    """Tests for _calculate_completeness_rate."""

    def test_100_percent_complete(self, calculator):
        """All data present -> 100.0."""
        from app.models.data import DataCompleteness

        completeness = [
            DataCompleteness(sample="A", missing=0, present=100),
            DataCompleteness(sample="B", missing=0, present=100),
        ]

        result = calculator._calculate_completeness_rate(completeness)

        assert result == 100.0

    def test_50_percent_complete(self, calculator):
        """Half data present -> 50.0."""
        from app.models.data import DataCompleteness

        completeness = [
            DataCompleteness(sample="A", missing=50, present=50),
            DataCompleteness(sample="B", missing=50, present=50),
        ]

        result = calculator._calculate_completeness_rate(completeness)

        assert result == 50.0

    def test_empty_input_returns_none(self, calculator):
        """Empty list returns None."""
        result = calculator._calculate_completeness_rate([])

        assert result is None

    def test_zero_total_returns_none(self, calculator):
        """When present+missing = 0, returns None."""
        from app.models.data import DataCompleteness

        completeness = [DataCompleteness(sample="A", missing=0, present=0)]

        result = calculator._calculate_completeness_rate(completeness)

        assert result is None

    def test_different_ratios(self, calculator):
        """Mixed ratios compute correctly."""
        from app.models.data import DataCompleteness

        completeness = [
            DataCompleteness(sample="A", missing=10, present=90),
            DataCompleteness(sample="B", missing=20, present=80),
        ]

        result = calculator._calculate_completeness_rate(completeness)

        # Total present = 170, total missing = 30, total = 200
        # Rate = (170 / 200) * 100 = 85.0
        assert result == 85.0
