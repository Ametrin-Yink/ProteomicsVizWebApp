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

## Visual Confirmation Rule

Automated test assertions are necessary but not sufficient. For every UI feature:

1. Navigate to page manually using browser automation
2. Perform the actions described in tests
3. Take screenshots at key steps (before, during, after)
4. Visually inspect: UI elements present, data displayed correctly, no broken layouts
5. Document findings

**Non-negotiable:** If visual confirmation fails, the test fails. If UI is misaligned, the test fails. If data is not displayed, the test fails. Screenshots don't lie — they show the actual rendered state.
