# 07 - Testing

## Test Organization

ALL tests go in `Tests/`. Never create `backend/tests/` or `frontend/tests/`.

```
Tests/
├── conftest.py               # Shared pytest fixtures (pipeline_test_files, sample_psm_data, etc.)
├── backend/
│   ├── unit/
│   │   ├── test_pipeline_chains.py     # FULL pipeline E2E: all steps (Python real, R mocked)
│   │   ├── test_pipeline_engine.py     # PipelineState + PipelineEngine.run() tests
│   │   ├── test_pipeline_registry.py   # Pipeline definitions + handler independence
│   │   ├── test_processing_orchestrator.py  # Orchestrator + process_session() tests
│   │   ├── test_data_processor.py      # DataProcessor step methods
│   │   ├── test_validators.py, test_sessions_api.py, test_gsea_cache.py, ...
│   │   └── test_processing_routes.py   # API routes including cancel flow
│   └── integration/          # test_api.py, test_processing.py, test_r_integration.py, ...
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

## Pipeline Testing Patterns

### Chain Tests (`test_pipeline_chains.py`)
Run ALL pipeline steps sequentially through a shared `StepContext`. Python steps use real `DataProcessor`; R steps are mocked to create expected output files. This catches cross-step state corruption (e.g., `ctx.df` freed too early).

### Pipeline Test Fixture (`pipeline_test_files`)
Generates ~1000-row PSM CSV files (2 conditions × 3 replicates, shared PSMs) with multi-protein accessions, contaminants, and No Value rows. Used by chain tests to exercise all `DataProcessor` filtering logic.

### PipelineEngine.run() Tests
Use `AsyncMock` step handlers to verify the execution loop: success, error, timeout retry, cancellation, progress callbacks. The `run()` method was previously 0% covered.

### Handler Independence Tests
Verify each pipeline uses its own step 1-2 handler functions (not shared). Changing one pipeline's handler must never affect the other.

## Coverage Targets

| Module | Target |
|--------|--------|
| Backend services | 80% |
| API routes | 90% |
| Utility functions | 90% |
| E2E critical paths | 100% |
| PipelineEngine.run() | Covered |
| ProcessingOrchestrator.process_session() | Covered |
| Pipeline chain (all steps) | Covered |
