import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from app.models.analysis import AnalysisConfig, AnalysisResult, PipelineTool
from app.services.pipeline_engine import StepContext
from app.services.steps.engines.step_msstats_de import step_msstats_group_comparison


def _make_ctx(comparisons, tmp_path, **config_overrides):
    """Create a real StepContext with a real AnalysisConfig and temp dirs."""
    results_dir = tmp_path / "results"
    results_dir.mkdir()

    config_kwargs = dict(
        pipeline=PipelineTool.MSSTATS,
        organism="human",
        comparisons=comparisons,
        msstats_log_base=2,
        msstats_save_fitted_models=True,
        pvalue_threshold=0.05,
    )
    config_kwargs.update(config_overrides)
    config = AnalysisConfig(**config_kwargs)

    # Create the RDS file so the step handler doesn't early-exit
    rds_file = results_dir / "MSstats_Processed.rds"
    rds_file.touch()

    ctx = StepContext(
        config=config,
        session_id="550e8400-e29b-41d4-a716-446655440001",
        file_paths=[],
        results_dir=results_dir,
        uploads_dir=tmp_path,
    )
    ctx.result = AnalysisResult(session_id=ctx.session_id)
    return ctx


@pytest.fixture
def mock_msstats():
    with patch(
        "app.services.steps.engines.step_msstats_de.msstats_wrapper"
    ) as mock:
        mock.group_comparison_multi = AsyncMock()
        mock.group_comparison_batched = AsyncMock()
        yield mock


class TestStepMsstatsBatched:
    def test_uses_batched_path_when_above_threshold(self, mock_msstats, tmp_path):
        comparisons = [
            {"group1": {"Condition": f"A{i}"}, "group2": {"Condition": f"B{i}"}}
            for i in range(15)
        ]
        ctx = _make_ctx(comparisons, tmp_path)

        with patch(
            "app.services.steps.engines.step_msstats_de.settings"
        ) as mock_settings:
            mock_settings.msstats_batch_size = 10
            mock_settings.msstats_max_workers = 4
            mock_settings.msstats_n_cores_cap = 32

            asyncio.run(step_msstats_group_comparison(ctx))

        mock_msstats.group_comparison_batched.assert_called_once()
        mock_msstats.group_comparison_multi.assert_not_called()

    def test_uses_single_path_when_below_threshold(self, mock_msstats, tmp_path):
        comparisons = [
            {"group1": {"Condition": f"A{i}"}, "group2": {"Condition": f"B{i}"}}
            for i in range(4)
        ]
        ctx = _make_ctx(comparisons, tmp_path)

        with patch(
            "app.services.steps.engines.step_msstats_de.settings"
        ) as mock_settings:
            mock_settings.msstats_batch_size = 10

            asyncio.run(step_msstats_group_comparison(ctx))

        mock_msstats.group_comparison_multi.assert_called_once()
        mock_msstats.group_comparison_batched.assert_not_called()

    def test_uses_single_path_at_threshold_boundary(self, mock_msstats, tmp_path):
        comparisons = [
            {"group1": {"Condition": f"A{i}"}, "group2": {"Condition": f"B{i}"}}
            for i in range(10)
        ]
        ctx = _make_ctx(comparisons, tmp_path)

        with patch(
            "app.services.steps.engines.step_msstats_de.settings"
        ) as mock_settings:
            mock_settings.msstats_batch_size = 10

            asyncio.run(step_msstats_group_comparison(ctx))

        mock_msstats.group_comparison_multi.assert_called_once()
        mock_msstats.group_comparison_batched.assert_not_called()

    def test_treatment_control_comparison_records_consolidated_result(
        self, mock_msstats, tmp_path
    ):
        ctx = _make_ctx([], tmp_path, treatment="Drug", control="Control")

        with patch(
            "app.services.steps.engines.step_msstats_de.settings"
        ) as mock_settings:
            mock_settings.msstats_batch_size = 10

            asyncio.run(step_msstats_group_comparison(ctx))

        assert ctx.result.diff_expression_path.endswith(
            "Differential_Results_Long.tsv"
        )
