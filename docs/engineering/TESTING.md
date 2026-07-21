# Testing standard

Tests provide decision-quality evidence for scientific correctness, workflow continuity, API compatibility, state/recovery, data safety, shared-report isolation, and user-visible behavior. Test count and repository-wide coverage are diagnostics, not goals.

## Test qualities

A useful test protects observable behavior, fails for the relevant defect, runs at the cheapest reliable layer, is isolated/repeatable, and rejects plausible wrong results. A bug fix requires a reproducer. Prefer output values, state transitions, artifacts, API contracts, and rendered behavior over private implementation inspection.

## Layers

| Layer | Location | Contract |
|---|---|---|
| Backend unit | `Tests/backend/unit/` | No network/live services; temporary roots only |
| Backend integration | `Tests/backend/integration/routes/` | Real FastAPI/store/filesystem boundaries, still hermetic |
| R smoke | `Tests/backend/integration/pipeline/test_r_integration.py` | Required package/environment availability |
| Scientific live | `Tests/backend/integration/pipeline/*_pipeline_e2e.py` | Isolated API, representative fixtures, known answers |
| Frontend unit/component | `frontend/src/**/*.test.ts(x)` | Rendered behavior, actions, stores, fetch boundaries |
| Browser | `frontend/e2e/` | A small set of critical journeys, including a real isolated stack |
| Performance | `performance` marker | Explicit lane, never the default gate |

## Standard gate

```powershell
backend\.venv\Scripts\python.exe -m ruff check backend Tests
backend\.venv\Scripts\python.exe backend\scripts\generate_openapi.py --check
backend\.venv\Scripts\python.exe -m pytest
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
```

Additional R and browser commands are in [Development and verification](../DEVELOPMENT.md). A green unit suite with a stale OpenAPI document, failed build, or broken real-stack contract is not a passing application gate.

## Scientific evidence

- Create controlled fixture signals rather than copying current output as the oracle.
- Assert effect direction/magnitude plus finite values, unique IDs, probability bounds, and adjusted-p-value invariants.
- TMT and DIA have committed representative known-answer lanes.
- PTM is supported with backend/frontend regression coverage and real-data end-to-end verification. A committed representative PTM known-answer pipeline lane remains necessary before claiming equivalent automated scientific qualification.
- Cross-language tests verify artifact names, columns, identifier meaning, numeric types, and missing-value encoding.

## Isolation and shared reports

Never read `SampleData`, `real_sample_files`, normal runtime roots, or a developer/production service. Tests get temporary session, report, library, reference, and cache roots. External capability requirements use explicit markers and remain outside the hermetic default unless provisioned.

Shared-report coverage proves atomic publication, token rotation, survival after source-session deletion, denial of private routes, bounded protein computations, and the absence of private navigation. PTM report coverage verifies read-only Volcano/QC behavior, available result layers, site data, QC, and download.

## Browser scope

Keep Playwright focused on high-value journeys: routing, upload/config restoration, processing state, result navigation, and protein/PTM report shells. Scientific numeric correctness belongs below the browser layer. Visually inspect changed supported viewports; screenshots supplement behavior assertions rather than replace them.
