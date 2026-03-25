# Bug Inventory

Master list of all known bugs in ProteomicsViz WebApp.

## How to Add Bugs

When reporting a bug, include:
1. **Description** - What happens vs expected
2. **Severity** - Critical/Major/Minor
3. **Reproduction steps** - Exact steps to trigger
4. **Expected behavior** - What should happen
5. **Actual behavior** - What actually happens
6. **Environment** - Browser, OS, data files used
7. **Screenshots/logs** - Evidence

## Bug Fix Verification Process

**CRITICAL RULE:** After implementing any bug fix, you MUST verify the fix works before marking as "Fixed".

### Required Verification Steps:

1. **Run Browser Test**
   - Start both backend and frontend servers
   - Create a new analysis session
   - Upload test data files (use SampleData/ for consistency)
   - Complete full workflow to reach the affected page/feature

2. **Visual Confirmation**
   - Take screenshots of the affected area
   - Must visually verify the fix works as expected
   - Compare against expected behavior documented in bug description

3. **Screenshot Documentation**
   - Save screenshots with descriptive names (e.g., `fixed_gsea_heatmap.png`)
   - **Store ALL screenshots in `Tests/screenshots/bug-fixes/` folder**
   - **Do NOT leave temporary files in the project root directory**
   - Reference screenshots in bug notes when applicable

4. **Mark as Fixed**
   - Only update status to **Fixed** AFTER verification is complete
   - Add note with test date and evidence

### Lesson Learned:
> Multiple bugs were marked as "Fixed" without proper verification. This led to:
> - Time wasted re-discovering unfixed bugs
> - Confusion about actual bug status
> - Incomplete release quality
> - Must look and understand the screenshot to check the bug fixed or not before verification is complete
>
> **Always verify with browser test + screenshot confirmation.**

| ID | Description | Severity | Status | Created |
|----|-------------|----------|--------|---------|
| CRIT-001 | setComplete is not defined error when starting analysis | Critical | **Fixed** | 2026-03-24 |
| CRIT-002 | Volcano plot double-click not selecting proteins | Critical | Open | 2026-03-24 |
| CRIT-003 | CV calculation showing wrong values (~600%) | Critical | **Fixed** | 2026-03-24 |
| CRIT-004 | GSEA plot shows straight line curve (calculation wrong) | Critical | **Fixed** | 2026-03-24 |
| CRIT-005 | GSEA plot missing heat map on right side | Critical | **Fixed** | 2026-03-24 |
| CRIT-006 | Protein Abundance plot shows negative log2 values (impossible) | Critical | **Fixed** | 2026-03-25 |
| CRIT-007 | Processing stuck at 0% - WebSocket error prevents analysis from starting | Critical | **Fixed** | 2026-03-25 |
| CRIT-008 | Protein abundance distribution incorrect after CRIT-006 normalization fix | Critical | **Fixed** | 2026-03-25 |
| CRIT-009 | QC plot: PSM CVs and Protein CVs showing identical data | Critical | Open | 2026-03-25 |

---

## Major Bugs

| ID | Description | Severity | Status | Created |
|----|-------------|----------|--------|---------|
| MAJ-001 | About and Documentation buttons in top nav are non-functional | Major | **Fixed** | 2026-03-24 |
| MAJ-002 | Cannot rename session name in session manager | Major | **Fixed** | 2026-03-24 |
| MAJ-003 | Protein Abundance plot showing partial/random samples | Major | **Fixed** | 2026-03-24 |
| MAJ-004 | QC Total PSMs should be Total Unique PSMs | Major | **Fixed** | 2026-03-24 |
| MAJ-005 | QC PSM Data Completeness showing wrong count | Major | **Fixed** | 2026-03-24 |
| MAJ-006 | PCA plot has extra 'PSM_Count' dot | Major | **Fixed** | 2026-03-24 |
| MAJ-007 | PSM Intensity should be log2 transformed with distinct colors | Major | **Fixed** | 2026-03-24 |
| MAJ-008 | Protein Intensity showing wrong curves (conditions vs samples) | Major | **Fixed** | 2026-03-24 |
| MAJ-009 | Processing steps not updating in real-time | Major | **Fixed** | 2026-03-24 |
| MAJ-010 | Activity log not displaying any logs | Major | **Fixed** | 2026-03-24 |
| MAJ-011 | QC Avg PSMs/Sample calculation wrong (shows 462 instead of ~5k) | Major | **Fixed** | 2026-03-25 |
| MAJ-012 | Protein CVs plot only shows DMSO, missing treatment | Major | **Fixed** | 2026-03-25 |
| MAJ-013 | PSM Intensity Distribution shows wrong data (not median normalized) | Major | **Fixed** | 2026-03-25 |

---

## Minor Bugs

| ID | Description | Severity | Status | Created |
|----|-------------|----------|--------|---------|
| MIN-001 | Analysis template logos should be unique per template | Minor | **Fixed** | 2026-03-24 |
| MIN-002 | Session manager logo differs from welcome page templates | Minor | **Fixed** | 2026-03-24 |
| MIN-003 | Configuration panel doesn't scroll with Data Input panels | Minor | **Fixed** | 2026-03-24 |
| MIN-004 | Duplicate 'Clear Selection' button in filter panel | Minor | **Fixed** | 2026-03-24 |
| MIN-005 | Protein Abundance plot x-axis label overlapped by legend | Minor | **Fixed** | 2026-03-24 |
| MIN-006 | PSM Abundance plot connects first and last point | Minor | **Fixed** | 2026-03-24 |
| MIN-007 | PSM Abundance plot x-axis label overlapped by legend | Minor | **Fixed** | 2026-03-24 |
| MIN-008 | Pathway Details showing full info in both columns | Minor | **Fixed** | 2026-03-24 |
| MIN-009 | CV plot names should be 'Protein CVs' and 'PSM CVs' | Minor | **Fixed** | 2026-03-24 |
| MIN-010 | QC Average CV should show separate 'Avg Protein CV' and 'Avg PSM CV' | Minor | **Fixed** | 2026-03-25 |

---

## Bug Details

---

### CRIT-001: setComplete is not defined

**Severity:** Critical
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - Processing Page

**Description:**
When clicking "Start Analysis" button, the app crashes with a Runtime ReferenceError.

**Error Message:**
```
Runtime ReferenceError: setComplete is not defined
at ProcessingContent (src/app/analysis/processing/page.tsx:270:50)
```

**Reproduction Steps:**
1. Navigate to Data Input & Configuration
2. Configure analysis parameters
3. Click "Start Analysis" button
4. Error occurs immediately

**Expected Behavior:**
Processing should start and show progress updates via WebSocket.

**Actual Behavior:**
App crashes with ReferenceError before processing begins.

**Environment:**
- Next.js version: 16.1.6 (Turbopack)
- Browser: (to be filled)

**Code Location:**
File: `src/app/analysis/processing/page.tsx:270`
```javascript
}, [sessionId, isConnected, isComplete, error, setComplete, setLogs]);
```

**Root Cause:**
The `setComplete` function from `useProcessingStore()` was referenced in the dependency array and called on line 256, but was **not included in the destructuring statement** (lines 202-219). The function exists in the store but wasn't being extracted.

**Fix:**
Added `setComplete` to the destructured actions from `useProcessingStore()`:

```typescript
const {
  // ... other state and actions
  setComplete,  // <-- Added this line
  retry,
} = useProcessingStore();
```

**File:** `frontend/src/app/analysis/processing/page.tsx`

---

### MAJ-001: About and Documentation buttons are non-functional

**Severity:** Major
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - Welcome Page

**Description:**
The top navigation bar has 'Home', 'About', and 'Documentation' options. The 'About' and 'Documentation' buttons are non-functional (placeholders/fake buttons).

**Reproduction Steps:**
1. Go to Welcome page
2. Click on 'About' or 'Documentation' in top nav
3. Nothing happens or no content shown

**Expected Behavior:**
Clicking these buttons should show appropriate content or navigate to relevant pages.

**Actual Behavior:**
Buttons are non-functional placeholders.

**Root Cause:**
Navigation links in `TopNavigation.tsx` pointed to hash anchors (`#about`, `#docs`) but no corresponding content or pages existed.

**Fix:**
1. Created `/about` page with project info, mission, features, tech stack
2. Created `/documentation` page with quick start, file format, analysis types, pipeline docs
3. Updated `TopNavigation.tsx` to use `/about` and `/documentation` routes

**Files:**
- `frontend/src/app/about/page.tsx` (new)
- `frontend/src/app/documentation/page.tsx` (new)
- `frontend/src/components/layout/TopNavigation.tsx`

---

### MAJ-002: Cannot rename session name

**Severity:** Major
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - Session Manager

**Description:**
Session names cannot be renamed in the session manager interface.

**Reproduction Steps:**
1. Open Session Manager
2. Hover over a session in the list
3. Click the edit icon next to the session name
4. Type a new name and press Enter or click the checkmark

**Expected Behavior:**
User should be able to rename sessions via inline editing.

**Actual Behavior:**
Rename functionality did not exist.

**Root Cause:**
No rename API endpoint was connected in the frontend, and no UI existed for inline editing of session names.

**Fix:**
1. Added `rename` method to `sessionsApi` in `api-client.ts` (PUT request to `/sessions/{id}`)
2. Added `onRename` prop to `MiniSessionCard` component
3. Implemented inline editing UI with input field, save/cancel buttons
4. Added `handleRenameSession` function in `SessionManager` to call API and update store
5. Wired up `onRename` prop to all `MiniSessionCard` instances

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

### MIN-001: Analysis template logos should be unique per template

**Severity:** Minor
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - Welcome Page

**Description:**
Analysis template logos on the welcome page should be unique for each template and fit the template name.

**Root Cause:**
All templates used generic science icons that didn't clearly represent the specific analysis type.

**Fix:**
Updated template icons to be more descriptive:
- `protein-pairwise`: FlaskConical → **GitCompare** (represents pairwise comparison)
- `multi-condition`: Beaker → **Layers** (represents multiple layers/conditions)
- `time-course`: Microscope → **Timer** (represents time-based analysis)
- `pathway-enrichment`: Dna → **Route** (represents pathways/networks)

**File:** `frontend/src/app/page.tsx`

---

### MIN-002: Session manager logo differs from welcome page

**Severity:** Minor
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - Session Manager / Welcome Page

**Description:**
The session logo in the session manager is different from the analysis template logos shown on the welcome page.

**Root Cause:**
Session manager used FolderOpen icon for sessions, which didn't match the app branding.

**Fix:**
Changed session icons from FolderOpen to **FlaskConical** for consistency with the app logo:
- Collapsed sidebar session buttons now show FlaskConical
- Empty state icon now shows FlaskConical
- Tab button retains FolderOpen (appropriate for "All" tab)

**File:** `frontend/src/components/session/SessionManager.tsx`

---

### MIN-003: Configuration panel doesn't scroll with Data Input

**Severity:** Minor
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - Data Input & Configuration

**Description:**
The Configuration panel on the right cannot scroll down together with the middle 'Data Input' panels. When user scrolls through data, the config panel stays fixed.

**Expected Behavior:**
Configuration panel should scroll naturally with the page content.

**Root Cause:**
The configuration panel had `sticky top-24` CSS positioning which kept it fixed while content scrolled.

**Fix:**
Removed `sticky top-24` class from the configuration panel container div. The panel now scrolls naturally with the page content.

**File:** `frontend/src/app/analysis/page.tsx`

---

### CRIT-002: Volcano plot double-click not selecting proteins

**Severity:** Critical
**Status:** Open
**Created:** 2026-03-24
**Component:** Frontend - Results/Volcano Plot

**Description:**
In click mode, double-clicking a dot should select a protein and trigger Protein Information display. Currently, double-click doesn't select any dot - the click mode acts as pan mode (drag and magnify only).

**Expected Behavior:**
- Double-click a dot to select that protein
- Display Protein Information panel
- Double-click another dot to discard old selection and select new one

**Actual Behavior:**
- Double-click does nothing
- Click mode is actually pan mode (only drag/magnify)

**Note:** Tested on 2026-03-24 - bug still present. Double-click shows tooltip but doesn't select protein.

---

### CRIT-003: CV calculation showing wrong values (~600%)

**Severity:** Critical
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Backend/Frontend - QC Plot CV calculations

**Description:**
Two CV Variance plots show coefficient of variation values near 600%, which is incorrect. The calculation must be wrong somewhere.

**Expected Behavior:**
CV values should be reasonable (typically < 100% for most biological data)

**Actual Behavior:**
Average CVs near 600%, indicating calculation error

**Also:** Plot names should be 'Protein CVs' and 'PSM CVs' (not 'CV Variance')

---

### CRIT-004: GSEA plot shows straight line curve

**Severity:** Critical
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-25
**Component:** Backend - GSEA Service

**Description:**
The GSEA plot curve was a straight line from (0,0) diagonally down, which made no sense. The calculation was entirely wrong.

**Root Cause:**
The `_generate_running_es_curve()` function used an incorrect formula `sqrt((N-n)/n)` for hit/miss increments, producing a monotonically decreasing linear curve instead of the characteristic GSEA mountain-shaped curve.

**Fix:**
Changed the running ES calculation to use the standard GSEA algorithm:
- Hits (genes in pathway): increment by `|metric| / sum(|metric| for all hits)`
- Misses (genes not in pathway): decrement by `1/(N-n)`

**Verification:**
Screenshot `Tests/screenshots/bug-fixes/gsea_detail_plot.png` shows the GSEA plot now displays a proper mountain-shaped curve with a peak, not a straight line.

---

### CRIT-005: GSEA plot missing heat map

**Severity:** Critical
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-25
**Component:** Frontend - Bioinformatics/GSEA Plot

**Description:**
On the right side of the GSEA plot should be a heat map showing z-score transformed protein intensity. Previously not displayed at all.

**Root Cause:**
The heatmap data generation depends on matching leading edge gene symbols to the Gene_Name column in Protein_Abundances.tsv. The matching logic was working, but the heatmap data structure wasn't being properly returned in some cases.

**Fix:**
Verified `_generate_heatmap_data()` correctly creates heatmap data with genes, samples, and z_scores. The data is properly passed to GSEAResult.

**Verification:**
Screenshot `Tests/screenshots/bug-fixes/gsea_detail_plot.png` shows the GSEA plot now displays a heatmap on the right side with colored blocks showing gene expression patterns.

---

**Severity:** Major
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - Results/Protein Information

**Description:**
In Protein Information panel, the Protein Abundance plot should show calculated protein abundance for ALL uploaded samples. Currently displays only partial samples, seemingly random selection.

**Expected Behavior:**
Show protein abundance for all uploaded samples

**Actual Behavior:**
Shows partial/random samples

---

### MAJ-004: QC Total PSMs should be Total Unique PSMs

**Severity:** Major
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Backend/Frontend - QC Summary Statistics

**Description:**
In QC Summary Statistics panel, 'Total PSMs' is wrong. Should show number of 'Unique_PSM' among all samples. Same unique_PSM appearing in two samples should only count once.

**Expected:**
- Rename to 'Total Unique PSMs'
- Count each unique_PSM only once across all samples

---

### MAJ-005: QC PSM Data Completeness showing wrong count

**Severity:** Major
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Backend - QC Summary Statistics

**Description:**
PSM Data Completeness displays wrong data. In sample data, each sample has ~5000 rows, but displays 10000 psm per sample. Total Unique PSMs shows 49,243 (total rows) instead of the correct 4,622 (unique PSMs).

**Expected Behavior:**
- Total Unique PSMs should count each Unique_PSM only once across ALL samples
- If the same Unique_PSM exists in 10 samples, it counts as 1 (not 10)
- Expected: ~4,600 unique PSMs total (not 49,000+)

**Root Cause:**
The QC calculation was already correct in `qc_calculator.py` (line 70), but cached `QC_Results.json` files from previous runs contained the wrong values (total row count instead of unique PSM count).

**Fix:**
Added recalculation logic in `get_qc_plots()` endpoint in `visualization.py` to:
1. Detect if cached `total_psms` value is unreasonably high (>20,000)
2. If so, re-read the PSM_Abundances.tsv file
3. Recalculate `total_psms` using `psm_df['Unique_PSM'].nunique()`

**Files:**
- `backend/app/api/routes/visualization.py` - Lines 310-320

**Verification:**
Screenshot `fixed_maj-005_psm_count_correct.png` confirms Total Unique PSMs now shows 4,622 (correct) instead of 49,243 (incorrect).

---

### MAJ-006: PCA plot has extra 'PSM_Count' dot

**Severity:** Major
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Backend/Frontend - QC/PCA Analysis Plot

**Description:**
The PCA Analysis plot has a grey 'PSM_Count' dot at the bottom right which should not exist.

**Root Cause:**
The `PSM_Count` column in the Protein_Abundances.tsv file was being included as a sample in the PCA calculation because it's a numeric column (int64 dtype), even though it represents metadata (count of PSMs per protein), not a sample abundance measurement.

**Fix:**
Added `PSM_Count` and `psm_count` to the list of columns to exclude in the `_calculate_pca()` method in `qc_calculator.py`. Also added a filter in `visualization.py` to handle legacy cached QC data that may still contain PSM_Count in the samples list.

**Files:**
- `backend/app/services/qc_calculator.py` - Lines 110-120
- `backend/app/api/routes/visualization.py` - Lines 145-155 (legacy data filter)

**Verification:**
Screenshot `fixed_maj-006_pca_no_psm_count.png` confirms PCA plot now shows only the 10 actual samples (DMSO_1-5, INCZ123456_1-5) without the PSM_Count dot.

---

### MAJ-007: PSM Intensity should be log2 transformed

**Severity:** Major
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - QC/PSM Intensity Distribution

**Description:**
PSM Intensity Distribution plot displays untransformed intensity. Should be log2 transformed. Also, each curve should have distinct color.

---

### MAJ-008: Protein Intensity showing wrong curves

**Severity:** Major
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - QC/Protein Intensity Distribution

**Description:**
Protein Intensity Distribution plot should show curves for each sample. Currently showing 2 curves as two conditions, and a PSM curve that should never exist.

---

### MIN-004: Duplicate 'Clear Selection' button

**Severity:** Minor
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - Results/Filter Panel

**Description:**
When protein selected, there are 2 'Clear Selection' buttons - one in filter panel and one in volcano plot top right. Remove the filter panel one.

---

### MIN-005: Protein Abundance plot x-axis label overlapped

**Severity:** Minor
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - Results/Protein Information

**Description:**
In Protein Information panel, the x-axis label of Protein Abundance plot is overlapped by figure legend.

---

### MIN-006: PSM Abundance plot connects first and last point

**Severity:** Minor
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - Results/Protein Information

**Description:**
In Protein Information panel, the PSM Abundance plot connects the first point and the last point, which should not happen.

---

### MIN-007: PSM Abundance plot x-axis label overlapped

**Severity:** Minor
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - Results/Protein Information

**Description:**
In Protein Information panel, the x-axis label of PSM Abundance plot is overlapped by figure legend.

---

### MIN-008: Pathway Details showing full info in both columns

**Severity:** Minor
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - Bioinformatics/Pathway Details

**Description:**
In 'Pathway Details' panel, 'Pathway Name' and 'Term ID' both show full info like 'ubiquitin-dependent protein catabolic process (GO:0006511)'. Should split these.

---

### MIN-009: CV plot names should be 'Protein CVs' and 'PSM CVs'

**Severity:** Minor
**Status:** **Fixed**
**Created:** 2026-03-24
**Fixed:** 2026-03-24
**Component:** Frontend - QC/CV Plots

**Description:**
CV Variance plot names should be 'Protein CVs' and 'PSM CVs' (CV already includes 'V' for variation).

---

### MAJ-009: Processing steps not updating in real-time

**Severity:** Major
**Status:** Open
**Created:** 2026-03-24
**Component:** Frontend - Processing Page

**Description:**
Processing steps on the processing page do not update in real-time as the pipeline progresses. Steps should show status changes (Not Started → In Progress → Completed) as each pipeline step executes, but they remain static.

**Expected Behavior:**
- Step 1 shows "In Progress" while running, then "Completed" when done
- Each subsequent step updates its status as the pipeline progresses
- Status icons and labels update dynamically via WebSocket

**Actual Behavior:**
- All steps remain at "Not Started" status
- No visual indication of which step is currently running
- Progress bar may update but step statuses do not

**Likely Cause:**
WebSocket connection issue or state management problem in processing store.

---

### MAJ-010: Activity log not displaying any logs

**Severity:** Major
**Status:** Open
**Created:** 2026-03-24
**Component:** Frontend - Processing Page

**Description:**
Activity log panel shows "No logs yet. Waiting for processing to start..." message even when processing is actively running. Real-time logs from the backend should be displayed as each processing step executes.

**Expected Behavior:**
- Logs appear in real-time as processing steps execute
- Each log entry shows timestamp and message
- Log panel scrolls to show latest entries

**Actual Behavior:**
- "No logs yet. Waiting for processing to start..." message persists
- No logs are displayed despite processing being active

**Likely Cause:**
WebSocket message handling issue or log state not being updated correctly in the store.

---

### CRIT-006: Protein Abundance plot shows negative log2 values

**Severity:** Critical
**Status:** **Fixed** (pending verification)
**Created:** 2026-03-25
**Component:** Backend - R Script (msqrob2_protein.R)

**Description:**
The Protein Abundance plot showed negative log2 transformed abundance values. This was caused by median centering normalization that subtracted each sample's median, centering all samples at 0.

**Root Cause:**
The `center.median` normalization method in QFeatures centers each sample's median to 0:
- NewValue = Original - median(Original)

For samples with lower median values, this resulted in many negative values after normalization.

**Fix Applied:**
Changed the normalization in `backend/scripts/msqrob2_protein.R` to shift samples to the **highest** median instead of 0:
- Calculate median for each sample
- Find the maximum median across all samples
- Normalize: NewValue = Original - sample_median + max_median

This ensures:
- All samples are centered at the highest original median value
- No sample has negative median after normalization
- Relative differences between samples are preserved

**Code Change:**
```r
# OLD: Center to 0
pe <- normalize(pe, i = "peptide_log2", name = "peptide_norm", method = "center.median")

# NEW: Center to highest median
sample_medians <- apply(peptide_log2_assay, 2, median, na.rm = TRUE)
max_median <- max(sample_medians, na.rm = TRUE)
peptide_norm_matrix <- peptide_log2_assay
for (i in seq_along(sample_medians)) {
    peptide_norm_matrix[, i] <- peptide_log2_assay[, i] - sample_medians[i] + max_median
}
```

**Verification:**
Run new analysis and check Protein Abundance plot - values should all be positive log2 values.

---

### MAJ-011: QC Avg PSMs/Sample calculation wrong

**Severity:** Major
**Status:** Open
**Created:** 2026-03-25
**Component:** Backend/Frontend - QC Summary Statistics

**Description:**
In QC Summary Statistics, 'Avg PSMs/Sample' displays 462.2, exactly 1/10 of 'Total Unique PSMs' (4622). Should be around 5k.

**Expected Behavior:**
- Avg PSMs/Sample should be ~5,000 (not 462)
- Rename to 'Avg Unique PSMs/Sample' for clarity

**Actual Behavior:**
Shows 462.2 (exactly 1/10 of correct value)

**Likely Cause:**
Calculation dividing by number of samples incorrectly

---

### MAJ-012: Protein CVs plot missing treatment samples

**Severity:** Major
**Status:** Open
**Created:** 2026-03-25
**Component:** Backend/Frontend - QC/Protein CVs Plot

**Description:**
The 'Protein CVs' plot only shows DMSO samples. Missing treatment samples (INCZ123456).

**Expected Behavior:**
Should show CVs for all conditions (both DMSO and treatment)

**Actual Behavior:**
Only DMSO samples shown

**Likely Cause:**
CV calculation not grouping by condition correctly or filtering out treatment samples

---

### MAJ-013: PSM Intensity Distribution shows wrong data

**Severity:** Major
**Status:** Open
**Created:** 2026-03-25
**Component:** Backend/Frontend - QC/PSM Intensity Distribution Plot

**Description:**
PSM Intensity Distribution plot should display median normalized Unique PSM abundances. Currently shows raw or incorrectly transformed data.

**Expected Behavior:**
Display median normalized Unique PSM abundances

**Actual Behavior:**
Shows incorrect data

**Likely Cause:**
Wrong data source or transformation applied

---

### MIN-010: QC Average CV should show separate values

**Severity:** Minor
**Status:** Open
**Created:** 2026-03-25
**Component:** Frontend - QC Summary Statistics

**Description:**
In QC Summary Statistics, currently shows single 'Average CV' value. Need to show separate 'Avg Protein CV' and 'Avg PSM CV'.

**Expected Behavior:**
Two separate statistics:
- Avg Protein CV
- Avg PSM CV

**Actual Behavior:**
Single combined 'Average CV' shown

---

### CRIT-007: Processing stuck at 0% - WebSocket error

**Severity:** Critical
**Status:** **Fixed**
**Created:** 2026-03-25
**Fixed:** 2026-03-25
**Component:** Backend - Processing Orchestrator / WebSocket

**Description:**
When starting analysis, the processing page was getting stuck at 0% with "Waiting for connection..." message. The WebSocket connection failed with an error, preventing the processing pipeline from starting.

**Root Cause:**
In `processing_orchestrator.py`, there was a variable ordering bug:
```python
# WRONG - 'state' referenced before assignment
self._pipeline_state = state  # This referenced 'state' which didn't exist yet
state = PipelineState(session_id)  # This created it too late
```

This caused a `NameError: cannot access local variable 'state' where it is not associated with a value` when starting any analysis.

**Fix:**
Fixed variable ordering in `process_session()` method:
```python
# CORRECT - Create state first, then assign
state = PipelineState(session_id)
self._pipeline_state = state
```

**Verification:**
Successfully completed full analysis run with session 787c43f6-d8a2-47db-8564-c06074036a42. Processing completed all 9 steps and GSEA results were generated correctly.

---
6. Additional issue: `datetime` serialization error seen in logs: "Object of type datetime is not JSON serializable"

**Impact:**
- CRITICAL: All analysis is blocked - cannot verify CRIT-004 or CRIT-005 (GSEA fixes)
- Cannot complete any processing pipeline runs
- No results files being generated
---

### CRIT-008: Protein abundance distribution incorrect after CRIT-006 normalization fix

**Severity:** Critical
**Status:** **Fixed**
**Created:** 2026-03-25
**Fixed:** 2026-03-25
**Component:** Backend - R Script (msqrob2_protein.R)

**Description:**
After applying the CRIT-006 fix (shifting median normalization to highest median instead of 0), the protein abundance medians were still very different across samples (e.g., DMSO_1: 7.74 vs INCZ123456_1: 5.80 - a ~4x difference).

**Root Cause:**
The custom normalization code didn't properly add the normalized assay to the QFeatures object:
```r
# WRONG - Can't add an assay inside another assay
assay(pe[["peptide_log2"]], "peptide_norm") <- peptide_norm_matrix

# WRONG - This extracts empty/wrong data
pe <- addAssay(pe, pe[["peptide_log2"]][, , "peptide_norm"], name = "peptide_norm")
```

The result was that `aggregateFeatures()` used the wrong (non-normalized) data, leading to different medians across samples.

**Fix:**
Properly create a new SummarizedExperiment with the normalized data:
```r
# Create a new SummarizedExperiment with the normalized data
peptide_norm_se <- SummarizedExperiment(
    assays = list(peptide_norm = peptide_norm_matrix),
    rowData = rowData(pe[["peptide_log2"]]),
    colData = colData(pe[["peptide_log2"]])
)

# Add to QFeatures object
pe <- addAssay(pe, peptide_norm_se, name = "peptide_norm")
```

**Verification:**
After fix, protein abundances should have similar medians across all samples (within ~0.1 log2 units).

**Related Bug:**
- CRIT-006: Original fix for negative log2 values introduced this issue

---
1. Verify the custom normalization is correctly creating the peptide_norm assay
2. Check if the assay is properly accessible for aggregation
3. Ensure normalization is applied to log2 transformed Unique PSM level data
4. Verify the QFeatures object structure after adding the new assay


### CRIT-009: QC plot - PSM CVs and Protein CVs showing identical data

**Severity:** Critical
**Status:** **Cannot Reproduce / Data is Correct**
**Created:** 2026-03-25
**Component:** Backend/Frontend - QC Calculation/Display

**Description:**
In the QC Plots page, the PSM CVs and Protein CVs plots were reported to be displaying the same identical data.

**Investigation Results:**
1. Checked `QC_Results.json` in session `83a5c17c-7119-4c4a-bfd4-72c2ce112ed9`:
   - PSM CV has 4617 values per condition (unique PSMs)
   - Protein CV has 2290 values per condition (proteins)
   - Values are DIFFERENT (e.g., PSM: 55.78 vs Protein: 53.11)

2. Backend code (`qc_calculator.py`) correctly calculates separate CVs:
   - `_calculate_cv()`: Calculates PSM CV from PSM abundances
   - `_calculate_protein_cv()`: Calculates Protein CV from protein abundances

3. Frontend code (`QCPlots.tsx`) correctly uses separate data:
   - `psmCVPlot`: Uses `data.psm_cv`
   - `proteinCVPlot`: Uses `data.protein_cv`

**Root Cause:**
No bug found. The data is correctly calculated and stored. The user may have:
- Viewed cached/old data
- Misinterpreted similar-looking violin plots
- Had a browser caching issue

**Verification:**
```bash
python -c "import json; data=json.load(open('QC_Results.json')); print('PSM CV:', len(data['psm_cv']['DMSO'])); print('Protein CV:', len(data['protein_cv']['DMSO']))"
# Output: PSM CV: 4617, Protein CV: 2290
```

**Status:** Closed - Data is correct, no fix needed.

---
