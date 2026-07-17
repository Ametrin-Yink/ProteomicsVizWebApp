"""Regression tests for PTM step completion behavior."""

import asyncio
from unittest.mock import AsyncMock, patch

import pandas as pd
from app.models.analysis import AnalysisConfig, AnalysisResult, PipelineTool
from app.services.pipeline_engine import StepContext
from app.services.steps.ptm_step3_comparison import step_ptm_group_comparison
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

    with patch(
        "app.services.steps.ptm_step3_comparison.ptm_wrapper.group_comparison_multi",
        new=AsyncMock(),
    ):
        asyncio.run(step_ptm_group_comparison(ctx))

    assert ctx.state.logs[-1] == ("info", "PTM group comparison complete", 3)


def test_ptm_qc_logs_success_with_step(tmp_path):
    ctx = _make_context(tmp_path)
    de_file = tmp_path / "Diff_Expression_Drug_vs_Control.tsv"
    pd.DataFrame({"adjPval": [0.01, 0.5], "logFC": [1.0, -1.0]}).to_csv(
        de_file, sep="\t", index=False
    )
    ctx.step_outputs["de_paths"] = [de_file]

    asyncio.run(step_ptm_qc_metrics(ctx))

    assert ctx.state.logs[-1] == ("info", "PTM QC metrics complete", 4)
