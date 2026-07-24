"""Tests for Pydantic data models — business logic and edge cases."""

import pytest
from app.models.data import (
    DataCompleteness,
    GSEAResult,
    GSEAResults,
    PCAResult,
    PValueDistribution,
    QCData,
)


class TestDataCompleteness:
    def test_completeness_pct_normal(self):
        dc = DataCompleteness(sample="S1", missing=2, present=8)
        assert dc.completeness_pct == 80.0

    def test_completeness_pct_all_missing(self):
        dc = DataCompleteness(sample="S1", missing=10, present=0)
        assert dc.completeness_pct == 0.0

    def test_completeness_pct_all_present(self):
        dc = DataCompleteness(sample="S1", missing=0, present=15)
        assert dc.completeness_pct == 100.0

    def test_completeness_pct_zero_total(self):
        dc = DataCompleteness(sample="S1", missing=0, present=0)
        assert dc.completeness_pct == 0.0  # division-by-zero guard


class TestGSEAResult:
    def test_significant_true(self):
        result = GSEAResult(
            term="TERM1", name="Term One",
            es=0.5, nes=1.5, pval=0.01, fdr=0.1,
            matched_genes=10,
        )
        assert result.significant is True

    def test_significant_nes_below_threshold(self):
        result = GSEAResult(
            term="TERM1", name="Term One",
            es=0.5, nes=0.9, pval=0.01, fdr=0.1,
            matched_genes=10,
        )
        assert result.significant is False

    def test_significant_fdr_above_threshold(self):
        result = GSEAResult(
            term="TERM1", name="Term One",
            es=0.5, nes=1.5, pval=0.01, fdr=0.3,
            matched_genes=10,
        )
        assert result.significant is False

    def test_significant_boundary_nes(self):
        result = GSEAResult(
            term="TERM1", name="Term One",
            es=0.5, nes=1.0, pval=0.01, fdr=0.1,
            matched_genes=10,
        )
        assert result.significant is True  # >= 1.0

    def test_enrichment_direction_overrepresented(self):
        result = GSEAResult(
            term="T", name="T", es=0.5, nes=2.0,
            pval=0.01, fdr=0.1, matched_genes=5,
        )
        assert result.enrichment_direction == "overrepresented"

    def test_enrichment_direction_underrepresented(self):
        result = GSEAResult(
            term="T", name="T", es=-0.5, nes=-2.0,
            pval=0.01, fdr=0.1, matched_genes=5,
        )
        assert result.enrichment_direction == "underrepresented"

    def test_enrichment_direction_neutral(self):
        result = GSEAResult(
            term="T", name="T", es=0.0, nes=0.0,
            pval=0.5, fdr=0.5, matched_genes=5,
        )
        assert result.enrichment_direction == "neutral"

    def test_validation_rejects_invalid_pval(self):
        with pytest.raises(Exception):  # Pydantic validation error
            GSEAResult(
                term="T", name="T", es=0, nes=0,
                pval=1.5, fdr=0.1, matched_genes=5,
            )


class TestPCAResult:
    def test_construction(self):
        pca = PCAResult(
            samples=["S1", "S2"],
            pc1=[1.0, -1.0],
            pc2=[0.5, -0.5],
            conditions=["A", "B"],
            pc1_variance=80.0,
            pc2_variance=20.0,
        )
        assert len(pca.samples) == 2
        assert pca.pc1_variance == 80.0


class TestGSEAResults:
    def test_construction_empty(self):
        results = GSEAResults(
            database="go_bp",
            total_pathways=0,
            significant_pathways=0,
            overrepresented=0,
            underrepresented=0,
        )
        assert results.results == []
        assert results.total_pathways == 0


class TestQCData:
    def test_construction_minimal(self):
        qc = QCData()
        assert qc.pca is None
        assert qc.total_psms is None

    def test_construction_full(self):
        qc = QCData(
            total_psms=100,
            total_proteins=30,
            completeness_rate=95.0,
        )
        assert qc.total_psms == 100
        assert qc.completeness_rate == 95.0
