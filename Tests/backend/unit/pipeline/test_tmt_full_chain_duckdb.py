"""Full TMT pipeline chain test with DuckDB streaming (Steps 1-5, R mocked)."""

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pandas as pd
import pytest
from app.models.analysis import (
    AnalysisConfig,
    AnalysisResult,
    AnalysisTemplate,
    PipelineTool,
)
from app.services.pipeline_engine import StepContext

# Reuse helpers from test_tmt_duckdb_streaming
from Tests.backend.unit.pipeline.test_tmt_duckdb_streaming import (
    _make_channel_mapping,
    _write_tmt_csv,
)


def _write_protein_abundance_tsv(results_dir: Path) -> pd.DataFrame:
    """Write a realistic Protein_Abundances.tsv for R step mock."""
    df = pd.DataFrame(
        {
            "Master_Protein_Accessions": ["P00001", "P00003"],
            "Gene_Name": ["GENE1", "GENE3"],
            "PSM_Count": [2, 1],
            "DMSO_24h_1": [1000.0, 1500.0],
            "DrugA_24h_1": [2000.0, 1500.0],
        }
    )
    df.to_csv(results_dir / "Protein_Abundances.tsv", sep="\t", index=False)
    return df


def _write_diff_expression_tsv(results_dir: Path, label: str) -> pd.DataFrame:
    """Write a realistic Diff_Expression_*.tsv for R step mock."""
    df = pd.DataFrame(
        {
            "Master_Protein_Accessions": ["P00001", "P00003"],
            "Gene_Name": ["GENE1", "GENE3"],
            "logFC": [2.0, 0.0],
            "pval": [0.001, 0.5],
            "adjPval": [0.005, 0.6],
        }
    )
    out = results_dir / f"Diff_Expression_{label}.tsv"
    df.to_csv(out, sep="\t", index=False)
    return df


_COMPARISONS = [{"group1": {"Condition": "DrugA_24h"}, "group2": {"Condition": "DMSO_24h"}}]
_COMPARISON_LABEL = "DrugA_24h_vs_DMSO_24h"


class TestTMTFullChainDuckDB:
    """Full TMT pipeline (Steps 1-8) with DuckDB streaming and mocked R."""

    @pytest.mark.asyncio
    async def test_full_chain_duckdb(self, tmp_path):
        """All 8 steps complete with DuckDB streaming for Steps 1-2."""

        from app.services.steps.engines.step_msstats_abundance import (
            step_msstats_protein_abundance,
        )
        from app.services.steps.engines.step_msstats_de import (
            step_msstats_group_comparison,
        )
        from app.services.steps.inputs.step_input_tmt import step_input_tmt
        from app.services.steps.shared.step_filter_criteria import (
            step_filter_criteria_default,
        )
        from app.services.steps.shared.step_qc_metrics import step_qc_metrics
        from app.services.steps.shared.step_remove_low_quality import (
            step_remove_low_quality_default,
        )
        from app.services.steps.shared.step_remove_razor import step_remove_razor
        from app.services.steps.shared.step_unique_psm import step_unique_psm

        # Create test input
        csv_path = tmp_path / "test_tmt.txt"
        _write_tmt_csv(csv_path)
        mapping = _make_channel_mapping()

        results_dir = tmp_path / "results"
        uploads_dir = tmp_path / "uploads"
        results_dir.mkdir(exist_ok=True)
        uploads_dir.mkdir(exist_ok=True)

        psm_path = results_dir / "PSM_Combined.parquet"

        config = AnalysisConfig(
            template=AnalysisTemplate.MULTI_CONDITION,
            pipeline=PipelineTool.MSSTATS,
            organism="human",
            remove_razor=True,
            strict_filtering=False,
            file_type="tmt",
            tmt_channel_mapping=mapping,
            comparisons=_COMPARISONS,
        )

        ctx = StepContext(
            config=config,
            session_id="full-chain-duckdb",
            file_paths=[csv_path],
            results_dir=results_dir,
            uploads_dir=uploads_dir,
        )
        ctx.psm_file_path = psm_path
        ctx.result = AnalysisResult(session_id="full-chain-duckdb")

        # Step 1: TMT input (DuckDB streaming)
        await step_input_tmt(ctx)
        assert ctx.df is None, "DuckDB mode: df loaded from parquet for Steps 2-5"
        assert psm_path.exists(), "PSM_Combined.parquet must exist"
        assert 2 in ctx.step_outputs, "Step 2 must be pre-marked as done"
        psms_after_step1 = ctx.result.total_psms
        assert psms_after_step1 > 0, "Must have PSMs after Step 1"

        # Step 2: Unique PSM (re-generates on parquet-loaded df)
        await step_unique_psm(ctx)
        assert ctx.df is None, "Step 2 must keep df alive"

        # Step 3: Remove razor (in-memory)
        await step_remove_razor(ctx)
        assert ctx.df is None, "Step 3 keeps df alive for in-memory processing"
        assert psm_path.exists()

        # Step 4: Remove low quality (in-memory)
        await step_remove_low_quality_default(ctx)
        assert ctx.df is None, "Step 4 keeps df alive for in-memory processing"

        # Step 5: Filter criteria (in-memory, frees df)
        await step_filter_criteria_default(ctx)
        assert ctx.df is None, "Step 5 frees ctx.df before R steps"

        # Step 6: Protein abundance (mocked MSstats R)
        rds = results_dir / "MSstats_Processed.rds"
        protein_df = _write_protein_abundance_tsv(results_dir)

        async def fake_data_process(*args, **kwargs):
            protein_df.to_csv(
                results_dir / "Protein_Abundances.tsv", sep="\t", index=False
            )
            rds.write_bytes(b"mock rds")

        with patch(
            "app.services.steps.engines.step_msstats_abundance.msstats_wrapper.data_process",
            new=AsyncMock(side_effect=fake_data_process),
        ):
            await step_msstats_protein_abundance(ctx)

        assert ctx.result.total_proteins == 2
        assert rds.exists()

        # Step 7: Differential expression (mocked MSstats R)
        with patch(
            "app.services.steps.engines.step_msstats_de.msstats_wrapper.group_comparison_multi",
            new=AsyncMock(
                side_effect=lambda **kw: _write_diff_expression_tsv(
                    results_dir, _COMPARISON_LABEL
                )
            ),
        ):
            await step_msstats_group_comparison(ctx)

        assert ctx.result.significant_proteins > 0
        assert (results_dir / f"Diff_Expression_{_COMPARISON_LABEL}.tsv").exists()

        # Step 8: QC metrics
        await step_qc_metrics(ctx)
        assert (results_dir / "QC_Results.json").exists()
        assert ctx.result.qc_results_path is not None

