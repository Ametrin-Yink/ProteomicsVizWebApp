# ProteomicsVizWebApp — Verified Gap Fix Plan

**Generated:** 2026-06-10
**Scope:** Code quality, architecture, type safety, UX, accessibility, correctness bugs
**Excludes:** Deployment, Docker, CI/CD, auth, security headers — not at deployment stage

## Verification Summary

5 agents read the actual source code to verify 30 audit claims. Results:

| Verdict | Count |
|---------|-------|
| CONFIRMED | 24 |
| PARTIALLY CONFIRMED | 4 |
| FALSE POSITIVE | 1 (ProteinTable DOM overload — uses 25-row pagination) |
| **Actionable fixes** | **28** |

---

## Dependency Graph

```
                          ┌─────────────────────────┐
                          │   Phase 1: Foundation    │
                          │  (type consolidation,    │
                          │   API client merge,      │
                          │   store singleton,       │
                          │   registry isolation)    │
                          └───────────┬─────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
  │  Phase 2: Backend   │  │ Phase 3: Frontend   │  │  Phase 5: A11y      │
  │  (subprocess orphan,│  │ (error boundaries,  │  │  (can start after   │
  │   taskmgr race,     │  │  silent catches,    │  │   Phase 1; parallel │
  │   WS progress,      │  │  type casts,        │  │   with Phases 3-4)  │
  │   cleanup schedule, │  │  abort controller)  │  └─────────────────────┘
  │   asyncio refactor) │  └──────────┬──────────┘
  └─────────────────────┘             │
                         ┌───────────┘
                         ▼
              ┌─────────────────────┐
              │  Phase 4: UX Polish │
              │ (slider debounce,   │
              │  wizard nav,        │
              │  breadcrumbs,       │
              │  onboarding,        │
              │  responsive layout) │
              └─────────────────────┘
```

---

## Phase 1: Foundation (Dependency Roots)

These fixes have NO prerequisites. All subsequent phases depend on them.

### FIX-1.1: Consolidate duplicate `Session` type definitions (4 variants → 1)

- **Gap:** Four different Session-like shapes exist across 4 files, creating constant manual mapping with no compile-time safety.
- **Verified:** CONFIRMED. `types/index.ts:31-46`, `types/session.ts:71-90`, `types/api.ts:23-39`, `api-client.ts:25-47` each define different shapes.
- **Approach:**
  1. Designate `types/session.ts` `Session` as the canonical frontend type (it's the most complete, with `SessionStatus` union and typed sub-objects).
  2. Delete `types/index.ts` `Session` interface (replaced by re-export from `types/session.ts`).
  3. Delete `types/api.ts` `Session` interface (it's the backend wire format — keep it as `BackendSession` or remove entirely since `api-client.ts` already has its own `BackendSession`).
  4. Keep `api-client.ts` `BackendSession` as-is (it serves a distinct purpose: mapping the backend JSON shape). Add a `toFrontendSession(bs: BackendSession): Session` transformation function with proper type checking.
  5. Update all imports: `@/types` consumers get the canonical `Session` via re-export.
- **Files:** `frontend/src/types/index.ts`, `frontend/src/types/session.ts`, `frontend/src/types/api.ts`, `frontend/src/lib/api-client.ts`
- **Tests:** Verify `api-client.ts` `create()` and `get()` return objects that satisfy the canonical `Session` type. Run `npm run lint` and `npx tsc --noEmit`.
- **Effort:** M
- **Risk:** Low — type-only changes, caught at compile time.

### FIX-1.2: Remove duplicate `ApiResponse`/`ApiError` definitions

- **Gap:** `ApiResponse<T>` and `ApiError` defined identically in both `types/index.ts` and `types/api.ts`.
- **Verified:** CONFIRMED — byte-for-byte identical at `types/index.ts:9-25` and `types/api.ts:4-20`.
- **Approach:**
  1. Keep definitions in `types/index.ts` (already the barrel via `@/types`).
  2. Delete copies from `types/api.ts`.
  3. Re-export from `types/api.ts` if anything imports them from `@/types/api`.
- **Files:** `frontend/src/types/index.ts`, `frontend/src/types/api.ts`
- **Tests:** `npx tsc --noEmit` passes.
- **Effort:** S
- **Risk:** Minimal.

### FIX-1.3: Consolidate near-duplicate `SessionConfig` types

- **Gap:** `types/index.ts:48-99` and `types/api.ts:41-88` define near-identical `SessionConfig` with subtle differences (api.ts version missing `condition_column`, `covariate_columns`, `msqrob2_batch_column`).
- **Verified:** PARTIALLY CONFIRMED — two near-identical types. `analysis-store.ts` correctly imports from `types/index.ts` (no third duplication).
- **Approach:**
  1. Keep `types/index.ts` `SessionConfig` (more complete).
  2. Delete `types/api.ts` `SessionConfig`.
  3. If the backend wire format differs, add a `BackendSessionConfig` type in `api-client.ts` and a transformation function.
- **Files:** `frontend/src/types/index.ts`, `frontend/src/types/api.ts`
- **Tests:** `npx tsc --noEmit` passes.
- **Effort:** S
- **Risk:** Low — check all imports of `SessionConfig` from `@/types/api`.

### FIX-1.4: Merge two API clients into one

- **Gap:** `api-client.ts` (548 lines) and `api.ts` (476 lines) both define API surfaces with overlapping processing endpoints and different error handling patterns.
- **Verified:** CONFIRMED — `processingApi.getStatus` and `processingAPI.getStatus` both hit the same endpoint. `api-client.ts` uses `APIError` class; `api.ts` throws plain `Error`.
- **Approach:**
  1. Move all functions from `api.ts` into `api-client.ts`, following the object-oriented namespaced pattern (`sessionsApi.`, `processingApi.`, `visualizationApi.`).
  2. Standardize on `APIError` class for all error handling.
  3. Delete `api.ts`.
  4. Update all imports from `@/lib/api` to `@/lib/api-client`.
  5. Remove the redundant `processingAPI` object (its functions already exist in `processingApi`).
- **Files:** `frontend/src/lib/api-client.ts`, `frontend/src/lib/api.ts`, all consumers (~10 files)
- **Tests:** Run E2E tests. Verify no TypeScript errors.
- **Effort:** M
- **Risk:** Medium — touches many consumer files. Do as first change on a fresh branch.

### FIX-1.5: Make `get_session_store()` return singleton from `app.state`

- **Gap:** `deps.py` creates a fresh `SessionStore` on every request, while `main.py` already creates one at startup and stores it in `app.state.session_store` — the `app.state` instance is never used.
- **Verified:** CONFIRMED. `deps.py:7-10` instantiates new store per call. `main.py:64-65` stores one in `app.state` but no route uses it.
- **Approach:**
  1. Change `get_session_store()` to accept `request: Request` and return `request.app.state.session_store`.
  2. Remove the duplicate instantiation.
- **Files:** `backend/app/api/deps.py`
- **Tests:** Existing backend tests pass. Verify session CRUD still works.
- **Effort:** S
- **Risk:** Minimal — `SessionStore.__init__` has no side effects beyond `mkdir()`.

### FIX-1.6: Add test isolation to pipeline registry

- **Gap:** `pipeline_registry.py` calls `register()` at module import time (lines 38-96). `PIPELINES` is a mutable module-level dict with no reset mechanism. Tests that mutate `PIPELINES` leak to other tests.
- **Verified:** CONFIRMED. `pipeline_registry.py:19` — `PIPELINES: dict[str, PipelineDefinition] = {}` with no `reset()` or `clear()`.
- **Approach:**
  1. Add `reset_registry()` function that clears `PIPELINES` and re-registers defaults.
  2. Add a pytest fixture that calls `reset_registry()` before each test.
  3. Add `get_registry_snapshot()` that returns a deep copy for tests that need the default state.
- **Files:** `backend/app/services/pipeline_registry.py`, `Tests/backend/conftest.py`
- **Tests:** Write a test that mutates `PIPELINES`, calls `reset_registry()`, and verifies default state is restored.
- **Effort:** S
- **Risk:** Low.

### FIX-1.7: Expand `STEP_DISPLAY_NAMES` for msqrob2 pipeline

- **Gap:** `STEP_DISPLAY_NAMES` in `analysis.py:48-57` only defines names for steps 1-8 (MSstats-specific). msqrob2 steps 3-5 show incorrect MSstats display names.
- **Verified:** CONFIRMED. `backend/app/models/analysis.py:48-57` — entries 1-8, no msqrob2 variants.
- **Approach:**
  1. Add msqrob2-specific display names: `3: "Protein Abundance (msqrob2/QFeatures)"`, `4: "Differential Expression (msqrob2)"`, `5: "QC Metrics (msqrob2)"`.
  2. Make `STEP_DISPLAY_NAMES` a function that accepts `pipeline_tool` and returns the correct names per pipeline.
  3. Or: use a dict of dicts keyed by pipeline tool.
- **Files:** `backend/app/models/analysis.py`
- **Tests:** Unit test that verifies correct display names for both msqrob2 and MSstats pipelines.
- **Effort:** S
- **Risk:** Minimal.

---

## Phase 2: Backend Correctness (depends on Phase 1)

### FIX-2.1: Kill R subprocesses on task cancellation

- **Gap:** `cancel()` in `task_manager.py` only sets an `asyncio.Event` — no `process.kill()` or `process.terminate()`. R subprocesses keep running even after the task is cancelled.
- **Verified:** CONFIRMED. `task_manager.py:256-276` only signals event. `base_r_wrapper.py:425` blocks on `process.wait()` until R exits naturally. `PipelineEngine._check_cancelled` at `pipeline_engine.py:317-323` is only called between steps, not during.
- **Approach:**
  1. In `base_r_wrapper.py`, store the `subprocess.Popen` object on the wrapper instance (`self._process`).
  2. Add a `cancel()` method to `BaseRWrapper` that calls `self._process.kill()` and `self._process.wait()`.
  3. In `PipelineEngine._check_cancelled()`, before raising `ProcessingError`, call `step_handler.cancel()` if the handler has an active subprocess.
  4. In `task_manager.cancel()`, after setting the event, also call a cancel callback registered by the running task.
  5. In `main.py` lifespan shutdown, iterate active tasks and terminate their subprocesses.
- **Files:** `backend/app/services/base_r_wrapper.py`, `backend/app/services/pipeline_engine.py`, `backend/app/services/task_manager.py`, `backend/app/main.py`
- **Tests:** Test that cancelling a running pipeline kills the R process (check `process.poll()` is not None after cancel).
- **Effort:** M
- **Risk:** Medium — needs careful testing. R processes that are mid-write could leave corrupted intermediate files.

### FIX-2.2: Fix TaskManager race condition in queue pop

- **Gap:** Between queue position check (`line 185`) and `queue.pop(0)` (`line 187`), a concurrent `cancel()` can remove the task, causing the wrong task to be popped.
- **Verified:** CONFIRMED. `task_manager.py:162-187`. No lock protects the gap between `await` at line 175 and `pop(0)` at line 187.
- **Approach:**
  1. Add an `asyncio.Lock` per queue kind, shared between `submit()` and `cancel()`.
  2. Or: change the queue model — instead of `list.pop(0)`, use `asyncio.Queue` which is thread/async-safe.
  3. Or: use the existing per-session `session_lock` to also guard queue mutation, and add queue-level locking in `cancel()`.
  4. After `except StopIteration` in the wait loop, check `cancel_event.is_set()` and `continue` instead of proceeding.
- **Files:** `backend/app/services/task_manager.py`
- **Tests:** Concurrent submit+cancel test that verifies the correct task is popped.
- **Effort:** M
- **Risk:** Medium — concurrency bugs are subtle. Use `asyncio.Queue` if possible (cleanest fix).

### FIX-2.3: Fix WebSocket progress calculation for msqrob2

- **Gap:** `main.py:316` hardcodes `overall_progress = int((len(completed_steps) / 9) * 100)`. msqrob2 has 5 steps, so progress maxes at ~55%.
- **Verified:** CONFIRMED for `main.py:316`. `pipeline_engine.py:344` default `9` is benign (callers always pass actual step count).
- **Approach:**
  1. In the WebSocket subscribe handler, look up the pipeline definition's actual step count: `pipeline = get_pipeline(session_pipeline_tool); total = len(pipeline.steps)`.
  2. Replace the hardcoded `9` with `total`.
- **Files:** `backend/app/main.py`
- **Tests:** Test WebSocket subscribe for msqrob2 sessions returns correct progress.
- **Effort:** S
- **Risk:** Minimal.

### FIX-2.4: Schedule session cleanup on startup

- **Gap:** `cleanup_old_sessions()` is fully implemented at `session_store.py:383-411` but never called.
- **Verified:** CONFIRMED. No reference to `cleanup_old_sessions` anywhere outside its definition.
- **Approach:**
  1. Call `cleanup_old_sessions()` in `main.py` lifespan startup, after session scanning.
  2. Optionally: add a background `asyncio.Task` that runs cleanup every 24 hours.
- **Files:** `backend/app/main.py`
- **Tests:** Test that old sessions are cleaned up on startup.
- **Effort:** S
- **Risk:** Minimal.

### FIX-2.5: Refactor `asyncio.run()` in thread pool workers

- **Gap:** `processing.py:373-378` and `visualization.py:1184-1197` wrap pipeline/GSEA execution in `asyncio.run()` functions passed to `ThreadPoolExecutor`. Creates nested event loops, requires `threading.Lock` workarounds for file writes.
- **Verified:** CONFIRMED. Two locations. Comment at `visualization.py:1020` acknowledges the pattern. `threading.Lock` at `visualization.py:1014-1033` is the workaround.
- **Approach:**
  1. Option A (safer): Restructure the orchestrator to not require an event loop — make `process_session()` a synchronous function that uses `subprocess.run()` or `asyncio.to_thread()` internally. The thread pool worker calls it directly.
  2. Option B (less invasive): Keep the pattern but extract the common "run async in thread" logic into a helper, add proper cleanup, and document the constraints.
  3. Remove the `threading.Lock` workaround if Option A is chosen (file I/O becomes synchronous in the worker thread, no contention with the main event loop).
- **Files:** `backend/app/api/routes/processing.py`, `backend/app/api/routes/visualization.py`, `backend/app/services/processing_orchestrator.py`, `backend/app/services/gsea_service.py`
- **Tests:** Run full pipeline e2e. Verify no event loop leaks.
- **Effort:** L
- **Risk:** High — touches the core async boundary. Do Option B first, then Option A in a follow-up.

---

## Phase 3: Frontend Core (depends on Phases 1-2)

### FIX-3.1: Add error boundaries

- **Gap:** No React Error Boundary exists anywhere in the frontend. Any rendering crash whitescreens the entire app.
- **Verified:** CONFIRMED. Grep for `ErrorBoundary` returned zero results.
- **Approach:**
  1. Create `frontend/src/components/ui/ErrorBoundary.tsx` with:
     - `componentDidCatch` that logs to console and optionally to an error aggregator
     - Fallback UI showing "Something went wrong" with a "Reload" button
     - Support for per-section custom fallback via `fallback` prop
  2. Wrap children in `layout.tsx` with a top-level `<ErrorBoundary>`.
  3. Add per-page error boundaries in:
     - `visualization/page.tsx` (Plotly crashes)
     - `visualization/bionet/page.tsx` (Cytoscape crashes)
     - `upload/page.tsx` (file parsing crashes)
- **Files:** `frontend/src/components/ui/ErrorBoundary.tsx` (new), `frontend/src/app/layout.tsx`, visualization pages
- **Tests:** Write a test component that throws, verify fallback renders.
- **Effort:** S
- **Risk:** Minimal.

### FIX-3.2: Fix silent error catches with user feedback

- **Gap:** `page.tsx:59-61` — empty `catch` block on session creation failure. `visualization/page.tsx:265` — second silent catch.
- **Verified:** CONFIRMED. `page.tsx:59-60` has `catch { // Error silently handled }`. `visualization/page.tsx:265` has `catch { /* silently fail */ }`.
- **Approach:**
  1. In `page.tsx` `handleNewAnalysis`: add `addToast('error', 'Failed to create session: ' + (e instanceof Error ? e.message : 'Unknown error'))` in the catch block. Add `console.error('Session creation failed:', e)`.
  2. In `visualization/page.tsx`: add a toast notification and console.error in the catch block.
  3. Audit all other `catch` blocks for silent failures.
- **Files:** `frontend/src/app/page.tsx`, `frontend/src/app/analysis/visualization/page.tsx`
- **Tests:** Mock API failure, verify toast appears.
- **Effort:** S
- **Risk:** Minimal.

### FIX-3.3: Eliminate `as unknown as` casts in visualization-modules

- **Gap:** 6 instances of `buildXxxExport(...) as unknown as Record<string, unknown>` in `visualization-modules.ts`.
- **Verified:** CONFIRMED. Lines 71, 91, 115, 132, 151. Plus 2 `(s as Record<string, unknown>).markers` at lines 66-68, 147-148.
- **Approach:**
  1. Create a union type: `type ExportData = VolcanoFigureExport | QcFigureExport | GseaFigureExport | CompareFigureExport | BioNetFigureExport`.
  2. Change `ExportState.data` from `Record<string, unknown>` to `ExportData`.
  3. Remove all 6 `as unknown as` casts.
  4. Fix the `.markers` access: add `markers` to the relevant export type or use a typed accessor.
- **Files:** `frontend/src/config/visualization-modules.ts`, `frontend/src/lib/figures/*.ts`
- **Tests:** `npx tsc --noEmit` passes. Export flow E2E test.
- **Effort:** M
- **Risk:** Medium — requires coordination across figure export types and ExportState.

### FIX-3.4: Rename reserved-word property names

- **Gap:** `ProcessingStepDef` uses `package: string` (line 17) and `function: string` (line 18) — both reserved words.
- **Verified:** CONFIRMED. `frontend/src/types/processing.ts:17-18`.
- **Approach:**
  1. Rename `package` → `module` (it holds display strings like "Python/Pandas").
  2. Rename `function` → `method` or `functionName` (it holds display strings like "pd.concat()").
  3. Update all references in `PROCESSING_STEPS` array and any component that accesses these properties.
- **Files:** `frontend/src/types/processing.ts`, `frontend/src/components/processing/LogPanel.tsx` (and any other consumers)
- **Tests:** `npx tsc --noEmit` passes.
- **Effort:** S
- **Risk:** Minimal — property rename, caught at compile time.

### FIX-3.5: Add AbortController support to API client

- **Gap:** Neither API client supports request cancellation. In-flight requests on page navigation consume bandwidth and can update unmounted component state.
- **Verified:** CONFIRMED by absence. No `AbortSignal` or `AbortController` anywhere in API client code.
- **Approach:**
  1. Add optional `signal?: AbortSignal` parameter to all API functions.
  2. Pass `signal` to `fetch()` calls.
  3. In hooks/components, create `AbortController` in `useEffect`, pass `signal` to API calls, and abort in cleanup.
- **Files:** `frontend/src/lib/api-client.ts` (after merge from FIX-1.4)
- **Tests:** Test that aborting a request throws `AbortError`.
- **Effort:** S
- **Risk:** Minimal.

---

## Phase 4: UX Polish (depends on Phase 3)

### FIX-4.1: Add debouncing to filter slider changes

- **Gap:** `Slider.tsx` fires `onChange` on every mousemove step. Each change triggers a full Plotly re-render via `setFilters`. During a drag, this fires 50+ times per second.
- **Verified:** CONFIRMED. `Slider.tsx:17-18` — no debounce/throttle. `FilterPanel.tsx:61,91,124,160` — no debounce wrapper. `visualization/page.tsx:493-494` — direct `setFilters`.
- **Approach:**
  1. Add a `useDebouncedValue` hook in `frontend/src/hooks/`.
  2. In `visualization/page.tsx`, wrap the incoming filter changes: debounce the Plotly update by 150ms while showing the slider value immediately (no visual lag on the slider UI).
  3. The backend save already has a 500ms debounce — keep that.
- **Files:** `frontend/src/hooks/use-debounce.ts` (new), `frontend/src/app/analysis/visualization/page.tsx`
- **Tests:** Simulate rapid slider changes, verify only one Plotly update fires.
- **Effort:** S
- **Risk:** Minimal.

### FIX-4.2: Fix wizard navigation history

- **Gap:** All wizard steps use `router.push()` for both forward and back navigation, polluting browser history. Browser back button cycles through intermediate states.
- **Verified:** PARTIALLY CONFIRMED. Forward navigation uses `push()` everywhere. Redirect guards correctly use `replace()`. Navigation works but history is messy.
- **Approach:**
  1. Change all forward navigation in wizard steps from `router.push()` to `router.replace()`.
  2. Keep backward navigation as `router.push()` (so browser back goes to the correct previous step).
  3. This way: browser back button goes straight from step N back to the previous page, not through every wizard step.
- **Files:** All 5 wizard pages in `frontend/src/app/new/*/page.tsx`
- **Tests:** E2E test: navigate through wizard, press browser back, verify correct landing.
- **Effort:** S
- **Risk:** Minimal.

### FIX-4.3: Add breadcrumbs / step indicator to wizard

- **Gap:** No visual indicator of current position in the 5-step wizard flow. User can't see which step they're on or how many remain.
- **Approach:**
  1. Create `frontend/src/components/analysis/WizardProgress.tsx` — a horizontal step indicator showing steps 1-5 with icons, labels, and status (completed/current/upcoming).
  2. Render it at the top of each wizard page.
- **Files:** `frontend/src/components/analysis/WizardProgress.tsx` (new), all `new/*/page.tsx`
- **Tests:** Visual verification. E2E test checks step indicator is present and correct.
- **Effort:** S
- **Risk:** Minimal.

### FIX-4.4: Add help tooltips to scientific parameters

- **Gap:** Most scientific parameters lack inline help. The `HelpCircle` + tooltip pattern already exists in `FilterPanel.tsx` lines 147-152 for the S0 parameter — it should be replicated.
- **Approach:**
  1. Add tooltips to: "Remove Razor Peptides", "Remove Low Quality", "Strict Filtering", "P-Value Threshold", "Log2 Fold Change Threshold", "Adjusted P-Value Threshold", and all config page parameters.
  2. Use the existing tooltip pattern (`HelpCircle` icon + hover tooltip).
- **Files:** `frontend/src/components/analysis/ConfigPanel.tsx`, `frontend/src/components/analysis/Msqrob2ConfigForm.tsx`, `frontend/src/components/analysis/MsstatsConfigForm.tsx`, `frontend/src/components/visualization/FilterPanel.tsx`
- **Tests:** Visual verification.
- **Effort:** M
- **Risk:** Minimal — content-only change.

### FIX-4.5: Make layout responsive

- **Gap:** No responsive breakpoints. Sidebar fixed at `w-80`. No mobile nav. No auto-collapse on small screens.
- **Verified:** CONFIRMED. `TopNavigation.tsx` — no breakpoints or hamburger. `SessionManager.tsx:277` — `w-80` fixed. `SidebarContext.tsx:18-28` — auto-collapse logic absent.
- **Approach:**
  1. Add `lg:` responsive breakpoints to sidebar: auto-collapse to `w-16` below `lg` breakpoint.
  2. Add hamburger menu button in `TopNavigation` visible below `lg` breakpoint.
  3. Add `overflow-x-auto` on main content area.
  4. Stack the flex layout vertically on small screens.
- **Files:** `frontend/src/app/layout.tsx`, `frontend/src/components/layout/TopNavigation.tsx`, `frontend/src/components/layout/SidebarContext.tsx`, `frontend/src/components/session/SessionManager.tsx`
- **Tests:** Visual verification at multiple viewport widths. E2E with viewport at 768px.
- **Effort:** M
- **Risk:** Medium — layout changes are visually impactful. Test across all pages.

---

## Phase 5: Accessibility (can start after Phase 1, parallel with Phases 3-4)

### FIX-5.1: Remove `maximum-scale=1` and `overflow-hidden`

- **Gap:** `layout.tsx:37` sets `maximumScale: 1`, violating WCAG 1.4.4 (blocks pinch-zoom to 200%). `layout.tsx:52` has `overflow-hidden` on body, clipping content at zoom.
- **Verified:** CONFIRMED. `layout.tsx:35-39` viewport export. `layout.tsx:52` body className.
- **Approach:**
  1. Change `maximumScale: 1` to `maximumScale: 5` (or remove it entirely — the browser default allows zoom).
  2. Change `overflow-hidden` to `overflow-auto` on the body.
  3. Fix any layout issues that emerge from allowing scroll (likely none — the `h-screen` constraint may need adjustment).
- **Files:** `frontend/src/app/layout.tsx`
- **Tests:** Test pinch-zoom on mobile. Test browser zoom to 200%.
- **Effort:** S
- **Risk:** Medium — may expose scroll layout bugs. Test thoroughly.

### FIX-5.2: Fix color contrast

- **Gap:** `--text-muted: #94a3b8` on white = ~2.7:1 (fails AA, needs 4.5:1). `--secondary: #00ADEF` on white = ~2.5:1 (fails AA). `--primary: #E73564` on white = ~4.1:1 (borderline, fails for normal text).
- **Verified:** CONFIRMED. `globals.css:9,12,27` define the problematic values.
- **Approach:**
  1. `--text-muted`: Change `#94a3b8` → `#64748b` (slate-500, contrast ~4.3:1 on white — improved, still borderline, consider `#475569` for full AA compliance at ~5.5:1).
  2. `--secondary`: Change `#00ADEF` → `#0078A8` or `#006B99` (darker cyan, contrast ~4.5:1 on white).
  3. `--primary`: Change `#E73564` → `#C42A52` (already used as `--primary-dark` in the theme — just swap it to be the primary and use `#E73564` as `--primary-light`).
- **Files:** `frontend/src/app/globals.css`
- **Tests:** Use axe DevTools or contrast checker to verify all three pass AA.
- **Effort:** M
- **Risk:** Medium — changes the app's visual identity. Get design sign-off.

### FIX-5.3: Add focus trapping to ExportModal

- **Gap:** ExportModal has no `role="dialog"`, no `aria-modal`, no focus trap, no Escape handler. Focus can tab behind the modal.
- **Verified:** CONFIRMED. `ExportModal.tsx:52` — bare `<div>` with `onClick={onClose}`. No ARIA attributes, no keyboard handlers.
- **Approach:**
  1. Replace the bare `<div>` wrapper with Radix UI's `Dialog` primitive (already in `package.json` as `@radix-ui/react-dialog`).
  2. OR: manually add `role="dialog"`, `aria-modal="true"`, `aria-labelledby={headingId}`, focus trapping via `useEffect` querying focusable elements, and Escape key handler.
  3. Add focus restoration to the trigger element when modal closes.
- **Files:** `frontend/src/components/visualization/ExportModal.tsx`
- **Tests:** Keyboard test: open modal, Tab/Shift+Tab, verify focus stays inside. Escape closes. Focus returns to trigger.
- **Effort:** M
- **Risk:** Medium if manual implementation; Low if using Radix Dialog.

### FIX-5.4: Add accessible alternative to BioNetNetwork canvas

- **Gap:** Cytoscape renders into an empty `<div>` with no ARIA attributes. Screen readers see nothing.
- **Verified:** CONFIRMED. `BioNetNetwork.tsx:427-431` — bare `<div>` with no role, aria-label, or tabindex.
- **Approach:**
  1. Add `role="img"` and `aria-label="Biological network graph showing {nodeCount} nodes and {edgeCount} edges"` to the Cytoscape container.
  2. Add a toggle button "View as table" that renders a data table of nodes and edges below the canvas.
  3. The table provides full keyboard + screen reader access to the network data.
- **Files:** `frontend/src/components/visualization/BioNetNetwork.tsx`
- **Tests:** Screen reader test. Keyboard test: can toggle to table view and navigate data.
- **Effort:** M
- **Risk:** Low — additive change, doesn't modify Cytoscape render.

### FIX-5.5: Add skip-to-content link

- **Gap:** No skip-navigation mechanism. Keyboard users must tab through the entire nav on every page. WCAG 2.4.1 failure.
- **Verified:** CONFIRMED. No skip link or component exists anywhere.
- **Approach:**
  1. Add a `<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to main content</a>` as the first focusable element in `layout.tsx`.
  2. Add `id="main-content"` to the main content container.
- **Files:** `frontend/src/app/layout.tsx`
- **Tests:** Keyboard test: Tab on page load, verify skip link appears and works.
- **Effort:** S
- **Risk:** Minimal.

### FIX-5.6: Add `prefers-reduced-motion` support

- **Gap:** No `@media (prefers-reduced-motion: reduce)` queries anywhere. Animations and transitions always play.
- **Verified:** CONFIRMED. Grep for `prefers-reduced-motion` returned zero results. CSS transitions defined at `globals.css:65-67`.
- **Approach:**
  1. Add to `globals.css`:
     ```css
     @media (prefers-reduced-motion: reduce) {
       *, *::before, *::after {
         animation-duration: 0.01ms !important;
         animation-iteration-count: 1 !important;
         transition-duration: 0.01ms !important;
         scroll-behavior: auto !important;
       }
     }
     ```
  2. For Plotly animations: detect `prefers-reduced-motion` in JS and pass `transition: { duration: 0 }` to Plotly config.
  3. For Cytoscape: pass `animate: false` when reduced motion is preferred.
- **Files:** `frontend/src/app/globals.css`, `frontend/src/components/visualization/BioNetNetwork.tsx`
- **Tests:** Enable reduced motion in OS settings, verify no animations.
- **Effort:** S
- **Risk:** Minimal.

### FIX-5.7: Add keyboard navigation to MultiSelect

- **Gap:** MultiSelect dropdown options have no arrow key navigation. Options are `<div>`s with `onClick` only.
- **Verified:** CONFIRMED. `Select.tsx:271-287` — options use `onClick` only. No `onKeyDown`, no arrow key handlers.
- **Approach:**
  1. Add `onKeyDown` handler to the dropdown container (`role="listbox"`):
     - ArrowDown/ArrowUp: move focus between options, update `aria-activedescendant` on the listbox.
     - Home/End: move to first/last option.
     - Enter/Space: toggle the focused option.
     - Escape: close dropdown, return focus to trigger.
  2. Or: replace the custom MultiSelect with Radix UI's `Select` with `type="multiple"` or use a well-tested headless library.
- **Files:** `frontend/src/components/ui/Select.tsx`
- **Tests:** Keyboard test: open MultiSelect, navigate with arrows, select with Enter, close with Escape.
- **Effort:** M
- **Risk:** Medium — complex interaction. Consider Radix UI migration.

---

## Summary: Total Fixes by Phase and Effort

| Phase | S | M | L | Total |
|-------|---|---|---|------|
| 1: Foundation | 4 | 2 | 0 | **6** |
| 2: Backend Correctness | 2 | 2 | 1 | **5** |
| 3: Frontend Core | 3 | 2 | 0 | **5** |
| 4: UX Polish | 4 | 2 | 0 | **6** |
| 5: Accessibility | 3 | 4 | 0 | **7** |
| **Total** | **16** | **12** | **1** | **29** |

---

## Topological Execution Order

```
1.  FIX-1.1 — Consolidate Session types
2.  FIX-1.2 — Remove duplicate ApiResponse/ApiError
3.  FIX-1.3 — Consolidate SessionConfig types
4.  FIX-1.4 — Merge API clients  ← THE key dependency fix
5.  FIX-1.5 — get_session_store singleton
6.  FIX-1.6 — Pipeline registry test isolation
7.  FIX-1.7 — STEP_DISPLAY_NAMES for msqrob2
8.  FIX-2.1 — Kill R subprocesses on cancel
9.  FIX-2.2 — TaskManager race fix
10. FIX-2.3 — WebSocket progress /9 fix
11. FIX-2.4 — Session cleanup schedule
12. FIX-2.5 — Refactor asyncio.run() (L effort — schedule carefully)
13. FIX-3.1 — Error boundaries
14. FIX-3.2 — Silent catches → toasts
15. FIX-3.3 — Eliminate as unknown as casts
16. FIX-3.4 — Rename reserved-word properties
17. FIX-3.5 — AbortController support
18. FIX-4.1 — Slider debouncing
19. FIX-4.2 — Wizard navigation (push→replace)
20. FIX-4.3 — Wizard breadcrumbs
21. FIX-4.4 — Scientific parameter tooltips
22. FIX-4.5 — Responsive layout
23. FIX-5.1 — Remove max-scale=1 + overflow-hidden
24. FIX-5.2 — Color contrast fixes
25. FIX-5.3 — ExportModal focus trapping
26. FIX-5.4 — BioNetNetwork ARIA
27. FIX-5.5 — Skip-to-content link
28. FIX-5.6 — prefers-reduced-motion
29. FIX-5.7 — MultiSelect keyboard nav
```

Items within the same phase can be parallelized. Items across phases must respect the dependency order shown in the graph.

---

## Items Explicitly EXCLUDED (False Positives or Deferred)

| Audit Claim | Reason Excluded |
|---|---|
| ProteinTable "loads 20K rows into DOM" | FALSE POSITIVE — uses client-side pagination, only 25 DOM rows |
| Dockerfile / containerization | Deferred — not at deployment stage |
| CI/CD pipeline | Deferred — not at deployment stage |
| Authentication / CSRF | Deferred — lab tool, local use |
| Security headers (CSP, HSTS) | Deferred — not at deployment stage |
| Rate limiting | Deferred — lab tool, local use |
| Structured logging / JSON logs | Deferred — nice-to-have for local dev |
| GSEA cache persistence | Deferred — local use, cache survives dev session |
| File magic-byte validation on upload | Deferred — local tool, extension check sufficient |
| Disk space monitoring | Deferred — not at deployment stage |
| DELETE path traversal hardening | Deferred — UUID validation in store layer is sufficient for local use |
