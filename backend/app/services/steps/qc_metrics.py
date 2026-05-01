"""Step 8: QC metrics calculation."""
from app.services.pipeline_engine import StepContext
from app.services.qc_calculator import QCCalculator


async def step_qc_metrics(ctx: StepContext) -> None:
    qc_output = ctx.results_dir / "QC_Results.json"
    psm_qc_path = ctx.psm_file_path
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"
    de_output = ctx.results_dir / "Diff_Expression.tsv"

    qc_calc = QCCalculator()
    qc_data = await qc_calc.calculate_all_metrics(
        protein_abundances_path=protein_output,
        diff_expression_path=de_output,
        psm_abundances_path=psm_qc_path,
    )
    qc_calc.save_qc_data(qc_data, qc_output)
    ctx.result.qc_results_path = str(qc_output)
    ctx.step_outputs[8] = qc_output
