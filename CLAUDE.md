# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Proteomics Visualization Web App - A full-stack scientific data analysis platform with a Next.js frontend, FastAPI backend, and R-based bioinformatics pipeline.

**Tech Stack:**
- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, Plotly.js
- Backend: FastAPI, Python 3.11+, Pydantic, asyncio
- Analysis: R 4.3+, msqrob2, QFeatures, limma, gseapy

## Quick Start (Dev)

```bash
# Install deps (first time)
cd backend && .venv/Scripts/python.exe -m pip install -r requirements.txt
cd ../frontend && npm install
cd ../Tests && npm install

# Terminal 1 - Backend (use backend venv)
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend && npm run dev
# Access at http://localhost:3000
```

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
cd frontend && npm run lint && npm run lint:fix
cd backend && ruff check . && ruff format .
```

### R Package Verification
```bash
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" -e "library(msqrob2); library(QFeatures); library(limma); cat('OK\n')"
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
- `app/api/routes/` - 8 route modules (sessions, upload, analysis, processing, visualization, reports, compounds)
- `app/services/` - Business logic including msqrob2_wrapper, data_processor, gsea_service
- `app/db/session_store.py` - JSON-based session persistence
- `app/models/` - Pydantic models for session, data, analysis
- `scripts/` - R scripts (msqrob2_protein.R, msqrob2_de.R) called via subprocess

**Critical Pattern - R Integration via Subprocess:**
```python
result = subprocess.run(
    ['Rscript', 'scripts/msqrob2_protein.R', input_file, output_file],
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
stores/
├── sessionStore.ts     # Session data (persisted)
├── uiStore.ts / ui-store.ts      # UI state (two separate files, both used)
├── analysisStore.ts / analysis-store.ts  # Analysis state (two separate files)
├── processing-store.ts # Real-time processing status
```

**Pattern - Store Usage:**
```typescript
const sessions = useSessionStore((state) => state.sessions);  // GOOD
const state = useSessionStore();  // BAD - causes re-renders
```

### Processing Pipeline (9 Steps)

```
Input: PSM CSV Files -> Steps 1-5 (Python) -> Step 6: Protein Abundance (R/msqrob2)
    -> Step 7: Differential Expression (R/msqrob2) -> Step 8: QC Metrics (Python)
    -> Step 9: GSEA Analysis (Python/gseapy) -> Output: Results, QC Plots, GSEA
```

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

### Test Location (CRITICAL)
- **ALL test files MUST be in `Tests/` directory** - No exceptions
- **Python tests:** `Tests/backend/unit/` and `Tests/backend/integration/`
- **E2E tests:** `Tests/e2e/`

### R Integration
- **NEVER use rpy2** - Always use subprocess
- **Required packages:** msqrob2, QFeatures, limma
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

**Base URL:** `http://localhost:8000/api/sessions`

**Endpoints (all prefixed with `/api/sessions`):**
- Sessions: `POST /`, `GET /`, `GET /{id}`, `PUT /{id}`, `PUT /{id}/config`, `DELETE /{id}`
- Upload: `POST /{id}/upload/proteomics`, `POST /{id}/upload/compound`, `DELETE /{id}/files/{type}/{filename}`
- Processing: `POST /{id}/process`, `GET /{id}/processing/status`, `GET /{id}/processing/logs`, `POST /{id}/processing/retry`
- Analysis: `POST /{id}/analysis/start`, `POST /{id}/analysis/cancel`
- Results: `GET /{id}/results`, `GET /{id}/qc/plots`, `GET /{id}/gsea/{db}`, `GET /{id}/gsea/{db}/plot`, `GET /{id}/gsea/{db}/heatmap`
- Protein: `GET /{id}/protein/{protein_id}/abundance`, `GET /{id}/protein/{protein_id}/peptide`
- Reports: `POST /{id}/reports/generate`, `GET /{id}/reports`, `GET /{id}/reports/{rid}/download`, `DELETE /{id}/reports/{rid}`
- Compounds: `GET /{id}/compounds`, `GET /{id}/compounds/{condition}`, `GET /{id}/compounds/{condition}/image`, `GET /{id}/compounds/{condition}/properties`, `POST /{id}/compounds/validate`
- WebSocket: `WS /ws/sessions/{id}`

## Session Storage

Sessions persisted to `backend/sessions/{session_id}/`:
- `session.json` - Session metadata, config, file list
- `pipeline_state.json` - Processing progress, completed steps
- `uploads/` - User uploaded files
- `results/` - Generated analysis outputs

**Session State Lifecycle:** `created -> configuring -> processing -> completed/error`

## Key Files Reference

- `backend/app/main.py` - FastAPI application
- `backend/app/core/config.py` - Backend settings (pydantic-settings)
- `frontend/next.config.ts` - Frontend config, API proxy to `http://127.0.0.1:8000`
- `backend/scripts/msqrob2_protein.R` / `msqrob2_de.R` - Steps 6 & 7
- `backend/app/services/processing_orchestrator.py` - Pipeline orchestration
- `AGENTS/` - 9 developer guides
- `docs/openapi.yaml` - API specification
- `PROJECT_STRUCTURE.md` - Folder organization

## Troubleshooting

**Backend won't start / Port 8000 in use:**
```bash
# Find all PIDs on port 8000
netstat -ano | findstr ":8000 " | findstr "LISTENING"

# Kill ALL Python processes (uvicorn --reload spawns workers; zombies can't be killed by PID alone)
taskkill //F //IM python.exe

# Verify port is free
netstat -ano | findstr ":8000 " | findstr "LISTENING"

# Restart backend with venv Python
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000

# Verify routes
curl -s http://localhost:8000/openapi.json | python -c "import sys,json; d=json.load(sys.stdin); [print(p,list(d['paths'][p].keys())) for p in sorted(d['paths']) if 'protein' in p]"
```

**Python code changes not picked up (IMPORTANT):**
uvicorn's `--reload` mode on Windows can serve stale bytecode. **Always clear `__pycache__` BEFORE restarting** when debugging:
```bash
taskkill //F //IM python.exe
find backend -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
find backend -name "*.pyc" -delete 2>/dev/null
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```
If a fix works in isolation (`python -c "..."`) but the API still fails, it is ALWAYS a cache issue.

**Test failures:**
```bash
rm -rf Tests/test-results/ Tests/screenshots/ frontend/playwright-report/
```

**Venv corrupted or missing packages:**
```bash
rm -rf backend/.venv
cd backend && python -m venv .venv
cd backend && .venv/Scripts/activate && pip install -r requirements.txt
```

## Common Bug Patterns to Avoid

### R Scripts
- **Use `fixed=TRUE` in `grepl()`** when matching user-provided strings to avoid regex injection
- **Don't use `colMedians`** (not in base R) - Use `apply(x, 2, median, na.rm=TRUE)`

### Testing
- **Always run tests from project root** - `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit` not `cd backend && pytest`
