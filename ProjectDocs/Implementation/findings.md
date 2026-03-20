# Research Findings & Discoveries

## Sample Data Analysis

### PSM File Structure
**File:** `PSM_SampleData_DMSO_1.csv`

**Key Columns Identified:**
- `Sequence` - Peptide sequence
- `Modifications` - Post-translational modifications (e.g., "N-Term(TMT6plex); K22(TMT6plex)")
- `Charge` - Peptide charge state
- `Contaminant` - Boolean flag (TRUE/FALSE)
- `Master Protein Accessions` - UniProt IDs (can be multiple, semicolon-separated)
- `Protein Accessions` - Additional protein IDs
- `Quan Info` - Quantification info ("NA" or values)
- `Abundance F49 Sample` - Abundance value (column name varies by file)
- `Confidence` - PSM confidence level
- `Annotated Sequence` - Modified sequence notation

**⚠️ CRITICAL: Abundance Column Format**
- **Format:** `Abundance F{code} Sample`
- **Examples:** `Abundance F49 Sample`, `Abundance F18 Sample`
- **R scripts parse this exactly - DO NOT CHANGE**
- Different files have different F-codes based on TMT channel

**Filename Pattern (IMMUTABLE):**
- **Format:** `PSM_{ExperimentName}_{Condition}_{ReplicateNumber}.csv`
- **Example:** `PSM_SampleData_DMSO_1.csv`
  - Experiment: SampleData
  - Condition: DMSO
  - Replicate: 1
- **NEVER modify this pattern**

**Data Characteristics:**
- ~5000 rows per file
- CSV format with quoted fields
- Contains contaminants that need filtering
- Multiple proteins can match single PSM (razor peptides)

### Compound File Structure
**File:** `compound id.csv`

**Columns:**
- `Corp ID` - Compound identifier (e.g., "INCZ123456")
- `SMILES` - Chemical structure notation

**Matching Logic:**
- Corp ID should match Condition names from PSM filenames
- If match found, display 2D structure via RDKit

## Technology Research

### PDF Generation Options
**Selected Approach:** Playwright + reportlab

**Reasoning:**
- reportlab: Good for programmatic PDF construction
- Playwright: Can render HTML/CSS for complex layouts
- Combination allows flexible report design

**Alternative Considered:**
- WeasyPrint: Good but limited CSS support
- pdfkit: Simple but less flexible

### R Integration (CRITICAL)
**Selected:** Subprocess method (NOT rpy2)

**⚠️ ABSOLUTE REQUIREMENT:**
- Use subprocess to call R scripts
- NEVER use rpy2 directly (causes stability issues)

**Implementation:**
```python
import subprocess
from pathlib import Path

class Msqrob2Wrapper:
    def run_protein_abundance(self, input_tsv: Path, output_tsv: Path):
        result = subprocess.run(
            ['Rscript', 'scripts/msqrob2_protein.R', 
             str(input_tsv), str(output_tsv)],
            capture_output=True,
            text=True,
            encoding='utf-8'  # Primary encoding
        )
        if result.returncode != 0:
            # Fallback encoding handling
            try:
                error_msg = result.stderr
            except UnicodeDecodeError:
                error_msg = result.stderr.encode('latin-1').decode('utf-8', errors='replace')
            raise RuntimeError(f"R script failed: {error_msg}")
        return output_tsv
```

**Required R Packages (NEVER SKIP):**
```r
BiocManager::install(c("msqrob2", "QFeatures", "limma"))
```

**Encoding Handling:**
- Primary: UTF-8
- Fallback: latin-1 with replacement
- Always handle UnicodeDecodeError gracefully

### Plotly.js Features
**Capabilities Confirmed:**
- Interactive volcano plots with selection modes
- Box/lasso selection built-in
- Custom colors and thresholds
- Export to PNG/SVG
- Responsive sizing

**Bundle Size Consideration:**
- Full Plotly.js is ~3MB
- May need to import specific trace types
- Consider lazy loading for plot components

## Color Scheme Research

**Required Colors:**
- Primary: #E73564 (Pink/Red)
- Secondary: #00ADEF (Cyan/Blue)
- Background: White

**Complementary Palette (Suggested):**
- Success/Up: #E73564 (Pink/Red) - for upregulated
- Down: #00ADEF (Cyan/Blue) - for downregulated
- Neutral: #6B7280 (Gray) - for non-significant
- Background: #FFFFFF (White)
- Surface: #F9FAFB (Light Gray)
- Border: #E5E7EB (Border Gray)
- Text Primary: #111827 (Near Black)
- Text Secondary: #6B7280 (Gray)

**Additional Accent Colors:**
- Warning: #F59E0B (Amber)
- Error: #DC2626 (Red)
- Info: #3B82F6 (Blue)

## Database Schema Notes

### Session Storage (JSON-based)
**File:** `backend/sessions/{session_id}/metadata.json`

**Structure:**
```json
{
  "id": "uuid",
  "name": "Session Name",
  "template": "protein_pairwise_comparison",
  "state": "completed",
  "created_at": "2026-03-16T10:00:00Z",
  "updated_at": "2026-03-16T12:00:00Z",
  "config": {
    "treatment": "DMSO",
    "control": "INCZ123456",
    "organism": "human",
    "remove_razor": true,
    "strict_filtering": false
  },
  "files": {
    "proteomics": ["path/to/file1.csv", ...],
    "compound": "path/to/compound.csv"
  },
  "outputs": {
    "psm_abundances": "path/to/PSM_Abundances.tsv",
    "protein_abundances": "path/to/Protein_Abundances.tsv",
    "diff_expression": "path/to/Diff_Expression.tsv",
    "qc_metrics": "path/to/qc/",
    "gsea": "path/to/gsea/"
  }
}
```

**Session Cleanup:**
- When user deletes session from manager → delete entire session directory
- Path: `backend/sessions/{session_id}/`

## Processing Pipeline Notes

### Step 1: Column Mapping
**Dynamic Abundance Columns:**
- Pattern: `Abundance FXX Sample` where XX varies
- Need to identify dynamically per file
- Map to unified `Abundance` column with sample origination
- **R scripts parse `Abundance F{code} Sample` exactly - NEVER CHANGE**

**Required Column Validation:**
Before processing, validate these columns exist:
1. `Sequence`
2. `Modifications`
3. `Charge`
4. `Contaminant`
5. `Master Protein Accessions`
6. `Quan Info`
7. `Abundance F{code} Sample` (dynamic code)

### File Format Conversion
**Standard Workflow:**
1. **User Upload:** CSV format
2. **Internal Processing:** Convert to TSV
3. **R Scripts:** Read TSV
4. **Output Downloads:** Convert back to CSV

**Rationale:**
- TSV handles special characters better
- Avoids comma-in-data issues
- Cleaner parsing in R

### Step 3: Razor Peptide Resolution
**Algorithm:**
1. Group by Unique PSM + Sample
2. For multi-protein matches:
   - Count peptides per protein
   - Select protein with max count
   - Tie: longer sequence (from FASTA)
   - Final tie: first in list

### Step 6: Protein Abundance (msqrob2)
**Function:** `aggregateFeatures()` (from QFeatures)

**Usage:**
```r
pe <- aggregateFeatures(
    object = pe,
    i = "peptide",
    fcol = "Proteins",
    name = "protein",
    fun = MsCoreUtils::robustSummary
)
```

**R Script Structure:**
```r
# scripts/msqrob2_protein.R
library(msqrob2)
library(QFeatures)
library(limma)

args <- commandArgs(trailingOnly = TRUE)
input_file <- args[1]
output_file <- args[2]

# Read TSV
data <- read.delim(input_file, sep="\t", stringsAsFactors=FALSE)

# Create QFeatures object and aggregate to protein level
# Processing steps:
# 1. Log2 transformation
# 2. Median centering normalization
# 3. Robust summarization (M-estimation)

# Write TSV output
write.table(result, output_file, sep="\t", row.names=FALSE, quote=FALSE)
```

### Step 7: Differential Expression (msqrob2)
**Function:** `msqrob()`

**Usage:**
```r
pe <- msqrob(
    object = pe,
    i = "protein",
    formula = ~ condition,
    modelColumnName = "rlm",
    robust = TRUE
)

# Extract results
results <- getResults(pe, i = "protein", modelColumnName = "rlm")
```

**Output Columns:**
| Column | Description |
|--------|-------------|
| `logFC` | Log2 fold change (Treatment/Control) |
| `pval` | Raw p-value from t-test |
| `adjPval` | Benjamini-Hochberg adjusted p-value |
| `se` | Standard error |
| `df` | Degrees of freedom |

### Step 9: GSEA Analysis (gseapy)
**Function:** `gseapy.prerank()`

**Requirements:**
- Pre-ranked gene list (from diff expression)
- Ranking metric: -log10(pvalue) * sign(logFC)
- Gene identifier: Gene Name (not UniProt)

**Usage:**
```python
import gseapy as gp

# Prepare ranked list
rnk = pd.DataFrame({
    'gene': diff_results['gene_name'],
    'metric': -np.log10(diff_results['pval']) * np.sign(diff_results['logFC'])
})
rnk = rnk.sort_values('metric', ascending=False)

# Run GSEA
pre_res = gp.prerank(
    rnk=rnk,
    gene_sets='GO_Biological_Process_2021',
    outdir='gsea_results',
    permutation_num=1000,
    min_size=15,
    max_size=500,
    threads=4
)

# Access results
results_df = pre_res.results
# Columns: term, es, nes, pval, fdr, lead_genes
```

**GSEA Databases:**
| Database | Enrichr Name |
|----------|--------------|
| GO Biological Process | `'GO_Biological_Process_2021'` |
| GO Molecular Function | `'GO_Molecular_Function_2021'` |
| GO Cellular Component | `'GO_Cellular_Component_2021'` |
| KEGG | `'KEGG_2021_Human'` |
| Reactome | `'Reactome_2022'` |

**Results DataFrame Columns:**
| Column | Description |
|--------|-------------|
| `term` | Gene set name / pathway |
| `es` | Enrichment Score |
| `nes` | Normalized Enrichment Score |
| `pval` | Nominal p-value |
| `fdr` | FDR q-value (adjusted) |
| `lead_genes` | Leading edge genes (comma-separated) |

## Error Handling Considerations

### Critical Error Points
1. **File Upload:**
   - Invalid CSV format
   - Missing required columns
   - File > 500MB
   - Wrong filename pattern

2. **Processing Step 6-7:**
   - R/msqrob2 failure
   - Encoding issues
   - Missing R packages

3. **Processing Step 9:**
   - GSEA database errors
   - Biomart offline

4. **Visualization:**
   - Large dataset rendering

### Recovery Strategies
- Save intermediate results after each step
- Allow re-processing from failed step
- Session state tracks processing progress
- Clear error messages to user
- WebSocket disconnect handling

## Performance Considerations

### File Sizes
- PSM files: ~5,000 rows × 40 columns = ~2MB each
- Combined: 10 files = ~20MB
- Protein abundance: ~2,000 proteins = ~500KB
- Diff expression: ~2,000 rows = ~200KB
- **Maximum upload: 500MB (hard limit)**

### Processing Time Estimates
- Steps 1-5 (Python): <10 seconds
- Step 6 (msqrob2): 30-60 seconds
- Step 7 (msqrob2): 10-20 seconds
- Step 8 (QC): <5 seconds
- Step 9 (GSEA): 30-120 seconds per database

### Memory Requirements
- Peak: ~500MB for 10 input files
- Recommend: 2GB+ RAM for concurrent sessions

## Testing Data Requirements

### Valid Test Case
**Files:**
- PSM_SampleData_DMSO_1.csv through _5.csv (5 replicates)
- PSM_SampleData_INCZ123456_1.csv through _5.csv (5 replicates)
- compound id.csv

**Configuration:**
- Treatment: INCZ123456
- Control: DMSO
- Organism: human (requires human.fasta + human_uniprot_gene.tsv)
- Remove Razor: Yes
- Strict Filtering: No

**Expected Results:**
- ~2,000 proteins identified
- Volcano plot with clear up/down regulation
- QC plots showing sample clustering
- GSEA pathways enriched

## Absolute Red Lines - Summary

### NEVER DO
1. ❌ Skip R package installation (msqrob2, QFeatures, limma)
2. ❌ Modify peptide filename pattern
3. ❌ Reduce minimum replicates below 3
4. ❌ Change abundance column naming (`Abundance F{code} Sample`)
5. ❌ Remove `strict: true` from tsconfig.json
6. ❌ Use rpy2 directly (use subprocess)
7. ❌ Upload files > 500MB
8. ❌ Mutate Zustand state directly
9. ❌ Use `as any` or `@ts-ignore`
10. ❌ Use blocking I/O in async Python
11. ❌ Assume R output format without verification
12. ❌ Mock data in production code
13. ❌ Change API endpoints without frontend sync
14. ❌ Ignore empty plots (indicates data flow issues)
15. ❌ Hardcode biomart without fallback

### ALWAYS DO
1. ✅ Start backend before frontend
2. ✅ Validate CSV columns before processing
3. ✅ Handle encoding (UTF-8 → latin-1 fallback)
4. ✅ Use TSV internally (CSV ↔ TSV conversion)
5. ✅ Clean up session directories on delete
6. ✅ Use global settings from .env
7. ✅ Handle WebSocket disconnect gracefully
8. ✅ Transform column-based R output to row-based for frontend
9. ✅ Log API responses during development
10. ✅ Verify API endpoint URLs match
11. ✅ Test R scripts independently before integration
12. ✅ Implement fallbacks for external APIs
13. ✅ Verify plots show real data (not empty)
14. ✅ Document all API endpoints in OpenAPI/Swagger
15. ✅ Make API response fields optional for backward compatibility

---

## Lessons Learned - Critical Issues

### Issue #1: QC Plots Showing Empty
**Problem:** QC plots displayed empty (PCA 0.0%, no data points)

**Root Causes:**
- Backend looked for separate JSON files but R outputs ONE `QC_Results.json`
- Frontend called wrong endpoint (`/qc/data` vs `/qc/plots`)
- Data format mismatch: R outputs column-based, frontend expected row-based

**Solution:**
```python
# Backend: Read from single QC_Results.json
qc_results_file = plots_dir / 'QC_Results.json'
with open(qc_results_file, 'r') as f:
    qc_results = json.load(f)
```

```typescript
// Frontend: Transform column-based to row-based
const transformedPca = samples.map((sample, i) => ({
    sample,
    pc1: pc1Values[i] || 0,
    pc2: pc2Values[i] || 0,
    condition: conditions[i] || 'Unknown',
}));
```

**Key Lesson:** R outputs column-based format (arrays per field), frontend components often need row-based (array of objects). Always verify data format compatibility.

---

### Issue #2: GSEA "No Pathways Found"
**Problem:** GSEA returns "No pathways found" with 0 enriched pathways

**Root Causes:**
- `gseapy.biomart()` requires internet to Ensembl database
- Biomart conversion fails silently when offline
- GSEA requires gene symbols, not UniProt IDs

**Solution:**
```python
def _uniprot_to_gene_symbol(self, uniprot_ids: List[str]) -> Dict[str, str]:
    try:
        result = gseapy.biomart(
            name='uniprot_gn',
            attrs=['uniprot_gn', 'external_gene_name'],
            filters={'uniprot_gn': uniprot_ids[:1000]}
        )
        if result is not None and len(result) > 0:
            return dict(zip(result['uniprot_gn'], result['external_gene_name']))
    except Exception as e:
        logger.warning(f"Biomart failed: {e}")
    
    # Fallback: return UniProt IDs as-is
    return {uid: uid for uid in uniprot_ids}
```

**Key Lesson:** External APIs (Ensembl biomart) can fail silently. Always implement fallbacks and log warnings. Cache biomart results to reduce API calls.

---

### Issue #3: API Endpoint Mismatches
**Problem:** Frontend calls `/qc/data` but backend route is `/qc/plots`

**Solution:**
```typescript
// Fixed in frontend/src/lib/api.ts
getData: async (sessionId: string) => {
    const response = await apiClient.get(
        `/sessions/${sessionId}/qc/plots`  // Was: /qc/data
    );
    return response.data;
},
```

**Key Lesson:** Always verify API endpoint URLs match between frontend and backend. Use OpenAPI/Swagger documentation to prevent mismatches.

---

## Agent Guidelines - MUST DO

### When Fixing Data Flow Issues:
1. **Verify API endpoint URLs** — Check both frontend and backend route definitions
2. **Check data format** — R outputs column-based, components may need row-based
3. **Add data transformation** — Transform in frontend useEffect, not in component render
4. **Make type fields optional** — Use `?` for fields that may not exist in API response
5. **Log API responses** — Add console.log to verify data structure during development

### When Working with R Integration:
1. **Check R script output format** — Read the R script to understand output structure
2. **Verify file paths** — R script may output to different location than expected
3. **Handle encoding issues** — Use UTF-8 with latin-1 fallback for R subprocess output
4. **Test R scripts independently** — Run Rscript manually to verify output

### When Debugging Empty Plots:
1. **Check API response** — Use curl/browser devtools to verify data is returned
2. **Check data transformation** — Log transformed data before passing to component
3. **Check component props** — Verify component receives expected data structure
4. **Check Plotly data format** — Plotly may need specific format (x: [], y: [], not [{x, y}])

---

## Agent Guidelines - MUST NOT DO

### Data Handling:
1. **Never assume data format** — Always verify what R scripts actually output
2. **Never suppress type errors with `as any`** — Fix the type definition instead
3. **Never ignore API 404 errors** — Check if endpoint URL matches between frontend/backend
4. **Never mock data in production** — Remove all MOCK_* constants before claiming completion

### Testing:
1. **Never claim completion without verification** — Screenshots must show real data, not mock data
2. **Never skip manual QA** — Always verify the actual feature works, not just types check
3. **Never ignore empty plots** — Empty plots indicate data flow issues that must be fixed

### API Design:
1. **Never change endpoint URLs without updating frontend** — Keep frontend and backend in sync
2. **Never remove fields from API response** — Make optional instead to maintain backward compatibility

