"""Step 8: QC metrics calculation."""

from pathlib import Path

from app.services.pipeline_engine import StepContext
from app.services.qc_calculator import QCCalculator


def _resolve_de_output(ctx: StepContext) -> Path:
    """Resolve the DE results file path, handling multi-condition output naming."""
    if ctx.result and ctx.result.diff_expression_path:
        p = Path(ctx.result.diff_expression_path)
        if p.exists():
            return p
    default = ctx.results_dir / "Diff_Expression.tsv"
    if default.exists():
        return default
    # Fall back to first Diff_Expression_*.tsv found
    candidates = sorted(ctx.results_dir.glob("Diff_Expression_*.tsv"))
    if candidates:
        return candidates[0]
    return default


async def step_qc_metrics(ctx: StepContext) -> None:
    qc_output = ctx.results_dir / "QC_Results.json"
    psm_qc_path = ctx.psm_file_path
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"
    de_output = _resolve_de_output(ctx)

    qc_calc = QCCalculator()
    qc_data = await qc_calc.calculate_all_metrics(
        protein_abundances_path=protein_output,
        diff_expression_path=de_output,
        psm_abundances_path=psm_qc_path,
    )
    qc_calc.save_qc_data(qc_data, qc_output)
    ctx.result.qc_results_path = str(qc_output)
    ctx.step_outputs[8] = qc_output
