# 13 - Lessons Learned

## Data Flow Issues

### QC Plots Showing Empty
**Problem:** PCA 0.0%, no data points, "No completeness data available"
**Root causes:**
1. Backend looked for separate JSON files but R generates one `QC_Results.json`
2. Frontend called `/qc/data` instead of `/qc/plots`
3. R outputs column-based format, frontend needed row-based

**Fix:** Read from single file, correct endpoint, transform column→row based in frontend.

### GSEA "No Pathways Found"
**Problem:** GSEA returns 0 enriched pathways
**Cause:** Biomart requires internet, fails silently when offline
**Fix:** Implement fallback — return UniProt IDs as-is when biomart is unavailable

### API Endpoint Mismatches
**Problem:** Frontend calls `/qc/data`, backend has `/qc/plots`
**Lesson:** Always verify endpoint URLs match. Use OpenAPI spec as source of truth.

### Agent Guidelines for Data Flow Issues:
1. Verify API endpoint URLs on both frontend and backend
2. Check data format — R outputs column-based, components may need row-based
3. Make type fields optional (`?`) for fields that may not exist
4. Log API responses during development to verify structure

## R Integration

- Check R script output format by reading the R script itself
- Verify file paths — R may output to different locations than expected
- Handle encoding: UTF-8 with latin-1 fallback
- Test R scripts independently before integrating

## Session Management Bugs

### Session Spam (9000+ sessions)
**Cause:** Missing useEffect dependencies caused infinite re-renders
**Fix:** Complete dependency array with cleanup

### Sessions Not Persisting
**Cause:** Backend returns `session_id`, frontend expected `id`
**Fix:** Map backend fields to frontend types

### API URL Double Prefix
**Cause:** `/api/api/sessions` from double prefix
**Fix:** Check API URLs carefully — no double slashes or wrong prefixes

**Lesson:** Always check useEffect dependencies, verify field names match between API and frontend types.

## E2E Test Infrastructure

### Common Issues:
1. **File upload:** Playwright's `setInputFiles()` doesn't trigger upload handler — use `uploadFiles()` helper
2. **Dialog flow:** Tests expected direct navigation, implementation uses modals
3. **Missing test IDs:** Retrofitting `data-testid` is time-consuming — add during component development
4. **File paths:** Must be relative to test file location
5. **Scrollable dialogs:** Add `max-h-[90vh] overflow-y-auto` to prevent off-screen elements

### Testing Rules:
- E2E tests must use human-like operations (`uploadFiles()` helper, not programmatic uploads)
- Visual confirmation required — screenshots at key steps, verify UI renders correctly
- Fix before proceeding — if a test fails, stop and fix it

## Toggle Switch Icon Misalignment

**Problem:** Checkmark/X icons not centered in toggle buttons
**Fix:** Add `flex items-center justify-center` + `display: block` on SVG icons

## Organism Dropdown Empty

**Problem:** Dropdown showed no options
**Cause:** Backend returned organisms without `available` property, frontend filtered by `available: true`
**Fix:** API client layer maps backend response to add `available: true`
**Lesson:** Bridge data model gaps in the API client, not the backend

## Shared Step Handler Cross-Pipeline Contamination

**Problem:** MSstats pipeline crashed at step 3 with `'NoneType' object is not subscriptable`.
**Root cause:** Step 2 (`unique_psm.py`) was shared between msqrob2 and MSstats. It unconditionally set `ctx.df = None` after completing — correct for msqrob2 (step 3+ are R scripts that read from disk) but fatal for MSstats (step 3 is a Python step that needs the DataFrame).
**Why tests didn't catch it:** Every test ran steps in isolation with fresh DataFrames. No test chained steps sequentially through a shared `StepContext`. `PipelineEngine.run()` had zero test coverage. The old `test_shared_steps_have_same_handler` actively enforced the sharing pattern.
**Fix:** Split step 1-2 handlers into pipeline-specific files (`combine_replicates_msqrob2.py`, `combine_replicates_msstats.py`, `unique_psm_msqrob2.py`, `unique_psm_msstats.py`). Added full-pipeline E2E chain tests and `PipelineEngine.run()` tests.
**Lesson:** Never share step handlers between pipelines. Test steps chained sequentially, not just in isolation. Test the execution engine itself.

## Cancel Flow on Errored Sessions

**Problem:** Users couldn't leave the processing page when a session was in ERROR state. Clicking Cancel returned "Can only cancel sessions that are processing or queued" (400).
**Root cause:** Backend cancel endpoint only allowed `QUEUED` and `PROCESSING` states. Frontend `handleConfirmCancel` trapped the error without navigating back.
**Fix:** Backend now accepts `ERROR` state for cancellation. Frontend calls `handleBack()` on cancel error to navigate to configuration page regardless.
**Lesson:** Error states need an exit path. The cancel/dismiss action should always let the user leave the processing page.

## Visual Confirmation Rule

Automated test assertions are necessary but not sufficient. For every UI feature:

1. Navigate to page manually using browser automation
2. Perform the actions described in tests
3. Take screenshots at key steps (before, during, after)
4. Visually inspect: UI elements present, data displayed correctly, no broken layouts
5. Document findings

**Non-negotiable:** If visual confirmation fails, the test fails. If UI is misaligned, the test fails. If data is not displayed, the test fails. Screenshots don't lie — they show the actual rendered state.

## Performance Optimization (Phase 1 & 2)

### Ridge Regression Breaks with ≤3 Replicates

**Problem:** After changing `msqrob2_ridge` default to `True`, all DE results showed 0 proteins (all-NA logFC/pval). Session `daf0051c` showed "0 proteins" in the web app.

**Root cause:** The 2025 msqrob2TMT paper recommends ridge for many-condition designs, but the formula `~ 0 + condition` with 3 replicates per condition creates 4 parameters from 12 observations. Ridge penalization causes `lme4` to hit "boundary (singular) fit" on every protein, producing all-NA results.

**Why the API didn't override it:** `SessionConfig` model was missing `msqrob2_ridge` field, so `config_forward_fields` couldn't forward the user's `msqrob2_ridge: false` from the API to `AnalysisConfig`. The default (`True`) was always used.

**Fix:** Reverted default to `False`, added missing msqrob2 fields to `SessionConfig`, and added them to `config_forward_fields` in `processing.py`.

**Lesson:** Every config field that exists in `AnalysisConfig` MUST also exist in `SessionConfig` AND in `config_forward_fields`. A missing field silently uses the default — the API returns 200 with no warning that the user's setting was ignored.

### DuckDB CSV vs Pandas CSV Parsing

**Problem:** DuckDB `read_csv` and `pandas.read_csv` handle quoted headers, null values, and type inference differently. A query that works on test data may silently drop rows on real data.

**Mitigation:** Use `all_varchar=true` (read everything as strings) and explicit `TRY_CAST(... AS DOUBLE)` for numeric columns. The output comparison test (`test_duckdb_streaming.py`) verifies identical output to pandas for the same input.

### Chunked Step 5 Replicate Counting

**Problem:** Using `max(nunique())` across Parquet row groups undercounts replicates when a condition's replicates span multiple chunks. Caused over-filtering.

**Fix:** Use `defaultdict(set)` to accumulate actual replicate values across all chunks, then convert to lengths.

### Phase 2.2 removeAssay Warnings

**Problem:** "removing N sampleMap rows not in names(experiments)" appears after `removeAssay()` calls. Benign — QFeatures is cleaning up sampleMap entries for deleted assays.

**Lesson:** These warnings are expected and harmless. The reduced RDS works correctly in Step 7 (only accesses `protein` assay).

### Hydration Mismatch in Wizard Layout

**Problem:** `getSessionIdFromURL()` used `typeof window === 'undefined'` check — server rendered empty `session=""`, client rendered actual session ID. React hydration mismatch.

**Fix:** Use `useState('')` + `useEffect(() => setSessionId(...), [])` so the initial render (empty) matches SSR.

## Shared Reports Are Bearer Capabilities

**Problem:** A predictable report ID in a URL is not access control, and serving
the report viewer through the normal application shell exposes navigation to
private workflows even if individual buttons are disabled.

**Fix:** Give every report a separate 256-bit share token, resolve shared data
only below `/api/shared-reports/{share_token}`, remove private shell components
on shared pages, and enforce the same separation at the production reverse
proxy. Keep management on a loopback-only listener reached by SSH.

**Lesson:** A UI-only restriction is not a security boundary. Separate identifiers,
backend routers, frontend scope, and gateway routes must all express the same
capability boundary. Because capability URLs grant access, support rotation and
keep full URLs out of referrers, caches, and access logs.
