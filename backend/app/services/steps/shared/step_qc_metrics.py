"""Final QC metrics and visualization-artifact materialization.

Unified handler that merges qc_metrics and qc_metrics_msqrob2.
Uses ctx.current_step_number for step_outputs.
"""

import asyncio

from app.services.pipeline_engine import StepContext
from app.services.qc_calculator import QCCalculator
from app.services.steps._helpers import differential_output_paths
from app.services.visualization_artifacts import (
    DIFFERENTIAL_ARTIFACT,
    materialize_visualization_artifacts,
)


async def step_qc_metrics(ctx: StepContext) -> None:
    """Calculate QC metrics and materialize canonical visualization artifacts.

    Uses ctx.current_step_number to determine output step number.
    """
    qc_output = ctx.results_dir / "QC_Results.json"
    psm_qc_path = ctx.psm_file_path
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"

    de_paths = differential_output_paths(ctx.results_dir)
    if not de_paths:
        raise FileNotFoundError(
            f"No consolidated differential results found in {ctx.results_dir}"
        )

    qc_calc = QCCalculator()
    qc_data = await qc_calc.calculate_all_metrics(
        protein_abundances_path=protein_output,
        # Per-comparison p-value histograms are queried from canonical Parquet.
        diff_expression_paths=[],
        psm_abundances_path=psm_qc_path,
    )
    qc_calc.save_qc_data(qc_data, qc_output)
    await asyncio.to_thread(
        materialize_visualization_artifacts,
        ctx.results_dir,
        config=ctx.config,
        pipeline=ctx.config.pipeline.value,
    )
    for path in [*de_paths, ctx.results_dir / "peptide_processed_long.tsv"]:
        path.unlink(missing_ok=True)
    ctx.result.diff_expression_path = str(ctx.results_dir / DIFFERENTIAL_ARTIFACT)
    ctx.result.qc_results_path = str(qc_output)
    ctx.step_outputs[ctx.current_step_number or 8] = qc_output
