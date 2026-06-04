# Comprehensive Test Suite Design

**Date:** 2026-06-04
**Status:** Approved
**Branch:** main

## Problem

The current test suite (223 backend tests, 4 E2E specs, 1 frontend unit test) does not ensure correct functionality across all features — core data analysis, visualization, session management, and study export. Major gaps exist in service layer tests, API route coverage, frontend component/store tests, and E2E scenarios.

## Approach

**Layered Bottom-Up:** Build tests foundation-first: services → routes → frontend → E2E. Each layer stabilizes the next.

- Services tested in isolation (no R subprocess, no disk I/O, no HTTP)
- Routes tested with mocked dependencies (verify HTTP contract)
- Frontend tested with vitest + React Testing Library
- E2E tested with existing Playwright helpers

## Current Coverage (Baseline)

- **Backend unit:** 14 files, ~150 tests — DataProcessor, validators, session API (viz state), task manager, compare service, report store/generator, bionet service, GSEA cache, MSstats batched, file parser, session model
- **Backend integration:** 8 files, ~70 tests — Session CRUD, config, upload, processing, R integration, pipeline performance (msqrob2 + MSstats), viz state, BioNet routes, compare API, report routes
- **Frontend:** 1 file (sessionStore)
- **E2E:** 4 specs — wizard happy path, error validation, pipeline results, report export (mostly skipped)

## Phase 1: Service Layer

Goal: Every service tested in isolation — mock R subprocess, file I/O, and session store.

### New files (11)

| File | Key Test Targets |
|------|-----------------|
| `test_pipeline_engine.py` (~25 tests) | Step execution, PipelineState lifecycle (pending→running→completed/failed), progress callbacks, error recovery, step skipping, cancellation mid-step |
| `test_processing_orchestrator.py` (~20 tests) | Session validation (min files, config required), config→AnalysisConfig mapping, error→ERROR transition, completion→COMPLETED |
| `test_session_manager.py` (~18 tests) | Session scanning, state transitions, WebSocket message formatting, session cleanup, duplicate handling |
| `test_qc_calculator.py` (~15 tests) | PCA from abundance matrix, p-value distribution binning, CV computation, data completeness percentages, boxplot quartile calculation, PSM count correction (MAJ-005 regression) |
| `test_compound_service.py` (~12 tests) | SMILES validation, property parsing, condition-based compound listing, image path resolution |
| `test_base_r_wrapper.py` (~15 tests) | Subprocess invocation with args, stdout/stderr capture, encoding fallback (UTF-8→latin-1), timeout handling, error message extraction |
| `test_gsea_service.py` (~12 tests) | Running ES curve algorithm, heatmap z-score computation, GMT file parsing, result serialization, prerank gene list construction |
| `test_pipeline_registry.py` (~8 tests) | msqrob2 step definitions (5 steps), MSstats step definitions (8 steps), step ordering, handler registration |
| `test_organism_scanner.py` (~6 tests) | FASTA file scanning, naming convention handling ({org}.fasta vs {Org}_Sequence.fasta), gene mapping file matching, organism_exists |
| `test_msqrob2_wrapper.py` (~8 tests) | R command construction for QFeatures pipeline, argument ordering, output path handling |
| `test_msstats_wrapper.py` (~8 tests) | R command construction for MSstats pipeline, argument ordering, output path handling |

### Extended (1)

| File | Added Tests |
|------|------------|
| `test_compare_service.py` | UMAP dimensionality reduction, t-SNE, Venn diagram set computation, hierarchical clustering, comparison heatmap matrix building (+10 tests) |

### New conftest.py fixtures

- `mock_subprocess_run` — returns realistic R script output
- `mock_session_with_config` — fully configured session
- `sample_abundance_matrix` — numeric matrix for QC calculator
- `sample_gene_sets` — GMT-style gene sets for GSEA curve tests

**Total: ~157 tests**

## Phase 2: API Routes + WebSocket

Goal: Every endpoint tested for happy path + error cases + edge cases. Mock session store and services; verify HTTP contract (status codes, response shapes, error codes).

### New files (8)

| File | Endpoints | Key Cases |
|------|-----------|-----------|
| `test_processing_routes.py` (~18 tests) | `POST /process`, `POST /cancel`, `POST /retry`, `GET /logs` | State transitions, queue handling, validation errors (missing config, too few files), cancel event signaling |
| `test_visualization_routes.py` (~22 tests) | `GET /results`, `GET /qc/plots`, `GET /protein/{pid}/abundance`, `GET /protein/{pid}/peptide`, `GET /tasks`, `POST /tasks/cancel` | Pagination math, sort/filter/search, per-comparison results, Parquet/TSV fallback, normalization coefficients |
| `test_gsea_routes.py` (~15 tests) | `POST /run`, `GET /status`, `GET /{db}`, `GET /{db}/plot`, `GET /{db}/heatmap` | Background task spawning, status file + TaskManager dual check, database validation, GMT fallback paths, gene rank ordering |
| `test_bionet_routes.py` (~12 tests) | `POST /run`, `GET /status`, `GET /subnetwork` | Task dispatch, status file recovery (server_restarted), JSON structure validation |
| `test_compare_routes.py` (~15 tests) | `POST /protein-correlation`, `POST /comparison-correlation`, `POST /venn`, `GET /proteins`, all status + result endpoints | Task dispatch, Venn size validation (2-3 only), result structures, fallback protein selection |
| `test_websocket.py` (~12 tests) | `WS /ws/sessions/{id}` | Connection lifecycle (accept→subscribe→messages→disconnect), ping/pong keepalive, historical log replay on subscribe, progress replay for completed steps, completion message format, graceful disconnect cleanup |
| `test_compounds_routes.py` (~8 tests) | `GET /compounds`, `GET /{cond}`, `GET /{cond}/image`, `GET /{cond}/properties`, `POST /validate` | No compound file (empty/404), SMILES validation counts, Content-Type for SVG/PNG |
| `test_report_routes.py` (~8 tests) | `PATCH /reports/{rid}`, `POST /reports/{rid}/gsea/run`, `POST /reports/{rid}/bionet/run`, `POST /reports/{rid}/compare/*`, `GET /reports/{rid}/protein/{pid}/peptide` | Only endpoints NOT covered by existing `test_report_routes.py` integration test. Lock-based concurrency, thin wrapper delegation |

### Extended (2)

| File | Added Tests |
|------|------------|
| `test_sessions_api.py` | `PUT /{id}` session update, `PUT /{id}/config` with pipeline selection (+5 tests) |
| `test_api.py` | `DELETE /{id}/files/{type}/{filename}`, `POST /upload/compound`, `GET /api/organisms` (+6 tests) |

### Notes on existing coverage

- `test_report_routes.py` (integration) already covers: empty list, generate+view all endpoints, reject non-completed, survive deletion, 404. Do NOT duplicate.
- `test_bionet_routes.py` (integration) has only 3 thin 404 tests. Our unit tests complement — not duplicate.
- `test_compare_api.py` (integration) has only 4 thin tests. Our unit tests complement — not duplicate.

**Total: ~121 tests**

## Phase 3: Frontend

Goal: Test all Zustand stores, API client, WebSocket hook, utils (critical math), and key visualization components. Pattern: `vitest` + `@testing-library/react`.

### Store tests (3 new)

| File | Tests |
|------|-------|
| `stores/__tests__/analysis-store.test.ts` (~10 tests) | Pipeline selection, config parameters (msqrob2 vs MSstats), organism, comparisons, reset |
| `stores/__tests__/processing-store.test.ts` (~12 tests) | Step progress tracking, WebSocket message handling, queue position updates, completion/error transitions, cancel state |
| `stores/__tests__/ui-store.test.ts` (~8 tests) | Sidebar open/close, toast queue (add/remove/auto-dismiss), modal open/close, loading state |

### Hook test (1 new)

| File | Tests |
|------|-------|
| `hooks/__tests__/use-websocket.test.ts` (~8 tests) | Connection lifecycle, reconnection on error, message parsing, cleanup on unmount |

### Library tests (2 new)

| File | Tests |
|------|-------|
| `lib/__tests__/api-client.test.ts` (~10 tests) | Session CRUD calls, upload batching (5-file group logic), error response handling, config update, GSEA/BioNet trigger |
| `lib/__tests__/utils.test.ts` (~15 tests) | `isSignificantVolcano` — hyperbolic S0-factor cutoff (rectangular mode s0=0, hyperbolic mode s0>0, boundary conditions), `transformPCARowBased`, `exportToCSV` (quote escaping), `formatNumber` (scientific notation boundary), `formatPValue`, `parseDelimited`, `formatGroup`, `formatComparisonKey` |

### Component tests (2 new)

| File | Tests |
|------|-------|
| `components/__tests__/VolcanoPlot.test.tsx` (~8 tests) | Renders with data, empty data (EmptyState), logFC/p-value axis labels, point coloring by significance, handles NaN/inf gracefully |
| `components/__tests__/ProteinTable.test.tsx` (~8 tests) | Sort by column, pagination controls, search filter, gene name display, significant badge |

### New frontend test utilities

- `src/test/test-utils.tsx` — custom render with store providers, mock API context
- `src/test/factories.ts` — `makeSession()`, `makeDEResult()`, `makeProteinData()` factory functions

**Total: ~79 tests**

## Phase 4: E2E

Goal: Comprehensive Playwright specs for features not yet covered. Uses existing `helpers.ts` patterns.

### New specs (4)

| File | Scenarios |
|------|-----------|
| `04-gsea-analysis.spec.ts` (~6 scenarios) | Open GSEA tab → select database (KEGG/GO) → view pathway table → click pathway → enrichment plot renders → heatmap renders → verify pagination |
| `05-bionet-network.spec.ts` (~5 scenarios) | Open BioNet tab → trigger analysis → poll until complete → network graph renders → click node → protein detail shows → verify interaction edges |
| `06-compare-correlation.spec.ts` (~6 scenarios) | Select protein → run protein correlation → PCA/UMAP cluster renders → similar proteins table → comparison heatmap → Venn diagram (2-3 comparisons) |
| `07-session-lifecycle.spec.ts` (~5 scenarios) | Create → upload → configure → start processing → cancel mid-run → verify CANCELLED → retry → verify re-processing → delete → verify cleanup. Also: create→configure→delete (never processed), list sessions with mixed states |

### Extended (1)

| File | Added Scenarios |
|------|----------------|
| `report-export.spec.ts` | Generate report from completed session → verify report page loads → verify DE results render → verify GSEA/BioNet tabs work → rename report → delete report (+3 scenarios) |

**Total: ~25 scenarios**

## Summary

| Phase | New Files | Extended Files | Tests |
|-------|-----------|----------------|-------|
| 1. Services | 11 | 1 | ~157 |
| 2. Routes + WebSocket | 8 | 2 | ~121 |
| 3. Frontend | 8 | 0 | ~79 |
| 4. E2E | 4 | 1 | ~25 |
| **Total** | **31** | **4** | **~382** |

Current: 223 backend + ~15 E2E scenarios + 1 frontend file ≈ ~240 tests.
After: ~620 tests total.

## Testing Conventions

- **Backend unit:** `pytest` + `unittest.mock` — mock R subprocess, file I/O, session store
- **Backend integration:** FastAPI `TestClient` with real JSON session store, mock only R calls
- **Frontend:** `vitest` + `@testing-library/react` + `@testing-library/jest-dom` (already configured)
- **E2E:** Existing Playwright setup with shared helpers from `Tests/e2e/helpers.ts`
- **Test location:** ALL tests in `Tests/` directory (backend) or co-located `__tests__/` (frontend)
- **One thing per file:** Route tests test endpoints. Service tests test logic. Component tests test rendering.

## Key Decisions

1. **WebSocket testing is included** — Critical gap found during review. The 150-line WebSocket endpoint has zero tests; frontend real-time updates depend on it.
2. **Report route tests are reduced** — Existing integration test already covers 6 scenarios well. Only missing endpoints added.
3. **Frontend utils.ts tested** — `isSignificantVolcano` (hyperbolic S0 algorithm) is more valuable than component tests.
4. **Component tests reduced to 2** — VolcanoPlot and ProteinTable. FileUploadZone better tested via E2E. ConfigPanel is mostly wiring.
5. **Organism scanner and R wrappers added** — Gaps found during verification review.
