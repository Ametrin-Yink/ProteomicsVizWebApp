"""Step 9: GSEA analysis."""
from app.services.gsea_service import GSEAService
from app.services.pipeline_engine import StepContext


async def step_gsea_analysis(ctx: StepContext) -> None:
    gsea_output = ctx.results_dir / "GSEA_Results.json"
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"
    de_output = ctx.results_dir / "Diff_Expression.tsv"

    gsea = GSEAService()
    gsea_results = await gsea.run_gsea_analysis(
        diff_expression_path=de_output,
        output_dir=ctx.results_dir / "gsea",
        protein_abundance_path=protein_output if protein_output.exists() else None,
    )
    # Save results — check if GSEAService has save_results method
    if hasattr(gsea, 'save_results'):
        gsea.save_results(gsea_results, gsea_output)
    ctx.result.gsea_results_path = str(gsea_output)
    ctx.step_outputs[9] = gsea_output
