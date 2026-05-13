"""Step 5: QC metrics calculation (msqrob2 consolidated pipeline)."""

from app.services.pipeline_engine import StepContext
from app.services.qc_calculator import QCCalculator


async def step_qc_metrics_msqrob2(ctx: StepContext) -> None:
    qc_output = ctx.results_dir / "QC_Results.json"
    psm_qc_path = ctx.psm_file_path
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"

    de_paths = sorted(ctx.results_dir.glob("Diff_Expression_*.tsv"))
    if not de_paths:
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
    ctx.step_outputs[5] = qc_output
