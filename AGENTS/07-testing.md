# 07 - Testing

## Test Organization

ALL tests go in `Tests/`. Never create `backend/tests/` or `frontend/tests/`.

```
Tests/
├── conftest.py               # Shared pytest fixtures
├── backend/
│   ├── unit/                 # test_validators.py, test_file_parser.py, test_data_processor.py, test_gsea_cache.py, test_session_model.py, test_sessions_api.py
│   └── integration/          # test_api.py, test_processing.py, test_r_integration.py, test_visualization_state.py
├── e2e/                      # Playwright E2E tests
│   ├── helpers.ts            # Shared helpers (uploadFiles, createSession, configureAnalysis, startAnalysis)
│   ├── 01-complete-analysis-flow.spec.ts    # Full pipeline: welcome → results
│   ├── 02-session-persistence.spec.ts       # Session lifecycle, rename, delete
│   ├── 03-config-variations.spec.ts         # 4 config combos + persistence + validation
│   ├── 04-error-handling.spec.ts            # Invalid files, missing columns, network errors
│   ├── 05-processing-recovery.spec.ts       # Cancel, retry, WebSocket reconnect
│   ├── 06-pdf-export.spec.ts               # PDF generation and download
│   ├── 07-queue-concurrency.spec.ts         # Concurrent session queue behavior
│   └── 08-session-manager-improvements.spec.ts  # Scan, multi-select, tabs
├── fixtures/                 # Test data CSVs
│   ├── compounds.csv
│   ├── PSM_SampleData_*.csv
│   └── test_*.tsv
└── downloads/                # Generated test downloads
```

## Running Tests

```bash
# Backend (from project root)
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration -v

# E2E (from Tests/)
cd Tests && npx playwright test
cd Tests && npx playwright test e2e/04-error-handling.spec.ts --headed
```

## Key Rules

1. **Human-like operations:** E2E tests must use `uploadFiles()` helper, not programmatic `setInputFiles()`
2. **SampleData-dependent tests:** Mark with `@pytest.mark.needs_sample_data` — auto-skip if `SampleData/` not present
3. **Visual confirmation:** Automated test assertions are necessary but not sufficient — verify UI renders correctly
4. **Fix before proceeding:** If a test fails, stop and fix it before moving on

## Coverage Targets

| Module | Target |
|--------|--------|
| Backend services | 80% |
| API routes | 90% |
| Utility functions | 90% |
| E2E critical paths | 100% |
