# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. Read this thoroughly before starting your work.

## Project Overview

Proteomics Visualization Web App - A full-stack scientific data analysis platform with a Next.js frontend, FastAPI backend, and R-based bioinformatics pipeline.

**Tech Stack:**
- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, Plotly.js, Cytoscape.js, Radix UI
- Backend: FastAPI, Python 3.12+, Pydantic, asyncio, scipy, scikit-learn, DuckDB (DIA streaming)
- Analysis: R 4.5+, msqrob2, QFeatures, limma, MSstats, MSstatsBioNet, gseapy

## Quick Start (Dev)

```bash
# Install deps + pre-commit hooks (first time)
cd backend && .venv/Scripts/python.exe -m pip install -r requirements.txt
cd ../frontend && npm install
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

**Environment:**
- Backend reads from `backend/.env` (auto-loaded by pydantic-settings). Required settings: `r_executable`, `sessions_dir`, timeouts. See `app/core/config.py` for all fields and defaults.

## Common Commands

### Testing
```bash
# Backend tests (run from project root)
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration -v

# Specific test group
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/pipeline -v
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

# R integration test
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/pipeline/test_r_integration.py -v
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
- `app/api/routes/` - 7 route modules (sessions, upload, processing, visualization, reports, compare, files)
- `app/services/file_index_service.py` - DuckDB-backed file library index with scan-and-sync diffing
- `app/services/pipeline_engine.py` - Plugin-based step execution engine with PipelineState tracking
- `app/services/pipeline_registry.py` - Pipeline definitions for msqrob2, MSstats, and PTM tools
- `app/services/steps/` - Individual step handlers (15 handler files across inputs, shared, engines, and PTM)
- `app/services/base_r_wrapper.py` - Template Method base class for R subprocess wrappers (shared by msqrob2/msstats)
- `app/services/task_manager.py` - Thread-pool-isolated background computation with queuing (TaskKind: PIPELINE, GSEA, BIONET, COMPUTE, LIGHT)
- `app/services/session_manager.py` - Centralized session lifecycle and scanning
- `app/services/bionet_service.py` - INDRA subnetwork analysis via MSstatsBioNet
- `app/services/compare_service.py` - On-demand protein/comparison correlation (PCA, UMAP, t-SNE, clustering)
- `app/services/gsea_cache_service.py` - GSEA result caching keyed by input data hash
- `app/db/session_store.py` - JSON-based session persistence
- `app/models/` - Pydantic models: analysis.py (PipelineTool, AnalysisConfig), data.py (PSM, DE results), session.py (Session, SessionState)
- `scripts/` - R scripts called via subprocess (see Pipeline section below)

**File Library Architecture:**
```
File Library (global, cross-session)
├── {FILE_LIBRARY_DIR}/                         # configurable via .env, default backend/file_library/
│   ├── .library_index.duckdb                   # DuckDB metadata index
│   └── user-created folders with .txt/.csv files
│
├── FileIndexService (backend/app/services/file_index_service.py)
│   ├── DuckDB schema: files(path TEXT PK, name, size, file_type, parent_path, modified_at)
│   ├── scan_and_sync() — os.walk diff against DB, guarded by threading.Lock
│   ├── CRUD: insert_entry, update_entry, delete_entry (cascade for folders)
│   └── Read: list_directory, search (LIKE with escape), get_entry, count
│
├── Files API (backend/app/api/routes/files.py) — 10 endpoints at /api/files/*
│   ├── GET /tree?path= — list directory (lazy, per-folder on expand)
│   ├── POST /folders, /upload, /scan
│   ├── PUT /rename, /move
│   ├── DELETE /delete
│   ├── GET /search?q=, /content?path= (10MB max, for metadata CSV import)
│   └── POST /select — copy files from library to session, parse, return metadata
│
└── Frontend: /files page + FileLibraryPicker modal
    ├── FileLibraryPage — folder tree, file list, toolbar, context menu
    ├── FolderTree — lazy-loaded recursive tree with expand/collapse
    ├── FileList — sortable table with checkboxes, breadcrumbs, file type filter
    ├── FileLibraryPicker — modal picker reusing FolderTree, used in wizard + metadata
    └── fileLibraryApi (api-client.ts) — 10 typed methods
```

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

**File Library Components:**
```
frontend/src/components/files/
├── FileLibraryPage.tsx    # Main page layout, state management, all handlers
├── FileLibraryToolbar.tsx # New Folder, Upload, Delete, Rename, Search, Refresh
├── FolderTree.tsx         # Lazy-loaded recursive folder tree
├── FileList.tsx           # Sortable table, breadcrumbs, checkboxes, file type filter
├── FileLibraryPicker.tsx  # Modal picker (reuses FolderTree) for wizard + metadata
└── ContextMenu.tsx        # Right-click menu (Rename, Delete, Copy Path)
```

**Pattern - Store Usage:**
```typescript
const sessions = useSessionStore((state) => state.sessions);  // GOOD
const state = useSessionStore();  // BAD - causes re-renders
```

### Processing Pipeline — Composable Architecture

The pipeline uses a **composable step library** (`pipeline_engine.py` + `pipeline_registry.py`). Pipelines are composed from shared building blocks organized by concern:

```
backend/app/services/steps/
├── inputs/        # File-format-specific input handlers
│   ├── step_input_tmt.py   # Melt TMT channels, map groups
│   └── step_input_dia.py   # Rename Quan_Value→Abundance, per-file metadata
├── shared/        # Unified handlers (both pipelines)
│   ├── step_unique_psm.py
│   ├── step_remove_razor.py
│   ├── step_remove_low_quality.py
│   ├── step_filter_criteria.py
│   └── step_qc_metrics.py
└── engines/       # Statistical engine R wrappers
    ├── step_msqrob2_abundance.py  # QFeatures
    ├── step_msqrob2_de.py         # msqrob2 contrasts
    ├── step_msstats_abundance.py   # dataProcess
    └── step_msstats_de.py          # groupComparison
    # PTM handlers (at steps/ root):
    #   ptm_step1_prepare.py, ptm_step2_summarization.py
    #   ptm_step3_comparison.py, ptm_step4_qc.py
```

**Pipeline → File Type Mapping (auto-derived):**
- **TMT** → MSstats (8 steps): TMT multiplexed data with reporter ion channels
- **DIA** → msqrob2 (8 steps): Label-free DIA data with single Quan_Value per PSM
- **PTM** → MSstatsPTM (4 steps): PTM-specific pipeline with summarization and group comparison
- User selects analysis type (TMT/DIA/PTM) up front; pipeline is auto-derived via `_derive_pipeline()` from `session.config.file_type`

**Both pipelines are 8-step symmetric:**

| Step | TMT (MSstats) | DIA (msqrob2) |
|------|--------------|----------------|
| 1 | INPUT_TMT — melt channels, map groups | INPUT_DIA — rename Quan_Value, metadata |
| 2 | UNIQUE_PSM (shared) | UNIQUE_PSM (shared) |
| 3 | REMOVE_RAZOR (shared) | REMOVE_RAZOR (shared) |
| 4 | REMOVE_LOW_QUALITY (shared) | REMOVE_LOW_QUALITY (shared) |
| 5 | FILTER_CRITERIA (shared) | FILTER_CRITERIA (shared) |
| 6 | MSSTATS_ABUNDANCE (R) | MSQROB2_ABUNDANCE (R) |
| 7 | MSSTATS_DE (R) | MSQROB2_DE (R) |
| 8 | QC_METRICS (shared) | QC_METRICS (shared) |

**PTM pipeline (4 steps):**

| Step | PTM (MSstatsPTM) |
|------|------------------|
| 1 | PREPARE_PTM_DATA — PTM data preparation |
| 2 | PTM_SUMMARIZATION — MSstatsPTM summarization (R) |
| 3 | PTM_GROUP_COMPARISON — PTM group comparison (R) |
| 4 | PTM_QC_METRICS — PTM QC metrics |

**DIA optimized path (Steps 1-5, DuckDB-only):** Pure DuckDB SQL reading/writing Parquet on disk:
- Steps 1-2: Single streaming DuckDB COPY query (CSV → Parquet with metadata join, Unique_PSM, contaminant/Quan_Info/Abundance<1 filters). Peak memory <500MB.
- Steps 3-5: DuckDB SQL (COPY queries with WHERE/CTE/JOIN). Step 3 uses two-phase DuckDB + Python for razor peptide protein selection. Zero pandas in preprocessing.

**msqrob2 DE batching (Step 7):** When comparisons exceed `msqrob2_batch_size` (default 10), splits across parallel R subprocesses via `ProcessPoolExecutor`. Each batch loads a pre-fitted QFeatures RDS and runs `makeContrast()` + `hypothesisTest()` independently. Config: `msqrob2_batch_size` (1-50), `msqrob2_max_workers` (1-64), `msqrob2_n_cores_cap` (1-64).

**QFeatures memory (Step 6):** After aggregation, peptide-level assays (peptide, peptideLog, peptideNorm, peptideImputed) are removed from the QFeatures object via `removeAssay()`, keeping only `protein` and `proteinBatchCorrected`. Controlled by `keep_intermediate_assays` config (default false). Reduces peak R memory by ~50%.

**Ridge regression:** `msqrob2_ridge` defaults to `False`. Ridge requires 5+ replicates per condition — with 3 replicates it causes boundary singular fits in `lme4` and returns all-NA results.

**On-Demand Analysis (triggered from visualization, not pipeline steps):**
- **GSEA**: Gene set enrichment via `visualization.py` POST endpoint, cached by `gsea_cache_service.py`
- **BioNet**: INDRA subnetwork analysis via `bionet_service.py` + `bionet_network.R`
- **Compare**: Protein/comparison correlation (PCA, UMAP, t-SNE, clustering) via `compare_service.py`

**R Scripts Reference:**

| Script | Pipeline Step | Purpose |
|--------|-------------|---------|
| `msqrob2_data_process.R` | 6 (msqrob2) | Full QFeatures pipeline: filter, log2, normalize, impute, aggregate, gene map, batch correct |
| `msqrob2_group_comparison_multi.R` | 7 (msqrob2) | Multi-condition DE via msqrob v1.16 API (`msqrob()` + `makeContrast()` + `hypothesisTest()`) |
| `msstats_data_process.R` | 6 (MSstats) | MSstats protein abundance (DDARawData → OpenMStoMSstatsFormat → dataProcess) |
| `msstats_group_comparison_multi.R` | 7 (MSstats) | MSstats group comparison (contrast matrix → groupComparison). Uses `grepl(fixed=TRUE)` for GROUP substring matching (not exact `==`). |
| `bionet_network.R` | on-demand | INDRA subnetwork analysis via MSstatsBioNet |
| `ptm_summarization.R` | PTM 2 | MSstatsPTM summarization |
| `ptm_group_comparison.R` | PTM 3 | PTM group comparison via MSstatsPTM |
| `install_r_packages.R` | setup | Installs all R packages (at `backend/scripts/`) |

**WebSocket for Real-Time Updates:**
- Frontend connects to `ws://localhost:8000/ws/sessions/{session_id}`
- Pipeline state persisted to `sessions/{session_id}/pipeline_state.json`

**Pipeline Tests:**
- `Tests/backend/integration/pipeline/test_tmt_pipeline_e2e.py` — Full TMT pipeline (10k-row PD extract, 16-plex channels, 8 steps, 4 comparisons vs DMSO_24h)
- `Tests/backend/unit/pipeline/test_pipeline_chains.py` — Chain tests with mocked R steps; column contract verification
- `Tests/backend/unit/pipeline/test_pipeline_registry.py` — Composition, step ordering, positional numbering
- `Tests/fixtures/` — PD data extracts: `tmt_sample_10000rows.txt` (TMT), `dia_sample_01_10000rows.txt` through `dia_sample_12_10000rows.txt` (DIA, 12 files)

**Input File Formats (Proteome Discoverer exports only):**
- **TMT:** Tab-delimited `.txt`, 78 columns, `Abundance 126` through `Abundance 134N` (16-plex). Channel detection pattern: `^"?Abundance\s+(\d+)([NC])?"?$`. Any plex size accepted (6, 10, 16, 18).
- **DIA:** Tab-delimited `.txt`, 61 columns, single `Quan Value` column. No TMT abundance columns. No requirement for `Quan Info` column.
- Both `.txt` and `.csv` accepted. Auto-detect delimiter (tab vs comma). No filename pattern required.
- Old `PSM_Experiment_Condition_Replicate.csv` format is **dropped**.

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
- **Python tests:** `Tests/backend/unit/` and `Tests/backend/integration/` (organized by domain in subdirectories)

### R Integration
- **NEVER use rpy2** - Always use subprocess
- **Required packages:** msqrob2, QFeatures, limma, MSstats, MSstatsBioNet
- **Handle encoding:** UTF-8 with latin-1 fallback for R output
- **R script receives args positionally:** Check argument count in R with `length(args)`

### File Patterns (Immutable)
- **Filename format:** Any filename accepted (no pattern requirement)
- **TMT Abundance columns:** `Abundance 126`, `Abundance 127N`, …, `Abundance 134N` (PD export format)
- **DIA quantification:** `Quan Value` column (single value per PSM)
- **Minimum replicates:** 3 per condition recommended (soft warning); 1 per condition accepted
- **Supported extensions:** `.txt` (tab-delimited) and `.csv` (comma-delimited), auto-detected

### Performance & Scale
- **DIA scale:** Supports 10K+ input files via DuckDB-only SQL preprocessing (Steps 1-5). Peak Python memory <500MB regardless of input count. Upload is the bottleneck — 10K files through the web API requires a bulk upload endpoint.
- **DE scale:** 10K comparisons with 16-way batching completes in ~5 minutes (vs ~10 hours serial). Config via `msqrob2_batch_size`, `msqrob2_max_workers`, `msqrob2_n_cores_cap`.
- **TMT scale:** <100 samples — current architecture handles this without optimization.
- **SessionConfig ↔ AnalysisConfig:** New msqrob2 fields must be added to BOTH models. `config_forward_fields` in `processing.py` only forwards fields that exist in `SessionConfig`. If a field exists in `AnalysisConfig` but not `SessionConfig`, the API silently drops it.

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

**Upload:** `POST /{id}/upload/proteomics` `DELETE /{id}/files/{type}/{filename}`

**Processing:** `POST /{id}/process` `POST /{id}/cancel` `GET /{id}/status` `GET /{id}/logs` `POST /{id}/retry`

**Results/Visualization:** `GET /{id}/results` `GET /{id}/qc/plots` `GET /{id}/protein/{protein_id}/abundance` `GET /{id}/protein/{protein_id}/peptide`

**GSEA (on-demand):** `POST /{id}/gsea/run` `GET /{id}/gsea/status` `GET /{id}/gsea/{db}` `GET /{id}/gsea/{db}/plot` `GET /{id}/gsea/{db}/heatmap`

**BioNet (on-demand):** `POST /{id}/bionet/run` `GET /{id}/bionet/status` `GET /{id}/bionet/subnetwork`

**Compare:** `POST /{id}/compare/protein` `POST /{id}/compare/matrix` `POST /{id}/compare/venn` `GET /{id}/compare/status` `GET /{id}/compare/result` `DELETE /{id}/compare/result`

**Reports:** `POST /{id}/reports/generate` `GET /{id}/reports` `GET /{id}/reports/{rid}/download` `DELETE /{id}/reports/{rid}`

**Tasks:** `GET /{id}/tasks` `POST /{id}/tasks/cancel`

**Other:** `WS /ws/sessions/{id}` `GET /api/organisms` `POST /{id}/analysis/start` (deprecated→`/process`)

**Files (File Library):** `GET /api/files/tree?path=` `POST /api/files/folders` `POST /api/files/upload` `PUT /api/files/rename` `PUT /api/files/move` `DELETE /api/files/delete` `POST /api/files/scan` `GET /api/files/search?q=` `GET /api/files/content?path=` `POST /api/files/select`

## Session Storage

Sessions persisted to `backend/sessions/{session_id}/`:
- `session.json` - Session metadata, config, file list
- `pipeline_state.json` - Processing progress, completed steps
- `uploads/` - User uploaded files
- `results/` - Generated analysis outputs

**Session State Lifecycle:** `created -> configuring -> queued -> processing -> completed/error/cancelled`

## Key Files Reference

- `backend/app/main.py` - FastAPI application, route mounting, lifespan handlers
- `backend/app/core/config.py` - Settings (pydantic-settings: R paths, timeouts, caching, file_library_dir)
- `backend/app/services/file_index_service.py` - DuckDB-backed file library index with scan-and-sync
- `backend/app/api/routes/files.py` - File library API (10 endpoints at /api/files/*)
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
- `backend/scripts/msqrob2_data_process.R` - Step 6 (protein abundance via QFeatures)
- `backend/scripts/msqrob2_group_comparison_multi.R` - Step 7 (multi-condition DE via msqrob2 v1.16)
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
# Backend unit tests (recursive, auto-discovers subdirectories)
backend\.venv\Scripts\python.exe -m pytest Tests/backend/unit -v

# Specific test group
backend\.venv\Scripts\python.exe -m pytest Tests/backend/unit/pipeline -v

# Backend integration tests
backend\.venv\Scripts\python.exe -m pytest Tests/backend/integration -v

# Run everything
backend\.venv\Scripts\python.exe -m pytest Tests/backend/ -v --tb=short
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

### Python
- **Type annotations: use `collections.abc.Callable`, NOT lowercase `callable`.** Lowercase `callable` is a built-in function, not a type — using it in `X | None` annotations causes `TypeError` at module import on Python 3.12.
- **Session IDs must be valid UUIDs.** `SessionStore._get_session_dir()` validates UUID format. Non-UUID strings like `"test-session"` raise `SessionNotFoundError` (404), not a generic 500.
- **NEVER blocking I/O in async functions** — Use `asyncio.to_thread()`

### R Scripts
- **Use `fixed=TRUE` in `grepl()`** when matching user-provided strings to avoid regex injection
- **Don't use `colMedians`** (not in base R) - Use `apply(x, 2, median, na.rm=TRUE)`
- **MSstats GROUP matching:** Use `grepl(target_val, GROUP, fixed=TRUE)` for substring matching, not `==` exact match. MSstats embeds BioReplicate/Run suffixes in GROUP values (e.g., `DMSO_24h_1_1`), so exact-match comparisons silently produce empty groups and "No valid comparisons" errors.

### File Library
- **DuckDB `LIKE` with leading wildcard causes full table scan.** Use exact `WHERE parent_path = ?` for directory listing, and indexed lookups where possible. The `path LIKE 'prefix/%'` pattern for folder cascades cannot use the PK index.
- **`threading.Lock` is required for DuckDB writes.** DuckDB allows concurrent readers but serializes writers. The `FileIndexService._write_lock` guards all write operations (scan, insert, update, delete).
- **`ProteomicsFileInfo` lacks `tmt_channels` field.** TMT channel info is attached to API response dicts but lost on session save. Workaround: frontend re-derives channels from `columns` matching `/^Abundance\s+(\d+[NC]?)$/`.
- **Replicate key is case-sensitive across the stack** — CSV import checks `h === 'Replicate'`, validation checks `entry.replicate`, comparisons auto-generate filters `k !== 'replicate'`. Always normalize to lowercase at the parse boundary.
- **Next.js dev proxy drops large multipart uploads** — files >200MB through `npm run dev` time out with 500. Use direct backend port 8000 for large uploads, or `npm run build && npm start`.

### Testing
- **Always run tests from project root** - `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit` not `cd backend && pytest`
- **Use valid UUIDs in test session IDs** — `"550e8400-e29b-41d4-a716-446655440000"` not `"test-session-1"`


## Testing Conventions

- **HTTP client:** Use `TestClient` (shared `client` fixture from `Tests/conftest.py`), never `httpx.AsyncClient`
- **Test data:** Use committed `Tests/fixtures/` files via `test_data_dir` or named fixture-path fixtures. Never depend on external `SampleData/`
- **File extensions:** `.txt` and `.csv` both accepted. `validate_csv_extension` has been removed
- **Organization:** Tests grouped by domain in subdirectories:
  - `unit/pipeline/` — pipeline engine, registry, chains, orchestrator, structure
  - `unit/processing/` — data processing, file parsing, QC, R wrappers, batch
  - `unit/services/` — GSEA, compare, BioNet, reports
  - `unit/routes/` — API route handlers
  - `unit/infrastructure/` — sessions, tasks, validation, organisms, WebSocket
  - `integration/pipeline/` — E2E pipeline + R integration
  - `integration/routes/` — API integration tests
- **Fixtures audit:** `Tests/conftest.py` fixtures are periodically audited for usage. Remove unused ones


## Project-Specific Guidelines

- **Surgical changes only** — touch only code relevant to the task; don't "clean up" adjacent files
- **Match existing style** — even if you'd do it differently
- **Verify before claiming success** — run tests, don't assume
- **Use selectors with Zustand** — `useStore(s => s.field)` never `useStore()` (causes re-renders)
- **Generic coding guidelines** (simplicity, planning, etc.) are in your global `~/.claude/CLAUDE.md`
