"""Regression tests for PTM step completion behavior."""

import asyncio
from unittest.mock import AsyncMock, patch

import pandas as pd
from app.models.analysis import AnalysisConfig, AnalysisResult, PipelineTool
from app.services.pipeline_engine import StepContext
from app.services.steps.ptm_step3_comparison import (
    _filter_adjusted_results,
    step_ptm_group_comparison,
)
from app.services.steps.ptm_step4_qc import step_ptm_qc_metrics


class RecordingState:
    """Minimal state object with PipelineState's add_log contract."""

    def __init__(self) -> None:
        self.logs: list[tuple[str, str, int | None]] = []

    def add_log(self, level: str, message: str, step: int | None = None) -> None:
        self.logs.append((level, message, step))


def _make_context(tmp_path, comparisons=None) -> StepContext:
    config = AnalysisConfig(
        pipeline=PipelineTool.PTM,
        comparisons=comparisons or [],
    )
    ctx = StepContext(
        config=config,
        session_id="550e8400-e29b-41d4-a716-446655440000",
        file_paths=[],
        results_dir=tmp_path,
        uploads_dir=tmp_path,
    )
    ctx.state = RecordingState()
    ctx.result = AnalysisResult(session_id=ctx.session_id)
    return ctx


def test_ptm_group_comparison_logs_success_with_step(tmp_path):
    comparisons = [
        {"group1": {"Condition": "Drug"}, "group2": {"Condition": "Control"}}
    ]
    ctx = _make_context(tmp_path, comparisons)
    rds_file = tmp_path / "ptm_summarized.rds"
    rds_file.touch()
    ctx.step_outputs["rds_file"] = rds_file
    metadata = tmp_path / "ptm_site_metadata.tsv"
    pd.DataFrame(
        {
            "ProteinName": ["P1_C10"],
            "ProteinAccession": ["P1"],
            "SiteLabel": ["P1 · C10"],
        }
    ).to_csv(metadata, sep="\t", index=False)
    ctx.step_outputs["site_metadata_path"] = metadata
    ctx.current_step_number = 5

    async def write_result(**kwargs):
        pd.DataFrame(
            {
                "Protein": ["P1_C10"],
                "Label": ["Drug vs Control"],
                "log2FC": [1.0],
                "pvalue": [0.01],
                "adj.pvalue": [0.02],
            }
        ).to_csv(
            kwargs["output_dir"] / "PTM_Model_Drug_vs_Control.tsv",
            sep="\t",
            index=False,
        )

    with patch(
        "app.services.steps.ptm_step3_comparison.ptm_wrapper.group_comparison_multi",
        new=AsyncMock(side_effect=write_result),
    ):
        asyncio.run(step_ptm_group_comparison(ctx))

    assert ctx.state.logs[-1] == ("info", "PTM group comparison complete", 5)


def test_adjusted_results_require_a_quantified_matching_protein():
    metadata = pd.DataFrame(
        {
            "ProteinName": ["P1_C10", "P2-2_C20", "P3_C30"],
            "ProteinAccession": ["P1", "P2-2", "P3"],
        }
    )
    results = pd.DataFrame(
        {
            "Protein": ["P1_C10", "P2-2_C20", "P3_C30"],
            "GlobalProtein": ["P1", "P2", "P3"],
            "Adjusted": [True, True, True],
        }
    )

    filtered = _filter_adjusted_results(results, metadata, {"P1", "P2"})

    assert filtered["Protein"].tolist() == ["P1_C10", "P2-2_C20"]
    assert filtered["ProteinMatch"].tolist() == ["exact", "canonical_fallback"]


def test_ptm_qc_logs_success_with_step(tmp_path):
    ctx = _make_context(tmp_path)
    de_file = tmp_path / "ptm_site_results.tsv"
    pd.DataFrame(
        {
            "adj.pvalue": [0.01, 0.5],
            "log2FC": [1.0, -1.0],
            "Status": ["Estimated", "Estimated"],
        }
    ).to_csv(de_file, sep="\t", index=False)
    ctx.step_outputs["ptm_results_path"] = de_file
    ctx.current_step_number = 6

    asyncio.run(step_ptm_qc_metrics(ctx))

    assert ctx.state.logs[-1] == (
        "info",
        "PTM QC metrics and result ZIP complete",
        6,
    )
