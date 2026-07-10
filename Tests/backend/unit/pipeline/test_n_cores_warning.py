"""Test that explicit n_cores=1 triggers a warning log."""

import logging
import pytest
from unittest.mock import AsyncMock, patch


class TestNCoresWarning:
    """Verify warning when n_cores=1 is explicitly set."""

    @pytest.mark.asyncio
    async def test_explicit_ncores_1_logs_warning(self, caplog):
        """Setting n_cores=1 explicitly should log a performance warning."""
        from app.services.base_r_wrapper import BaseRWrapper, _safe_log

        caplog.set_level(logging.WARNING)

        # We need a concrete subclass — use MsstatsWrapper
        from app.services.msstats_wrapper import msstats_wrapper

        # Monkey-patch _resolve_n_cores to bypass calibration (we just want
        # to test the warning path when explicit==1)
        from app.models.analysis import AnalysisConfig
        from pathlib import Path

        config = AnalysisConfig(msstats_n_cores=1)
        dummy_file = Path("/nonexistent/input.parquet")

        # Call _resolve_n_cores — it should log a warning about n_cores=1
        result = await msstats_wrapper._resolve_n_cores(
            config, "msstats_n_cores", dummy_file, log_callback=None
        )

        assert result == 1
        # Check that a WARNING was logged about n_cores=1
        warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
        assert len(warnings) > 0, (
            "Expected at least one warning when n_cores=1 is explicitly set"
        )
        assert any("n_cores=1" in str(r.message) for r in warnings), (
            "Warning should mention n_cores=1"
        )
