"""Re-run GSEA analysis with fixed algorithm on existing data"""
import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, 'D:/CodingWorks/ProteomicsVizWebApp/backend')

from app.services.gsea_service import GSEAService

async def main():
    session_id = "456e356b-0de4-4f6d-b219-89bd50d14688"
    results_dir = Path(f"D:/CodingWorks/ProteomicsVizWebApp/backend/sessions/{session_id}/results")

    diff_expression_path = results_dir / "Diff_Expression.tsv"
    protein_abundance_path = results_dir / "Protein_Abundances.tsv"
    gsea_output = results_dir / "GSEA_Results.json"

    if not diff_expression_path.exists():
        print(f"Diff expression file not found: {diff_expression_path}")
        return

    print(f"Re-running GSEA analysis...")
    
    service = GSEAService()

    gsea_results = await service.run_gsea_analysis(
        diff_expression_path=diff_expression_path,
        output_dir=results_dir / "gsea",
        protein_abundance_path=protein_abundance_path if protein_abundance_path.exists() else None
    )

    service.save_results(gsea_output)

    print(f"GSEA analysis complete!")

    # Print first result curve sample
    for db, results in gsea_results.items():
        if results.results:
            first = results.results[0]
            print(f"\n{db}: {first.name}")
            print(f"  NES: {first.nes}")
            if first.running_es_curve:
                y_values = [y for x, y in first.running_es_curve]
                print(f"  Max ES: {max(y_values):.4f}")
                print(f"  Min ES: {min(y_values):.4f}")
            break

if __name__ == '__main__':
    asyncio.run(main())
