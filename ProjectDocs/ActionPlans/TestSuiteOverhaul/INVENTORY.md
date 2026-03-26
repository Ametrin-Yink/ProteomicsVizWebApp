# Test Inventory - ProteomicsViz WebApp

**Generated:** 2026-03-25
**Status:** Complete

---

## Summary

| Category | Files | Tests | Verdict |
|----------|-------|-------|---------|
| E2E Tests (Playwright) | 8 | ~45 | **MOSTLY KEEP** - Well structured, strict assertions |
| Integration Tests (pytest) | 3 | ~25 | **REWRITE** - Many skipped, weak assertions |
| Unit Tests (pytest) | 3 | ~20 | **KEEP** - Solid, isolated tests |
| R Script Tests | 11 | N/A | **DELETE** - Debug scripts, not tests |
| Helper Scripts | ~20 | N/A | **REVIEW** - Mix of utilities and ad-hoc scripts |

---

## E2E Tests (Playwright) - Tests/e2e/

### Overview
**Status:** ✅ **KEEP** (with minor updates)

These tests are well-structured with:
- Strict assertions (no `in [200, 404]` patterns)
- Visual confirmation (screenshots)
- Proper cleanup
- Real user workflows

### File Details

#### 1. `01-welcome.spec.ts`
**Tests:** 8
**Coverage:** Welcome page, template selection, session persistence
**Status:** ✅ **KEEP**

```
✓ page loads without errors
✓ template section displays correctly
✓ TBD tooltip appears on unavailable templates
✓ clicking available template creates session and navigates
✓ session panel displays on welcome page
✓ new analysis button opens create dialog
✓ help link is visible and clickable
✓ page is responsive on mobile viewport
✓ session persists across page reload
✓ session survives browser restart
```

**Issues:** None significant

---

#### 2. `02-data-input.spec.ts`
**Tests:** 10
**Coverage:** File upload, validation, config panel
**Status:** ✅ **KEEP**

```
✓ uploads single proteomics file
✓ uploads multiple proteomics files
✓ uploads compound file
✓ compound file upload succeeds
✓ compound handling with non-matching condition
✓ parses experiment structure correctly
✓ validation shows warning for single replicate
✓ configure analysis sets treatment/control/organism
✓ config validation prevents treatment=control
✓ session persists uploaded files
```

**Issues:** None significant

---

#### 3. `03-processing.spec.ts`
**Tests:** 11
**Coverage:** Processing pipeline, WebSocket, progress updates
**Status:** ✅ **KEEP**

```
✓ starts processing successfully
✓ displays all 9 processing steps
✓ shows real-time progress updates
✓ displays log messages
✓ shows estimated completion time
✓ processing completes all 9 steps and navigates to results
✓ all steps show completed status
✓ allows canceling processing
✓ reconnects on WebSocket disconnect
✓ handles network errors gracefully
✓ displays validation error for insufficient replicates
✓ shows error details with suggestion
```

**Issues:** None significant

---

#### 4. `04-results.spec.ts`
**Tests:** 6
**Coverage:** Results visualization, volcano plot, protein table
**Status:** ✅ **KEEP**

```
✓ general info panel displays
✓ volcano plot displays
✓ plot filters work
✓ protein results table displays
✓ protein selection from volcano works
✓ protein info panel shows details
```

**Strengths:**
- Verifies actual data counts (proteins > 0)
- Tests scientific validity (logFC ranges)
- Interactive elements tested (click, filter)

---

#### 5. `05-qc-plots.spec.ts`
**Tests:** 7
**Coverage:** QC plots with REAL DATA verification
**Status:** ✅ **KEEP**

```
✓ all 6 plots are visible
✓ PCA plot has REAL data
✓ P-value distribution plot has REAL data
✓ CV plot has REAL data
✓ PSM intensity plot has REAL data
✓ Protein intensity plot has REAL data
✓ Data completeness plot has REAL data
```

**Strengths:**
- Explicitly checks for non-empty plots
- Verifies data points exist (`.scatterlayer .trace .point`)
- Variance percentages validated

---

#### 6. `06-bioinformatics.spec.ts`
**Tests:** 4
**Coverage:** GSEA heatmap and pathways
**Status:** ✅ **KEEP**

```
✓ GSEA heatmap displays
✓ GSEA pathways table displays
✓ pathway details show correct information
✓ GSEA data is scientifically valid
```

---

#### 7. `07-pdf-export.spec.ts`
**Tests:** 2
**Coverage:** PDF report generation
**Status:** ⚠️ **REVIEW** - May be skipped or minimal

```
✓ PDF export button is visible
? PDF generation works
? PDF download succeeds
```

**Note:** Check if fully implemented

---

#### 8. `08-session-manager.spec.ts`
**Tests:** 5
**Coverage:** Session management UI
**Status:** ✅ **KEEP**

```
✓ session list displays
✓ can delete session from list
✓ session persists after deletion
✓ can rename session
✓ can filter sessions
```

---

#### `helpers.ts`
**Type:** Test utilities
**Status:** ✅ **KEEP**

Contains:
- `createSession()` - Creates session via UI
- `uploadFiles()` - Uploads files one-by-one
- `configureAnalysis()` - Sets config options
- `startAnalysis()` - Starts and waits for completion
- `createCompletedSession()` - Full pipeline helper
- `cleanupSession()` - Deletes session via API
- `takeScreenshot()` - With size validation
- `verifyNoConsoleErrors()` - Console error check

**Strengths:**
- Mimics real user behavior
- Proper cleanup
- Screenshot verification

---

## Integration Tests - Tests/backend/integration/

### Overview
**Status:** ⚠️ **REWRITE NEEDED**

These tests have structural issues:
- Many tests are `@pytest.mark.skip` (outdated API)
- Some assertions check for multiple status codes
- Mock usage in places where real behavior should be tested

### File Details

#### 1. `test_api.py`
**Tests:** ~18
**Coverage:** Session CRUD, upload, config, processing
**Status:** ⚠️ **REWRITE**

**Issues Found:**
```python
# ❌ Line 331: Multiple acceptable status codes
assert response.status_code in [200, 400, 422]

# ❌ Lines 346, 380, 396, 414, 438: Weak assertions
assert response.status_code in [200, 404]

# ❌ Lines 459, 475: Tests skipped
@pytest.mark.skip(reason="Reports endpoint requires session_manager")
```

**Keep These:**
- `test_create_session_success` - Good specific assertions
- `test_get_session_not_found` - Proper 404 testing
- `test_delete_session_success` - Verification of deletion

---

#### 2. `test_processing.py`
**Tests:** ~12
**Coverage:** 9-step pipeline
**Status:** ⚠️ **REWRITE**

**Issues Found:**
```python
# Lines 28, 68, 96, 123: Tests skipped
@pytest.mark.skip(reason="Step classes don't exist - DataProcessor class has different API")
```

**Verdict:** Tests reference outdated API. Need to update for `DataProcessor` class.

---

#### 3. `test_r_integration.py`
**Tests:** ~5
**Coverage:** R script execution
**Status:** ⚠️ **REVIEW**

**Assessment:**
- Tests R integration which is good
- May need updating for current R script signatures

---

## Unit Tests - Tests/backend/unit/

### Overview
**Status:** ✅ **KEEP** (minor updates needed)

Solid tests for pure functions with:
- No external dependencies
- Specific assertions
- Good edge case coverage

### File Details

#### 1. `test_file_parser.py`
**Tests:** ~18
**Coverage:** Filename parsing, column validation
**Status:** ✅ **KEEP**

Tests:
- `parse_psm_filename()` - Valid/invalid filenames
- `validate_psm_columns()` - Required columns
- `find_abundance_column()` - Column extraction
- `sanitize_filename()` - Security

---

#### 2. `test_data_processor.py`
**Tests:** ~12
**Coverage:** DataProcessor steps
**Status:** ✅ **KEEP**

Tests:
- `step2_generate_unique_psm()`
- `step4_remove_low_quality()` - Contaminants, No Value, low abundance
- `step5_filter_by_criteria()` - Lenient vs strict

**Note:** Tests for `step3_remove_razor` should be added

---

#### 3. `test_validators.py`
**Tests:** ~5
**Coverage:** Input validation
**Status:** ✅ **KEEP**

---

## R Script Tests - Tests/backend/r_scripts/

### Overview
**Status:** ❌ **DELETE**

These are **debugging scripts**, not automated tests:
- `test_contrast.R` - Manual contrast debugging
- `test_de_debug.R` - Manual DE debugging
- `test_protein.R` - Manual protein inspection
- `test_qfeatures.R` - Manual QFeatures debugging
- `test_qf_debug.R` - More debugging
- etc.

**None of these:**
- ❌ Have assertions
- ❌ Are run automatically
- ❌ Test expected behavior
- ❌ Are integrated with CI

**Verdict:** Delete or move to `Tests/debug_scripts/`

---

## Helper Scripts - Tests/scripts/

### Overview
**Status:** ⚠️ **REVIEW**

Mix of:
- ✅ Useful utilities (keep)
- ⚠️ One-off verification scripts (archive)
- ❌ Outdated debug scripts (delete)

### Categorization

#### ✅ KEEP - Useful Utilities
- `upload_and_process.py` - Standard upload + start helper
- `test_websocket.py` - WebSocket connection testing

#### ⚠️ REVIEW - Bug Fix Verification
- `verify_crit005*.py` - Specific bug verifications
- `test_crit006_fix.py` - Bug fix testing
- `test_gsea_heatmap.py` - GSEA visualization check

These were for bug fixes - may be kept as regression tests or archived

#### ❌ DELETE - Outdated/Debug
- `test_simple.py` - Basic test (covered by real tests)
- `test_fixes.py` - Generic (purpose unclear)
- `test_volcano.py` - Covered by E2E
- `test_compound.py` - Covered by E2E
- `inspect_welcome.py` - Debugging
- `check_page.py` - Basic check

---

## Python Files in Wrong Places

### Tests/e2e/*.py
- `verify_crit002_fix.py` - Move to Tests/scripts/
- `verify_crit004_fix.py` - Move to Tests/scripts/

These don't belong in e2e/ (TypeScript tests)

---

## Recommendations

### E2E Tests: Keep All 8 Files
**Action:** Minor updates only
- Update selectors if UI changed
- Add config variation tests (4 combinations)
- Ensure PDF export test is complete

### Integration Tests: Rewrite
**Action:** Complete rewrite of 3 files
- Remove all `@pytest.mark.skip` decorators
- Replace `status in [200, 404]` with specific assertions
- Test real behavior, not mocks
- Match current API signatures

### Unit Tests: Keep with Additions
**Action:** Add missing coverage
- Add `test_step3_remove_razor` tests
- Add validation tests for config
- Keep existing file_parser tests

### R Scripts: Delete or Archive
**Action:**
- Delete all 11 R files from r_scripts/
- OR move to `Tests/debug_scripts/` if useful for manual debugging

### Helper Scripts: Organize
**Action:**
- Move `verify_crit*.py` to `Tests/regression/`
- Delete outdated scripts
- Document remaining utilities

---

## Test Gaps (Not Covered)

### Critical Gaps
1. **Configuration combinations** - No test for all 4 config variants
2. **Error scenarios** - Limited error condition testing
3. **Session persistence** - Backend restart survival
4. **Large file upload** - 500MB limit enforcement
5. **Concurrent sessions** - Multiple users

### Nice-to-Have
1. **API rate limiting** - If implemented
2. **Session expiration** - If implemented
3. **Export formats** - CSV, TSV download validation

---

## Action Plan

### Phase 1: Cleanup (1 hour)
- [ ] Delete/move R scripts
- [ ] Organize helper scripts
- [ ] Move Python files to correct locations

### Phase 2: Fix Integration Tests (2-3 hours)
- [ ] Rewrite test_api.py
- [ ] Rewrite test_processing.py
- [ ] Update test_r_integration.py

### Phase 3: Enhance Coverage (2-3 hours)
- [ ] Add config combination tests
- [ ] Add step3_remove_razor unit tests
- [ ] Add error handling E2E tests

### Phase 4: Verify (1 hour)
- [ ] Run full test suite
- [ ] Verify all tests pass
- [ ] Check no flaky tests

---

## Test Suite Reliability Score

| Category | Score | Notes |
|----------|-------|-------|
| E2E Tests | 9/10 | Well structured, strict assertions |
| Integration | 4/10 | Many skipped, weak assertions |
| Unit Tests | 8/10 | Solid, but missing some coverage |
| Overall | 7/10 | Good foundation, needs cleanup |

---

## Files to Delete

```
Tests/backend/r_scripts/          # All 11 files
Tests/scripts/test_simple.py
Tests/scripts/test_fixes.py
Tests/scripts/test_volcano.py
Tests/scripts/test_compound.py
Tests/scripts/inspect_welcome.py
Tests/scripts/check_page.py
```

## Files to Rewrite

```
Tests/backend/integration/test_api.py
Tests/backend/integration/test_processing.py
```

## Files to Keep

```
Tests/e2e/*.spec.ts               # All 8 files
Tests/e2e/helpers.ts
Tests/backend/unit/*.py           # All 3 files
Tests/conftest.py
Tests/playwright.config.ts
```
