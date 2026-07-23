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
    """Write a realistic consolidated differential table for R step mocks."""
    df = pd.DataFrame(
        {
            "Label": [comparison_label] * 5,
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
    out = results_dir / "Differential_Results_Long.tsv"
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
        resolve_shared_peptides=True,
        max_missing_fraction_per_condition=0.40,
        min_psms_per_protein=1,
        comparisons=_COMPARISONS if with_comparisons else [],
        metadata={
            f"{condition}_{replicate}.txt": {
                "condition": condition,
                "replicate": replicate,
            }
            for condition in ["DMSO", "DrugA"]
            for replicate in [1, 2, 3]
        },
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
    """TMT preparation output has all required columns (Section 8.1)."""

    @pytest.mark.asyncio
    async def test_column_contract_tmt(self, tmt_fixture_path, tmp_path):
        """Run the combined TMT preparation/filter stage and check columns."""
        from app.services.steps.inputs.step_input_tmt import step_input_tmt

        channel_mapping = _make_tmt_channel_mapping()
        config = AnalysisConfig(
            template=AnalysisTemplate.MULTI_CONDITION,
            pipeline=PipelineTool.MSSTATS,
            organism="human",
            resolve_shared_peptides=True,
            max_missing_fraction_per_condition=0.40,
            min_psms_per_protein=1,
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
        # Preparation creates Unique_PSM and applies quality filters in DuckDB.
        if ctx.df is None:
            assert (
                ctx.psm_file_path and ctx.psm_file_path.exists()
            ), "Step 1 must save parquet when DuckDB streaming"
            ctx.df = pd.read_parquet(ctx.psm_file_path, engine="pyarrow")

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
    """DIA preparation output has all required columns (Section 8.1)."""

    @pytest.mark.asyncio
    async def test_column_contract_dia(self, dia_fixture_path, tmp_path):
        """Run the combined DIA preparation/filter stage and check columns."""
        from app.services.steps.inputs.step_input_dia import step_input_dia

        metadata = _make_dia_metadata(dia_fixture_path)
        config = AnalysisConfig(
            template=AnalysisTemplate.MULTI_CONDITION,
            pipeline=PipelineTool.MSQROB2,
            organism="human",
            resolve_shared_peptides=True,
            max_missing_fraction_per_condition=0.40,
            min_psms_per_protein=1,
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
        assert (
            ctx.psm_file_path and ctx.psm_file_path.exists()
        ), "Step 1 must save parquet"
        assert ctx.df is None, "Step 1 must set ctx.df=None (DuckDB mode)"

        # Load the DuckDB preparation output for column contract verification.
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
    """Shared protein-resolution and coverage stages compose via Parquet."""

    @pytest.mark.asyncio
    async def test_shared_stage_chain(self, tmp_path):
        from app.services.steps.shared.step_filter_criteria import (
            step_filter_criteria_default,
        )
        from app.services.steps.shared.step_resolve_shared_peptides import (
            step_resolve_shared_peptides,
        )

        ctx = _make_preseeded_ctx(tmp_path)
        await step_resolve_shared_peptides(ctx)
        await step_filter_criteria_default(ctx)
        assert ctx.psm_file_path.exists()
        assert ctx.psm_file_path.name == "PSM_Abundances.parquet"

    @pytest.mark.asyncio
    async def test_resolver_assigns_shared_psm_to_one_protein(self, tmp_path):
        from app.services.steps.shared.step_resolve_shared_peptides import (
            step_resolve_shared_peptides,
        )

        ctx = _make_preseeded_ctx(tmp_path)
        shared = pd.read_parquet(ctx.psm_file_path, engine="pyarrow").iloc[[0]].copy()
        shared["Master_Protein_Accessions"] = "P00000; P99999"
        shared.to_parquet(ctx.psm_file_path, engine="pyarrow", index=False)

        await step_resolve_shared_peptides(ctx)

        result = pd.read_parquet(ctx.psm_file_path, engine="pyarrow")
        multi = result["Master_Protein_Accessions"].str.contains(";").sum()
        assert multi == 0, f"Expected 0 multi-protein accessions, got {multi}"


# ── FULL pipeline E2E tests (with R steps mocked) ───────────────────────


class TestMSstatsFullPipeline:
    """MSstats (TMT): six-stage pipeline with mocked R stages 4-5."""

    @pytest.mark.asyncio
    async def test_all_6_steps(self, tmp_path):
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
        from app.services.steps.shared.step_resolve_shared_peptides import (
            step_resolve_shared_peptides,
        )

        # Use pre-seeded DataFrame (bypasses input step 1)
        ctx = _make_preseeded_ctx(tmp_path)
        ctx.config.comparisons = _COMPARISONS
        ctx.config.pipeline = PipelineTool.MSSTATS
        results = ctx.results_dir

        # ── Stages 2-3: shared DuckDB filters (real) ──
        await step_resolve_shared_peptides(ctx)
        await step_filter_criteria_default(ctx)
        assert ctx.psm_file_path.exists(), "Stage 3 must write output parquet"

        # ── Stage 4: Protein abundance (mocked MSstats R) ──
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

        # ── Stage 5: Differential expression (mocked MSstats R) ──
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
        assert (results / "Differential_Results_Long.tsv").exists()

        # ── Stage 6: QC metrics (real Python) ──
        await step_qc_metrics(ctx)

        qc_file = results / "QC_Results.json"
        assert qc_file.exists()
        assert ctx.result.qc_results_path == str(qc_file)
        assert (results / "visualization_artifacts.json").exists()
        assert (results / "protein_abundance_long.parquet").exists()
        assert (results / "peptide_abundance_long.parquet").exists()


class TestMsqrob2FullPipeline:
    """msqrob2 (DIA): six-stage pipeline with mocked R stages 4-5."""

    @pytest.mark.asyncio
    async def test_all_6_steps(self, tmp_path):
        from app.services.steps.engines.step_msqrob2_abundance import (
            step_protein_abundance_msqrob2,
        )
        from app.services.steps.engines.step_msqrob2_de import step_multi_condition_de
        from app.services.steps.shared.step_filter_criteria import (
            step_filter_criteria_default,
        )
        from app.services.steps.shared.step_qc_metrics import step_qc_metrics
        from app.services.steps.shared.step_resolve_shared_peptides import (
            step_resolve_shared_peptides,
        )

        # Use pre-seeded DataFrame (bypasses input step 1)
        ctx = _make_preseeded_ctx(tmp_path)
        ctx.config.comparisons = _COMPARISONS
        ctx.config.pipeline = PipelineTool.MSQROB2
        results = ctx.results_dir

        # ── Stages 2-3: shared DuckDB filters (real) ──
        await step_resolve_shared_peptides(ctx)
        await step_filter_criteria_default(ctx)
        assert ctx.psm_file_path.exists(), "Stage 3 must write output parquet"

        # ── Stage 4: Protein abundance (mocked msqrob2 R) ──
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

        # ── Stage 5: Differential expression (mocked msqrob2 R) ──
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
        assert (results / "Differential_Results_Long.tsv").exists()

        # ── Stage 6: QC metrics (real Python) ──
        await step_qc_metrics(ctx)

        qc_file = results / "QC_Results.json"
        assert qc_file.exists()
        assert ctx.result.qc_results_path == str(qc_file)
        assert (results / "visualization_artifacts.json").exists()
        assert (results / "protein_abundance_long.parquet").exists()
        assert (results / "peptide_abundance_long.parquet").exists()


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
