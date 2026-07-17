# 07 - Testing Standard

The test suite exists to provide decision-quality evidence that released behavior
works. Test count and repository-wide coverage percentages are diagnostics, not
goals.

## First principles

A good test:

1. Protects an observable product, scientific, safety, or recovery requirement.
2. Fails when that requirement is broken, not merely when code is reorganized.
3. Runs at the cheapest layer that can detect the failure reliably.
4. Is deterministic, isolated, and safe to run repeatedly.
5. Has assertions strong enough to reject plausible wrong results.

Prefer output values, state transitions, persisted artifacts, API contracts, and
user-visible behavior. Avoid tests that only inspect private attributes, function
source text, implementation identity, or whether a supplied value can be read
back from a model.

## Risk model

Coverage must be planned around these risks:

| Risk | Required evidence |
|------|-------------------|
| Scientific correctness | Small known-answer datasets, numeric invariants, Python/R artifact contracts |
| Workflow continuity | Input -> configuration -> processing -> results tests |
| API compatibility | Generated OpenAPI drift check and frontend API-client behavior tests |
| State and recovery | Queue, retry, cancel, restart, persistence, and rollback tests |
| Data safety | Isolated roots, path-boundary tests, collision and atomicity tests |
| UI behavior | Component tests for states/errors and a few critical browser journeys |
| Performance | Separate representative-data tests with explicit resource expectations |

Every released critical behavior must have an owner test at the lowest reliable
layer. The release-quality scope is TMT and DIA. PTM is explicitly omitted from
this test standard and must not be inferred to be release-qualified.

## Test layers

| Layer | Location | Rules |
|-------|----------|-------|
| Backend unit | `Tests/backend/unit/` | No network or live services; temporary filesystem only |
| Backend integration | `Tests/backend/integration/routes/` and `test_file_library_e2e.py` | Real FastAPI/store/filesystem boundaries, still hermetic |
| R smoke | `Tests/backend/integration/pipeline/test_r_integration.py` | Marked `r`; verifies the scientific environment, not statistical correctness |
| Live scientific system | `Tests/backend/integration/pipeline/*_pipeline_e2e.py` | Marked `live`, `r`, and `slow`; isolated API process and filesystem roots |
| Frontend unit/component | Colocated `*.test.ts(x)` under `frontend/src/` | Test behavior through rendered output, actions, stores, and fetch boundaries |
| Browser critical journeys | `frontend/e2e/` | Small Playwright layer; mocked UI states plus one isolated real frontend/backend contract |
| Performance | Tests marked `performance` | Never part of the default PR gate |

Frontend unit/component and browser tests stay with the frontend toolchain.
Backend, cross-stack, and fixture tests remain under `Tests/`.

## Required commands

Run from the repository root unless noted otherwise.

```powershell
# Hermetic backend PR suite (the default pytest selection)
backend/.venv/Scripts/python.exe -m pytest

# R environment smoke check
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/pipeline/test_r_integration.py

# TMT/DIA scientific release gate: R smoke plus both isolated live pipelines
backend/.venv/Scripts/python.exe -m pytest -m r Tests/backend/integration/pipeline

# Frontend unit/component suite
npm --prefix frontend test

# Browser critical journeys
npm --prefix frontend run test:e2e
```

The PR gate also requires Ruff, the generated OpenAPI drift check, ESLint,
TypeScript, a production frontend build, and the isolated real-stack browser
contract. A green unit suite with a failing contract or build is not a passing
application gate. A TMT/DIA release is not qualified unless the scientific
release command above also passes in an environment with the required R packages.

## Scientific known answers

- Known-answer directions and magnitude bounds must come from controlled signals
  injected into isolated fixture copies, not copied from current pipeline output.
- Change only the targeted fixture cells so the parser still receives the
  committed vendor-export shape.
- The TMT contract anchors positive P00352 and negative P25815 effects for
  INCB224525_4h versus DMSO_24h.
- The DIA contract anchors positive P13010 and negative P62424 effects for Drug2
  versus DMSO.
- Every differential-expression table must also satisfy finite-effect, unique-ID,
  probability-bound, and adjusted-p-value invariants.
- Controlled anchors must remain significant after multiple-testing adjustment;
  output direction alone is not a sufficient scientific oracle.

## Isolation and fixture rules

- Never read from `SampleData/` or write to runtime session/file-library roots.
- Backend tests receive isolated session and file-library directories from
  `Tests/conftest.py`.
- Use tiny purpose-built fixtures for correctness and API tests.
- Use the committed 10K-row fixtures only for scientific integration or
  performance checks.
- A test requiring R, internet, or another external dependency
  must be explicitly marked and excluded from the default suite.
- Browser and live scientific fixtures must start their own isolated services;
  tests must never attach to a developer's existing backend.
- Skips must describe an optional environment capability. Required PR tests do
  not skip.

## Assertion and maintenance rules

- Assert meaningful outputs, schemas, and invariants, not just status 200 or
  `is not None`.
- A regression test must reproduce the original failure before the fix.
- Contract tests should use non-default values so silent fallback is detectable.
- Expected warnings must be asserted or narrowly filtered; unexpected warnings
  fail the quality standard.
- Consolidate repetitive cases with parameterization when failure diagnostics
  remain clear.
- Delete a stale test only after confirming that it protects no current
  requirement or after replacing it with a stronger behavior test.
- Do not add parallel execution until runtime warrants the additional complexity.

## Browser scope

Playwright is a small integration cap, not the whole strategy. Keep approximately
three to five critical journeys. At least one journey must use the real isolated
FastAPI backend so routing, CORS, payload mapping, persistence, and frontend state
restoration are exercised together. Scientific numeric correctness belongs below
the browser layer.

For UI changes, inspect the rendered result at the supported viewport in addition
to automated assertions. Screenshots are evidence for visual layout, not a
substitute for behavioral assertions.

## Suite health targets

- Hermetic PR suite completes in under two minutes.
- Zero writes to user/runtime data.
- Zero unexpected warnings or required-test skips.
- Ten consecutive hermetic runs have zero intermittent failures.
- Changed critical code has direct behavior coverage.
- Periodically seed representative defects or use targeted mutation testing for
  configuration forwarding, filtering, QC, and file-safety logic.
