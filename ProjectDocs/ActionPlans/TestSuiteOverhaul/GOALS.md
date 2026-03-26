# Test Suite Goals: ProteomicsViz WebApp

**Practical Standard: Tests Prove The WebApp Works for Real Users**

---

## What "Functional WebApp" Means

The test suite passes when a user can successfully:

### Critical User Story 1: New Analysis
1. Land on welcome page → See session list
2. Click template → Get new session → Redirected to analysis page
3. Upload 6 CSV files → See files in table with correct condition names
4. Set treatment/control/organism → See green checkmarks/validation
5. Configure razor/filtering options → See summary update
6. Click Start → Redirected to processing page
7. See progress bar moving, steps completing (1→9), logs streaming
8. Auto-redirect to results when complete → See volcano plot with points
9. Click points in volcano → See protein details panel
10. Navigate to QC → See PCA plot with samples separated by condition
11. Navigate to GSEA → See heatmap with pathways

### Critical User Story 2: Resume Analysis
1. Return to welcome page → See previous session in list
2. Click session → Back to results → Data still there
3. Refresh page → Session restored

### Critical User Story 3: Error Recovery
1. Upload invalid file → See specific error message (what's wrong + how to fix)
2. Set treatment=control → See validation error before start
3. Processing fails → See error message with step number → Can retry
4. Session deleted → 404 page with clear message

---

## The Testing Standard

### Test Pass Criteria

A test **PASSES** only when:
1. **UI elements render** (visual confirmation - screenshots)
2. **User interactions work** (clicks, uploads, selections)
3. **Data is correct** (specific values, not just "not null")
4. **State persists** (reload page, data still there)

A test **FAILS** when:
1. Any assertion fails (specific, no ranges)
2. Console has errors
3. Network request fails (4xx/5xx)
4. UI element missing or wrong content

### What's NOT Acceptable (Unreliable Tests)

```typescript
// ❌ BAD - Multiple acceptable outcomes
test('upload works', async () => {
  const response = await uploadFiles();
  expect([200, 201, 204]).toContain(response.status); // GIVES FALSE CONFIDENCE
});

// ❌ BAD - No data verification
test('results load', async () => {
  await page.goto('/analysis/visualization');
  await expect(page.locator('[data-testid="results"]')).toBeVisible(); // ANYTHING PASSES
});

// ❌ BAD - Tests mocks
test('processing starts', async () => {
  const mockStart = jest.fn();
  await startProcessing(mockStart);
  expect(mockStart).toHaveBeenCalled(); // DOESN'T TEST REAL FUNCTIONALITY
});
```

---

## Bug Discovery Protocol (CRITICAL)

When tests reveal a bug, **DO NOT FIX IT IMMEDIATELY**. Follow this process:

### Step 1: Log the Bug (Required)
Add the bug to the BugFix action plan files **before** attempting any fix:

1. **Add to bug-inventory.md** - Include:
   - Bug ID (auto-increment from existing, e.g., CRIT-010, MAJ-011, MIN-010)
   - Severity (Critical/Major/Minor)
   - Description - What fails in the test
   - Reproduction steps - The exact test that fails
   - Expected behavior - What the test asserts should happen
   - Actual behavior - What actually happens
   - Evidence - Screenshot path, error message, console log

2. **Update README.md** - Add bug to the summary table

**Bug File Locations:**
- `ProjectDocs/ActionPlans/BugFix/bug-inventory.md` - Full bug details
- `ProjectDocs/ActionPlans/BugFix/README.md` - Bug status summary
- `ProjectDocs/ActionPlans/BugFix/fixed-bugs.md` - After fix is verified

### Step 2: Continue Testing
- Mark the failing test as `test.skip()` or `test.fixme()`
- Document the skip reason with bug ID
- Continue with other tests
- Do NOT let one bug block the entire test suite

### Step 3: Fix During BugFix Phase
- Only fix bugs after inventory is complete
- Follow the systematic debugging process in `AGENTS/`
- Verify fix with browser test + screenshot
- Mark as fixed in bug-inventory.md
- Move to fixed-bugs.md with root cause

### Why This Rule Exists

1. **Prevents context switching** - Fix bugs in batches, not one-by-one
2. **Maintains test suite integrity** - Skipped tests document known issues
3. **Enables prioritization** - All bugs visible for triage
4. **Prevents half-fixes** - Bugs get proper root cause analysis
5. **Creates audit trail** - Every bug tracked from discovery to resolution

### Example: Test Finds a Bug

```typescript
// Test discovers volcano plot not rendering
test('volcano plot displays data points', async () => {
  // ... test code ...

  // BUG FOUND: No data points visible
  // await expect(points).toHaveCount(2847); // FAILS

  test.skip(true, 'MAJ-011: Volcano plot data points not rendering - see bug-inventory.md');
});
```

Then immediately add to `bug-inventory.md`:
```markdown
| MAJ-011 | Volcano plot not rendering data points after processing completes | Open |
```

With full details in the file.

---

## Minimal Test Coverage (What's Actually Required)

### E2E Tests (Playwright) - The Core 5 Workflows

These are **non-negotiable** - without these, we don't know if the app works.

#### E2E Test 1: Complete Analysis Flow
**User:** Researcher wants to run differential expression analysis

**Steps:**
1. Navigate to welcome page → Verify title, template cards visible
2. Click "Protein Pair-wise Comparison" → Verify redirect to /analysis?session=XXX
3. Upload 6 PSM files → Verify files appear in table with correct conditions
4. Configure: treatment=INCZ123456, control=DMSO, organism=human, remove_razor=true, strict_filtering=true
5. Click Start → Verify redirect to /analysis/processing
6. Verify WebSocket connects → Progress bar moves → Steps 1-9 complete
7. Auto-redirect to /analysis/visualization → Verify volcano plot renders with data points
8. Click point on volcano → Verify protein info panel shows data
9. Navigate to QC tab → Verify PCA plot shows sample separation
10. Navigate to GSEA tab → Verify heatmap displays

**Success Criteria:**
- All UI assertions pass (visible, correct text)
- Processing completes (state === 'completed')
- Results have actual data (protein count > 0)
- Screenshots captured at key steps

---

#### E2E Test 2: Session Persistence
**User:** Researcher returns to previous analysis

**Steps:**
1. Create session, upload files, configure
2. Navigate back to welcome page → Verify session appears in list
3. Click session → Verify back to analysis page with files/config intact
4. Refresh page → Verify session restored from URL
5. Close browser, reopen, go to session URL → Verify still works

**Success Criteria:**
- Session data persists across navigation
- Config values preserved
- File list preserved

---

#### E2E Test 3: Configuration Variations
**User:** Researcher wants to test different filtering settings

**Steps (4 separate test runs):**
1. Config A: remove_razor=false, strict_filtering=false → Run → Check results
2. Config B: remove_razor=false, strict_filtering=true → Run → Check results (fewer proteins)
3. Config C: remove_razor=true, strict_filtering=false → Run → Check results (different proteins)
4. Config D: remove_razor=true, strict_filtering=true → Run → Check results (most filtered)

**Success Criteria:**
- Different configs produce measurably different results
- PSM counts differ between strict/lenient
- Protein counts differ between razor on/off

---

#### E2E Test 4: Error Handling
**User:** Researcher makes mistakes, needs clear feedback

**Steps:**
1. Upload invalid filename → Verify error message explains required format
2. Upload file with missing columns → Verify error lists missing columns
3. Set treatment=control → Verify validation error before processing
4. Start without enough files → Verify "at least 6 files" error
5. Delete session → Verify 404 on subsequent access

**Success Criteria:**
- Error messages are specific and actionable
- UI prevents invalid actions where possible
- Errors don't crash the app

---

#### E2E Test 5: Processing Recovery
**User:** Researcher handles processing failure

**Steps:**
1. Start processing → Simulate/cause failure at step 3
2. Verify error displayed with step number
3. Click Retry → Verify processing restarts
4. Complete successfully → Verify results available

**Success Criteria:**
- Failed state is clear
- Retry works
- No data corruption

---

### Integration Tests (pytest) - API Contract Verification

These verify backend endpoints work in isolation.

#### Required Integration Tests:

1. **Session CRUD**
   - POST /api/sessions → Returns 201, has id, name, state='created'
   - GET /api/sessions/{id} → Returns 200 with same data
   - PUT /api/sessions/{id}/config → Validates treatment≠control
   - DELETE /api/sessions/{id} → Returns 204, subsequent GET returns 404

2. **File Upload**
   - POST /api/sessions/{id}/upload/proteomics → 200, file stored, metadata correct
   - Invalid filename → 400 with specific error message
   - Session not found → 404

3. **Processing Control**
   - POST /api/analysis/{id}/start → 202, state changes to 'processing'
   - Without config → 400
   - Without files → 400
   - Cancel → state changes to 'cancelled'

4. **Results Retrieval**
   - GET /api/viz/{id}/results → Returns array with log_fc, pval, adj_pval
   - GET /api/viz/{id}/qc/plots → Returns pca, pvalue_distribution
   - GET /api/viz/{id}/gsea/go_bp → Returns results array
   - No results yet → 404 (not empty 200)

---

### Unit Tests - Pure Functions Only

These test data transformation logic without I/O.

#### Required Unit Tests:

1. **file_parser.py**
   - `parse_psm_filename("PSM_Exp_Cond_1.csv")` → Returns correct experiment/condition/replicate
   - Invalid filenames → Raises InvalidFileFormatError

2. **data_processor.py**
   - `step3_remove_razor(data, config)` → Removes razor peptides when config.remove_razor=true
   - `step5_filter_by_criteria(data, strict=true)` → Filters more aggressively
   - Edge cases: empty data, all NaN, single protein

3. **validators.py** (if exists)
   - Treatment≠control validation
   - Organism enum validation

---

## What's NOT Required (Over-testing)

Don't write tests for:

1. **Internal implementation details**
   - Function call order
   - Private method behavior
   - Store implementation

2. **Third-party libraries**
   - R/msqrob2 correctness (test our integration only)
   - Pandas operations
   - Plotly rendering

3. **Visual perfection**
   - Pixel-perfect matching
   - Animation timings
   - Responsive breakpoints

4. **Every error case**
   - Focus on user-facing errors
   - Skip "should never happen" internal errors

---

## Test Data Requirements

### For E2E Tests:
- **6 real PSM files** from SampleData/ (3 DMSO + 3 treatment)
- Each file ~1000+ rows
- Valid columns present

### For Integration Tests:
- **Minimal CSV fixtures** (10-20 rows)
- Stored in Tests/fixtures/
- Same format as real files

### For Unit Tests:
- **Mock DataFrames**
- Created in test code
- No file I/O

---

## Success Metrics

The test overhaul is complete when:

- [ ] E2E Test 1 passes (full analysis flow)
- [ ] E2E Test 2 passes (session persistence)
- [ ] E2E Test 3 passes (all 4 config combinations)
- [ ] E2E Test 4 passes (error handling)
- [ ] E2E Test 5 passes (processing recovery)
- [ ] Integration tests cover all API endpoints
- [ ] Unit tests cover file_parser and data_processor
- [ ] Tests catch real bugs (verified by breaking code temporarily)
- [ ] Tests run in < 10 minutes total
- [ ] No flaky tests (5 consecutive runs, all pass)

---

## Out of Scope

1. **Load testing** - Not required for functional verification
2. **Security testing** - Separate concern
3. **Accessibility testing** - Nice to have, not critical
4. **Cross-browser testing** - Chrome only is fine
5. **Mobile testing** - Desktop focus only

---

## The "Golden Rule"

> If a user can't do it through the UI, don't test it.
> If a user CAN do it and it breaks, the test must fail.

This means:
- ✅ Test: Upload → Process → Results (user does this)
- ❌ Don't test: Internal function returns correct dict (user never sees this)
- ✅ Test: Error message displays (user sees this)
- ❌ Don't test: Exception is raised internally (user doesn't see this)
