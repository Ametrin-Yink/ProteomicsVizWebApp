import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.services.pipeline_engine import StepContext
from app.services.steps.engines.step_msstats_de import step_msstats_group_comparison


class FakeConfig:
    def __init__(
        self,
        comparisons,
        organism="Human",
        treatment=None,
        control=None,
        msstats_log_base=2,
        msstats_save_fitted_models=True,
        pvalue_threshold=0.05,
    ):
        self.comparisons = comparisons
        self.organism = organism
        self.treatment = treatment
        self.control = control
        self.msstats_log_base = msstats_log_base
        self.msstats_save_fitted_models = msstats_save_fitted_models
        self.pvalue_threshold = pvalue_threshold
        self.metadata = {}
        self.covariate_columns = None


class TestStepMsstatsBatched:
    def make_ctx(self, config, results_dir):
        """Create mock StepContext with writable results_dir containing MSstats_Processed.rds."""
        rds_file = results_dir / "MSstats_Processed.rds"
        rds_file.touch()  # so the step handler skips the early-exit FileNotFoundError
        ctx = MagicMock(spec=StepContext)
        ctx.config = config
        ctx.results_dir = results_dir
        ctx.timeout_multiplier = 1
        ctx.step_outputs = {}
        ctx.result = MagicMock()
        ctx.result.diff_expression_path = ""
        ctx.result.significant_proteins = 0
        ctx.state = MagicMock()
        return ctx

    @pytest.fixture
    def mock_msstats(self):
        with patch(
            "app.services.steps.engines.step_msstats_de.msstats_wrapper"
        ) as mock:
            mock.group_comparison_multi = AsyncMock()
            mock.group_comparison_batched = AsyncMock()
            yield mock

    def test_uses_batched_path_when_above_threshold(self, mock_msstats, tmp_path):
        """When comparisons > msstats_batch_size, use group_comparison_batched."""
        with patch(
            "app.services.steps.engines.step_msstats_de.settings"
        ) as mock_settings:
            mock_settings.msstats_batch_size = 10
            mock_settings.msstats_max_workers = 4
            mock_settings.msstats_n_cores_cap = 32

            comparisons = [
                {"group1": {"Condition": f"A{i}"}, "group2": {"Condition": f"B{i}"}}
                for i in range(15)
            ]
            config = FakeConfig(comparisons=comparisons)
            ctx = self.make_ctx(config, tmp_path)

            asyncio.run(step_msstats_group_comparison(ctx))

            mock_msstats.group_comparison_batched.assert_called_once()
            mock_msstats.group_comparison_multi.assert_not_called()

    def test_uses_single_path_when_below_threshold(self, mock_msstats, tmp_path):
        """When comparisons <= msstats_batch_size, use group_comparison_multi."""
        with patch(
            "app.services.steps.engines.step_msstats_de.settings"
        ) as mock_settings:
            mock_settings.msstats_batch_size = 10

            comparisons = [
                {"group1": {"Condition": f"A{i}"}, "group2": {"Condition": f"B{i}"}}
                for i in range(4)
            ]
            config = FakeConfig(comparisons=comparisons)
            ctx = self.make_ctx(config, tmp_path)

            asyncio.run(step_msstats_group_comparison(ctx))

            mock_msstats.group_comparison_multi.assert_called_once()
            mock_msstats.group_comparison_batched.assert_not_called()

    def test_uses_single_path_at_threshold_boundary(self, mock_msstats, tmp_path):
        """When comparisons == msstats_batch_size, use group_comparison_multi."""
        with patch(
            "app.services.steps.engines.step_msstats_de.settings"
        ) as mock_settings:
            mock_settings.msstats_batch_size = 10

            comparisons = [
                {"group1": {"Condition": f"A{i}"}, "group2": {"Condition": f"B{i}"}}
                for i in range(10)
            ]
            config = FakeConfig(comparisons=comparisons)
            ctx = self.make_ctx(config, tmp_path)

            asyncio.run(step_msstats_group_comparison(ctx))

            mock_msstats.group_comparison_multi.assert_called_once()
            mock_msstats.group_comparison_batched.assert_not_called()
