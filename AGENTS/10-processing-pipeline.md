# 10 - Processing Pipeline (9 Steps)

```
Input: PSM CSV Files → Steps 1-9 → Output: Results, QC Plots, GSEA
```

| Step | Description | Package | Output |
|------|-------------|---------|--------|
| 1 | Combine Replicates | Python/Pandas | `PSM_Abundances.tsv` |
| 2 | Generate Unique PSM | Python/Pandas | (in place) |
| 3 | Remove Razor (optional) | Python | (in place) |
| 4 | Remove Low Quality | Python/Pandas | (in place) |
| 5 | Filter by Criteria | Python/Pandas | (in place) |
| 6 | Protein Abundance | R/msqrob2 `aggregateFeatures()` | `Protein_Abundances.tsv` |
| 7 | Differential Expression | R/msqrob2 `msqrob()` | `Diff_Expression.tsv` |
| 8 | QC Metrics | Python/sklearn PCA | `QC_Results.json` |
| 9 | GSEA Analysis | Python/gseapy `gp.prerank()` | GSEA results (5 databases) |

## Key Details

### Steps 1-5 (Python/Pandas)
- Combine uploaded CSVs, extract abundance columns, filter contaminants and low-quality PSMs
- Strict filtering: 20% missing value threshold, remove proteins with only 1 PSM
- Lenient filtering: 40% missing value threshold

### Steps 6-7 (R/msqrob2)
- R integration via subprocess, never rpy2
- Step 6 aggregates peptide-level data to protein-level using robust M-estimation
- Step 7 fits robust linear models and computes logFC, p-values, adjusted p-values

### Step 8 (QC)
- PCA on protein abundances (sklearn)
- P-value distribution, CV metrics, intensity distributions, data completeness

### Step 9 (GSEA)
- 5 databases: GO BP/MF/CC, KEGG, Reactome
- Requires biomart for UniProt→gene symbol mapping (implement fallback)

## State Management

Pipeline state persisted to `sessions/{session_id}/pipeline_state.json`:
```json
{
  "current_step": 0,
  "completed_steps": [],
  "failed_step": null,
  "error": null,
  "outputs": {}
}
```

## Recovery

Failed steps can be retried from the point of failure. Pipeline state is saved after each completed step, allowing resume after server restart.
