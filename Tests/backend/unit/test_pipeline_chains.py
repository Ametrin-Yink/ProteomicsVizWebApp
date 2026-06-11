"""E2E chain tests: run ALL pipeline steps sequentially through shared StepContext.

Python steps run with real DataProcessor. R steps are mocked to create the
expected output files, allowing full-pipeline verification.
"""

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pandas as pd
import pytest

from app.models.analysis import AnalysisConfig, AnalysisResult, AnalysisTemplate, PipelineTool
from app.services.pipeline_engine import StepContext
from app.services.steps import (
    step_combine_replicates_msqrob2,
    step_combine_replicates_msstats,
    step_filter_criteria_default,
    step_generate_unique_psm_msqrob2,
    step_generate_unique_psm_msstats,
    step_multi_condition_de,
    step_msstats_group_comparison,
    step_msstats_protein_abundance,
    step_protein_abundance_msqrob2,
    step_qc_metrics,
    step_qc_metrics_msqrob2,
    step_remove_low_quality_default,
    step_remove_razor,
)


# ── Test data for R step mocks ──────────────────────────────────────────

def _write_protein_abundance_tsv(results_dir: Path) -> pd.DataFrame:
    """Write a realistic Protein_Abundances.tsv for R step mocks."""
    df = pd.DataFrame({
        "Protein": ["P00001", "P00002", "P00003", "P00004", "P00005"],
        "DMSO_1": [1000.0, 2000.0, 1500.0, 1200.0, 1800.0],
        "DMSO_2": [1100.0, 2100.0, 1600.0, 1300.0, 1900.0],
        "DMSO_3": [1050.0, 2050.0, 1550.0, 1250.0, 1850.0],
        "DrugA_1": [2000.0, 2000.0, 1500.0, 1200.0, 1800.0],
        "DrugA_2": [2100.0, 2100.0, 1600.0, 1300.0, 1900.0],
        "DrugA_3": [2050.0, 2050.0, 1550.0, 1250.0, 1850.0],
    })
    df.to_csv(results_dir / "Protein_Abundances.tsv", sep="\t", index=False)
    return df


def _write_diff_expression_tsv(results_dir: Path, comparison_label: str) -> pd.DataFrame:
    """Write a realistic Diff_Expression_*.tsv for R step mocks."""
    df = pd.DataFrame({
        "Master_Protein_Accessions": ["P00001", "P00002", "P00003", "P00004", "P00005"],
        "Gene_Name": ["GENE1", "GENE2", "GENE3", "GENE4", "GENE5"],
        "logFC": [2.0, -1.5, 0.5, 0.0, -2.0],
        "pval": [0.001, 0.01, 0.5, 0.8, 0.0001],
        "adjPval": [0.005, 0.05, 0.6, 0.9, 0.001],
    })
    out = results_dir / f"Diff_Expression_{comparison_label}.tsv"
    df.to_csv(out, sep="\t", index=False)
    return df


# ── Helpers ─────────────────────────────────────────────────────────────

_COMPARISONS = [
    {"group1": {"condition_1": "DrugA"}, "group2": {"condition_1": "DMSO"}}
]
_COMPARISON_LABEL = "DrugA_vs_DMSO"


def _make_ctx(
    pipeline: PipelineTool,
    file_paths: list[Path],
    tmp_path: Path,
    with_comparisons: bool = False,
) -> StepContext:
    """Create a StepContext for chain testing."""
    config = AnalysisConfig(
        template=AnalysisTemplate.MULTI_CONDITION,
        pipeline=pipeline,
        organism="human",
        remove_razor=True,
        strict_filtering=False,
        comparisons=_COMPARISONS if with_comparisons else [],
    )
    results_dir = tmp_path / "results"
    uploads_dir = tmp_path / "uploads"
    results_dir.mkdir(exist_ok=True)
    uploads_dir.mkdir(exist_ok=True)

    ctx = StepContext(
        config=config,
        session_id="chain-test-session",
        file_paths=file_paths,
        results_dir=results_dir,
        uploads_dir=uploads_dir,
    )
    ctx.psm_file_path = results_dir / "PSM_Combined.parquet"
    ctx.result = AnalysisResult(session_id="chain-test-session")
    return ctx


# ── Python-only chain tests ─────────────────────────────────────────────

class TestMSstatsChain_Python:
    """MSstats pipeline: Python steps 1-5 chain."""

    @pytest.mark.asyncio
    async def test_step1_creates_dataframe(self, pipeline_test_files, tmp_path):
        ctx = _make_ctx(PipelineTool.MSSTATS, pipeline_test_files, tmp_path)
        await step_combine_replicates_msstats(ctx)
        assert ctx.df is not None
        assert len(ctx.df) > 0
        assert ctx.psm_file_path.exists()

    @pytest.mark.asyncio
    async def test_step2_keeps_dataframe(self, pipeline_test_files, tmp_path):
        ctx = _make_ctx(PipelineTool.MSSTATS, pipeline_test_files, tmp_path)
        await step_combine_replicates_msstats(ctx)
        await step_generate_unique_psm_msstats(ctx)
        assert ctx.df is not None, "MSstats step 2 must keep ctx.df alive"

    @pytest.mark.asyncio
    async def test_full_chain_1_to_5(self, pipeline_test_files, tmp_path):
        """Python steps 1-5: ctx.df stays alive until step 5 frees it."""
        ctx = _make_ctx(PipelineTool.MSSTATS, pipeline_test_files, tmp_path)
        await step_combine_replicates_msstats(ctx)
        assert ctx.df is not None, "Step 1 must populate ctx.df"
        await step_generate_unique_psm_msstats(ctx)
        assert ctx.df is not None, "Step 2 must keep ctx.df"
        await step_remove_razor(ctx)
        assert ctx.df is not None, "Step 3 must keep ctx.df"
        await step_remove_low_quality_default(ctx)
        assert ctx.df is not None, "Step 4 must keep ctx.df"
        await step_filter_criteria_default(ctx)
        assert ctx.df is None, "Step 5 must free ctx.df before R steps"

    @pytest.mark.asyncio
    async def test_step3_razor_removes_multi_protein(self, pipeline_test_files, tmp_path):
        ctx = _make_ctx(PipelineTool.MSSTATS, pipeline_test_files, tmp_path)
        await step_combine_replicates_msstats(ctx)
        await step_generate_unique_psm_msstats(ctx)
        await step_remove_razor(ctx)
        assert ctx.df is not None
        multi = ctx.df["Master_Protein_Accessions"].str.contains(";").sum()
        assert multi == 0, f"Expected 0 multi-protein accessions, got {multi}"


class TestMsqrob2Chain_Python:
    """msqrob2 pipeline: Python steps 1-2 chain."""

    @pytest.mark.asyncio
    async def test_step2_frees_dataframe(self, pipeline_test_files, tmp_path):
        ctx = _make_ctx(PipelineTool.MSQROB2, pipeline_test_files, tmp_path)
        await step_combine_replicates_msqrob2(ctx)
        assert ctx.df is not None
        await step_generate_unique_psm_msqrob2(ctx)
        assert ctx.df is None, "msqrob2 step 2 must free ctx.df for R step 3"

    @pytest.mark.asyncio
    async def test_parquet_persisted_after_step2(self, pipeline_test_files, tmp_path):
        ctx = _make_ctx(PipelineTool.MSQROB2, pipeline_test_files, tmp_path)
        await step_combine_replicates_msqrob2(ctx)
        await step_generate_unique_psm_msqrob2(ctx)
        assert ctx.df is None
        df = pd.read_parquet(ctx.psm_file_path)
        assert len(df) > 0
        assert "Unique_PSM" in df.columns


# ── FULL pipeline E2E tests (with R steps mocked) ───────────────────────

class TestMsqrob2FullPipeline:
    """msqrob2: ALL 5 steps (Python 1-2 + mocked R 3-4 + QC 5)."""

    @pytest.mark.asyncio
    async def test_all_5_steps(self, pipeline_test_files, tmp_path):
        """Run the complete msqrob2 pipeline end-to-end."""
        ctx = _make_ctx(PipelineTool.MSQROB2, pipeline_test_files, tmp_path,
                        with_comparisons=True)
        results = ctx.results_dir

        # ── Steps 1-2: Python (real) ──
        await step_combine_replicates_msqrob2(ctx)
        assert ctx.df is not None
        await step_generate_unique_psm_msqrob2(ctx)
        assert ctx.df is None  # freed before R
        assert ctx.psm_file_path.exists()

        # ── Step 3: Protein abundance (mocked R) ──
        rds = results / "MSqRob2_Processed.rds"
        protein_df = _write_protein_abundance_tsv(results)

        async def fake_data_process(*args, **kwargs):
            protein_df.to_csv(results / "Protein_Abundances.tsv", sep="\t", index=False)
            rds.write_bytes(b"mock rds")

        with patch(
            "app.services.steps.protein_abundance.msqrob2_wrapper.data_process",
            new=AsyncMock(side_effect=fake_data_process),
        ):
            await step_protein_abundance_msqrob2(ctx)

        assert ctx.result.total_proteins == 5
        assert rds.exists()
        assert (results / "Protein_Abundances.tsv").exists()

        # ── Step 4: Differential expression (mocked R) ──
        with patch(
            "app.services.steps.multi_condition_de.msqrob2_wrapper.group_comparison_multi",
            new=AsyncMock(
                side_effect=lambda **kw: _write_diff_expression_tsv(results, _COMPARISON_LABEL)
            ),
        ):
            await step_multi_condition_de(ctx)

        assert ctx.result.significant_proteins > 0
        assert (results / f"Diff_Expression_{_COMPARISON_LABEL}.tsv").exists()

        # ── Step 5: QC metrics (real Python, reads TSV/parquet) ──
        await step_qc_metrics_msqrob2(ctx)

        qc_file = results / "QC_Results.json"
        assert qc_file.exists()
        assert ctx.result.qc_results_path == str(qc_file)


class TestMSstatsFullPipeline:
    """MSstats: ALL 8 steps (Python 1-5 + mocked R 6-7 + QC 8)."""

    @pytest.mark.asyncio
    async def test_all_8_steps(self, pipeline_test_files, tmp_path):
        """Run the complete MSstats pipeline end-to-end."""
        ctx = _make_ctx(PipelineTool.MSSTATS, pipeline_test_files, tmp_path,
                        with_comparisons=True)
        results = ctx.results_dir

        # ── Steps 1-5: Python (real) ──
        await step_combine_replicates_msstats(ctx)
        assert ctx.df is not None
        await step_generate_unique_psm_msstats(ctx)
        assert ctx.df is not None, "df must survive step 2"
        await step_remove_razor(ctx)
        assert ctx.df is not None, "df must survive step 3"
        await step_remove_low_quality_default(ctx)
        assert ctx.df is not None, "df must survive step 4"
        await step_filter_criteria_default(ctx)
        assert ctx.df is None, "df freed after step 5"

        # ── Step 6: Protein abundance (mocked MSstats R) ──
        rds = results / "MSstats_Processed.rds"
        protein_df = _write_protein_abundance_tsv(results)

        async def fake_data_process(*args, **kwargs):
            protein_df.to_csv(results / "Protein_Abundances.tsv", sep="\t", index=False)
            rds.write_bytes(b"mock rds")

        with patch(
            "app.services.steps.group_comparison_multi.msstats_wrapper.data_process",
            new=AsyncMock(side_effect=fake_data_process),
        ):
            await step_msstats_protein_abundance(ctx)

        assert ctx.result.total_proteins == 5
        assert rds.exists()

        # ── Step 7: Differential expression (mocked MSstats R) ──
        with patch(
            "app.services.steps.group_comparison_multi.msstats_wrapper.group_comparison_multi",
            new=AsyncMock(
                side_effect=lambda **kw: _write_diff_expression_tsv(results, _COMPARISON_LABEL)
            ),
        ):
            await step_msstats_group_comparison(ctx)

        assert ctx.result.significant_proteins > 0
        assert (results / f"Diff_Expression_{_COMPARISON_LABEL}.tsv").exists()

        # ── Step 8: QC metrics (real Python) ──
        await step_qc_metrics(ctx)

        qc_file = results / "QC_Results.json"
        assert qc_file.exists()
        assert ctx.result.qc_results_path == str(qc_file)


# ── Handler independence ────────────────────────────────────────────────

class TestPipelineHandlerIndependence:
    """Verify handler functions are separate — no shared handlers for steps 1-2."""

    def test_step1_handlers_are_different(self):
        assert step_combine_replicates_msqrob2 is not step_combine_replicates_msstats

    def test_step2_handlers_are_different(self):
        assert step_generate_unique_psm_msqrob2 is not step_generate_unique_psm_msstats

    def test_step2_df_behavior_differs(self):
        import inspect
        src_msqrob2 = inspect.getsource(step_generate_unique_psm_msqrob2)
        src_msstats = inspect.getsource(step_generate_unique_psm_msstats)
        assert "ctx.df = None" in src_msqrob2
        assert "ctx.df = None" not in src_msstats
