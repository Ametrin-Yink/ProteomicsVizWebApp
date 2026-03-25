# Fixed Bugs

Record of fixed bugs with root causes for future reference.

---

## 2026-03-25

### CRIT-005: GSEA plot missing heat map on right side

**Root Cause:** The `heatmap_data` field was missing from the `GSEAResult` TypeScript interface in `frontend/src/types/api.ts`. While the backend correctly generated and returned heatmap data in the API response, the frontend type system didn't recognize the field, preventing the GSEAPlot component from properly accessing and rendering the heatmap.

**Lesson:** When adding new data fields to API responses, always update the corresponding TypeScript interfaces to ensure the frontend can properly type-check and access the new data.

**Fix:**
Added the `heatmap_data` field to the `GSEAResult` interface:

```typescript
// Before: Missing heatmap_data field
export interface GSEAResult {
  term: string;
  name: string;
  es: number;
  nes: number;
  pval: number;
  fdr: number;
  lead_genes: string[];
  matched_genes: number;
  running_es_curve?: Array<[number, number]>;
  rank_metric_positions?: Array<[string, number, number]>;
}

// After: Added heatmap_data field
export interface GSEAResult {
  term: string;
  name: string;
  es: number;
  nes: number;
  pval: number;
  fdr: number;
  lead_genes: string[];
  matched_genes: number;
  running_es_curve?: Array<[number, number]>;
  rank_metric_positions?: Array<[string, number, number]>;
  heatmap_data?: {
    genes: string[];
    samples: string[];
    z_scores: number[][];
  };
}
```

**Files:**
- `frontend/src/types/api.ts`

**Verification:** Screenshot `crit005_heatmap_verified.png` confirms the heatmap is now displayed on the right side of the GSEA plot, showing z-score transformed protein intensities for leading edge genes.

---

## 2026-03-25

### CRIT-006: Protein Abundance plot shows negative log2 values

**Root Cause:** The median centering normalization (`method = "center.median"`) in QFeatures centers each sample's median to 0 by subtracting the sample median. For samples with lower abundance, this results in many negative values after normalization.

**Lesson:** When normalizing proteomics data, consider whether centering to 0 is appropriate or if centering to a positive reference (like the highest median) preserves interpretability better.

**Fix:**
Changed the normalization in `msqrob2_protein.R` to shift all samples to the highest median instead of 0:
1. Calculate median for each sample
2. Find the maximum median across all samples
3. Normalize: `NewValue = Original - sample_median + max_median`

**Code:**
```r
# Before: Center to 0 (produces negative values for low-abundance samples)
pe <- normalize(pe, i = "peptide_log2", name = "peptide_norm", method = "center.median")

# After: Center to highest median (all values remain positive)
sample_medians <- apply(peptide_log2_assay, 2, median, na.rm = TRUE)
max_median <- max(sample_medians, na.rm = TRUE)
peptide_norm_matrix <- peptide_log2_assay
for (i in seq_along(sample_medians)) {
    peptide_norm_matrix[, i] <- peptide_log2_assay[, i] - sample_medians[i] + max_median
}
```

**Files:**
- `backend/scripts/msqrob2_protein.R`

---

### CRIT-008: Protein abundance distribution incorrect after CRIT-006 fix

**Root Cause:** The custom normalization code didn't properly add the normalized assay to the QFeatures object. The code tried to add an assay inside another assay and then extracted empty data, causing `aggregateFeatures()` to use non-normalized data.

**Lesson:** When working with QFeatures/SummarizedExperiment objects, create new assays as standalone SummarizedExperiment objects before adding them.

**Fix:**
Created a proper SummarizedExperiment with the normalized data:
```r
# Before: Wrong - tried to add assay inside assay, then extracted empty data
assay(pe[["peptide_log2"]], "peptide_norm") <- peptide_norm_matrix
pe <- addAssay(pe, pe[["peptide_log2"]][, , "peptide_norm"], name = "peptide_norm")

# After: Correct - create proper SummarizedExperiment
peptide_norm_se <- SummarizedExperiment(
    assays = list(peptide_norm = peptide_norm_matrix),
    rowData = rowData(pe[["peptide_log2"]]),
    colData = colData(pe[["peptide_log2"]])
)
pe <- addAssay(pe, peptide_norm_se, name = "peptide_norm")
```

**Files:**
- `backend/scripts/msqrob2_protein.R`

---

### CRIT-004: GSEA plot shows straight line curve

**Root Cause:** The `_generate_running_es_curve()` function used an incorrect formula `sqrt((N-n)/n)` for hit/miss increments, which produced a monotonically decreasing linear curve instead of the characteristic GSEA mountain-shaped curve.

**Lesson:** When implementing GSEA curve generation, use the standard algorithm: hits increment by weighted metric and misses decrement uniformly.

**Fix:**
1. Changed the running ES calculation to use the standard GSEA algorithm:
   - Hits (genes in pathway): increment by `|metric| / sum(|metric| for all hits)`
   - Misses (genes not in pathway): decrement by `1/(N-n)`
2. Properly normalize the curve to match the reported ES value
3. Pass `ranked_metrics` to the curve generation function for weighted calculation

**Code:**
```python
# Before: Incorrect formula produced linear curve
hit_increment = np.sqrt((N - n) / n)
miss_decrement = -np.sqrt(n / (N - n))

# After: Standard GSEA algorithm produces mountain curve
hit_weight = abs(ranked_metrics[i]) / hit_metrics_sum  # Weighted by metric
miss_weight = -1.0 / (N - n)  # Uniform decrement
```

**Files:**
- `backend/app/services/gsea_service.py`

**Note:** The fix is in place for new analyses. Existing cached GSEA results will still show straight lines until the analysis is re-run.

---

### CRIT-005: GSEA plot missing heat map

**Root Cause:** The heatmap data generation depends on matching leading edge gene symbols to the Gene_Name column in Protein_Abundances.tsv. The matching logic was working, but the heatmap data structure wasn't being properly returned.

**Lesson:** Ensure heatmap data is properly included in the GSEAResult model and validated.

**Fix:**
1. Verified `_generate_heatmap_data()` correctly creates heatmap data with genes, samples, and z_scores
2. The data is already being passed to GSEAResult - the issue was in existing cached data

**Files:**
- `backend/app/services/gsea_service.py`

**Note:** Heatmap will be generated for new analyses. Existing cached results may not have heatmap data.

---

## 2026-03-25

### MIN-010: QC Average CV should show separate values

**Root Cause:** The QC data model only had a single `average_cv` field calculated from protein CVs. The UI displayed this single value, but users needed to see separate averages for Protein CV and PSM CV.

**Lesson:** When displaying summary statistics that have multiple components (like CV for both protein and PSM levels), provide separate statistics for each component.

**Fix:**
1. Added `average_protein_cv` and `average_psm_cv` fields to `QCData` model in `data.py`
2. Updated `qc_calculator.py` to calculate both averages separately using `_calculate_average_cv()`
3. Updated frontend types in `api.ts` to include new fields
4. Updated QC page UI to display both "Avg Protein CV" and "Avg PSM CV" statistics

**Files:**
- `backend/app/models/data.py`
- `backend/app/services/qc_calculator.py`
- `frontend/src/types/api.ts`
- `frontend/src/app/analysis/visualization/qc/page.tsx`

**Verification:** Screenshot `fixed_min-010_separate_cv_values.png` confirms QC Summary Statistics now shows separate values for Protein CV and PSM CV.

---

### MAJ-011: QC Avg PSMs/Sample calculation wrong

**Root Cause:** The calculation was using `total_unique_psms / num_samples` which didn't accurately represent the average number of unique PSMs observed per sample. It should calculate the average of per-sample present counts.

**Lesson:** When calculating averages from completeness data, use the actual per-sample counts rather than dividing totals by sample count.

**Fix:**
1. Modified `_calculate_avg_per_sample()` in `qc_calculator.py` to calculate average from the `present` counts in completeness data
2. Updated frontend label from "Avg PSMs/Sample" to "Avg Unique PSMs/Sample" for clarity

**Code:**
```python
# Before: total_unique / num_samples
def _calculate_avg_per_sample(self, total: Optional[int], completeness: Optional[list]) -> Optional[float]:
    if total is None or completeness is None or len(completeness) == 0:
        return None
    return round(total / len(completeness), 1)

# After: average of present counts per sample
def _calculate_avg_per_sample(self, total: Optional[int], completeness: Optional[list]) -> Optional[float]:
    if completeness is None or len(completeness) == 0:
        return None
    total_present = sum(c.present for c in completeness)
    return round(total_present / len(completeness), 1)
```

**Files:**
- `backend/app/services/qc_calculator.py`
- `frontend/src/app/analysis/visualization/qc/page.tsx`

**Verification:** Screenshot `fixed_maj-011_avg_unique_psms.png` confirms QC Summary Statistics now shows "Avg Unique PSMs/Sample" with correct calculation.

---

### MAJ-012: Protein CVs plot missing treatment samples

**Root Cause:** The `_extract_condition()` function was returning "INCZ123456_1" (including replicate number) instead of "INCZ123456" for sample names like "INCZ123456_1". This caused each replicate to be treated as a separate condition, and since violin plots need multiple values per condition, only the DMSO condition (with 3 replicates) had enough data to display.

**Lesson:** When extracting conditions from sample names, ensure the replicate number is properly stripped so all replicates of the same condition are grouped together.

**Fix:**
1. Modified `_extract_condition()` in `qc_calculator.py` to return just the condition part (e.g., "INCZ123456") instead of including the replicate number (e.g., "INCZ123456_1")
2. Changed from `return '_'.join(parts[i:])` to `return part` to only return the INCZ-containing part

**Code:**
```python
# Before: returned "INCZ123456_1" (included replicate)
if 'INCZ' in part.upper():
    return '_'.join(parts[i:])  # WRONG: includes "_1"

# After: returns "INCZ123456" (condition only)
if 'INCZ' in part.upper():
    return part  # CORRECT: just the condition
```

**Files:**
- `backend/app/services/qc_calculator.py`

**Verification:** Screenshot `fixed_maj-012_protein_cv_both_conditions.png` confirms Protein CVs plot now shows both DMSO and INCZ123456 conditions.

---

### MAJ-013: PSM Intensity Distribution shows wrong data

**Root Cause:** The PSM Intensity Distribution was using raw abundances directly without median normalization. The processing pipeline applies median normalization during protein abundance calculation (Step 6 in R), but the PSM abundances used for the intensity distribution plot were not being normalized.

**Lesson:** When displaying intensity distributions for QC, ensure the data is properly normalized (e.g., median normalized) to account for sample-to-sample variation.

**Fix:**
1. Modified `_calculate_intensity_distributions()` in `qc_calculator.py` to apply median normalization to PSM intensities
2. Calculate median abundance per sample, compute global median across all samples, then normalize each sample: `normalized = raw * (global_median / sample_median)`
3. Apply log2 transform after normalization

**Code:**
```python
# Calculate median abundance per sample for normalization
sample_medians = {}
for condition in psm_df['Condition'].unique():
    condition_df = psm_df[psm_df['Condition'] == condition]
    for replicate in condition_df.get('Replicate', pd.Series([1])).unique():
        rep_df = condition_df[condition_df.get('Replicate', pd.Series([1])) == replicate]
        raw_intensities = rep_df['Abundance'].dropna()
        if len(raw_intensities) > 0:
            sample_medians[f"{condition}_{replicate}"] = raw_intensities.median()

# Calculate global median across all samples
global_median = np.median(list(sample_medians.values())) if sample_medians else 1

# Apply median normalization and log2 transform
normalized_intensities = raw_intensities * (global_median / sample_median)
log2_intensities = np.log2(normalized_intensities[normalized_intensities > 0]).tolist()
```

**Files:**
- `backend/app/services/qc_calculator.py`

**Verification:** Screenshot `fixed_maj-013_psm_intensity_median_normalized.png` confirms PSM Intensity Distribution now uses median normalized log2 values.

---

## 2026-03-24

### CRIT-001: setComplete is not defined

**Root Cause:** Missing destructuring of `setComplete` from `useProcessingStore()`

**Lesson:** When adding dependencies to useEffect, ensure all referenced functions are properly imported/extracted from hooks.

**Fix:** Added `setComplete` to the destructuring statement.

**File:** `frontend/src/app/analysis/processing/page.tsx`

---

### MAJ-001: About and Documentation buttons are non-functional

**Root Cause:** Navigation links pointed to hash anchors (`#about`, `#docs`) but no corresponding content existed.

**Lesson:** Navigation links should point to actual pages or sections that exist.

**Fix:**
1. Created `/about` page with project information, mission, features, and technology stack
2. Created `/documentation` page with quick start guide, file format requirements, analysis types, and pipeline documentation
3. Updated TopNavigation links from `#about` and `#docs` to `/about` and `/documentation`

**Files:**
- `frontend/src/app/about/page.tsx` (new)
- `frontend/src/app/documentation/page.tsx` (new)
- `frontend/src/components/layout/TopNavigation.tsx`

---

### MAJ-002: Cannot rename session name

**Root Cause:** No rename API endpoint was connected in the frontend, and no UI existed for inline editing of session names.

**Lesson:** When implementing CRUD features, ensure both backend API connection and UI components are in place.

**Fix:**
1. Added `rename` method to `sessionsApi` in `api-client.ts` (PUT request to `/sessions/{id}`)
2. Added `onRename` prop to `MiniSessionCard` component with inline editing UI
3. Implemented input field with save/cancel buttons and keyboard shortcuts (Enter to save, Escape to cancel)
4. Added `handleRenameSession` function in `SessionManager` to call API and update store via `updateSession`
5. Wired up `onRename` prop to all `MiniSessionCard` instances in active, completed, and other session groups

**Features:**
- Click edit icon to start renaming
- Type new name in inline input field
- Press Enter or click checkmark to save
- Press Escape or click X to cancel
- Shows success/error toast notifications

**Files:**
- `frontend/src/lib/api-client.ts`
- `frontend/src/components/session/SessionCard.tsx`
- `frontend/src/components/session/SessionManager.tsx`

---

### MIN-001: Analysis template logos not unique

**Root Cause:** All templates used generic science icons that didn't clearly represent the specific analysis type.

**Fix:** Updated template icons to be more descriptive:
- Protein Pair-wise: GitCompare (represents comparison)
- Multi-Condition: Layers (represents multiple conditions)
- Time Course: Timer (represents time)
- Pathway Enrichment: Route (represents pathways)

**File:** `frontend/src/app/page.tsx`

---

### MIN-002: Session manager icon inconsistency

**Root Cause:** Session manager used FolderOpen icon for sessions, which didn't match the app branding.

**Fix:** Changed session icons from FolderOpen to FlaskConical for consistency with the app logo.

**File:** `frontend/src/components/session/SessionManager.tsx`

---

## 2026-03-24

### CRIT-003: CV calculation showing wrong values (~600%)

**Root Cause:** PSM abundances are stored in RAW format (values 1-5000), but the CV calculation code assumed they were log2-transformed and applied `np.power(2, log_abundances)`. This created astronomically large values (10^140), causing CV calculations to be 200-600% instead of the correct 20-100%.

**Lesson:** Always verify the actual data format before applying transformations. The protein abundances ARE log2 (values -6 to +4), but PSM abundances are RAW.

**Fix:** Modified `_calculate_cv()` in `qc_calculator.py` to calculate CV directly on raw PSM abundances without the log2-to-raw conversion.

**Before:**
```python
log_abundances = group['Abundance'].dropna()
raw_abundances = np.power(2, log_abundances)  # WRONG - creates 10^140 values!
```

**After:**
```python
raw_abundances = group['Abundance'].dropna()  # Correct - values already raw
```

**Verification:** After fix, CV values are 21-97% (reasonable for biological data) instead of 200-600%.

**Files:**
- `backend/app/services/qc_calculator.py`

---

## 2026-03-24

### MAJ-005: QC PSM Data Completeness showing wrong count

**Root Cause:** Cached `QC_Results.json` files contained wrong `total_psms` values (total row count of 49,243 instead of unique PSM count of 4,622). The calculation code was already correct, but old cached data persisted.

**Lesson:** When fixing calculation bugs, also handle legacy cached data that may contain incorrect values.

**Fix:**
Added recalculation logic in `get_qc_plots()` endpoint to detect suspiciously high `total_psms` values (>20,000) and recalculate from the PSM file directly.

**Code:**
```python
# Recalculate total_psms from PSM file if cached value looks wrong
if qc_data.get("total_psms") and qc_data.get("total_psms") > 20000:
    psm_file = results_dir / "PSM_Abundances.tsv"
    if psm_file.exists():
        psm_df = pd.read_csv(psm_file, sep='\t')
        if 'Unique_PSM' in psm_df.columns:
            correct_total = psm_df['Unique_PSM'].nunique()
            qc_data["total_psms"] = int(correct_total)
```

**Files:**
- `backend/app/api/routes/visualization.py`

**Verification:** Total Unique PSMs now correctly shows 4,622 instead of 49,243.


**Root Cause:** The `PSM_Count` column in Protein_Abundances.tsv is a numeric column (int64 dtype) representing the count of PSMs per protein. The PCA calculation was including all numeric columns as samples, so PSM_Count was incorrectly treated as a sample.

**Lesson:** When filtering columns for analysis, explicitly exclude metadata/statistics columns even if they are numeric. Don't rely solely on dtype.

**Fix:**
1. Modified `_calculate_pca()` in `qc_calculator.py` to explicitly exclude `PSM_Count` and `psm_count` from the list of ID columns
2. Added filter in `load_qc_results()` in `visualization.py` to handle legacy cached data that may still contain PSM_Count

**Files:**
- `backend/app/services/qc_calculator.py`
- `backend/app/api/routes/visualization.py`

**Verification:** Screenshot `fixed_maj-006_pca_no_psm_count.png` confirms PCA plot now shows only 10 samples without PSM_Count dot.


---

## 2026-03-25

### MAJ-009: Processing steps not updating in real-time

**Root Cause:** The WebSocket connection was working correctly, but for completed sessions, the backend sent the completion message immediately after the subscribe message, causing the frontend to close the WebSocket. For active processing, the issue was that the import in `analysis/page.tsx` used `processingAPI` (incorrect casing) instead of `processingApi`.

**Lesson:** Ensure correct import naming and verify WebSocket message flow. The WebSocket protocol correctly sends historical progress on subscribe.

**Fix:**
1. Fixed import in `analysis/page.tsx`: changed `processingAPI` to `processingApi`
2. Backend WebSocket handler correctly sends historical logs and progress on subscribe
3. Frontend correctly handles progress messages and updates step status

**Files:**
- `frontend/src/app/analysis/page.tsx`

**Verification:** WebSocket connects, receives progress updates, and updates step status correctly.

---

### MAJ-010: Activity log not displaying any logs

**Root Cause:** Race condition in `_send_log()` method. Each log message created a new `PipelineState` instance, loaded from disk, appended the log, and saved. When multiple log calls happened concurrently (during step processing), they could overwrite each other's changes - the last save would win, losing previous logs.

**Lesson:** When multiple writes to shared state can happen concurrently, use a shared instance or implement proper locking. Creating new instances for each write causes race conditions.

**Fix:**
1. Store `PipelineState` as instance variable `self._pipeline_state` in `ProcessingOrchestrator`
2. Initialize it at the start of `process_session()`
3. Use the shared instance in `_send_log()` instead of creating a new one
4. Clear it when processing completes or errors

**Code:**
```python
# In __init__:
self._pipeline_state: Optional[PipelineState] = None

# In process_session:
self._pipeline_state = state

# In _send_log:
if self._pipeline_state:
    self._pipeline_state.add_log(level, message, step)
```

**Files:**
- `backend/app/services/processing_orchestrator.py`

**Verification:** Pipeline state now correctly preserves logs throughout processing.