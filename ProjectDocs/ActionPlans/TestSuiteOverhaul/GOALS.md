# Test Suite Goals: ProteomicsViz WebApp

## What "Functional" Means

A test suite that gives **real confidence** the webapp works. Tests must:
1. **Fail** when functionality is broken
2. **Pass** only when functionality actually works
3. **Never** give false confidence

---

## Critical User Workflows (Must Be Tested)

### Workflow 1: Complete Analysis Pipeline
**User journey:** Upload → Configure → Process → View Results

**Success Criteria:**
- User can upload 6+ PSM CSV files (3 treatment + 3 control)
- Files are validated (correct columns, filename format)
- Analysis config is saved (treatment, control, organism)
- Processing starts and completes all 9 steps
- Results are generated (protein abundance, differential expression)
- QC plots are viewable (PCA, volcano)
- GSEA results are available

**Test Type:** E2E with real browser, real backend, real R processing

---

### Workflow 2: Session Lifecycle
**User journey:** Create → Configure → Process → Results → Delete

**Success Criteria:**
- Session is created with unique ID
- Session persists across page reloads
- Session survives browser restart (stored in backend)
- Session can be deleted and removed from list
- Sessions display correct status (created/configuring/processing/completed)

**Test Type:** Integration tests + E2E

---

### Workflow 3: File Upload & Validation
**User journey:** Select files → Validation feedback → Success/Error

**Success Criteria:**
- Valid PSM files accepted (correct filename pattern: `PSM_*_*_*.csv`)
- Invalid filenames rejected with clear error
- CSV columns validated (Sequence, Modifications, Charge, Contaminant, Master Protein Accessions, Quan Info, Abundance)
- Missing required columns detected
- Multiple files uploaded simultaneously

**Test Type:** Unit tests (parsing) + Integration tests (API) + E2E (UI flow)

---

### Workflow 4: Analysis Configuration
**User journey:** Set treatment → Set control → Select organism → Configure Razor Peptide Handling → Configure Data Quality Filtering → Validate

**Success Criteria:**
- Config saved to session
- Treatment ≠ Control (validation error if same)
- Organism must be valid (human, mouse, rat)
- **Razor Peptide Handling option configured (remove_razor: true/false)**
  - When true: Peptides mapping to multiple proteins are resolved to single best protein (Step 3 executed)
  - When false: Razor peptides kept as-is, may map to multiple proteins (Step 3 skipped)
  - Best protein selected by: most peptides matched → longest sequence → first in list
  - Results in more consistent protein quantification when enabled
- **Data Quality Filtering options configured (strict_filtering: true/false)**
  - When strict (true):
    - Remove PSMs with >20% missing values per condition
    - Remove proteins with only 1 PSM (single-peptide proteins excluded)
  - When lenient (false):
    - Remove PSMs with >40% missing values per condition
    - Single-peptide proteins allowed
  - Both modes apply: remove contaminants, "No Value" quan, abundance < 1
- All required fields enforced before processing
- Processing pipeline respects all configuration options

**Test Type:** Integration tests + E2E

**Test Cases - Config Combinations:**
| Config | remove_razor | strict_filtering | Expected Behavior |
|--------|--------------|------------------|-------------------|
| Conservative | true | true | Razor resolved, 20% missing threshold, no single-PSM proteins |
| Balanced | true | false | Razor resolved, 40% missing threshold, single-PSM proteins allowed |
| Inclusive | false | true | Razor kept, 20% missing threshold, no single-PSM proteins |
| Permissive | false | false | Razor kept, 40% missing threshold, single-PSM proteins allowed |

**Key Test Assertions:**
1. **Config persistence:** All 5 settings saved and retrieved correctly
2. **Razor handling impact:** Protein counts differ between remove_razor=true/false
3. **Filtering impact:** PSM counts differ between strict_filtering=true/false
4. **Validation:** Cannot start processing without all required fields
5. **UI state:** Checkbox states persist on page reload

---

### Workflow 5: Real-Time Processing
**User journey:** Start → See progress → Completion notification → Auto-redirect

**Success Criteria:**
- WebSocket connects and shows "Connected"
- Progress bar updates for each of 9 steps
- Log messages display in real-time
- All steps complete without error
- Auto-redirect to results page on completion
- Estimated time remaining is shown

**Test Type:** E2E (requires running backend + browser)

---

### Workflow 6: Results Display
**User journey:** Navigate to results → View tables → View plots → Export

**Success Criteria:**
- DE results table displays with correct columns
- Volcano plot renders with interactive points
- PCA plot shows sample clustering
- GSEA heatmap displays
- CSV export downloads correct data
- PDF report generates

**Test Type:** E2E (with seeded/known results data)

---

### Workflow 7: Error Handling
**User journey:** Encounter error → See clear message → Recovery path

**Success Criteria:**
- Insufficient replicates error (need ≥3 per condition)
- Invalid file format error
- R processing error (missing packages, data issues)
- Network errors handled gracefully
- Validation errors show before processing starts
- Error messages include actionable suggestions

**Test Type:** Integration tests + E2E

---

## Test Pyramid Structure

```
       /\
      /  \      E2E Tests (8 suites) - Full workflows
     /    \     - Real browser + real backend
    /______\    - Verify end-to-end functionality
   /        \
  /__________\  Integration Tests (API + Services)
 /            \ - Real backend, test DB/session store
/______________\ - HTTP endpoints, R subprocess, file I/O

   Unit Tests (Pure Functions)
   - File parsing (no I/O)
   - Data validation
   - Utility functions
```

### Distribution
- **Unit tests:** ~20% - Fast, isolated, reliable
- **Integration tests:** ~30% - API endpoints, services
- **E2E tests:** ~50% - Critical user workflows

---

## What Makes a Test "Reliable"

### ✅ Reliable Test Characteristics

1. **Deterministic:** Same input → Same output, every time
2. **Isolated:** No dependencies on other tests or test order
3. **Verifies actual behavior, not implementation details:**
   ```python
   # GOOD - verifies behavior
   assert response.json()['data']['total_proteins'] > 0

   # BAD - verifies implementation detail
   assert mock_function.called_once()
   ```
4. **Fails fast with clear error messages**
5. **No "acceptable" status code ranges:**
   ```python
   # GOOD - specific assertion
   assert response.status_code == 200

   # BAD - gives false confidence
   assert response.status_code in [200, 404]
   ```

### ❌ Unreliable Test Characteristics

1. **Accepts multiple outcomes** (`in [200, 404]`)
2. **Tests mocks instead of real behavior**
3. **Depends on timing/sleep** (`await page.waitForTimeout(5000)`)
4. **No assertions on data** (only checks element exists)
5. **Catches and swallows errors** (`.catch()` or try/except that doesn't assert)

---

## Test Data Strategy

### For E2E Tests
- Use real SampleData files (PSM_SampleData_*.csv)
- Create sessions with predictable names
- Clean up sessions after tests (via API)

### For Integration Tests
- Use TestClient with temp session store
- Create test fixtures with minimal data
- Reset state between tests

### For Unit Tests
- Mock file inputs (DataFrames)
- No external dependencies
- Parametrize edge cases

---

## Success Criteria for Test Overhaul

1. **All critical workflows have E2E coverage**
2. **No test accepts multiple status codes** (except genuine redirects)
3. **Every API test verifies response data, not just status**
4. **Unit tests only test pure functions** (no I/O, no mocks of internal code)
5. **Integration tests use real backend, not mocked services**
6. **Tests fail when functionality breaks** (verified by temporarily breaking code)
7. **Test suite runs in < 10 minutes** (parallel where possible)
8. **No flaky tests** (run 5 times, same results)

---

## Out of Scope (Not Testing)

These are intentionally NOT tested (or tested minimally):

1. **Visual regression** - Pixel-perfect UI matching (too brittle)
2. **Performance benchmarks** - Load testing (separate effort)
3. **Third-party R packages** - Assume msqrob2/QFeatures work (test our integration only)
4. **Browser-specific quirks** - Test Chrome only (Playwright default)
5. **Mobile responsiveness** - Basic smoke test only (not full workflow)

---

## Definition of Done

The test overhaul is complete when:

- [ ] All 7 critical workflows have automated E2E tests
- [ ] Razor Peptide Handling configuration tested with both settings (true/false)
- [ ] Data Quality Filtering configuration tested with both settings (strict/lenient)
- [ ] Configuration combinations tested (4 combinations table above)
- [ ] All API endpoints have integration tests with data verification
- [ ] All pure functions have unit tests
- [ ] Running the test suite catches the bugs we've already fixed
- [ ] No test gives false confidence (verified by code review)
- [ ] Test documentation exists (this file + README)
- [ ] CI can run the full suite and it passes
