"""Step 8: QC metrics calculation (shared, both pipelines).

Unified handler that merges qc_metrics and qc_metrics_msqrob2.
Uses ctx.current_step_number for step_outputs.
"""

from app.services.pipeline_engine import StepContext
from app.services.qc_calculator import QCCalculator


async def step_qc_metrics(ctx: StepContext) -> None:
    """Calculate QC metrics from Protein_Abundances.tsv and Diff_Expression_*.tsv.

    Uses ctx.current_step_number to determine output step number.
    """
    qc_output = ctx.results_dir / "QC_Results.json"
    psm_qc_path = ctx.psm_file_path
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"

    # Gather all per-comparison DE files
    de_paths = sorted(ctx.results_dir.glob("Diff_Expression_*.tsv"))
    if not de_paths:
        # Fall back to legacy single file
        legacy = ctx.results_dir / "Diff_Expression.tsv"
        if legacy.exists():
            de_paths = [legacy]
        else:
            raise FileNotFoundError(
                f"No Diff_Expression files found in {ctx.results_dir}"
            )

    qc_calc = QCCalculator()
    qc_data = await qc_calc.calculate_all_metrics(
        protein_abundances_path=protein_output,
        diff_expression_paths=de_paths,
        psm_abundances_path=psm_qc_path,
    )
    qc_calc.save_qc_data(qc_data, qc_output)
    ctx.result.qc_results_path = str(qc_output)
    ctx.step_outputs[ctx.current_step_number or 8] = qc_output
