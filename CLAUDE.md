# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. Read this thoroughly before starting your work.

## Project Overview

Proteomics Visualization Web App - A full-stack scientific data analysis platform with a Next.js frontend, FastAPI backend, and R-based bioinformatics pipeline.

**Tech Stack:**
- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, Plotly.js, Cytoscape.js, Radix UI
- Backend: FastAPI, Python 3.12+, Pydantic, asyncio, scipy, scikit-learn
- Analysis: R 4.5+, msqrob2, QFeatures, limma, MSstats, MSstatsBioNet, gseapy

## Quick Start (Dev)

```bash
# Install deps + pre-commit hooks (first time)
cd backend && .venv/Scripts/python.exe -m pip install -r requirements.txt
cd ../frontend && npm install
cd ../Tests && npm install
cd ../backend && .venv/Scripts/pre-commit.exe install

# Terminal 1 - Backend (start FIRST — frontend proxies to port 8000)
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000

# Terminal 2 - Frontend
cd frontend && npm run dev
# Access at http://localhost:3000
```

**Startup order matters:** Backend must be running on port 8000 before the frontend — Next.js proxies `/api/*` requests to the backend. If you see 502/ECONNREFUSED errors in the frontend, the backend is not running or port 8000 is blocked.

## System Paths (This Machine)

**Python:**
- Backend venv: `backend/.venv/Scripts/python.exe` (Python 3.12.10, has all deps)
- **Always use the venv Python** for running backend code and tests

**R:**
- Installation: `C:/Program Files/R/R-4.5.1/`
- Rscript: `C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe` (also on PATH)
- Use full path if `Rscript` not found in PATH

## Common Commands

### Testing
```bash
# Backend tests (run from project root)
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration -v

# Frontend E2E tests (Playwright)
cd Tests && npx playwright test
cd Tests && npx playwright test --list
cd Tests && npx playwright show-report
```

### Code Quality
```bash
# Backend lint (run from project root)
backend/.venv/Scripts/python.exe -m ruff check .
backend/.venv/Scripts/python.exe -m ruff format .

# Frontend lint
cd frontend && npm run lint

# Pre-commit (run manually if git hooks aren't installed)
backend/.venv/Scripts/pre-commit.exe run --all-files
```

### R Package Verification
```bash
# Quick check
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" -e "library(msqrob2); library(QFeatures); library(limma); library(MSstats); cat('OK\n')"

# Full verification scripts
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" backend/scripts/verify_r_packages.R
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" backend/scripts/verify_msstats.R
```

## High-Level Architecture

### Backend Architecture (FastAPI)

**Request Flow:**
```
HTTP Request -> API Router -> Service Layer -> R Script / Python Processing
                    ↓
            Session Store (JSON files)
```

**Key Modules:**
- `app/api/routes/` - 8 route modules (sessions, upload, analysis, processing, visualization, reports, compounds, compare)
- `app/services/pipeline_engine.py` - Plugin-based step execution engine with PipelineState tracking
- `app/services/pipeline_registry.py` - Pipeline definitions for both msqrob2 and MSstats tools
- `app/services/steps/` - Individual step handlers (10 handlers + helpers, one per pipeline step)
- `app/services/base_r_wrapper.py` - Template Method base class for R subprocess wrappers (shared by msqrob2/msstats)
- `app/services/task_manager.py` - Thread-pool-isolated background computation with queuing (TaskKind: PIPELINE, GSEA, BIONET, COMPUTE, LIGHT)
- `app/services/session_manager.py` - Centralized session lifecycle and scanning
- `app/services/bionet_service.py` - INDRA subnetwork analysis via MSstatsBioNet
- `app/services/compare_service.py` - On-demand protein/comparison correlation (PCA, UMAP, t-SNE, clustering)
- `app/services/gsea_cache_service.py` - GSEA result caching keyed by input data hash
- `app/db/session_store.py` - JSON-based session persistence
- `app/models/` - Pydantic models: analysis.py (PipelineTool, AnalysisConfig), data.py (PSM, DE results), session.py (Session, SessionState)
- `scripts/` - R scripts called via subprocess (see Pipeline section below)

**Critical Pattern - R Integration via Subprocess:**
```python
result = subprocess.run(
    ['Rscript', 'scripts/msqrob2_data_process.R', input_file, output_file],
    capture_output=True, text=True, encoding='utf-8'
)
```

**Async Pattern - No Blocking I/O:**
```python
content = await asyncio.to_thread(read_file, file_path)
```

### Frontend Architecture (Next.js)

**State Management (Zustand with Immer):**
```
frontend/src/stores/
├── sessionStore.ts        # Session data (persisted)
├── ui-store.ts            # UI state
├── analysis-store.ts      # Analysis state
├── processing-store.ts    # Real-time processing status + WebSocket + queue tracking
```

**Pattern - Store Usage:**
```typescript
const sessions = useSessionStore((state) => state.sessions);  // GOOD
const state = useSessionStore();  // BAD - causes re-renders
```

### Processing Pipeline

The pipeline uses a **plugin-based engine** (`pipeline_engine.py`) with step handlers registered via `pipeline_registry.py`. Two statistical pipelines are available, selected via `PipelineTool` (not `AnalysisTemplate`):

- **msqrob2** (default): R/msqrob2 + QFeatures for protein abundance and DE
- **MSstats**: R/MSstats for protein abundance and DE

Both pipelines are defined in `pipeline_registry.py`. GSEA and BioNet are on-demand, triggered from visualization routes — not pipeline steps. The `TIME_SERIES` template is reserved for future use.

**msqrob2 Pipeline (5 steps — consolidated for v1.16 API):**

| Step | Name | Tool |
|------|------|------|
| 1 | Combine Replicates | Python (DataProcessor) |
| 2 | Generate Unique PSM | Python (DataProcessor) |
| 3 | Protein Abundance | R (msqrob2/QFeatures) |
| 4 | Differential Expression | R (msqrob2 v1.16: `msqrob()` + `makeContrast()` + `hypothesisTest()`) |
| 5 | QC Metrics | Python (QCCalculator, msqrob2-specific) |

Steps 1-2 are shared with MSstats. Steps 3-5 replace the old 8-step pipeline: Python preprocessing (old steps 3-5: razor, quality, filter) is now handled natively in the R QFeatures pipeline at step 3.

**MSstats Pipeline (8 steps — unchanged):**

| Step | Name | Tool |
|------|------|------|
| 1 | Combine Replicates | Python (DataProcessor) |
| 2 | Generate Unique PSM | Python (DataProcessor) |
| 3 | Remove Razor Peptides | Python (DataProcessor, conditional) |
| 4 | Remove Low Quality | Python (DataProcessor) |
| 5 | Filter by Criteria | Python (DataProcessor) |
| 6 | Protein Abundance | R (MSstats dataProcess) |
| 7 | Differential Expression | R (MSstats groupComparison) |
| 8 | QC Metrics | Python (QCCalculator) |

**On-Demand Analysis (triggered from visualization, not pipeline steps):**
- **GSEA**: Gene set enrichment via `visualization.py` POST endpoint, cached by `gsea_cache_service.py`
- **BioNet**: INDRA subnetwork analysis via `bionet_service.py` + `bionet_network.R`
- **Compare**: Protein/comparison correlation (PCA, UMAP, t-SNE, clustering) via `compare_service.py`

**R Scripts Reference:**

| Script | Step | Purpose |
|--------|------|---------|
| `msqrob2_data_process.R` | 3 (msqrob2) | Full QFeatures pipeline: filter, log2, normalize, impute, aggregate, gene map, batch correct |
| `msqrob2_group_comparison_multi.R` | 4 (msqrob2) | Multi-condition DE via msqrob v1.16 API (`msqrob()` + `makeContrast()` + `hypothesisTest()`) |
| `msstats_data_process.R` | 6 (MSstats) | MSstats protein abundance |
| `msstats_group_comparison_multi.R` | 7 (MSstats) | MSstats group comparison |
| `bionet_network.R` | on-demand | INDRA subnetwork analysis via MSstatsBioNet |
| `install_r_packages.R` | setup | Installs Bioconductor packages |
| `verify_r_packages.R` | setup | Verifies msqrob2/QFeatures/limma are installed |
| `verify_msstats.R` | setup | Verifies MSstats/MSstatsConvert are installed |

**WebSocket for Real-Time Updates:**
- Frontend connects to `ws://localhost:8000/ws/sessions/{session_id}`
- Pipeline state persisted to `sessions/{session_id}/pipeline_state.json`

### Data Flow Patterns

**File Upload -> Processing:**
1. User uploads `PSM_ExperimentName_Condition_Replicate.csv`
2. Filename parsed to extract experiment, condition, replicate
3. CSV validated for required columns (Sequence, Modifications, Charge, Contaminant, Master Protein Accessions, Quan Info, Abundance)
4. Converted to TSV for R processing

**API Response Format:** Backend returns column-based data `{ samples: [], pc1: [], pc2: [], conditions: [] }` -> Frontend transforms to row-based for Plotly.

## Critical Constraints (Absolute Red Lines)

### Tool call
- **Read file before update** - No exceptions

### Test Location (CRITICAL)
- **ALL test files MUST be in `Tests/` directory** - No exceptions
- **Python tests:** `Tests/backend/unit/` and `Tests/backend/integration/`
- **E2E tests:** `Tests/e2e/`

### R Integration
- **NEVER use rpy2** - Always use subprocess
- **Required packages:** msqrob2, QFeatures, limma, MSstats, MSstatsBioNet
- **Handle encoding:** UTF-8 with latin-1 fallback for R output
- **R script receives args positionally:** Check argument count in R with `length(args)`

### File Patterns (Immutable)
- **Filename format:** `PSM_ExperimentName_Condition_ReplicateNumber.csv`
- **Abundance column:** `Abundance F{code} Sample` (dynamic F-code per TMT channel)
- **Minimum replicates:** 3 per condition

### TypeScript / State Management
- **strict: true** required in tsconfig.json
- **NEVER use `as any` or `@ts-ignore`**
- **NEVER mutate Zustand state directly** - Always use actions

### Python
- **NEVER blocking I/O in async functions** - Use `asyncio.to_thread()`
- **Max upload size:** 500MB

### Data Format
- **Internal:** TSV (handles special characters better than CSV)
- **Required CSV columns:** Sequence, Modifications, Charge, Contaminant, Master Protein Accessions, Quan Info, Abundance

## API Contract

**Base URL:** `http://localhost:8000/api/sessions` (all below prefixed with this unless noted)

**Sessions:** `POST /` `GET /` `GET /{id}` `PUT /{id}` `DELETE /{id}` `PUT /{id}/config` `POST /{id}/config` `PATCH /{id}/visualization-state`

**Upload:** `POST /{id}/upload/proteomics` `POST /{id}/upload/compound` `DELETE /{id}/files/{type}/{filename}`

**Processing:** `POST /{id}/process` `POST /{id}/cancel` `GET /{id}/status` `GET /{id}/logs` `POST /{id}/retry`

**Results/Visualization:** `GET /{id}/results` `GET /{id}/qc/plots` `GET /{id}/protein/{protein_id}/abundance` `GET /{id}/protein/{protein_id}/peptide`

**GSEA (on-demand):** `POST /{id}/gsea/run` `GET /{id}/gsea/status` `GET /{id}/gsea/{db}` `GET /{id}/gsea/{db}/plot` `GET /{id}/gsea/{db}/heatmap`

**BioNet (on-demand):** `POST /{id}/bionet/run` `GET /{id}/bionet/status` `GET /{id}/bionet/subnetwork`

**Compare:** `POST /{id}/compare/protein` `POST /{id}/compare/matrix` `POST /{id}/compare/venn` `GET /{id}/compare/status` `GET /{id}/compare/result` `DELETE /{id}/compare/result`

**Reports:** `POST /{id}/reports/generate` `GET /{id}/reports` `GET /{id}/reports/{rid}/download` `DELETE /{id}/reports/{rid}`

**Compounds:** `GET /{id}/compounds` `GET /{id}/compounds/{condition}` `GET /{id}/compounds/{condition}/image` `GET /{id}/compounds/{condition}/properties` `POST /{id}/compounds/validate`

**Tasks:** `GET /{id}/tasks` `POST /{id}/tasks/cancel`

**Other:** `WS /ws/sessions/{id}` `GET /api/organisms` `POST /{id}/analysis/start` (deprecated→`/process`)

## Session Storage

Sessions persisted to `backend/sessions/{session_id}/`:
- `session.json` - Session metadata, config, file list
- `pipeline_state.json` - Processing progress, completed steps
- `uploads/` - User uploaded files
- `results/` - Generated analysis outputs

**Session State Lifecycle:** `created -> configuring -> queued -> processing -> completed/error/cancelled`

## Key Files Reference

- `backend/app/main.py` - FastAPI application, route mounting, lifespan handlers
- `backend/app/core/config.py` - Settings (pydantic-settings: R paths, timeouts, caching)
- `backend/app/services/pipeline_engine.py` - Pipeline step execution engine with PipelineState
- `backend/app/services/pipeline_registry.py` - Pipeline definitions for msqrob2 and MSstats tools
- `backend/app/services/processing_orchestrator.py` - Pipeline orchestration (adapts engine to session lifecycle)
- `backend/app/services/task_manager.py` - Background computation isolation with thread pools and queuing
- `backend/app/services/session_manager.py` - Centralized session lifecycle and scanning
- `backend/app/services/base_r_wrapper.py` - Template Method base for R subprocess wrappers
- `backend/app/services/gsea_service.py` - On-demand GSEA analysis with caching (not a pipeline step)
- `backend/app/services/compare_service.py` - On-demand protein/comparison correlation analysis
- `backend/app/services/bionet_service.py` - INDRA subnetwork analysis via MSstatsBioNet
- `backend/app/models/analysis.py` - PipelineTool enum, AnalysisConfig (msqrob2 + MSstats params)
- `backend/app/models/session.py` - Session, SessionState (includes QUEUED, CANCELLED)
- `backend/app/models/data.py` - PSMData, ProteinAbundance, DifferentialExpressionResult, QC metrics
- `backend/scripts/msqrob2_data_process.R` - Step 6 (protein abundance via msqrob2)
- `backend/scripts/msqrob2_group_comparison_multi.R` - Step 7 (multi-condition DE via msqrob2)
- `backend/scripts/bionet_network.R` - INDRA subnetwork analysis
- `frontend/next.config.ts` - Frontend config, API proxy to `http://127.0.0.1:8000`
- `AGENTS/` - 9 developer guides covering overview, red lines, coding standards, API contract, state management, error handling, testing, pipeline, and lessons learned
- `docs/api/openapi.yaml` - API specification
- `docs/CONTRIBUTING.md` - Contributor guidelines

## Troubleshooting

### Backend won't start / Port 8000 in use
This is the most common issue. uvicorn's `--reload` spawns child processes; killing by PID alone leaves zombies. Kill ALL Python processes:

**PowerShell (recommended on Windows):**
```powershell
# Kill ALL Python processes
taskkill /F /IM python.exe

# Verify port is free (should show no output)
netstat -ano | findstr ":8000.*LISTENING"

# Restart backend
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000
```

**Bash (Git Bash / WSL):**
```bash
taskkill //F //IM python.exe
netstat -ano | grep ":8000.*LISTENING"
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000
```

### Stale bytecode / Code changes not picked up
On Windows, uvicorn's `--reload` often serves stale `.pyc` files. If a fix works in `python -c "..."` but the API still fails, **it is always a cache issue**:

```powershell
taskkill /F /IM python.exe
Get-ChildItem -Recurse -Directory -Filter "__pycache__" -Path backend | Remove-Item -Recurse -Force
Get-ChildItem -Recurse -Filter "*.pyc" -Path backend | Remove-Item -Force
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000
```

### Frontend won't start

**`npm run dev` fails with module not found:**
```powershell
cd frontend
npm install        # reinstall if node_modules is missing or stale
npm run dev        # starts at http://localhost:3000
```

**API calls return 404 / proxy errors:**
The Next.js dev server proxies `/api/*` to `http://127.0.0.1:8000` (see `frontend/next.config.ts`). The backend must be running on port 8000. If you see `ECONNREFUSED` or 502 errors, start the backend first.

**Multipart upload fails with 6+ files:**
Next.js dev server has a known issue proxying large multipart uploads. The frontend batches uploads into groups of 5 as a workaround (`api-client.ts` line 403). If uploads still fail, try `npm run build && npm start` instead of `npm run dev`.

**Port 3000 already in use:**
```powershell
netstat -ano | findstr ":3000.*LISTENING"
taskkill /F /PID <PID>
```

### Running tests

**Always run from project root:**
```powershell
# Backend unit tests
backend\.venv\Scripts\python.exe -m pytest Tests/backend/unit -v

# Backend integration tests (some require SampleData — use -m "not needs_sample_data" to skip)
backend\.venv\Scripts\python.exe -m pytest Tests/backend/integration -v

# Run everything
backend\.venv\Scripts\python.exe -m pytest Tests/backend/ -v --tb=short
```

**E2E tests (Playwright):**
```powershell
cd Tests
npx playwright install chromium   # first time only
npx playwright test               # run all specs
npx playwright show-report        # view HTML report
```

**Clean test artifacts before re-running:**
```powershell
Remove-Item -Recurse -Force Tests/test-results, Tests/screenshots, Tests/playwright-report -ErrorAction SilentlyContinue
```

### Linting and formatting

```powershell
# Backend (run from project root)
backend\.venv\Scripts\python.exe -m ruff check .
backend\.venv\Scripts\python.exe -m ruff format .

# Frontend
cd frontend; npx eslint src/
```

### Pre-commit hooks

Hooks are configured in `.pre-commit-config.yaml`. They run ruff, ruff-format, and eslint on staged files. Install once:

```powershell
backend\.venv\Scripts\pip.exe install pre-commit
backend\.venv\Scripts\pre-commit.exe install
```

If `pre-commit install` fails with "Cowardly refusing to install hooks with core.hooksPath set" (Claude Code worktrees set this), run manually instead:

```powershell
backend\.venv\Scripts\pre-commit.exe run --all-files
```

### Venv corrupted or missing packages

```powershell
Remove-Item -Recurse -Force backend\.venv
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Common Bug Patterns to Avoid

### R Scripts
- **Use `fixed=TRUE` in `grepl()`** when matching user-provided strings to avoid regex injection
- **Don't use `colMedians`** (not in base R) - Use `apply(x, 2, median, na.rm=TRUE)`

### Testing
- **Always run tests from project root** - `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit` not `cd backend && pytest`


## Common guidelines (must follow)

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
