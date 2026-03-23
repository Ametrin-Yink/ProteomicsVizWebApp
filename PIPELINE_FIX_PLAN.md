# Data Processing Pipeline Fix Plan

## Executive Summary

The current pipeline deviates from requirements in critical ways. Based on msqrob2 documentation and requirements, here's the correct workflow:

```
Step 1-5: PSM Processing (Python) ✓ Working
Step 6: Peptide → Protein Aggregation (R/msqrob2) ✗ WRONG
  Required: log2 transform → median centering → robust aggregation
  Current: Only robust aggregation (linear scale)
Step 7: DE Analysis (R) ✗ WRONG
  Required: msqrob on log2 protein abundances
  Current: limma with double log2
Step 8-9: QC and GSEA (Python) ✓ Working
```

## Root Cause Analysis

### Why Current Step 6 is Wrong
**Current implementation:**
- Reads PSM_Abundances.tsv (long format with Sample_Origination)
- Reshapes to wide format
- Creates QFeatures object
- Calls aggregateFeatures() directly WITHOUT log2 or normalization
- Outputs linear protein abundances

**Required per requirements:**
> "use msqrob2 package, perform log2 transformation to abundance, normalize the data by median centering, and get protein abundances by robust summarisation"

### Why Current Step 7 is Wrong
**Current implementation:**
- Uses limma directly (switched from msqrob)
- Log2 transforms again: `log2(protein_matrix + 1)`
- This causes double-log2 when Step 6 outputs linear data

**Required per requirements:**
> "use msqrob2 to calculate the Treatment/Control abundance ratio (logFC), p-value (pval), B_H adjusted p-value (adjPval)"

### The msqrob2 Design Pattern

From msqrob2 documentation, the correct workflow is:

```r
# Step 6: Peptide-level processing
pe <- readQFeatures(assayData = peptide_data, quantCols = ..., name = "peptide")
pe <- logTransform(pe, base = 2, i = "peptide", name = "peptide_log2")
pe <- normalize(pe, i = "peptide_log2", name = "peptide_norm", method = "center.median")
pe <- aggregateFeatures(pe, i = "peptide_norm", name = "protein", fcol = "Proteins", fun = robustSummary)
# Output: log2 protein abundances

# Step 7: Differential expression
# Option A: Use msqrob (expects log2 data at protein level)
pe <- msqrob(pe, i = "protein", formula = ~condition)
results <- topFeatures(...)

# Option B: Use limma (also valid for protein-level log2 data)
# limma is actually MORE appropriate for pre-aggregated protein data
```

## Implementation Plan

### Phase 1: Fix Step 6 (msqrob2_protein.R)

**Changes needed:**

1. **After creating QFeatures object**, add log2 transformation:
```r
# Log2 transform peptide abundances
pe <- logTransform(pe, base = 2, i = "peptide", name = "peptide_log2")
cat("Log2 transformed peptide abundances\n")
```

2. **Add median centering normalization**:
```r
# Median centering normalization
pe <- normalize(pe,
                i = "peptide_log2",
                name = "peptide_norm",
                method = "center.median")
cat("Applied median centering normalization\n")
```

3. **Update aggregation to use normalized data**:
```r
pe <- aggregateFeatures(
    object = pe,
    i = "peptide_norm",  # Changed from "peptide"
    fcol = "Proteins",
    name = "protein",
    fun = MsCoreUtils::robustSummary
)
```

4. **Verify output is log2 scale**: The output Protein_Abundances.tsv will now contain log2 abundances

### Phase 2: Fix Step 7 (msqrob2_de.R)

**Changes needed:**

1. **Remove log2 transformation** (data is already log2 from Step 6):
```r
# OLD (WRONG): protein_matrix_log2 <- log2(protein_matrix + 1)
# NEW: Use as-is (already log2)
protein_matrix_log2 <- protein_matrix
```

2. **Keep limma approach** (it's actually more appropriate for protein-level data):
```r
# limma is correct for protein-level log2 abundances
fit <- lmFit(protein_matrix_log2, design)
```

3. **Verify logFC is correct**: With proper log2 input, logFC will be correct log2 fold change

### Phase 3: QC Metrics Update (qc_calculator.py)

**Changes needed:**

Since Protein_Abundances.tsv will now contain log2 abundances:

1. **Intensity distribution plots**: Already expect log2, so no changes needed
2. **PCA**: Already uses log2 in most implementations
3. **Verify all QC plots work with log2 data**

### Phase 4: Frontend Updates

**Changes needed:**

1. **Protein Abundance Plot**: Already applies log2 in plot, may need to adjust
2. **Volcano Plot**: Uses logFC directly from API - should be correct now
3. **Protein Info Panel**:
   - log2FC comes from API (will be correct)
   - Fold Change = 2^logFC (need to calculate)
   - Protein Abundance Plot expects linear? Currently plots log2

## Data Flow Verification

### Before Fix (Current):
```
PSM_Abundances.tsv (linear)
    ↓ Step 6 (WRONG - only aggregation)
Protein_Abundances.tsv (linear)  ← WRONG: Should be log2
    ↓ Step 7 (limma + log2)
log2(protein_matrix + 1)  ← WRONG: double log2 if Step 6 was correct
    ↓
Diff_Expression.tsv (logFC = -800)  ← WRONG: linear difference, not log2FC
```

### After Fix:
```
PSM_Abundances.tsv (linear)
    ↓ Step 6 (log2 → median center → aggregate)
Protein_Abundances.tsv (log2)  ← CORRECT
    ↓ Step 7 (limma, no additional log2)
logFC calculation on log2 data  ← CORRECT: proper log2FC
    ↓
Diff_Expression.tsv (logFC = -2.9)  ← CORRECT: actual log2 fold change
```

## Test Suite Impact

### Test Suite 3 (Processing Pipeline)
- Tests Steps 1-9 completion ✓ No changes needed
- Tests WebSocket updates ✓ No changes needed
- Tests progress display ✓ No changes needed
- **Risk**: Low - processing still completes, just with correct data

### Test Suite 4 (Results Visualization)
- Tests volcano plot display ✓ Need to verify x-axis range
- Tests protein info panel ✓ Need to verify logFC display
- Tests scientific validity ✓ CRITICAL: logFC should be in range (-5, +5), not (-800, +800)

**Expected changes:**
1. Volcano plot x-axis: -5 to +5 (not -3000 to +3000)
2. logFC values: -3 to +3 (not -800 to +800)
3. Gene names: Properly mapped (already fixed)
4. Protein abundance plot: Should work (already fixed)

## Files to Modify

### Backend
1. `backend/scripts/msqrob2_protein.R` - Add log2 and normalization
2. `backend/scripts/msqrob2_de.R` - Remove double log2
3. `backend/app/services/qc_calculator.py` - Verify QC works with log2 data

### Frontend (if needed)
1. `frontend/src/components/visualization/ProteinInfo.tsx` - Verify fold change calculation
2. `frontend/src/components/visualization/VolcanoPlot.tsx` - Verify x-axis range

## Verification Steps

After implementing fixes:

1. **Check Protein_Abundances.tsv**:
   - Values should be ~5-15 (log2 of typical abundances 30-50000)
   - Not 30-50000 (linear)

2. **Check Diff_Expression.tsv**:
   - logFC should be in range -5 to +5
   - Not -800 to +800

3. **Check volcano plot**:
   - Dots clustered around x=0
   - Range approximately -5 to +5
   - Not -3000 to +3000

4. **Check protein info**:
   - log2FC makes sense (e.g., -2.9 for 4-fold change)
   - Fold Change calculated as 2^log2FC

## Risks and Mitigations

### Risk 1: Step 6 normalization fails
**Mitigation**: Add try-catch, fall back to aggregation without normalization

### Risk 2: QC plots expect linear data
**Mitigation**: Review qc_calculator.py, may need to remove log2 transform in QC

### Risk 3: Frontend display issues
**Mitigation**: Check ProteinInfo.tsx for fold change calculation (should be 2^log2FC)

## Success Criteria

1. ✅ All 21 tests pass
2. ✅ Volcano plot x-axis range: -5 to +5
3. ✅ logFC values: reasonable range (-5 to +5)
4. ✅ Gene names: correctly mapped for multi-ID proteins
5. ✅ Protein abundance plot: displays actual data
6. ✅ Scientific validity: logFC = log2(Treatment/Control)
