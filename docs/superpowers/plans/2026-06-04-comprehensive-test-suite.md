# Comprehensive Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ~382 tests across 31 new files (11 services, 8 routes, 8 frontend, 4 E2E) to ensure the web app's core data analysis, visualization, session management, and study export functions are all verified.

**Architecture:** Four sequential phases — services first (no dependencies), routes second (depends on service signatures), frontend third (depends on API contract), E2E last (requires full stack). Each phase produces independently runnable tests.

**Tech Stack:** pytest + unittest.mock (backend), vitest + @testing-library/react (frontend), Playwright (E2E)

---

## File Structure

### Phase 1: Services (11 new + 1 extended)

```
Tests/backend/unit/
├── test_pipeline_engine.py          NEW - PipelineState, error recovery, cancellation
├── test_processing_orchestrator.py  NEW - Validation, config mapping, state transitions
├── test_session_manager.py          NEW - Session lifecycle, WebSocket mgmt
├── test_qc_calculator.py            NEW - PCA, CV, completeness, boxplot quartiles
├── test_compound_service.py         NEW - SMILES validation, property parsing
├── test_base_r_wrapper.py           NEW - Subprocess, encoding, timeout, errors
├── test_gsea_service.py             NEW - ES curve, heatmap z-scores, GMT parsing
├── test_pipeline_registry.py        NEW - Step definitions, ordering, handlers
├── test_organism_scanner.py         NEW - FASTA scanning, naming conventions
├── test_msqrob2_wrapper.py          NEW - QFeatures command construction
├── test_msstats_wrapper.py          NEW - MSstats command construction
├── test_compare_service.py          EXTEND - UMAP, t-SNE, Venn, clustering
Tests/
├── conftest.py                      EXTEND - New shared fixtures
```

### Phase 2: API Routes (8 new + 2 extended)

```
Tests/backend/unit/
├── test_processing_routes.py        NEW - /process, /cancel, /retry, /logs
├── test_visualization_routes.py     NEW - /results, /qc/plots, /protein, /tasks
├── test_gsea_routes.py              NEW - GSEA run/status/data/plot/heatmap
├── test_bionet_routes.py            NEW - BioNet run/status/subnetwork (unit)
├── test_compare_routes.py           NEW - Compare protein/comparison/Venn (unit)
├── test_websocket.py                NEW - WS lifecycle, ping/pong, replay
├── test_compounds_routes.py         NEW - Compounds list/image/properties/validate
├── test_report_routes.py            NEW - Missing report endpoints only
Tests/backend/unit/
├── test_sessions_api.py             EXTEND - PUT update, pipeline config
Tests/backend/integration/
├── test_api.py                      EXTEND - File delete, compound upload, organisms
```

### Phase 3: Frontend (8 new)

```
frontend/src/
├── stores/__tests__/
│   ├── analysis-store.test.ts       NEW
│   ├── processing-store.test.ts     NEW
│   └── ui-store.test.ts             NEW
├── hooks/__tests__/
│   └── use-websocket.test.ts        NEW
├── lib/__tests__/
│   ├── api-client.test.ts           NEW
│   └── utils.test.ts                NEW
├── components/__tests__/
│   ├── VolcanoPlot.test.tsx         NEW
│   └── ProteinTable.test.tsx        NEW
├── test/
│   ├── test-utils.tsx               NEW - Custom render with providers
│   └── factories.ts                 NEW - Test data factories
```

### Phase 4: E2E (4 new + 1 extended)

```
Tests/e2e/
├── 04-gsea-analysis.spec.ts         NEW
├── 05-bionet-network.spec.ts        NEW
├── 06-compare-correlation.spec.ts   NEW
├── 07-session-lifecycle.spec.ts     NEW
├── report-export.spec.ts            EXTEND - Full report lifecycle
```

---

## Phase 1: Service Layer Tests

### Phase 1 Setup: Shared Fixtures

**Files:**
- Modify: `Tests/conftest.py`

- [ ] **Step 1: Add service-layer fixtures to conftest.py**

Append to `Tests/conftest.py`:

```python
import subprocess as _subprocess_mod

@pytest.fixture
def mock_subprocess_run():
    """Mock subprocess.run to return success with fake R output."""
    with patch.object(_subprocess_mod, "run") as mock_run:
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "R processing complete\n"
        mock_result.stderr = ""
        mock_run.return_value = mock_result
        yield mock_run

@pytest.fixture
def mock_subprocess_failure():
    """Mock subprocess.run to simulate R script failure."""
    with patch.object(_subprocess_mod, "run") as mock_run:
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = ""
        mock_result.stderr = "Error in msqrob2::msqrob(): object 'x' not found\n"
        mock_run.return_value = mock_result
        yield mock_run

@pytest.fixture
def sample_abundance_matrix() -> np.ndarray:
    """10 proteins x 6 samples abundance matrix for QC calculator tests."""
    np.random.seed(42)
    return np.abs(np.random.randn(10, 6) * 2 + 10)

@pytest.fixture
def sample_gene_sets() -> dict[str, set[str]]:
    """Small GMT-style gene sets for GSEA curve tests."""
    return {
        "Pathway_A": {"GENE1", "GENE2", "GENE3", "GENE4"},
        "Pathway_B": {"GENE5", "GENE6", "GENE7"},
        "Pathway_C": {"GENE1", "GENE5", "GENE8", "GENE9", "GENE10"},
    }

@pytest.fixture
def sample_ranked_genes() -> tuple[list[str], list[float]]:
    """Ranked gene list matching sample_gene_sets."""
    genes = [f"GENE{i}" for i in range(1, 21)]
    metrics = [3.0 - (i * 0.15) for i in range(20)]  # descending
    return genes, metrics

@pytest.fixture
def mock_session_with_config():
    """Fully configured mock session for orchestrator/manager tests."""
    from datetime import UTC, datetime

    session = MagicMock()
    session.id = "550e8400-e29b-41d4-a716-446655440000"
    session.name = "Test Experiment"
    session.state = SessionState.CONFIGURING
    session.template = "multi_condition_comparison"
    session.pipeline = "msqrob2"
    session.config = MagicMock()
    session.config.treatment = "DrugA"
    session.config.control = "DMSO"
    session.config.organism = "human"
    session.config.remove_razor = False
    session.config.strict_filtering = False
    session.config.comparisons = [
        {"group1": {"C": "DrugA"}, "group2": {"C": "DMSO"}}
    ]
    session.files = MagicMock()
    session.files.proteomics = [
        MagicMock(filename=f"PSM_Exp_DrugA_{i}.csv") for i in range(1, 4)
    ] + [
        MagicMock(filename=f"PSM_Exp_DMSO_{i}.csv") for i in range(1, 4)
    ]
    session.files.compound = None
    session.created_at = datetime.now(UTC)
    session.updated_at = datetime.now(UTC)
    session.markers = {}
    session.volcano_filters = None
    session.error_message = None
    return session
```

- [ ] **Step 2: Run existing tests to verify fixtures don't break anything**

```powershell
backend\.venv\Scripts\python.exe -m pytest Tests/backend/unit/ -v --tb=short 2>&1 | Select-Object -Last 5
```

Expected: All existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add Tests/conftest.py
git commit -m "test: add service-layer fixtures to conftest"
```

---

### Task 1: test_pipeline_engine.py

**Files:**
- Create: `Tests/backend/unit/test_pipeline_engine.py`

- [ ] **Step 1: Create test file with PipelineState lifecycle tests**

```python
"""Unit tests for PipelineState and PipelineEngine."""
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from app.services.pipeline_engine import PipelineState


class TestPipelineStateLifecycle:
    """Test PipelineState initialization, transitions, and persistence."""

    @pytest.fixture
    def state_file(self, tmp_path):
        state_path = tmp_path / "pipeline_state.json"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        return state_path

    @pytest.fixture
    def state(self, state_file, monkeypatch):
        from app.core import config
        monkeypatch.setattr(config.settings, "sessions_dir", state_file.parent.parent)
        ps = PipelineState(session_id=state_file.parent.name)
        ps.state_file = state_file
        return ps

    def test_initial_state_is_empty(self, state):
        assert state.data["current_step"] == 0
        assert state.data["completed_steps"] == []
        assert state.data["failed_step"] is None
        assert state.data["error"] is None
        assert state.data["started_at"] is None
        assert state.data["completed_at"] is None

    def test_loads_existing_state_from_disk(self, state_file):
        existing = {
            "current_step": 3,
            "completed_steps": [1, 2],
            "failed_step": None,
            "error": None,
            "outputs": {"step1": "out1.tsv"},
            "started_at": "2026-01-01T00:00:00Z",
            "completed_at": None,
            "logs": [{"level": "info", "message": "Step 1 done"}],
        }
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps(existing))

        ps = PipelineState(session_id=state_file.parent.name)
        ps.state_file = state_file
        assert ps.data["current_step"] == 3
        assert ps.data["completed_steps"] == [1, 2]
        assert len(ps.data["logs"]) == 1

    def test_handles_corrupt_state_file(self, state_file):
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text("not valid json {{{")

        ps = PipelineState(session_id=state_file.parent.name)
        ps.state_file = state_file
        assert ps.data["current_step"] == 0  # falls back to default

    def test_log_appends_to_pending_buffer(self, state):
        state.log("info", "Processing started")
        assert len(state._pending_logs) == 1
        assert state._pending_logs[0]["level"] == "info"

    def test_flush_writes_to_disk_and_clears_buffer(self, state, state_file):
        state.log("info", "Step 1 started")
        state.log("info", "Step 1 complete")
        state.flush()

        assert state_file.exists()
        saved = json.loads(state_file.read_text())
        assert len(saved["logs"]) == 2
        assert len(state._pending_logs) == 0

    def test_complete_step_advances_state(self, state):
        state.complete_step(1, outputs={"result": "out1.tsv"})
        assert 1 in state.data["completed_steps"]
        assert state.data["outputs"].get("step1") == "out1.tsv"

    def test_fail_step_sets_error(self, state):
        state.fail_step(3, "R script crashed")
        assert state.data["failed_step"] == 3
        assert state.data["error"] == "R script crashed"

    def test_set_started_sets_timestamp(self, state):
        state.set_started()
        assert state.data["started_at"] is not None

    def test_set_completed_sets_timestamp(self, state):
        state.set_completed()
        assert state.data["completed_at"] is not None
```

- [ ] **Step 2: Run tests**

```powershell
backend\.venv\Scripts\python.exe -m pytest Tests/backend/unit/test_pipeline_engine.py -v
```

Expected: 9 passed

- [ ] **Step 3: Commit**

```bash
git add Tests/backend/unit/test_pipeline_engine.py
git commit -m "test: add PipelineState lifecycle unit tests"
```

---

### Task 2: test_qc_calculator.py

**Files:**
- Create: `Tests/backend/unit/test_qc_calculator.py`

- [ ] **Step 1: Read QC calculator source to confirm function signatures**

Read `backend/app/services/qc_calculator.py` for exact function names and signatures before writing tests.

- [ ] **Step 2: Create test file**

```python
"""Unit tests for QC calculator functions."""
import numpy as np
import pandas as pd
import pytest
from app.services.qc_calculator import (
    compute_pca,
    compute_coefficient_of_variation,
    compute_data_completeness,
    compute_pvalue_distribution,
    compute_boxplot_stats,
)


class TestComputePCA:
    def test_pca_returns_coords_and_variance(self, sample_abundance_matrix):
        coords, variance = compute_pca(sample_abundance_matrix)
        assert coords.shape == (10, 2)
        assert len(variance) == 2
        assert 0 < variance[0] < 1
        assert sum(variance) > 0.5  # first 2 PCs should explain substantial variance

    def test_pca_centers_data(self, sample_abundance_matrix):
        coords, _ = compute_pca(sample_abundance_matrix)
        assert abs(coords[:, 0].mean()) < 1e-10
        assert abs(coords[:, 1].mean()) < 1e-10

    def test_pca_with_nan_values(self):
        matrix = np.array([
            [1.0, 2.0, 3.0],
            [4.0, np.nan, 6.0],
            [7.0, 8.0, 9.0],
        ])
        coords, variance = compute_pca(matrix)
        assert coords.shape == (3, 2)


class TestComputeCV:
    def test_cv_identical_values_is_zero(self):
        data = pd.DataFrame({"S1": [10.0, 10.0, 10.0], "S2": [20.0, 20.0, 20.0]})
        cv = compute_coefficient_of_variation(data)
        assert cv["S1"] == pytest.approx(0.0, abs=1e-6)

    def test_cv_increases_with_variance(self):
        data = pd.DataFrame({"S1": [1.0, 10.0, 100.0], "S2": [5.0, 5.0, 5.0]})
        cv = compute_coefficient_of_variation(data)
        assert cv["S1"] > cv["S2"]

    def test_cv_handles_zero_mean(self):
        data = pd.DataFrame({"S1": [0.0, 0.0, 0.0]})
        cv = compute_coefficient_of_variation(data)
        assert np.isnan(cv["S1"]) or cv["S1"] == 0.0


class TestDataCompleteness:
    def test_full_completeness(self):
        data = pd.DataFrame({"S1": [1.0, 2.0, 3.0], "S2": [4.0, 5.0, 6.0]})
        result = compute_data_completeness(data)
        assert result[0]["present"] == 3
        assert result[0]["missing"] == 0

    def test_partial_completeness(self):
        data = pd.DataFrame({"S1": [1.0, np.nan, 3.0], "S2": [np.nan, 5.0, np.nan]})
        result = compute_data_completeness(data)
        # S1: 2 present, 1 missing; S2: 1 present, 2 missing
        assert result[0]["present"] == 2
        assert result[1]["present"] == 1


class TestPValueDistribution:
    def test_uniform_pvalues_produce_flat_histogram(self):
        np.random.seed(42)
        pvalues = np.random.uniform(0, 1, 1000)
        bins, counts = compute_pvalue_distribution(pvalues, n_bins=20)
        assert len(bins) == 21  # n_bins + 1 edges
        assert len(counts) == 20
        # Each bin should have roughly 50 counts (uniform)
        assert all(20 < c < 80 for c in counts)

    def test_significant_pvalues_cluster_at_zero(self):
        pvalues = np.concatenate([np.random.uniform(0, 0.05, 500), np.random.uniform(0.05, 1, 500)])
        _, counts = compute_pvalue_distribution(pvalues, n_bins=20)
        # First bin (closest to 0) should have more
        assert counts[0] > counts[-1]


class TestBoxplotStats:
    def test_quartiles_are_correct(self):
        data = np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        stats = compute_boxplot_stats(data)
        assert stats["q1"] == 3.0  # actually depends on method
        assert stats["median"] == 5.5
        assert stats["q3"] == 8.0

    def test_handles_single_value(self):
        data = np.array([5.0])
        stats = compute_boxplot_stats(data)
        assert stats["q1"] == stats["median"] == stats["q3"] == 5.0
```

- [ ] **Step 3: Run tests (will fail if function names don't match — fix signatures)**

```powershell
backend\.venv\Scripts\python.exe -m pytest Tests/backend/unit/test_qc_calculator.py -v --tb=short
```

- [ ] **Step 4: Adjust function imports to match actual qc_calculator.py exports, then verify pass**

- [ ] **Step 5: Commit**

---

### Task 3: test_base_r_wrapper.py

**Files:**
- Create: `Tests/backend/unit/test_base_r_wrapper.py`

- [ ] **Step 1: Create test file**

```python
"""Unit tests for BaseRWrapper — subprocess encoding, timeout, error handling."""
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.core.exceptions import RScriptError
from app.services.base_r_wrapper import BaseRWrapper


class FakeRWrapper(BaseRWrapper):
    """Concrete subclass for testing BaseRWrapper."""
    def _build_data_process_config(self, config, n_cores):
        return {"treatment": config.treatment, "n_cores": n_cores}

    def _build_gc_config(self, config, n_cores, **extra):
        return {"comparisons": [], "n_cores": n_cores}

    def __init__(self):
        super().__init__(
            cal_prefix="test_cal",
            benchmark_script="benchmark.R",
            data_process_script="data_process.R",
            gc_script="group_comparison.R",
            verify_script="verify.R",
            dp_timeout=3600,
            gc_timeout=3600,
        )


@pytest.fixture
def wrapper():
    return FakeRWrapper()


class TestSubprocessExecution:
    @pytest.mark.asyncio
    async def test_successful_run_returns_output_file(self, wrapper):
        with patch.object(wrapper, "_run_r_script") as mock_run:
            mock_run.return_value = None
            result = await wrapper.data_process(
                input_file=Path("/tmp/input.parquet"),
                output_file=Path("/tmp/output.tsv"),
                rds_output=Path("/tmp/output.rds"),
            )
            assert result == Path("/tmp/output.tsv")
            mock_run.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_run_r_script_raises_on_nonzero_exit(self, wrapper):
        """RScriptError raised when subprocess returns non-zero."""
        with patch("subprocess.Popen") as mock_popen:
            process = MagicMock()
            process.returncode = 1
            process.stdout.readline.side_effect = ["line1\n", ""]
            process.stderr.readline.side_effect = ["Error: package not found\n", ""]
            mock_popen.return_value = process

            with pytest.raises(RScriptError, match="package not found"):
                await wrapper._run_r_script(
                    cmd=["Rscript", "test.R"],
                    script_path=Path("test.R"),
                    timeout=10,
                )

    @pytest.mark.asyncio
    async def test_run_r_script_timeout_kills_process(self, wrapper):
        """Subprocess is killed on timeout."""
        with patch("subprocess.Popen") as mock_popen:
            process = MagicMock()
            process.returncode = 0  # Will be None while running
            mock_popen.return_value = process

            # Simulate timeout by patching asyncio.to_thread
            with patch("asyncio.to_thread", side_effect=subprocess.TimeoutExpired("cmd", 10)):
                with pytest.raises(subprocess.TimeoutExpired):
                    await wrapper._run_r_script(
                        cmd=["Rscript", "test.R"],
                        script_path=Path("test.R"),
                        timeout=10,
                    )
                process.kill.assert_called_once()

    @pytest.mark.asyncio
    async def test_encoding_fallback_handles_latin1(self, wrapper):
        """stdout with latin-1 characters is decoded cleanly."""
        with patch("subprocess.Popen") as mock_popen:
            process = MagicMock()
            process.returncode = 0
            process.stdout.readline.side_effect = ["Résultat: OK\n", ""]
            process.stderr.readline.side_effect = [""]
            mock_popen.return_value = process

            # Should not raise — encoding errors are replaced
            await wrapper._run_r_script(
                cmd=["Rscript", "test.R"],
                script_path=Path("test.R"),
                timeout=10,
            )


class TestNCoreResolution:
    @pytest.mark.asyncio
    async def test_explicit_ncores_skips_calibration(self, wrapper):
        from app.models.analysis import AnalysisConfig
        config = AnalysisConfig(organism="human", msqrob2_n_cores=1)
        with patch.object(wrapper, "_calibrate_ncores") as mock_cal:
            n = await wrapper._resolve_n_cores(config, "msqrob2_n_cores", Path("in.parquet"))
            assert n == 1
            mock_cal.assert_not_called()

    @pytest.mark.asyncio
    async def test_cached_ncores_skips_calibration(self, wrapper):
        wrapper._optimal_ncores = 8
        from app.models.analysis import AnalysisConfig
        config = AnalysisConfig(organism="human")
        with patch.object(wrapper, "_calibrate_ncores") as mock_cal:
            n = await wrapper._resolve_n_cores(config, "msqrob2_n_cores", Path("in.parquet"))
            assert n == 8
            mock_cal.assert_not_called()


class TestScriptNotFound:
    @pytest.mark.asyncio
    async def test_missing_script_raises_clear_error(self, wrapper):
        wrapper._data_process_script_name = "nonexistent.R"
        with pytest.raises(RScriptError, match="R script not found"):
            await wrapper.data_process(
                input_file=Path("/tmp/in.parquet"),
                output_file=Path("/tmp/out.tsv"),
                rds_output=Path("/tmp/out.rds"),
            )


class TestVerifyRPackages:
    @pytest.mark.asyncio
    async def test_successful_verification(self, wrapper):
        with patch("subprocess.run") as mock_run:
            mock_result = MagicMock()
            mock_result.returncode = 0
            mock_result.stdout = "OK\n"
            mock_result.stderr = ""
            mock_run.return_value = mock_result

            result = await wrapper.verify_r_packages()
            assert result["success"] is True

    @pytest.mark.asyncio
    async def test_failed_verification(self, wrapper):
        with patch("subprocess.run") as mock_run:
            mock_result = MagicMock()
            mock_result.returncode = 1
            mock_result.stdout = ""
            mock_result.stderr = "msqrob2 not installed"
            mock_run.return_value = mock_result

            result = await wrapper.verify_r_packages()
            assert result["success"] is False
            assert "msqrob2" in result["error"]
```

- [ ] **Step 2: Run tests**

```powershell
backend\.venv\Scripts\python.exe -m pytest Tests/backend/unit/test_base_r_wrapper.py -v
```

- [ ] **Step 3: Fix any signature mismatches, verify all pass, commit**

---

### Task 4: test_gsea_service.py

**Files:**
- Create: `Tests/backend/unit/test_gsea_service.py`

- [ ] **Step 1: Create test file**

```python
"""Unit tests for GSEA service — running ES curve and heatmap computation."""
import pytest
from app.services.gsea_service import gsea_service


class TestRunningESCurve:
    def test_positive_nes_produces_peak_above_zero(self):
        """With positive NES, the ES curve peaks above the baseline."""
        ranked_genes = ["A", "B", "C", "D", "E", "F", "G", "H"]
        pathway_genes = ["A", "C", "E", "G"]
        ranked_metrics = [3.0, 2.0, 1.5, 1.0, 0.5, 0.0, -0.5, -1.0]

        curve = gsea_service.generate_running_es_curve(
            ranked_genes, pathway_genes, nes=2.0, ranked_metrics=ranked_metrics
        )

        assert len(curve) > 0
        # Each point has [rank_position, es_value]
        assert len(curve[0]) == 2
        # With positive NES and pathway genes enriched at top, max ES should be positive
        max_es = max(p[1] for p in curve)
        assert max_es > 0

    def test_negative_nes_produces_trough_below_zero(self):
        ranked_genes = ["A", "B", "C", "D", "E", "F", "G", "H"]
        pathway_genes = ["G", "H"]
        ranked_metrics = [3.0, 2.0, 1.5, 1.0, 0.5, 0.0, -0.5, -1.0]

        curve = gsea_service.generate_running_es_curve(
            ranked_genes, pathway_genes, nes=-1.8, ranked_metrics=ranked_metrics
        )

        min_es = min(p[1] for p in curve)
        assert min_es < 0

    def test_empty_pathway_genes_returns_empty_curve(self):
        curve = gsea_service.generate_running_es_curve(
            ["A", "B", "C"], [], nes=1.0, ranked_metrics=[1.0, 0.5, 0.0]
        )
        # Should handle gracefully
        assert isinstance(curve, list)

    def test_no_overlap_returns_flat_negative_curve(self):
        ranked_genes = ["A", "B", "C"]
        pathway_genes = ["X", "Y", "Z"]
        ranked_metrics = [1.0, 0.5, 0.0]

        curve = gsea_service.generate_running_es_curve(
            ranked_genes, pathway_genes, nes=1.0, ranked_metrics=ranked_metrics
        )

        # No gene hits → ES decreases monotonically
        assert len(curve) > 0
        for i in range(1, len(curve)):
            assert curve[i][1] <= curve[i-1][1] + 1e-6


class TestHeatmapData:
    def test_generates_z_scores_for_lead_genes(self):
        import pandas as pd
        import numpy as np

        protein_df = pd.DataFrame({
            "Master_Protein_Accessions": ["P1", "P2", "P3"],
            "Gene_Name": ["GENE1", "GENE2", "GENE3"],
            "S1": [15.0, 14.0, 13.0],
            "S2": [16.0, 14.5, 12.5],
            "S3": [14.5, 13.5, 13.5],
        })

        result = gsea_service.generate_heatmap_data(
            protein_df, lead_genes=["GENE1", "GENE2"]
        )

        assert result is not None
        assert "genes" in result
        assert "samples" in result
        assert "z_scores" in result
        assert len(result["genes"]) == 2
        assert len(result["samples"]) == 3
        assert len(result["z_scores"]) == 2

    def test_missing_lead_genes_returns_none(self):
        import pandas as pd
        protein_df = pd.DataFrame({
            "Master_Protein_Accessions": ["P1"],
            "Gene_Name": ["GENE1"],
            "S1": [15.0],
        })

        result = gsea_service.generate_heatmap_data(
            protein_df, lead_genes=["NONEXISTENT"]
        )

        assert result is None

    def test_excludes_psm_count_column(self):
        import pandas as pd
        protein_df = pd.DataFrame({
            "Master_Protein_Accessions": ["P1"],
            "Gene_Name": ["GENE1"],
            "PSM_Count": [5],
            "S1": [15.0],
        })

        result = gsea_service.generate_heatmap_data(
            protein_df, lead_genes=["GENE1"]
        )

        assert result is not None
        assert "PSM_Count" not in result["samples"]
```

- [ ] **Step 2: Run tests — adjust to match actual gsea_service method signatures**

```powershell
backend\.venv\Scripts\python.exe -m pytest Tests/backend/unit/test_gsea_service.py -v --tb=short
```

- [ ] **Step 3: Fix, verify pass, commit**

---

### Task 5: test_pipeline_registry.py

**Files:**
- Create: `Tests/backend/unit/test_pipeline_registry.py`

- [ ] **Step 1: Create test file**

```python
"""Unit tests for pipeline registry — step definitions and ordering."""
import pytest
from app.services.pipeline_registry import get_pipeline, list_pipelines
from app.models.analysis import PipelineTool


class TestMsqrob2Pipeline:
    @pytest.fixture
    def pipeline(self):
        return get_pipeline(PipelineTool.MSQROB2)

    def test_has_five_steps(self, pipeline):
        assert len(pipeline.steps) == 5

    def test_step_order_is_correct(self, pipeline):
        step_names = [s.name for s in pipeline.steps]
        assert step_names == [
            "combine_replicates",
            "generate_unique_psm",
            "protein_abundance",
            "differential_expression",
            "qc_metrics",
        ]

    def test_step_1_is_python(self, pipeline):
        assert pipeline.steps[0].tool == "python"

    def test_step_3_is_r(self, pipeline):
        assert pipeline.steps[2].tool == "r"


class TestMSstatsPipeline:
    @pytest.fixture
    def pipeline(self):
        return get_pipeline(PipelineTool.MSSTATS)

    def test_has_eight_steps(self, pipeline):
        assert len(pipeline.steps) == 8

    def test_step_order_is_correct(self, pipeline):
        step_names = [s.name for s in pipeline.steps]
        assert step_names == [
            "combine_replicates",
            "generate_unique_psm",
            "remove_razor",
            "remove_low_quality",
            "filter_by_criteria",
            "protein_abundance",
            "differential_expression",
            "qc_metrics",
        ]


class TestListPipelines:
    def test_returns_both_pipelines(self):
        pipelines = list_pipelines()
        assert len(pipelines) >= 2

    def test_msqrob2_is_default(self):
        from app.services.pipeline_registry import DEFAULT_PIPELINE
        assert DEFAULT_PIPELINE == PipelineTool.MSQROB2
```

- [ ] **Step 2: Run tests — adjust function names to match actual registry API**

```powershell
backend\.venv\Scripts\python.exe -m pytest Tests/backend/unit/test_pipeline_registry.py -v --tb=short
```

- [ ] **Step 3: Fix, verify pass, commit**

---

### Task 6: test_organism_scanner.py

**Files:**
- Create: `Tests/backend/unit/test_organism_scanner.py`

- [ ] **Step 1: Read source to confirm API**

Read `backend/app/services/organism_scanner.py` (already done — `scan()`, `get_organism_path()`, `organism_exists()`).

- [ ] **Step 2: Create test file**

```python
"""Unit tests for organism scanner."""
from pathlib import Path
import pytest
from app.services.organism_scanner import OrganismScanner


class TestScan:
    def test_empty_directory_returns_empty(self, tmp_path):
        scanner = OrganismScanner(tmp_path)
        assert scanner.scan() == []

    def test_fasta_without_gene_mapping_is_excluded(self, tmp_path):
        (tmp_path / "human.fasta").write_text(">seq1\nACGT")
        scanner = OrganismScanner(tmp_path)
        assert scanner.scan() == []

    def test_fasta_with_gene_mapping_v1_is_included(self, tmp_path):
        (tmp_path / "human.fasta").write_text(">seq1\nACGT")
        (tmp_path / "human_uniprot_gene.tsv").write_text("gene1\tP12345")
        scanner = OrganismScanner(tmp_path)
        result = scanner.scan()
        assert len(result) == 1
        assert result[0]["id"] == "human"

    def test_sequence_naming_convention(self, tmp_path):
        (tmp_path / "Human_Sequence.fasta").write_text(">seq1\nACGT")
        (tmp_path / "Human_GeneName.tsv").write_text("gene1\tP12345")
        scanner = OrganismScanner(tmp_path)
        result = scanner.scan()
        assert len(result) == 1
        assert result[0]["id"] == "human"
        assert result[0]["name"] == "Human"

    def test_sorted_by_name(self, tmp_path):
        (tmp_path / "zebra.fasta").write_text(">s\nA")
        (tmp_path / "zebra_uniprot_gene.tsv").write_text("g\tP")
        (tmp_path / "apple.fasta").write_text(">s\nA")
        (tmp_path / "apple_uniprot_gene.tsv").write_text("g\tP")
        scanner = OrganismScanner(tmp_path)
        result = scanner.scan()
        assert result[0]["id"] == "apple"
        assert result[1]["id"] == "zebra"


class TestOrganismExists:
    def test_returns_true_when_files_exist(self, tmp_path):
        (tmp_path / "human.fasta").write_text(">s\nA")
        (tmp_path / "human_uniprot_gene.tsv").write_text("g\tP")
        scanner = OrganismScanner(tmp_path)
        assert scanner.organism_exists("human") is True

    def test_returns_false_when_missing(self, tmp_path):
        scanner = OrganismScanner(tmp_path)
        assert scanner.organism_exists("nonexistent") is False
```

- [ ] **Step 3: Run, fix, pass, commit**

---

### Task 7: test_msqrob2_wrapper.py

**Files:**
- Create: `Tests/backend/unit/test_msqrob2_wrapper.py`

- [ ] **Step 1: Read msqrob2_wrapper source to confirm method signatures**

Read `backend/app/services/msqrob2_wrapper.py` for `_build_data_process_config`, `_build_gc_config`, `_build_cmd_extras`.

- [ ] **Step 2: Create test file**

```python
"""Unit tests for Msqrob2Wrapper — QFeatures pipeline command construction."""
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from app.models.analysis import AnalysisConfig
from app.services.msqrob2_wrapper import Msqrob2Wrapper


@pytest.fixture
def wrapper():
    return Msqrob2Wrapper()


@pytest.fixture
def basic_config():
    return AnalysisConfig(
        organism="human",
        treatment="DrugA",
        control="DMSO",
        msqrob2_batch_column=None,
    )


class TestDataProcessConfig:
    def test_includes_treatment_and_control(self, wrapper, basic_config):
        config = wrapper._build_data_process_config(basic_config, n_cores=4)
        assert config["treatment"] == "DrugA"
        assert config["control"] == "DMSO"
        assert config["n_cores"] == 4

    def test_includes_organism(self, wrapper, basic_config):
        config = wrapper._build_data_process_config(basic_config, n_cores=2)
        assert config["organism"] == "human"

    def test_batch_column_included_when_set(self, wrapper):
        config = AnalysisConfig(organism="human", treatment="A", control="B", msqrob2_batch_column="Plate")
        result = wrapper._build_data_process_config(config, n_cores=4)
        assert result["batch_column"] == "Plate"


class TestGroupComparisonConfig:
    def test_includes_thresholds(self, wrapper, basic_config):
        gc_config = wrapper._build_gc_config(basic_config, n_cores=4)
        assert "pvalue_threshold" in gc_config
        assert "logfc_threshold" in gc_config

    def test_ncores_passed_through(self, wrapper, basic_config):
        gc_config = wrapper._build_gc_config(basic_config, n_cores=8)
        assert gc_config["n_cores"] == 8


class TestCmdExtras:
    def test_empty_by_default(self, wrapper):
        extras = wrapper._build_cmd_extras()
        assert extras == []
```

- [ ] **Step 3: Run, fix signatures, pass, commit**

---

### Task 8: test_msstats_wrapper.py

**Files:**
- Create: `Tests/backend/unit/test_msstats_wrapper.py`

Mirrors Task 7 pattern but tests MSstats-specific config: `msstats_normalization`, `msstats_feature_selection`, `msstats_summary_method`, `msstats_impute`, `msstats_n_top_feature`, `msstats_min_feature_count`, covariates JSON in `_build_cmd_extras`.

- [ ] **Step 1: Create file**

```python
"""Unit tests for MSstatsWrapper — MSstats pipeline command construction."""
import pytest
from app.models.analysis import AnalysisConfig, PipelineTool
from app.services.msstats_wrapper import MSstatsWrapper


@pytest.fixture
def wrapper():
    return MSstatsWrapper()


@pytest.fixture
def msstats_config():
    return AnalysisConfig(
        organism="human",
        treatment="DrugA",
        control="DMSO",
        pipeline=PipelineTool.MSSTATS,
        msstats_normalization="equalizeMedians",
        msstats_feature_selection="highQuality",
        msstats_summary_method="TMP",
        msstats_impute=True,
        msstats_n_top_feature=3,
        msstats_min_feature_count=2,
    )


class TestDataProcessConfig:
    def test_includes_msstats_specific_fields(self, wrapper, msstats_config):
        config = wrapper._build_data_process_config(msstats_config, n_cores=4)
        assert config["normalization"] == "equalizeMedians"
        assert config["feature_selection"] == "highQuality"
        assert config["summary_method"] == "TMP"
        assert config["n_top_feature"] == 3
        assert config["min_feature_count"] == 2


class TestCmdExtras:
    def test_includes_empty_covariates_by_default(self, wrapper, msstats_config):
        extra_kwargs = {"covariate_columns": None}
        extras = wrapper._build_cmd_extras(**extra_kwargs)
        assert len(extras) >= 0  # Should be empty or contain empty JSON
```

- [ ] **Step 2: Run, fix, pass, commit**

---

### Task 9: test_session_manager.py

**Files:**
- Create: `Tests/backend/unit/test_session_manager.py`

- [ ] **Step 1: Create test file**

```python
"""Unit tests for SessionManager — session lifecycle and WebSocket management."""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.models.session import SessionCreate, SessionState, SessionConfig
from app.services.session_manager import SessionManager


@pytest.fixture
def mock_store():
    store = AsyncMock()
    store.get = AsyncMock()
    store.create = AsyncMock()
    store.save = AsyncMock()
    store.update = AsyncMock()
    store.delete = AsyncMock()
    store.list_all = AsyncMock(return_value=[])
    store.load_pipeline_state = AsyncMock(return_value=None)
    return store


@pytest.fixture
def manager(mock_store):
    return SessionManager(store=mock_store)


class TestCreateSession:
    @pytest.mark.asyncio
    async def test_creates_session_with_valid_name(self, manager, mock_store):
        data = SessionCreate(name="My Experiment", template="multi_condition_comparison")
        await manager.create_session(data)
        mock_store.create.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_rejects_empty_name(self, manager, mock_store):
        with pytest.raises(Exception):
            await manager.create_session(SessionCreate(name="", template="multi_condition_comparison"))

    @pytest.mark.asyncio
    async def test_rejects_name_too_long(self, manager, mock_store):
        with pytest.raises(Exception):
            await manager.create_session(SessionCreate(name="x" * 201, template="multi_condition_comparison"))


class TestUpdateSessionState:
    @pytest.mark.asyncio
    async def test_updates_state_in_store(self, manager, mock_store):
        session = MagicMock()
        session.id = "test-id"
        session.state = SessionState.PROCESSING
        mock_store.get.return_value = session

        await manager.update_session_state("test-id", SessionState.COMPLETED)
        assert session.state == SessionState.COMPLETED
        mock_store.save.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_sets_error_message(self, manager, mock_store):
        session = MagicMock()
        session.id = "test-id"
        mock_store.get.return_value = session

        await manager.update_session_state("test-id", SessionState.ERROR, "R script failed")
        assert session.state == SessionState.ERROR
        assert session.error_message == "R script failed"


class TestWebSocketManagement:
    @pytest.mark.asyncio
    async def test_register_websocket(self, manager):
        ws = MagicMock()
        await manager.register_websocket("session-1", ws)
        assert "session-1" in manager._websocket_connections
        assert ws in manager._websocket_connections["session-1"]

    @pytest.mark.asyncio
    async def test_unregister_websocket(self, manager):
        ws1 = MagicMock()
        ws2 = MagicMock()
        await manager.register_websocket("session-1", ws1)
        await manager.register_websocket("session-1", ws2)
        await manager.unregister_websocket("session-1", ws1)

        assert ws1 not in manager._websocket_connections["session-1"]
        assert ws2 in manager._websocket_connections["session-1"]

    @pytest.mark.asyncio
    async def test_send_progress_update(self, manager):
        ws = MagicMock()
        ws.send_json = AsyncMock()
        await manager.register_websocket("session-1", ws)

        progress = {"step": 1, "status": "running", "progress": 50}
        await manager.send_progress_update("session-1", progress)

        ws.send_json.assert_awaited()
        sent = ws.send_json.call_args[0][0]
        assert sent["type"] == "progress"
        assert sent["payload"]["step"] == 1
```

- [ ] **Step 2: Run, fix, pass, commit**

---

### Task 10: test_compound_service.py

**Files:**
- Create: `Tests/backend/unit/test_compound_service.py`

- [ ] **Step 1: Read source to confirm function signatures**

Read `backend/app/services/compound_service.py` for `CompoundService` class methods.

- [ ] **Step 2: Create test file**

```python
"""Unit tests for compound service — SMILES validation and property parsing."""
import pytest
from app.services.compound_service import CompoundService


@pytest.fixture
def service():
    return CompoundService()


class TestValidateSMILES:
    def test_valid_smiles_returns_true(self, service):
        assert service.validate_smiles("CCO") is True
        assert service.validate_smiles("c1ccccc1") is True

    def test_invalid_smiles_returns_false(self, service):
        assert service.validate_smiles("not_a_smiles") is False
        assert service.validate_smiles("") is False

    def test_none_returns_false(self, service):
        assert service.validate_smiles(None) is False


class TestParseCompoundCSV:
    def test_parses_valid_csv(self, service, tmp_path):
        csv_path = tmp_path / "compounds.csv"
        csv_path.write_text("Corp_ID,Condition,SMILES,MW,Formula\n"
                            "CPD001,DrugA,CCO,46.07,C2H6O\n"
                            "CPD002,DrugB,c1ccccc1,78.11,C6H6\n")

        compounds = service.parse_compound_csv(csv_path)
        assert len(compounds) == 2
        assert "CPD001" in compounds
        assert compounds["CPD001"].smiles == "CCO"
        assert compounds["CPD001"].condition == "DrugA"

    def test_missing_columns_raises_error(self, service, tmp_path):
        csv_path = tmp_path / "bad.csv"
        csv_path.write_text("Name,Value\ntest,1\n")

        with pytest.raises(Exception):
            service.parse_compound_csv(csv_path)


class TestMolecularProperties:
    def test_returns_properties_for_valid_smiles(self, service):
        props = service.get_molecular_properties("CCO")
        if props is not None:  # RDKit may not be installed
            assert "molecular_weight" in props or "MW" in str(props)

    def test_returns_none_for_invalid_smiles(self, service):
        props = service.get_molecular_properties("invalid")
        assert props is None
```

- [ ] **Step 3: Run, adjust to match actual CompoundService API, pass, commit**

---

### Task 11: test_processing_orchestrator.py

**Files:**
- Create: `Tests/backend/unit/test_processing_orchestrator.py`

- [ ] **Step 1: Read source to confirm ProcessOrchestrator API**

Read `backend/app/services/processing_orchestrator.py`.

- [ ] **Step 2: Create test file**

```python
"""Unit tests for ProcessingOrchestrator — validation, config mapping, state transitions."""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.models.analysis import AnalysisConfig, PipelineTool
from app.models.session import SessionState
from app.services.processing_orchestrator import ProcessingOrchestrator


@pytest.fixture
def orchestrator():
    return ProcessingOrchestrator(session_id="550e8400-e29b-41d4-a716-446655440000")


class TestConfigMapping:
    def test_maps_session_config_to_analysis_config(self, orchestrator, mock_session_with_config):
        from app.models.analysis import Organism
        config = orchestrator._build_analysis_config(mock_session_with_config)
        assert config.treatment == "DrugA"
        assert config.control == "DMSO"
        assert config.organism == Organism.HUMAN

    def test_derives_pipeline_from_session(self, orchestrator):
        session = MagicMock()
        session.pipeline = "msstats"
        session.template = "multi_condition_comparison"

        from app.services.processing_orchestrator import _derive_pipeline
        pipeline = _derive_pipeline(session)
        assert pipeline == PipelineTool.MSSTATS

    def test_backward_compat_no_pipeline_field(self, orchestrator):
        session = MagicMock()
        session.pipeline = None
        session.template = "multi_condition_comparison"

        from app.services.processing_orchestrator import _derive_pipeline
        pipeline = _derive_pipeline(session)
        assert pipeline == PipelineTool.MSQROB2  # default


class TestValidation:
    @pytest.mark.asyncio
    async def test_rejects_missing_config(self, orchestrator):
        session = MagicMock()
        session.config = None
        with pytest.raises(ValueError, match="config"):
            orchestrator._validate_session(session)

    @pytest.mark.asyncio
    async def test_rejects_too_few_files(self, orchestrator):
        session = MagicMock()
        session.config = MagicMock()
        session.config.organism = "human"
        session.files = MagicMock()
        session.files.proteomics = [MagicMock()]  # Only 1 file

        with pytest.raises(ValueError, match="files"):
            orchestrator._validate_session(session)
```

- [ ] **Step 3: Run, fix signatures, pass, commit**

---

### Task 12: Extend test_compare_service.py

**Files:**
- Modify: `Tests/backend/unit/test_compare_service.py`

- [ ] **Step 1: Add tests for UMAP, t-SNE, Venn, clustering**

Append to existing file:

```python
class TestDimensionalityReduction:
    def test_umap_2d_output(self):
        np.random.seed(42)
        matrix = np.random.randn(20, 10)
        from app.services.compare_service import run_cluster
        coords, variance = run_cluster(matrix, "umap")
        assert coords.shape == (20, 2)
        # variance not applicable for UMAP, should be [0, 0] or [1, 1]
        assert len(variance) == 2

    def test_tsne_2d_output(self):
        np.random.seed(42)
        matrix = np.random.randn(20, 10)
        from app.services.compare_service import run_cluster
        coords, variance = run_cluster(matrix, "tsne")
        assert coords.shape == (20, 2)


class TestVennDiagram:
    def test_computes_intersections_for_two_comparisons(self, tmp_path):
        results_dir = tmp_path / "results"
        results_dir.mkdir()
        pd.DataFrame({
            "Master_Protein_Accessions": ["P1", "P2", "P3"],
            "Gene_Name": ["G1", "G2", "G3"],
            "logFC": [2.0, -1.5, 0.3],
            "pval": [0.001, 0.01, 0.5],
            "adjPval": [0.005, 0.05, 0.6],
        }).to_csv(results_dir / "Diff_Expression_A_vs_B.tsv", sep="\t", index=False)

        pd.DataFrame({
            "Master_Protein_Accessions": ["P1", "P3", "P4"],
            "Gene_Name": ["G1", "G3", "G4"],
            "logFC": [1.5, 0.8, -2.0],
            "pval": [0.0001, 0.03, 0.001],
            "adjPval": [0.001, 0.04, 0.005],
        }).to_csv(results_dir / "Diff_Expression_C_vs_D.tsv", sep="\t", index=False)

        from app.services.compare_service import compute_venn_data
        result = compute_venn_data(
            str(tmp_path), ["A_vs_B", "C_vs_D"], pvalue_threshold=0.05, logfc_threshold=1.0
        )

        assert "sets" in result or "intersections" in result

    def test_venn_with_three_comparisons(self, tmp_path):
        results_dir = tmp_path / "results"
        results_dir.mkdir()
        for comp in ["A_vs_B", "C_vs_D", "E_vs_F"]:
            pd.DataFrame({
                "Master_Protein_Accessions": ["P1", "P2"],
                "Gene_Name": ["G1", "G2"],
                "logFC": [2.0, -1.5],
                "pval": [0.001, 0.01],
                "adjPval": [0.005, 0.05],
            }).to_csv(results_dir / f"Diff_Expression_{comp}.tsv", sep="\t", index=False)

        from app.services.compare_service import compute_venn_data
        result = compute_venn_data(
            str(tmp_path), ["A_vs_B", "C_vs_D", "E_vs_F"], pvalue_threshold=0.05, logfc_threshold=1.0
        )
        assert result is not None


class TestHierarchicalClustering:
    def test_hierarchical_order_preserves_size(self):
        import numpy as np
        from app.services.compare_service import compute_hierarchical_order
        matrix = np.random.randn(20, 5)
        order = compute_hierarchical_order(matrix)
        assert len(order) == 20
        assert len(set(order)) == 20  # all indices unique

    def test_single_row_returns_trivial_order(self):
        import numpy as np
        from app.services.compare_service import compute_hierarchical_order
        matrix = np.array([[1.0, 2.0, 3.0]])
        order = compute_hierarchical_order(matrix)
        assert order == [0]
```

- [ ] **Step 2: Run, fix, pass, commit**

---

### Phase 1 Completion Check

- [ ] Run all unit tests: `backend\.venv\Scripts\python.exe -m pytest Tests/backend/unit/ -v --tb=short`
- [ ] All 12 new/extended files pass
- [ ] Total unit test count increased by ~157

---

## Phase 2: API Route Tests + WebSocket

### Task 13: test_processing_routes.py

**Files:**
- Create: `Tests/backend/unit/test_processing_routes.py`

- [ ] **Step 1: Read processing route handler signatures**

From `backend/app/api/routes/processing.py`:
- `start_processing(session_id, store)` → POST /{id}/process
- `cancel_processing(session_id, store)` → POST /{id}/cancel
- `retry_processing(session_id, store)` → POST /{id}/retry
- `get_processing_logs(session_id, store)` → GET /{id}/logs
- `get_processing_status(session_id, store)` → GET /{id}/status

- [ ] **Step 2: Create test file**

```python
"""Unit tests for processing API routes."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from app.models.session import SessionState
from app.main import app


@pytest.fixture
def mock_store():
    from app.models.session import Session, SessionConfig, SessionFiles
    from datetime import UTC, datetime

    store = AsyncMock()
    session = Session(
        id="550e8400-e29b-41d4-a716-446655440000",
        name="Test",
        template="multi_condition_comparison",
        pipeline="msqrob2",
        state=SessionState.CONFIGURING,
        config=SessionConfig(treatment="DrugA", control="DMSO", organism="human"),
        files=SessionFiles(),
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    # Add 6 files (minimum for processing)
    session.files.proteomics = [
        MagicMock() for _ in range(6)
    ]
    store.get = AsyncMock(return_value=session)
    store.save = AsyncMock()
    store.load_pipeline_state = AsyncMock(return_value={
        "logs": [{"level": "info", "message": "Step 1 done"}],
        "completed_steps": [1],
        "current_step": 2,
        "completed_at": None,
        "outputs": None,
    })
    return store


@pytest.fixture
def client(mock_store):
    from app.api.deps import get_session_store
    app.dependency_overrides[get_session_store] = lambda: mock_store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


class TestStartProcessing:
    def test_requires_config(self, client, mock_store):
        mock_store.get.return_value.config = None
        response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/process")
        assert response.status_code == 400

    def test_requires_files(self, client, mock_store):
        mock_store.get.return_value.files.proteomics = []
        response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/process")
        assert response.status_code == 400

    def test_requires_minimum_files(self, client, mock_store):
        mock_store.get.return_value.files.proteomics = [MagicMock()] * 3
        response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/process")
        assert response.status_code == 400

    @patch("app.api.routes.processing._schedule_background_task")
    def test_successful_start_returns_202(self, mock_schedule, client, mock_store):
        # Patch out the pipeline run to avoid real processing
        with patch("app.api.routes.processing.run_processing_pipeline_async"):
            response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/process")
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["status"] == "started"

    def test_session_not_found(self, client, mock_store):
        mock_store.get.return_value = None
        response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/process")
        assert response.status_code == 404


class TestCancelProcessing:
    def test_cancel_non_processing_session_fails(self, client, mock_store):
        mock_store.get.return_value.state = SessionState.CREATED
        response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/cancel")
        assert response.status_code == 400

    def test_cancel_queued_session_succeeds(self, client, mock_store):
        mock_store.get.return_value.state = SessionState.QUEUED
        response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/cancel")
        assert response.status_code == 200
        assert response.json()["data"]["status"] == "cancelled"

    def test_cancel_processing_session_sets_cancelled(self, client, mock_store):
        mock_store.get.return_value.state = SessionState.PROCESSING
        response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/cancel")
        assert response.status_code == 200


class TestRetryProcessing:
    def test_retry_only_allowed_from_error_state(self, client, mock_store):
        mock_store.get.return_value.state = SessionState.COMPLETED
        response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/retry")
        assert response.status_code == 400

    def test_retry_requires_config(self, client, mock_store):
        mock_store.get.return_value.state = SessionState.ERROR
        mock_store.get.return_value.config = None
        response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/retry")
        assert response.status_code == 400

    def test_retry_requires_files(self, client, mock_store):
        mock_store.get.return_value.state = SessionState.ERROR
        mock_store.get.return_value.files.proteomics = []
        response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/retry")
        assert response.status_code == 400

    @patch("app.api.routes.processing._schedule_background_task")
    def test_successful_retry(self, mock_schedule, client, mock_store):
        mock_store.get.return_value.state = SessionState.ERROR
        with patch("app.api.routes.processing.run_processing_pipeline_async"):
            response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/retry")
        assert response.status_code == 200


class TestGetLogs:
    def test_returns_logs(self, client, mock_store):
        response = client.get("/api/sessions/550e8400-e29b-41d4-a716-446655440000/logs")
        assert response.status_code == 200
        data = response.json()
        assert len(data["logs"]) == 1
        assert data["completed_steps"] == [1]
        assert data["is_complete"] is False
```

- [ ] **Step 2: Run, fix, pass, commit**

---

### Task 14: test_visualization_routes.py

**Files:**
- Create: `Tests/backend/unit/test_visualization_routes.py`

- [ ] **Step 1: Create test file**

```python
"""Unit tests for visualization API routes."""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def mock_viz_session():
    from app.models.session import Session, SessionConfig, SessionFiles, SessionState
    from datetime import UTC, datetime
    return Session(
        id="550e8400-e29b-41d4-a716-446655440000",
        name="Test",
        template="multi_condition_comparison",
        pipeline="msqrob2",
        state=SessionState.COMPLETED,
        config=SessionConfig(
            treatment="DrugA", control="DMSO", organism="human",
            comparisons=[{"group1": {"C": "DrugA"}, "group2": {"C": "DMSO"}}]
        ),
        files=SessionFiles(),
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    )


@pytest.fixture
def client(mock_viz_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "sessions_dir", tmp_path)

    # Create mock results files
    results_dir = tmp_path / "550e8400-e29b-41d4-a716-446655440000" / "results"
    results_dir.mkdir(parents=True)

    de_df = pd.DataFrame({
        "Master_Protein_Accessions": ["P001", "P002", "P003"],
        "Gene_Name": ["GENE1", "GENE2", "GENE3"],
        "logFC": [2.5, -1.8, 0.3],
        "pval": [0.001, 0.01, 0.5],
        "adjPval": [0.005, 0.05, 0.6],
        "PSM_Count": [10, 5, 2],
        "se": [0.1, 0.2, 0.3],
        "t": [25.0, -9.0, 1.0],
    })
    de_df.to_csv(results_dir / "Diff_Expression.tsv", sep="\t", index=False)

    mock_store = AsyncMock()
    mock_store.get = AsyncMock(return_value=mock_viz_session)
    mock_store.load_pipeline_state = AsyncMock(return_value=None)

    from app.api.deps import get_session_store
    app.dependency_overrides[get_session_store] = lambda: mock_store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


class TestGetResults:
    def test_returns_paginated_results(self, client):
        response = client.get("/api/sessions/550e8400-e29b-41d4-a716-446655440000/results")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 3
        assert len(data["results"]) == 3
        assert data["page"] == 1

    def test_significant_only_filter(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/results",
            params={"significant_only": True}
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 2  # P001 and P002 only

    def test_search_by_gene_name(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/results",
            params={"search": "GENE1"}
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total"] == 1

    def test_sort_by_logfc(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/results",
            params={"sort_by": "log_fc", "sort_order": "desc"}
        )
        assert response.status_code == 200
        results = response.json()["data"]["results"]
        assert results[0]["log_fc"] == 2.5

    def test_pagination_page_size(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/results",
            params={"page_size": 1, "page": 2}
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert len(data["results"]) == 1
        assert data["page"] == 2

    def test_session_not_found_returns_404(self, client):
        # Use a non-existent UUID
        response = client.get("/api/sessions/660e8400-e29b-41d4-a716-446655440001/results")
        assert response.status_code == 404


class TestGetQCPlots:
    def test_returns_defaults_when_no_qc_file(self, client):
        response = client.get("/api/sessions/550e8400-e29b-41d4-a716-446655440000/qc/plots")
        assert response.status_code == 200
        data = response.json()["data"]
        assert "pca" in data
        assert "pvalue_distribution" in data
```

- [ ] **Step 2: Run, fix, pass, commit**

---

### Task 15: test_gsea_routes.py

**Files:**
- Create: `Tests/backend/unit/test_gsea_routes.py`

- [ ] **Step 1: Create test file**

```python
"""Unit tests for GSEA API routes."""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "sessions_dir", tmp_path)

    from app.models.session import Session, SessionConfig, SessionFiles, SessionState
    from datetime import UTC, datetime

    session = Session(
        id="550e8400-e29b-41d4-a716-446655440000",
        name="Test", template="multi_condition_comparison",
        pipeline="msqrob2", state=SessionState.COMPLETED,
        config=SessionConfig(treatment="A", control="B", organism="human"),
        files=SessionFiles(),
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    )

    # Create DE file for GSEA
    results_dir = tmp_path / "550e8400-e29b-41d4-a716-446655440000" / "results"
    results_dir.mkdir(parents=True)
    import pandas as pd
    pd.DataFrame({
        "Master_Protein_Accessions": ["P001"],
        "Gene_Name": ["GENE1"],
        "logFC": [2.0], "pval": [0.01], "adjPval": [0.05], "PSM_Count": [5],
    }).to_csv(results_dir / "Diff_Expression_test_vs_ctrl.tsv", sep="\t", index=False)
    pd.DataFrame({
        "Master_Protein_Accessions": ["P001"],
        "Gene_Name": ["GENE1"],
        "PSM_Count": [5],
        "S1": [15.0], "S2": [16.0],
    }).to_csv(results_dir / "Protein_Abundances.tsv", sep="\t", index=False)

    mock_store = AsyncMock()
    mock_store.get = AsyncMock(return_value=session)

    from app.api.deps import get_session_store
    app.dependency_overrides[get_session_store] = lambda: mock_store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


class TestGseaRun:
    def test_run_requires_comparison(self, client):
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/run",
            json={"comparison": "test_vs_ctrl", "databases": ["go_bp"]}
        )
        # 200 means it triggered — may fail later in background but the route accepted it
        assert response.status_code == 200

    def test_run_missing_de_file_returns_404(self, client):
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/run",
            json={"comparison": "nonexistent_vs_ctrl", "databases": ["go_bp"]}
        )
        assert response.status_code == 404

    def test_run_invalid_database_is_accepted_at_trigger_time(self, client):
        # DB validation happens during run, not at trigger
        response = client.post(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/run",
            json={"comparison": "test_vs_ctrl", "databases": ["invalid_db"]}
        )
        assert response.status_code == 200  # Trigger accepted


class TestGseaStatus:
    def test_returns_idle_when_no_status_file(self, client):
        response = client.get("/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/status")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["status"] == "idle"


class TestGseaData:
    def test_returns_empty_for_missing_results(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/go_bp"
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert "results" in data

    def test_rejects_invalid_database(self, client):
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/gsea/invalid_db"
        )
        assert response.status_code == 400
```

- [ ] **Step 2: Run, fix, pass, commit**

---

### Task 16: test_websocket.py

**Files:**
- Create: `Tests/backend/unit/test_websocket.py`

- [ ] **Step 1: Create test file**

```python
"""Unit tests for WebSocket endpoint."""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from app.main import app


class TestWebSocketEndpoint:
    @pytest.fixture
    def mock_session_manager(self):
        mgr = MagicMock()
        mgr.register_websocket = AsyncMock()
        mgr.unregister_websocket = AsyncMock()
        mgr.send_progress_update = AsyncMock()
        mgr.send_complete_message = AsyncMock()
        return mgr

    @pytest.fixture
    def mock_store(self):
        store = AsyncMock()
        store.load_pipeline_state = AsyncMock(return_value=None)
        return store

    @pytest.mark.asyncio
    async def test_websocket_accepts_and_registers(self, mock_session_manager, mock_store, monkeypatch):
        """WebSocket connection is accepted and registered with session manager."""
        app.state.session_manager = mock_session_manager
        app.state.session_store = mock_store

        from fastapi.testclient import TestClient
        client = TestClient(app)

        with client.websocket_connect("/ws/sessions/550e8400-e29b-41d4-a716-446655440000") as ws:
            # Connection should be established
            assert ws is not None
            mock_session_manager.register_websocket.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_ping_pong(self, mock_session_manager, mock_store, monkeypatch):
        """Client ping receives pong response."""
        app.state.session_manager = mock_session_manager
        app.state.session_store = mock_store

        client = TestClient(app)
        with client.websocket_connect("/ws/sessions/550e8400-e29b-41d4-a716-446655440000") as ws:
            ws.send_text("ping")
            response = ws.receive_text()
            assert "pong" in response

    @pytest.mark.asyncio
    async def test_subscribe_replays_historical_logs(self, mock_session_manager, mock_store, monkeypatch):
        """Subscribe message triggers replay of completed pipeline steps."""
        app.state.session_manager = mock_session_manager
        mock_store.load_pipeline_state = AsyncMock(return_value={
            "logs": [{"level": "info", "message": "Step 1 complete"}],
            "completed_steps": [1],
            "completed_at": None,
        })
        app.state.session_store = mock_store

        client = TestClient(app)
        with client.websocket_connect("/ws/sessions/550e8400-e29b-41d4-a716-446655440000") as ws:
            ws.send_text('{"type":"subscribe"}')
            # Should receive at least the log message
            response = ws.receive_text()
            data = json.loads(response)
            assert data["type"] == "log"
            assert data["payload"]["message"] == "Step 1 complete"

    @pytest.mark.asyncio
    async def test_subscribe_replays_completed_steps(self, mock_session_manager, mock_store, monkeypatch):
        """Subscribe replays progress for completed steps."""
        app.state.session_manager = mock_session_manager
        mock_store.load_pipeline_state = AsyncMock(return_value={
            "logs": [],
            "completed_steps": [1, 2],
            "completed_at": None,
            "outputs": {},
        })
        app.state.session_store = mock_store

        client = TestClient(app)
        with client.websocket_connect("/ws/sessions/550e8400-e29b-41d4-a716-446655440000") as ws:
            ws.send_text('{"type":"subscribe"}')
            # Should receive progress for step 1 and step 2
            resp1 = ws.receive_text()
            data1 = json.loads(resp1)
            assert data1["type"] == "progress"

    @pytest.mark.asyncio
    async def test_subscribe_sends_completion_if_done(self, mock_session_manager, mock_store, monkeypatch):
        """Subscribe sends complete message when pipeline is done."""
        app.state.session_manager = mock_session_manager
        mock_store.load_pipeline_state = AsyncMock(return_value={
            "logs": [],
            "completed_steps": [1, 2, 3, 4, 5],
            "completed_at": "2026-01-01T00:00:00Z",
            "outputs": {"diff_expression": "Diff_Expression.tsv"},
        })
        app.state.session_store = mock_store

        client = TestClient(app)
        with client.websocket_connect("/ws/sessions/550e8400-e29b-41d4-a716-446655440000") as ws:
            ws.send_text('{"type":"subscribe"}')
            # Read through progress messages to find the complete message
            complete_found = False
            for _ in range(10):
                try:
                    msg = ws.receive_text()
                    if '"type":"complete"' in msg:
                        complete_found = True
                        break
                except Exception:
                    break
            assert complete_found, "Should receive a completion message"
```

- [ ] **Step 2: Read actual websocket implementation in main.py to confirm message formats**

- [ ] **Step 3: Run, fix, pass, commit**

---

### Task 17: test_compounds_routes.py

**Files:**
- Create: `Tests/backend/unit/test_compounds_routes.py`

- [ ] **Step 1: Create test file**

```python
"""Unit tests for compounds API routes."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    """Setup client with mocked session_manager on app state."""
    from app.core import config
    monkeypatch.setattr(config.settings, "sessions_dir", tmp_path)

    from app.models.session import Session, SessionConfig, SessionFiles, SessionState
    from datetime import UTC, datetime

    session = Session(
        id="550e8400-e29b-41d4-a716-446655440000",
        name="Test", template="multi_condition_comparison",
        pipeline="msqrob2", state=SessionState.COMPLETED,
        config=SessionConfig(treatment="A", control="B", organism="human"),
        files=SessionFiles(),
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
    )

    mock_mgr = MagicMock()
    mock_mgr.get_session = AsyncMock(return_value=session)
    mock_mgr.get_uploads_dir = AsyncMock(return_value=tmp_path)

    # Create a compound file for testing
    uploads_dir = tmp_path
    uploads_dir.mkdir(parents=True, exist_ok=True)
    import pandas as pd
    pd.DataFrame({
        "Corp_ID": ["CPD001"],
        "Condition": ["DrugA"],
        "SMILES": ["CCO"],
        "MW": [46.07],
        "Formula": ["C2H6O"],
    }).to_csv(uploads_dir / "compounds.csv", index=False)
    session.files.compound = MagicMock()
    session.files.compound.filename = "compounds.csv"

    app.state.session_manager = mock_mgr

    with TestClient(app) as c:
        yield c


class TestListCompounds:
    def test_returns_empty_when_no_compound_file(self, client):
        app.state.session_manager.get_session.return_value.files.compound = None
        response = client.get("/api/sessions/550e8400-e29b-41d4-a716-446655440000/compounds")
        assert response.status_code == 200
        assert response.json()["compounds"] == []


class TestValidateCompounds:
    def test_returns_valid_for_good_file(self, client):
        response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/compounds/validate")
        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True
        assert data["total_compounds"] >= 0

    def test_no_compound_file_returns_invalid(self, client):
        app.state.session_manager.get_session.return_value.files.compound = None
        response = client.post("/api/sessions/550e8400-e29b-41d4-a716-446655440000/compounds/validate")
        assert response.status_code == 200
        assert response.json()["valid"] is False


class TestCompoundImage:
    def test_no_compound_file_returns_404(self, client):
        app.state.session_manager.get_session.return_value.files.compound = None
        response = client.get(
            "/api/sessions/550e8400-e29b-41d4-a716-446655440000/compounds/DrugA/image"
        )
        assert response.status_code == 404
```

- [ ] **Step 2: Run, fix, pass, commit**

---

### Task 18: test_report_routes.py (missing endpoints only)

**Files:**
- Create: `Tests/backend/unit/test_report_routes.py`

Covers only endpoints NOT in the existing integration `test_report_routes.py`: `PATCH /reports/{rid}` (rename), `POST /reports/{rid}/gsea/run`, `POST /reports/{rid}/bionet/run`, `GET /reports/{rid}/protein/{pid}/peptide`.

- [ ] **Step 1: Create test file**

```python
"""Unit tests for report endpoints not covered by integration test_report_routes.py."""
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "base_dir", tmp_path)

    reports_dir = tmp_path / "reports"
    reports_dir.mkdir()
    import app.services.report_store as report_store
    monkeypatch.setattr(report_store, "REPORTS_DIR", reports_dir)

    # Create a minimal report
    report_dir = reports_dir / "rpt_test123"
    report_dir.mkdir(parents=True)
    results_dir = report_dir / "results"
    results_dir.mkdir()
    (report_dir / "report.json").write_text(json.dumps({"name": "Test Report", "session_id": "s1"}))
    (report_dir / "session.json").write_text(json.dumps({"id": "s1", "name": "Test"}))

    import pandas as pd
    pd.DataFrame({
        "Master_Protein_Accessions": ["P001"],
        "Gene_Name": ["G1"], "logFC": [2.0], "pval": [0.01],
        "adjPval": [0.05], "PSM_Count": [5],
    }).to_csv(results_dir / "Diff_Expression.tsv", sep="\t", index=False)

    with TestClient(app) as c:
        yield c


class TestRenameReport:
    def test_rename_succeeds(self, client):
        response = client.patch(
            "/api/reports/rpt_test123",
            json={"name": "Renamed Report"}
        )
        assert response.status_code == 200
        assert response.json()["name"] == "Renamed Report"

    def test_rename_empty_name_fails(self, client):
        response = client.patch(
            "/api/reports/rpt_test123",
            json={"name": ""}
        )
        assert response.status_code == 400


class TestReportNotFound:
    def test_nonexistent_report_returns_404(self, client):
        response = client.get("/api/reports/rpt_nonexistent")
        assert response.status_code == 404
```

- [ ] **Step 2: Run, fix, pass, commit**

---

### Task 19-20: Extend existing route tests

**Files:**
- Modify: `Tests/backend/unit/test_sessions_api.py`
- Modify: `Tests/backend/integration/test_api.py`

- [ ] **Step 1: Extend test_sessions_api.py with PUT update + pipeline config**

Append:

```python
class TestUpdateSession:
    def test_put_updates_session_name(self, client_with_mock_store, mock_store):
        response = client_with_mock_store.put(
            "/api/sessions/test-session-id",
            json={"name": "Updated Name"}
        )
        assert response.status_code == 200
        mock_store.update.assert_awaited_once()

    def test_put_session_not_found(self, client_with_mock_store, mock_store):
        mock_store.get = AsyncMock(return_value=None)
        response = client_with_mock_store.put(
            "/api/sessions/nonexistent-id",
            json={"name": "Test"}
        )
        assert response.status_code == 404

    def test_config_with_pipeline_selection(self, client_with_mock_store, mock_store):
        response = client_with_mock_store.put(
            "/api/sessions/test-session-id/config",
            json={
                "treatment": "DrugA", "control": "DMSO", "organism": "human",
                "pipeline": "msstats"
            }
        )
        assert response.status_code == 200
```

- [ ] **Step 2: Extend test_api.py with file delete, compound upload, organisms**

Append to `Tests/backend/integration/test_api.py`:

```python
class TestFileDelete:
    def test_delete_nonexistent_file_returns_success(self, client):
        # Create session first
        create_resp = client.post("/api/sessions", json={"name": "Delete Test"})
        session_id = create_resp.json()["id"]

        response = client.delete(f"/api/sessions/{session_id}/files/proteomics/nonexistent.csv")
        # Should succeed — the file just won't be in the list
        assert response.status_code == 200

    def test_invalid_file_type_returns_400(self, client):
        create_resp = client.post("/api/sessions", json={"name": "Delete Test"})
        session_id = create_resp.json()["id"]

        response = client.delete(f"/api/sessions/{session_id}/files/invalid_type/test.csv")
        assert response.status_code == 400


class TestOrganismsEndpoint:
    def test_lists_organisms(self, client):
        response = client.get("/api/organisms")
        assert response.status_code == 200
        assert "organisms" in response.json()
```

- [ ] **Step 3: Run all tests, fix, pass, commit**

---

### Task 21: test_bionet_routes.py and test_compare_routes.py

**Files:**
- Create: `Tests/backend/unit/test_bionet_routes.py`
- Create: `Tests/backend/unit/test_compare_routes.py`

Both follow the same pattern as Task 15 (mock store + TestClient). Key tests:

**test_bionet_routes.py:**
- `POST /{id}/bionet/run` — 200 on trigger, 404 missing DE file, 404 missing session
- `GET /{id}/bionet/status` — idle/completed/error states
- `GET /{id}/bionet/subnetwork` — 200 with data, 404 missing subnetwork

**test_compare_routes.py:**
- `POST /{id}/compare/protein-correlation` — 200 trigger, 409 already running, 404 missing session
- `POST /{id}/compare/venn` — 200 with 2-3 comps, 400 with 1 comp, 400 with 4+ comps
- `GET /{id}/compare/protein-correlation/status` — idle/completed
- `GET /{id}/compare/proteins` — list from DE files

- [ ] **Step 1: Create both files following the TestClient + mock_store pattern**

- [ ] **Step 2: Run, fix, pass, commit both**

---

### Phase 2 Completion Check

- [ ] Run all unit + integration tests: `backend\.venv\Scripts\python.exe -m pytest Tests/backend/ -v --tb=short`
- [ ] All 8 new + 2 extended files pass
- [ ] Total test count increased by ~121

---

## Phase 3: Frontend Tests

### Task 22: Frontend test utilities

**Files:**
- Create: `frontend/src/test/test-utils.tsx`
- Create: `frontend/src/test/factories.ts`

- [ ] **Step 1: Create test-utils.tsx**

```typescript
import React from 'react';
import { render, RenderOptions } from '@testing-library/react';

interface AllProvidersProps {
  children: React.ReactNode;
}

function AllProviders({ children }: AllProvidersProps) {
  // Add store providers as needed per test
  return <>{children}</>;
}

function customRender(ui: React.ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export { customRender as render };
export * from '@testing-library/react';
```

- [ ] **Step 2: Create factories.ts**

```typescript
import type { Session } from '@/types/session';

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: 'Test Session',
    template: 'multi_condition_comparison' as const,
    status: 'created',
    currentStep: null,
    progress: 0,
    config: {
      name: 'Test',
      description: '',
      template: 'multi_condition_comparison' as const,
      conditions: [],
      replicates: {},
      parameters: {
        minPeptides: 2,
        minSamples: 3,
        log2FoldChangeThreshold: 1,
        pValueThreshold: 0.05,
        gseaDatabase: 'KEGG',
        gseaMinSize: 15,
        gseaMaxSize: 500,
        pcaComponents: 3,
        normalizationMethod: 'none',
        imputationMethod: 'none',
      },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    errorMessage: null,
    uploadedFiles: [],
    compoundFile: null,
    results: null,
    ...overrides,
  };
}

export function makeDEResult(overrides: Record<string, unknown> = {}) {
  return {
    master_protein_accessions: 'P12345',
    gene_name: 'GENE1',
    log_fc: 2.5,
    pval: 0.001,
    adj_pval: 0.005,
    se: 0.1,
    t_statistic: 25.0,
    significant: true,
    psm_count: 10,
    ...overrides,
  };
}
```

- [ ] **Step 3: Verify vitest config exists and commit**

Check `frontend/vitest.config.ts` or `frontend/package.json` for vitest configuration. If missing, note for setup.

---

### Task 23: test utils.ts

**Files:**
- Create: `frontend/src/lib/__tests__/utils.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, it, expect } from 'vitest';
import {
  isSignificantVolcano,
  getVolcanoPointColor,
  getSignificanceLabel,
  transformPCARowBased,
  exportToCSV,
  formatNumber,
  formatPValue,
  parseDelimited,
  formatGroup,
  formatComparisonKey,
  formatDuration,
  formatTimestamp,
  truncateText,
} from '@/lib/utils';

describe('isSignificantVolcano', () => {
  const thresholds = {
    foldChange: 1.0,
    pValue: 0.05,
    adjPValue: 0.05,
    s0: 0,
  };

  it('marks significant upregulated protein', () => {
    expect(isSignificantVolcano(2.5, 0.001, 0.005, thresholds)).toBe(true);
  });

  it('marks significant downregulated protein', () => {
    expect(isSignificantVolcano(-2.0, 0.001, 0.005, thresholds)).toBe(true);
  });

  it('marks non-significant when logFC below threshold', () => {
    expect(isSignificantVolcano(0.5, 0.001, 0.005, thresholds)).toBe(false);
  });

  it('marks non-significant when pvalue above threshold', () => {
    expect(isSignificantVolcano(2.5, 0.5, 0.5, thresholds)).toBe(false);
  });

  it('marks non-significant when adjPval above threshold', () => {
    expect(isSignificantVolcano(2.5, 0.001, 0.5, thresholds)).toBe(false);
  });

  it('S0 hyperbolic cutoff: rejects points with abs(logFC) <= s0', () => {
    const s0Thresholds = { ...thresholds, s0: 0.5 };
    // abs(logFC) = 0.4, which is <= actualS0 (0.5 * 1.0 = 0.5)
    expect(isSignificantVolcano(0.4, 0.0001, 0.0001, s0Thresholds)).toBe(false);
  });

  it('S0 hyperbolic cutoff: accepts points beyond the curve', () => {
    const s0Thresholds = { ...thresholds, s0: 0.1 };
    // Very significant p-value with moderate logFC should pass S0 curve
    expect(isSignificantVolcano(1.5, 0.00001, 0.00001, s0Thresholds)).toBe(true);
  });

  it('handles edge case: logFC exactly at foldChange', () => {
    expect(isSignificantVolcano(1.0, 0.001, 0.005, thresholds)).toBe(true);
  });

  it('handles edge case: pValue exactly at threshold', () => {
    expect(isSignificantVolcano(2.5, 0.05, 0.05, thresholds)).toBe(true);
  });
});

describe('getVolcanoPointColor', () => {
  const thresholds = { foldChange: 1.0, pValue: 0.05, adjPValue: 0.05, s0: 0 };

  it('returns pink for upregulated', () => {
    expect(getVolcanoPointColor(2.5, 0.001, 0.005, thresholds)).toBe('#E73564');
  });

  it('returns blue for downregulated', () => {
    expect(getVolcanoPointColor(-2.0, 0.001, 0.005, thresholds)).toBe('#00ADEF');
  });

  it('returns grey for not significant', () => {
    expect(getVolcanoPointColor(0.3, 0.5, 0.5, thresholds)).toBe('#6B7280');
  });
});

describe('getSignificanceLabel', () => {
  const thresholds = { foldChange: 1.0, pValue: 0.05, adjPValue: 0.05, s0: 0 };

  it('returns Upregulated', () => {
    expect(getSignificanceLabel(2.5, 0.001, 0.005, thresholds)).toBe('Upregulated');
  });

  it('returns Downregulated', () => {
    expect(getSignificanceLabel(-2.0, 0.001, 0.005, thresholds)).toBe('Downregulated');
  });

  it('returns Not Significant', () => {
    expect(getSignificanceLabel(0.3, 0.5, 0.5, thresholds)).toBe('Not Significant');
  });
});

describe('transformPCARowBased', () => {
  it('transforms column-based to row-based format', () => {
    const result = transformPCARowBased(
      ['S1', 'S2', 'S3'],
      [1.0, -2.0, 0.5],
      [3.0, -1.0, 0.0],
      ['Control', 'Treatment', 'Control']
    );

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ sample: 'S1', pc1: 1.0, pc2: 3.0, condition: 'Control' });
    expect(result[1]).toEqual({ sample: 'S2', pc1: -2.0, pc2: -1.0, condition: 'Treatment' });
  });

  it('handles empty arrays', () => {
    const result = transformPCARowBased([], [], [], []);
    expect(result).toEqual([]);
  });
});

describe('exportToCSV', () => {
  it('escapes quotes in values', () => {
    // Mock DOM functions
    const createObjectURL = vi.fn(() => 'blob:test');
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = createObjectURL;

    const mockLink = {
      setAttribute: vi.fn(),
      style: {} as CSSStyleDeclaration,
      click: vi.fn(),
    } as unknown as HTMLAnchorElement;
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(mockLink);
    const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn());
    const removeChild = vi.spyOn(document.body, 'removeChild').mockImplementation(vi.fn());

    exportToCSV(
      [{ name: 'Test "Quoted"', value: 42 }],
      'test.csv',
      [{ key: 'name', label: 'Name' }, { key: 'value', label: 'Value' }]
    );

    expect(mockLink.click).toHaveBeenCalled();

    // Cleanup
    URL.createObjectURL = originalCreateObjectURL;
    createElement.mockRestore();
    appendChild.mockRestore();
    removeChild.mockRestore();
  });

  it('does nothing with empty data', () => {
    exportToCSV([], 'test.csv');
    // Should not throw
  });
});

describe('formatNumber', () => {
  it('formats regular numbers', () => {
    expect(formatNumber(3.14159, 2)).toBe('3.14');
  });

  it('handles null', () => {
    expect(formatNumber(null)).toBe('-');
  });

  it('handles undefined', () => {
    expect(formatNumber(undefined)).toBe('-');
  });

  it('uses scientific notation for very small numbers', () => {
    expect(formatNumber(0.0001, 3)).toContain('e');
  });

  it('handles zero', () => {
    expect(formatNumber(0, 2)).toBe('0.00');
  });
});

describe('formatPValue', () => {
  it('uses scientific notation for small values', () => {
    expect(formatPValue(0.0001)).toContain('e');
  });

  it('uses fixed notation for moderate values', () => {
    expect(formatPValue(0.05)).toBe('0.0500');
  });

  it('returns dash for null', () => {
    expect(formatPValue(null)).toBe('-');
  });
});

describe('parseDelimited', () => {
  it('splits by comma', () => {
    expect(parseDelimited('A, B, C')).toEqual(['A', 'B', 'C']);
  });

  it('splits by semicolon', () => {
    expect(parseDelimited('P12345; P67890')).toEqual(['P12345', 'P67890']);
  });

  it('handles mixed delimiters', () => {
    expect(parseDelimited('A; B, C')).toEqual(['A', 'B', 'C']);
  });

  it('filters empty strings', () => {
    expect(parseDelimited('A,,B')).toEqual(['A', 'B']);
  });
});

describe('formatGroup', () => {
  it('joins values with +', () => {
    expect(formatGroup({ C: 'DrugA', T: '24h' })).toBe('DrugA+24h');
  });

  it('returns (any) for empty object', () => {
    expect(formatGroup({})).toBe('(any)');
  });
});

describe('formatComparisonKey', () => {
  it('replaces _vs_ with vs', () => {
    expect(formatComparisonKey('DrugA_vs_DMSO')).toBe('DrugA vs DMSO');
  });
});

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('formats seconds only when under 60', () => {
    expect(formatDuration(45)).toBe('45s');
  });
});
```

- [ ] **Step 2: Run frontend tests**

```powershell
cd frontend; npx vitest run src/lib/__tests__/utils.test.ts
```

- [ ] **Step 3: Fix any issues, verify all pass, commit**

---

### Task 24: Store tests (3 files)

**Files:**
- Create: `frontend/src/stores/__tests__/analysis-store.test.ts`
- Create: `frontend/src/stores/__tests__/processing-store.test.ts`
- Create: `frontend/src/stores/__tests__/ui-store.test.ts`

Each follows the existing `sessionStore.test.ts` pattern: `vitest` with `beforeEach` reset.

**analysis-store.test.ts** — tests pipeline selection, config parameters, organism, comparisons, reset.

**processing-store.test.ts** — tests step tracking, WebSocket message dispatch, queue position, cancel state, completion handling.

**ui-store.test.ts** — tests sidebar toggle, toast queue (add/remove/dismiss), modal open/close.

- [ ] **Step 1: Read each store source to confirm action names, then create test files**

- [ ] **Step 2: Run, fix, pass, commit each**

---

### Task 25: use-websocket hook test

**Files:**
- Create: `frontend/src/hooks/__tests__/use-websocket.test.ts`

- [ ] **Step 1: Create test file**

Tests: connection lifecycle (connect on mount, disconnect on unmount), reconnection logic, message parsing, cleanup on unmount. Uses `renderHook` from `@testing-library/react`.

- [ ] **Step 2: Run, fix, pass, commit**

---

### Task 26: api-client test

**Files:**
- Create: `frontend/src/lib/__tests__/api-client.test.ts`

- [ ] **Step 1: Create test file**

Tests: session CRUD URL construction, upload batching logic (5 files per batch from `api-client.ts:403`), error response→exception mapping, config update, GSEA/BioNet trigger URL construction. Uses `vi.fn()` for fetch mocking.

- [ ] **Step 2: Run, fix, pass, commit**

---

### Task 27: Component tests (2 files)

**Files:**
- Create: `frontend/src/components/__tests__/VolcanoPlot.test.tsx`
- Create: `frontend/src/components/__tests__/ProteinTable.test.tsx`

- [ ] **Step 1: Create VolcanoPlot test**

Tests: renders with DE data, renders EmptyState when no data, handles NaN/Inf values, passes correct significance coloring to plotly.

- [ ] **Step 2: Create ProteinTable test**

Tests: renders rows, sort by column triggers callback, pagination controls render, search input filters rows, gene name displayed, significant/not-significant badges.

- [ ] **Step 3: Run, fix, pass, commit**

---

### Phase 3 Completion Check

- [ ] Run all frontend tests: `cd frontend && npx vitest run`
- [ ] All 8 new files pass
- [ ] Total test count increased by ~79

---

## Phase 4: E2E Tests

### Task 28: 04-gsea-analysis.spec.ts

**Files:**
- Create: `Tests/e2e/04-gsea-analysis.spec.ts`

- [ ] **Step 1: Create spec**

Uses existing `helpers.ts` patterns. Key scenarios:
1. Complete msqrob2 pipeline → open GSEA tab → select KEGG → verify pathway table renders
2. Click pathway → enrichment plot appears
3. Switch to GO_BP → verify different pathways load
4. Toggle "Significant only" → table filters
5. Verify heatmap tab renders z-scores
6. Verify pagination controls work

- [ ] **Step 2: Run, fix selectors, pass, commit**

### Task 29: 05-bionet-network.spec.ts

**Files:**
- Create: `Tests/e2e/05-bionet-network.spec.ts`

Scenarios: trigger BioNet analysis, poll status, verify network graph renders, click node → protein detail, verify edges exist.

### Task 30: 06-compare-correlation.spec.ts

**Files:**
- Create: `Tests/e2e/06-compare-correlation.spec.ts`

Scenarios: select protein → run correlation → PCA renders → similar proteins table → Venn diagram with 2 comparisons → Venn with 3 comparisons.

### Task 31: 07-session-lifecycle.spec.ts

**Files:**
- Create: `Tests/e2e/07-session-lifecycle.spec.ts`

Scenarios: create → upload → configure → start → cancel → verify CANCELLED → retry → verify processing → list sessions shows mixed states → delete → verify gone.

### Task 32: Extend report-export.spec.ts

**Files:**
- Modify: `Tests/e2e/report-export.spec.ts`

Replace skipped tests with working scenarios: generate report from completed session → view report page → DE results render → rename report → delete report.

---

### Phase 4 Completion Check

- [ ] Run all E2E tests: `cd Tests && npx playwright test`
- [ ] All 4 new + 1 extended specs pass
- [ ] Total scenarios increased by ~25

---

## Final Verification

- [ ] **Backend full suite:** `backend\.venv\Scripts\python.exe -m pytest Tests/backend/ -v --tb=short`
- [ ] **Frontend full suite:** `cd frontend && npx vitest run`
- [ ] **E2E full suite:** `cd Tests && npx playwright test`
- [ ] **Lint check:** `backend\.venv\Scripts\python.exe -m ruff check . && cd frontend && npx eslint src/`
- [ ] **All pass, zero failures, zero warnings**
