"""E2E chain tests: run ALL pipeline steps sequentially through shared StepContext.

Python steps run with real DataProcessor. R steps are mocked to create the
expected output files, allowing full-pipeline verification.

Column contract tests verify Step 1+2 output conforms to Section 8.1 spec.
"""

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

# ── Required column contract (Section 8.1) ──────────────────────────────

# Core columns the pipeline ALWAYS produces (regardless of input file format)
CORE_CONTRACT_COLUMNS = [
    "Abundance",
    "Sample_Origination",
    "Condition",
    "Replicate",
    "Unique_PSM",
]

# Columns that are standard input columns (present in most PD exports)
# but may vary between TMT and DIA formats
STANDARD_INPUT_COLUMNS = [
    "Sequence",
    "Modifications",
    "Charge",
    "Contaminant",
    "Master_Protein_Accessions",
]


# ── Test data for R step mocks ──────────────────────────────────────────


def _write_protein_abundance_tsv(results_dir: Path) -> pd.DataFrame:
    """Write a realistic Protein_Abundances.tsv for R step mocks."""
    df = pd.DataFrame(
        {
            "Protein": ["P00001", "P00002", "P00003", "P00004", "P00005"],
            "DMSO_1": [1000.0, 2000.0, 1500.0, 1200.0, 1800.0],
            "DMSO_2": [1100.0, 2100.0, 1600.0, 1300.0, 1900.0],
            "DMSO_3": [1050.0, 2050.0, 1550.0, 1250.0, 1850.0],
            "DrugA_1": [2000.0, 2000.0, 1500.0, 1200.0, 1800.0],
            "DrugA_2": [2100.0, 2100.0, 1600.0, 1300.0, 1900.0],
            "DrugA_3": [2050.0, 2050.0, 1550.0, 1250.0, 1850.0],
        }
    )
    df.to_csv(results_dir / "Protein_Abundances.tsv", sep="\t", index=False)
    return df


def _write_diff_expression_tsv(
    results_dir: Path, comparison_label: str
) -> pd.DataFrame:
    """Write a realistic Diff_Expression_*.tsv for R step mocks."""
    df = pd.DataFrame(
        {
            "Master_Protein_Accessions": [
                "P00001",
                "P00002",
                "P00003",
                "P00004",
                "P00005",
            ],
            "Gene_Name": ["GENE1", "GENE2", "GENE3", "GENE4", "GENE5"],
            "logFC": [2.0, -1.5, 0.5, 0.0, -2.0],
            "pval": [0.001, 0.01, 0.5, 0.8, 0.0001],
            "adjPval": [0.005, 0.05, 0.6, 0.9, 0.001],
        }
    )
    out = results_dir / f"Diff_Expression_{comparison_label}.tsv"
    df.to_csv(out, sep="\t", index=False)
    return df


# ── Helpers ─────────────────────────────────────────────────────────────

_COMPARISONS = [{"group1": {"condition_1": "DrugA"}, "group2": {"condition_1": "DMSO"}}]
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


def _make_preseeded_ctx(tmp_path: Path) -> StepContext:
    """Create a StepContext with pre-built DataFrame (bypasses input step 1)."""
    ctx = _make_ctx(PipelineTool.MSSTATS, [], tmp_path)
    # Build a realistic DataFrame matching Step 1+2 output contract
    import numpy as np

    rng = np.random.default_rng(42)
    n = 50
    conditions_list = ["DMSO", "DrugA"]
    rows = []
    for i in range(n):
        cond = conditions_list[i % 2]
        rep = (i // 2) % 3 + 1
        rows.append(
            {
                "Sequence": f"PEP_{i:04d}",
                "Modifications": "",
                "Charge": 2,
                "Contaminant": "FALSE",
                "Master_Protein_Accessions": f"P{i:05d}",
                "Quan_Info": "Valid",
                "Abundance": round(float(rng.lognormal(mean=7.0, sigma=0.5)), 1),
                "Sample_Origination": f"{cond}_{rep}",
                "Condition": cond,
                "Replicate": rep,
                "Unique_PSM": f"PEP_{i:04d}||2",
            }
        )
    ctx.df = pd.DataFrame(rows)
    ctx.df.to_parquet(ctx.psm_file_path, engine="pyarrow", index=False)
    return ctx


# ── Column Contract Tests ───────────────────────────────────────────────


class TestColumnContractTMT:
    """TMT pipeline Step 1+2 output has all required columns (Section 8.1)."""

    @pytest.mark.asyncio
    async def test_column_contract_tmt(self, tmt_fixture_path, tmp_path):
        """Run TMT step 1 (input) + step 2 (unique_psm) and check columns."""
        from app.services.steps.inputs.step_input_tmt import step_input_tmt
        from app.services.steps.shared.step_unique_psm import step_unique_psm

        channel_mapping = _make_tmt_channel_mapping()
        config = AnalysisConfig(
            template=AnalysisTemplate.MULTI_CONDITION,
            pipeline=PipelineTool.MSSTATS,
            organism="human",
            remove_razor=True,
            strict_filtering=False,
            file_type="tmt",
            tmt_channel_mapping=channel_mapping,
        )
        results_dir = tmp_path / "results"
        uploads_dir = tmp_path / "uploads"
        results_dir.mkdir(exist_ok=True)
        uploads_dir.mkdir(exist_ok=True)

        ctx = StepContext(
            config=config,
            session_id="contract-test-tmt",
            file_paths=[tmt_fixture_path],
            results_dir=results_dir,
            uploads_dir=uploads_dir,
        )
        ctx.psm_file_path = results_dir / "PSM_Combined.parquet"
        ctx.result = AnalysisResult(session_id="contract-test-tmt")

        await step_input_tmt(ctx)
        # In DuckDB mode, ctx.df is None (Steps 1-2 merged into streaming)
        # Load from parquet for column verification
        if ctx.df is None:
            assert ctx.psm_file_path and ctx.psm_file_path.exists(), (
                "Step 1 must save parquet when DuckDB streaming"
            )

        await step_unique_psm(ctx)
        if ctx.df is None:
            # DuckDB mode: load parquet for verification
            ctx.df = pd.read_parquet(ctx.psm_file_path, engine="pyarrow")
        else:
            assert ctx.df is not None, "Step 2 must keep ctx.df alive"

        # Check core pipeline-produced columns exist
        for col in CORE_CONTRACT_COLUMNS:
            assert col in ctx.df.columns, f"Missing required column: {col}"

        # Check standard input columns (should be carried through)
        for col in STANDARD_INPUT_COLUMNS:
            assert col in ctx.df.columns, f"Missing input column: {col}"

        # Check condition group columns (drug, time) are present
        assert "drug" in ctx.df.columns, "Missing condition group column: drug"
        assert "time" in ctx.df.columns, "Missing condition group column: time"

        # Verify Sample_Origination format
        assert (
            ctx.df["Sample_Origination"].str.match(r".+_\d+").all()
        ), "Sample_Origination should end with _<replicate>"

        # Verify Abundance is numeric
        assert pd.api.types.is_numeric_dtype(
            ctx.df["Abundance"]
        ), "Abundance must be numeric"

        # Verify Replicate is integer
        assert pd.api.types.is_integer_dtype(
            ctx.df["Replicate"]
        ), "Replicate must be integer"

        # Verify no zero abundances
        assert (ctx.df["Abundance"] > 0).all(), "No zero abundances allowed"

        # Verify Unique_PSM format
        assert (
            ctx.df["Unique_PSM"].str.contains("|", regex=False).all()
        ), "Unique_PSM must contain pipe separators"


class TestColumnContractDIA:
    """DIA pipeline Step 1+2 output has all required columns (Section 8.1)."""

    @pytest.mark.asyncio
    async def test_column_contract_dia(self, dia_fixture_path, tmp_path):
        """Run DIA step 1 (input) + step 2 (unique_psm) and check columns."""
        from app.services.steps.inputs.step_input_dia import step_input_dia
        from app.services.steps.shared.step_unique_psm import step_unique_psm

        metadata = _make_dia_metadata(dia_fixture_path)
        config = AnalysisConfig(
            template=AnalysisTemplate.MULTI_CONDITION,
            pipeline=PipelineTool.MSQROB2,
            organism="human",
            remove_razor=True,
            strict_filtering=False,
            file_type="dia",
            metadata=metadata,
        )
        results_dir = tmp_path / "results"
        uploads_dir = tmp_path / "uploads"
        results_dir.mkdir(exist_ok=True)
        uploads_dir.mkdir(exist_ok=True)

        ctx = StepContext(
            config=config,
            session_id="contract-test-dia",
            file_paths=[dia_fixture_path],
            results_dir=results_dir,
            uploads_dir=uploads_dir,
        )
        ctx.psm_file_path = results_dir / "PSM_Combined.parquet"
        ctx.result = AnalysisResult(session_id="contract-test-dia")

        await step_input_dia(ctx)
        assert ctx.psm_file_path and ctx.psm_file_path.exists(), (
            "Step 1 must save parquet"
        )
        assert ctx.df is None, "Step 1 must set ctx.df=None (DuckDB mode)"

        await step_unique_psm(ctx)
        assert ctx.df is None, (
            "Step 2 must keep ctx.df=None "
            "(downstream steps 3-5 use DuckDB SQL)"
        )
        # Load parquet for column contract verification
        ctx.df = pd.read_parquet(ctx.psm_file_path, engine="pyarrow")

        # Check core pipeline-produced columns exist
        for col in CORE_CONTRACT_COLUMNS:
            assert col in ctx.df.columns, f"Missing required column: {col}"

        # Check standard input columns that should be carried through
        for col in STANDARD_INPUT_COLUMNS:
            assert col in ctx.df.columns, f"Missing input column: {col}"

        # Check condition group columns are present
        assert "condition_1" in ctx.df.columns, "Missing group column: condition_1"
        assert "condition_2" in ctx.df.columns, "Missing group column: condition_2"

        # Verify Abundance and Replicate types
        assert pd.api.types.is_numeric_dtype(
            ctx.df["Abundance"]
        ), "Abundance must be numeric"
        assert pd.api.types.is_integer_dtype(
            ctx.df["Replicate"]
        ), "Replicate must be integer"

        # Verify Unique_PSM format
        assert (
            ctx.df["Unique_PSM"].str.contains("|", regex=False).all()
        ), "Unique_PSM must contain pipe separators"


# ── Python-only chain tests (shared steps 2-5) ─────────────────────────


class TestSharedChainSteps:
    """Shared pipeline steps 2-5 (unique_psm, razor, quality, filter)."""

    @pytest.mark.asyncio
    async def test_step2_keeps_dataframe(self, tmp_path):
        from app.services.steps.shared.step_unique_psm import step_unique_psm

        ctx = _make_preseeded_ctx(tmp_path)
        assert ctx.df is not None

        await step_unique_psm(ctx)
        assert ctx.df is not None, "Unified step 2 must keep ctx.df alive"
        assert "Unique_PSM" in ctx.df.columns

    @pytest.mark.asyncio
    async def test_full_chain_2_to_5(self, tmp_path):
        """Shared steps 2-5: ctx.df stays alive until step 5 frees it."""
        from app.services.steps.shared.step_filter_criteria import (
            step_filter_criteria_default,
        )
        from app.services.steps.shared.step_remove_low_quality import (
            step_remove_low_quality_default,
        )
        from app.services.steps.shared.step_remove_razor import step_remove_razor
        from app.services.steps.shared.step_unique_psm import step_unique_psm

        ctx = _make_preseeded_ctx(tmp_path)
        assert ctx.df is not None

        await step_unique_psm(ctx)
        assert ctx.df is not None, "Step 2 must keep ctx.df"
        await step_remove_razor(ctx)
        assert ctx.df is not None, "Step 3 must keep ctx.df"
        await step_remove_low_quality_default(ctx)
        assert ctx.df is not None, "Step 4 must keep ctx.df"
        await step_filter_criteria_default(ctx)
        assert ctx.psm_file_path.exists(), (
            "Step 5 must write PSM_Abundances.parquet"
        )

    @pytest.mark.asyncio
    async def test_step_razor_removes_multi_protein(self, tmp_path):
        from app.services.steps.shared.step_remove_razor import step_remove_razor
        from app.services.steps.shared.step_unique_psm import step_unique_psm

        ctx = _make_preseeded_ctx(tmp_path)
        await step_unique_psm(ctx)
        await step_remove_razor(ctx)
        assert ctx.df is not None
        multi = ctx.df["Master_Protein_Accessions"].str.contains(";").sum()
        assert multi == 0, f"Expected 0 multi-protein accessions, got {multi}"


# ── FULL pipeline E2E tests (with R steps mocked) ───────────────────────


class TestMSstatsFullPipeline:
    """MSstats (TMT): ALL 8 steps with mocked R steps 6-7."""

    @pytest.mark.asyncio
    async def test_all_8_steps(self, tmp_path):
        from app.services.steps.engines.step_msstats_abundance import (
            step_msstats_protein_abundance,
        )
        from app.services.steps.engines.step_msstats_de import (
            step_msstats_group_comparison,
        )
        from app.services.steps.shared.step_filter_criteria import (
            step_filter_criteria_default,
        )
        from app.services.steps.shared.step_qc_metrics import step_qc_metrics
        from app.services.steps.shared.step_remove_low_quality import (
            step_remove_low_quality_default,
        )
        from app.services.steps.shared.step_remove_razor import step_remove_razor
        from app.services.steps.shared.step_unique_psm import step_unique_psm

        # Use pre-seeded DataFrame (bypasses input step 1)
        ctx = _make_preseeded_ctx(tmp_path)
        ctx.config.comparisons = _COMPARISONS
        ctx.config.pipeline = PipelineTool.MSSTATS
        results = ctx.results_dir

        # ── Steps 2-5: Python (real) ──
        await step_unique_psm(ctx)
        assert ctx.df is not None
        await step_remove_razor(ctx)
        assert ctx.df is not None
        await step_remove_low_quality_default(ctx)
        assert ctx.df is not None
        await step_filter_criteria_default(ctx)
        assert ctx.psm_file_path.exists(), "Step 5 must write output parquet"

        # ── Step 6: Protein abundance (mocked MSstats R) ──
        rds = results / "MSstats_Processed.rds"
        protein_df = _write_protein_abundance_tsv(results)

        async def fake_data_process(*args, **kwargs):
            protein_df.to_csv(results / "Protein_Abundances.tsv", sep="\t", index=False)
            rds.write_bytes(b"mock rds")

        with patch(
            "app.services.steps.engines.step_msstats_abundance.msstats_wrapper.data_process",
            new=AsyncMock(side_effect=fake_data_process),
        ):
            await step_msstats_protein_abundance(ctx)

        assert ctx.result.total_proteins == 5
        assert rds.exists()

        # ── Step 7: Differential expression (mocked MSstats R) ──
        with patch(
            "app.services.steps.engines.step_msstats_de.msstats_wrapper.group_comparison_multi",
            new=AsyncMock(
                side_effect=lambda **kw: _write_diff_expression_tsv(
                    results, _COMPARISON_LABEL
                )
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


class TestMsqrob2FullPipeline:
    """msqrob2 (DIA): ALL 8 steps with mocked R steps 6-7."""

    @pytest.mark.asyncio
    async def test_all_8_steps(self, tmp_path):
        from app.services.steps.engines.step_msqrob2_abundance import (
            step_protein_abundance_msqrob2,
        )
        from app.services.steps.engines.step_msqrob2_de import step_multi_condition_de
        from app.services.steps.shared.step_filter_criteria import (
            step_filter_criteria_default,
        )
        from app.services.steps.shared.step_qc_metrics import step_qc_metrics
        from app.services.steps.shared.step_remove_low_quality import (
            step_remove_low_quality_default,
        )
        from app.services.steps.shared.step_remove_razor import step_remove_razor
        from app.services.steps.shared.step_unique_psm import step_unique_psm

        # Use pre-seeded DataFrame (bypasses input step 1)
        ctx = _make_preseeded_ctx(tmp_path)
        ctx.config.comparisons = _COMPARISONS
        ctx.config.pipeline = PipelineTool.MSQROB2
        results = ctx.results_dir

        # ── Steps 2-5: Python (real) ──
        await step_unique_psm(ctx)
        assert ctx.df is not None
        await step_remove_razor(ctx)
        assert ctx.df is not None
        await step_remove_low_quality_default(ctx)
        assert ctx.df is not None
        await step_filter_criteria_default(ctx)
        assert ctx.psm_file_path.exists(), "Step 5 must write output parquet"

        # ── Step 6: Protein abundance (mocked msqrob2 R) ──
        rds = results / "MSqRob2_Processed.rds"
        protein_df = _write_protein_abundance_tsv(results)

        async def fake_data_process(*args, **kwargs):
            protein_df.to_csv(results / "Protein_Abundances.tsv", sep="\t", index=False)
            rds.write_bytes(b"mock rds")

        with patch(
            "app.services.steps.engines.step_msqrob2_abundance.msqrob2_wrapper.data_process",
            new=AsyncMock(side_effect=fake_data_process),
        ):
            await step_protein_abundance_msqrob2(ctx)

        assert ctx.result.total_proteins == 5
        assert rds.exists()

        # ── Step 7: Differential expression (mocked msqrob2 R) ──
        with patch(
            "app.services.steps.engines.step_msqrob2_de.msqrob2_wrapper.group_comparison_multi",
            new=AsyncMock(
                side_effect=lambda **kw: _write_diff_expression_tsv(
                    results, _COMPARISON_LABEL
                )
            ),
        ):
            await step_multi_condition_de(ctx)

        assert ctx.result.significant_proteins > 0
        assert (results / f"Diff_Expression_{_COMPARISON_LABEL}.tsv").exists()

        # ── Step 8: QC metrics (real Python) ──
        await step_qc_metrics(ctx)

        qc_file = results / "QC_Results.json"
        assert qc_file.exists()
        assert ctx.result.qc_results_path == str(qc_file)


# ── Fixture helpers ─────────────────────────────────────────────────────


def _make_tmt_channel_mapping() -> dict:
    """Create a TMT channel mapping for testing with 16 channels."""
    # 16 channels from the TMT fixture
    channels = [
        "126",
        "127N",
        "127C",
        "128N",
        "128C",
        "129N",
        "129C",
        "130N",
        "130C",
        "131N",
        "131C",
        "132N",
        "132C",
        "133N",
        "133C",
        "134N",
    ]
    mapping = {}
    for i, ch in enumerate(channels):
        if i < 8:
            mapping[ch] = {"drug": "DMSO", "time": "24h", "replicate": 1}
        else:
            mapping[ch] = {"drug": "DrugA", "time": "24h", "replicate": 1}
    return mapping


def _make_dia_metadata(fixture_path: Path) -> dict:
    """Create DIA per-file metadata matching the fixture filename."""
    return {
        fixture_path.name: {
            "condition_1": "DMSO",
            "condition_2": "24h",
            "experiment": "MyExp",
            "batch": "A",
            "replicate": "1",
        }
    }
