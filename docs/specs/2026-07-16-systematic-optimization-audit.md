# Systematic Optimization Audit

Date: 2026-07-16

## Scope and assumptions

- TMT/MSstats and DIA/msqrob2 are the production scientific workflows.
- PTM is an intentional placeholder. Its incomplete configuration, processing, and
  visualization paths are documented here but are not implementation defects for
  this effort.
- Scientific correctness, preservation of user data, and reproducibility take
  priority over throughput and cosmetic optimization.
- Changes should be narrow and backed by regression tests.

## Verification baseline

- Backend unit tests: 460 passed.
- Backend route integration tests: 41 passed.
- Frontend tests: 60 passed.
- Ruff, ESLint, TypeScript, and the network-enabled production build passed.
- R-backed end-to-end processing was not executed because `Rscript` was not
  available in the review environment.

## Findings and disposition

| Priority | Finding | Disposition |
| --- | --- | --- |
| Known gap | PTM workflow is incomplete end to end. | No action; intentional placeholder. |
| Critical | An empty file-library delete path resolves to the library root and can recursively delete it. | Fixed on `codex/fix-audit-gaps`; resolved-root deletion is rejected and regression-tested. |
| Critical | Production TMT/DIA and file-library uploads buffer whole files, can overwrite sanitized-name collisions, and store the original name although processing uses the saved path. | Fixed on `codex/fix-audit-gaps`; uploads are streamed, collision-safe, canonical, and request-atomic. PTM placeholder uploads remain out of scope. |
| Critical | Tests write sessions and task state into the real runtime store. | Fixed on `codex/fix-audit-gaps`; import-time stores and every test use temporary session roots. Five test-only runtime directories were identified by their fixed test UUIDs and removed. |
| High | Active analysis settings are absent from `SessionConfig` and are silently discarded. | Fixed on `codex/fix-audit-gaps`; unknown fields are rejected, model forwarding is automatic, and msqrob2 uses the shared peptide threshold. |
| High | Task timers set an event that production tasks do not observe; cancellation can kill unrelated R work. | Fixed on `codex/fix-audit-gaps`; deadlines return promptly, R subprocesses are session-owned, and a lingering worker retains session ownership until it exits. |
| High | CI masks pipeline failures, omits frontend tests/build, and skips R-backed E2E coverage. | Partially fixed; current jobs fail closed and now run backend lint/tests/contract plus frontend lint/typecheck/tests/build. A reproducible live-server R-backed HTTP E2E job remains open. |
| High | Python/R scientific dependencies are not fully locked. | Add Python and R lock files and record versions with analysis provenance. |
| High | The checked-in OpenAPI document is incomplete and stale. | Fixed on `codex/fix-audit-gaps`; FastAPI generates the checked-in contract and CI fails on drift. |
| High | Production frontend dependencies have one high and two moderate audit findings. | Upgrade in a controlled dependency-only change. |
| Medium | Recursive filesystem operations run directly in async request handlers. | Fixed for session/report deletion and report generation by moving coarse filesystem work to worker threads. |
| Medium | `pytest.ini` uses an invalid section name, so test settings and asyncio scope are ignored. | Fixed on `codex/fix-audit-gaps`; pytest now loads the intended configuration explicitly. |
| Medium | Session listing parses every session on a fixed 15-second poll. | Add lightweight indexed summaries/pagination and poll only active work. |
| Medium | Plotly delivery is large and the build downloads a Google font. | Partially fixed; the build now uses a local system-font stack and succeeds offline. Plotly bundle reduction remains open. |
| Medium | Whole-store Zustand subscriptions, effect suppressions, and unsafe casts violate project guidance. | Repair high-frequency components incrementally. |
| Medium | API error helpers can replace structured server errors with generic messages. | Consolidate response handling. |
| Medium | QC coefficient-of-variation calculation can overflow and collapse to zero-valued box statistics. | Fixed on `codex/fix-audit-gaps`; overflow is warning-free, all-invalid conditions are omitted, and mixed invalid values are counted. |
| Low | Mobile file-library controls and columns overflow at 390 px. | Fix after correctness and desktop workflow reliability. |
| Low | Heavy unused packages are mixed with runtime dependencies. | Remove verified unused packages and split runtime/dev dependencies. |

## Implementation order

1. Data safety: file-library deletion, isolated tests, and upload identity/streaming.
2. Scientific correctness: configuration contract and numerically stable QC.
3. Processing reliability: task-scoped timeout/cancellation and non-blocking I/O.
4. Delivery confidence: CI, dependency locks/audit, and generated API contract.
5. Performance and UX: session indexing, frontend payload/state, and mobile layout.

Each item is complete only when its regression tests pass and the full relevant
backend or frontend suite remains green.

## Current branch verification

- Backend unit, route, file-library, and non-HTTP pipeline integration: 536
  tests passed, including installed R/package checks. The two remaining NumPy
  warnings are the pre-existing small-sample degrees-of-freedom warnings.
- Frontend: 60 tests passed; ESLint, TypeScript, and the production build passed.
- The generated OpenAPI drift check and full Ruff check passed.
- Runtime sessions remained at 106 before and after the isolated regression run.
- The system-font build was visually checked at 1280 px: layout was preserved
  and there was no horizontal overflow.
