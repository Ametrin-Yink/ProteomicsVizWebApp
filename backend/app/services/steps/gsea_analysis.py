"""Step 9: GSEA analysis."""

from pathlib import Path

from app.services.gsea_service import GSEAService
from app.services.pipeline_engine import StepContext


def _resolve_de_output(ctx: StepContext) -> Path:
    """Resolve the DE results file path, handling multi-condition output naming."""
    if ctx.result and ctx.result.diff_expression_path:
        p = Path(ctx.result.diff_expression_path)
        if p.exists():
            return p
    default = ctx.results_dir / "Diff_Expression.tsv"
    if default.exists():
        return default
    candidates = sorted(ctx.results_dir.glob("Diff_Expression_*.tsv"))
    if candidates:
        return candidates[0]
    return default


async def step_gsea_analysis(ctx: StepContext) -> None:
    gsea_output = ctx.results_dir / "GSEA_Results.json"
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"
    de_output = _resolve_de_output(ctx)

    gsea = GSEAService()
    gsea_results = await gsea.run_gsea_analysis(
        diff_expression_path=de_output,
        output_dir=ctx.results_dir / "gsea",
        protein_abundance_path=protein_output if protein_output.exists() else None,
    )
    # Save results — check if GSEAService has save_results method
    if hasattr(gsea, "save_results"):
        gsea.save_results(gsea_results, gsea_output)
    ctx.result.gsea_results_path = str(gsea_output)
    ctx.step_outputs[9] = gsea_output
