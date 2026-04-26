# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Proteomics Visualization Web App - A full-stack scientific data analysis platform with a Next.js frontend, FastAPI backend, and R-based bioinformatics pipeline.

**Tech Stack:**
- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, Plotly.js
- Backend: FastAPI, Python 3.11+, Pydantic, asyncio
- Analysis: R 4.3+, msqrob2, QFeatures, limma, gseapy

## Environment Setup

```bash
# Backend dependencies (use existing venv)
cd backend && .venv/Scripts/python.exe -m pip install -r requirements.txt

# Frontend dependencies
cd frontend && npm install

# Test dependencies
cd Tests && npm install
```

## Common Commands

### Development (Start Both Services)
```bash
# Terminal 1 - Backend (use backend venv)
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend && npm run dev

# Access at http://localhost:3000
```

### Testing
```bash
# Backend tests (run from project root)
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration -v
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_file_parser.py -v

# Frontend E2E tests (Playwright)
cd Tests && npx playwright test
cd Tests && npx playwright test e2e/04-error-handling.spec.ts --headed

# List E2E tests (dry run)
cd Tests && npx playwright test --list

# View test report
cd Tests && npx playwright show-report
```

### Code Quality
```bash
# Frontend linting
cd frontend && npm run lint
cd frontend && npm run lint:fix

# Backend (if ruff installed)
cd backend && ruff check .
cd backend && ruff format .
```

### R Package Verification (Critical)
```bash
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" -e "library(msqrob2); library(QFeatures); library(limma); cat('OK\n')"
```

## System Paths (This Machine)

**Python:**
- Backend venv: `backend/.venv/Scripts/python.exe` (Python 3.12.10, has all deps)
- **Always use the venv Python** for running backend code and tests

**R:**
- Installation: `C:/Program Files/R/R-4.5.1/`
- Rscript: `C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe` (also on PATH)
- Use full path if `Rscript` not found in PATH

## High-Level Architecture

### Backend Architecture (FastAPI)

**Request Flow:**
```
HTTP Request → API Router → Service Layer → R Script / Python Processing
                    ↓
            Session Store (JSON files)
```

**Key Modules:**
- `app/api/routes/` - 7 route modules (sessions, upload, analysis, processing, visualization, reports, compounds)
- `app/services/` - Business logic including msqrob2_wrapper, data_processor, gsea_service
- `app/db/session_store.py` - JSON-based session persistence
- `app/models/` - Pydantic models for session, data, analysis
- `scripts/` - R scripts (msqrob2_protein.R, msqrob2_de.R) called via subprocess

**Critical Pattern - R Integration via Subprocess:**
```python
# CORRECT - Always use subprocess, NEVER rpy2
result = subprocess.run(
    ['Rscript', 'scripts/msqrob2_protein.R', input_file, output_file],
    capture_output=True,
    text=True,
    encoding='utf-8'
)
```

**Async Pattern - No Blocking I/O:**
```python
# CORRECT - Use asyncio.to_thread for file I/O
content = await asyncio.to_thread(read_file, file_path)

# WRONG - Never use blocking I/O in async functions
content = open(file_path).read()  # Blocks event loop!
```

### Frontend Architecture (Next.js)

**State Management (Zustand with Immer):**
```
stores/
├── sessionStore.ts     # Session data (persisted)
├── uiStore.ts          # UI state (modals, toasts, selections)
├── analysisStore.ts    # Cached analysis results
├── analysis-store.ts   # Additional analysis state
├── processing-store.ts # Real-time processing status
└── ui-store.ts         # Additional UI state
```

**Pattern - Store Usage:**
```typescript
// Select only what you need to prevent re-renders
const sessions = useSessionStore((state) => state.sessions);
const removeSession = useSessionStore((state) => state.removeSession);

// NEVER get entire store
const state = useSessionStore();  // BAD - causes re-renders
```

**Pattern - Immer for Immutable Updates:**
```typescript
// Mutable syntax, immutable result
set((state) => {
  state.nested.count += 1;  // ✅ Safe with Immer middleware
});
```

### Processing Pipeline (9 Steps)

```
Input: PSM CSV Files
    ↓
Step 1: Combine Replicates (Python/Pandas)
Step 2: Generate Unique PSM (Python)
Step 3: Remove Razor (Python, optional)
Step 4: Remove Low Quality (Python)
Step 5: Filter by Criteria (Python)
Step 6: Protein Abundance (R/msqrob2 aggregateFeatures)
Step 7: Differential Expression (R/msqrob2 msqrob)
Step 8: QC Metrics (Python/sklearn PCA)
Step 9: GSEA Analysis (Python/gseapy)
    ↓
Output: Results, QC Plots, GSEA
```

**WebSocket for Real-Time Updates:**
- Frontend connects to `ws://localhost:8000/ws/sessions/{session_id}`
- Backend sends progress updates at each pipeline step
- Pipeline state persisted to `sessions/{session_id}/pipeline_state.json`

### Data Flow Patterns

**File Upload → Processing:**
1. User uploads `PSM_ExperimentName_Condition_Replicate.csv`
2. Filename parsed to extract experiment, condition, replicate
3. CSV validated for required columns (Sequence, Modifications, Charge, Contaminant, Master Protein Accessions, Quan Info, Abundance)
4. Converted to TSV for R processing
5. R scripts read TSV → output results

**API Response Format:**
```typescript
// Backend returns column-based data
{ samples: [], pc1: [], pc2: [], conditions: [] }

// Frontend transforms to row-based for Plotly
{ sample: string, pc1: number, pc2: number, condition: string }[]
```

## Critical Constraints (Absolute Red Lines)

### Test Location (CRITICAL)
- **ALL test files MUST be in `Tests/` directory** - No exceptions
- **NEVER create test files in `backend/tests/` or `frontend/tests/`** - These directories should not exist
- **Python tests:** `Tests/backend/unit/` and `Tests/backend/integration/`
- **E2E tests:** `Tests/e2e/`
- **Test data:** `Tests/fixtures/`

### R Integration
- **NEVER use rpy2** - Always use subprocess
- **Required packages:** msqrob2, QFeatures, limma (verify with Rscript command)
- **Handle encoding:** UTF-8 with latin-1 fallback for R output
- **Debug argument passing:** Add logging with error handling in wrapper to trace file paths
- **R script receives args positionally:** Check argument count in R with `length(args)`

### File Patterns (Immutable)
- **Filename format:** `PSM_ExperimentName_Condition_ReplicateNumber.csv`
- **Abundance column:** `Abundance F{code} Sample` (dynamic F-code per TMT channel)
- **Minimum replicates:** 3 per condition

### TypeScript
- **strict: true** required in tsconfig.json
- **NEVER use `as any` or `@ts-ignore`**

### State Management
- **NEVER mutate Zustand state directly** - Always use actions
- **Separate stores by domain** - No monolithic stores

### Python
- **NEVER blocking I/O in async functions** - Use asyncio.to_thread()
- **Max upload size:** 500MB

### Data Format
- **Internal:** TSV (handles special characters better than CSV)
- **API:** Column-based from R → Row-based for frontend
- **Required CSV columns:** Sequence, Modifications, Charge, Contaminant, Master Protein Accessions, Quan Info, Abundance

### Service Management (CRITICAL)
- **NEVER use `killall`, `taskkill /IM`, or global cleanup commands** - These can kill the Claude process itself
- **ALWAYS target specific PID or port only** - Use `netstat -ano | findstr :PORT` then `taskkill //F //PID <PID>`
- **Verify PID is not Claude's** - Check that the PID being killed belongs to uvicorn/node, not the current Python process

## API Contract

**Base URL:** `http://localhost:8000/api/sessions`

**Key Endpoints:**
- `POST /api/sessions` - Create session
- `GET /api/sessions` - List sessions
- `POST /api/sessions/{id}/upload/proteomics` - Upload PSM files
- `DELETE /api/sessions/{id}` - Delete session
- `POST /api/sessions/{id}/process` - Start processing pipeline
- `GET /api/sessions/{id}/results` - Get DE results
- `GET /api/sessions/{id}/qc/plots` - Get QC data
- `GET /api/sessions/{id}/gsea/{database}` - Get GSEA results
- `WS /ws/sessions/{id}` - WebSocket for real-time updates

**Response Format:**
```typescript
interface ApiResponse<T> {
  data: T;
  meta: { timestamp: string; request_id: string; };
}

interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    timestamp: string;
    request_id: string;
  };
}
```

## Testing Architecture

**ALL tests MUST be in the `Tests/` directory only.** No test files should exist in `backend/tests/` or `frontend/tests/`.

**Test Directory Structure:**
```
Tests/
├── backend/
│   ├── unit/              # Python unit tests (pytest)
│   └── integration/       # API/integration tests (pytest)
├── e2e/                   # Playwright E2E tests (6 suites + helpers)
├── fixtures/              # Test data and fixtures
├── screenshots/           # Generated during E2E tests (gitignored)
├── downloads/             # Generated during E2E tests (gitignored)
├── conftest.py            # Pytest configuration and fixtures
└── package.json           # Playwright config
```

**E2E Tests (Playwright):**
- Located in `Tests/e2e/`
- 6 test suites: 01-complete-analysis-flow through 06-pdf-export
- Run with: `cd Tests && npx playwright test`
- Tests preserve sessions in `backend/sessions/{session_id}/` for debugging (set `PRESERVE_TEST_SESSIONS=false` to clean up)

**Backend Tests:**
- Located in `Tests/backend/`
- pytest with asyncio support
- Run with: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit` or `backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration`

## Session Storage

Sessions persisted to `backend/sessions/{session_id}/`:
- `session.json` - Session metadata, config, file list
- `pipeline_state.json` - Processing progress, completed steps
- `uploads/` - User uploaded files
- `results/` - Generated analysis outputs

**Session State Lifecycle:**
```
created → configuring → processing → completed/error
```

## Key Files Reference

**Configuration:**
- `backend/app/core/config.py` - Backend settings (pydantic-settings)
- `frontend/next.config.ts` - Frontend config, API proxy
- `backend/.env` - Environment variables (not in git)

**Entry Points:**
- `backend/app/main.py` - FastAPI application
- `frontend/src/app/page.tsx` - Welcome page

**Processing:**
- `backend/scripts/msqrob2_protein.R` - Step 6 (protein abundance)
- `backend/scripts/msqrob2_de.R` - Step 7 (differential expression)
- `backend/app/services/processing_orchestrator.py` - Pipeline orchestration
- R integration: Always via `subprocess.run(['Rscript', ...])` — never rpy2

**Documentation:**
- `AGENTS/` - 8 developer guides (overview, red lines, coding standards, API, state management, errors, testing, pipeline, lessons learned)
- `docs/openapi.yaml` - API specification
- `PROJECT_STRUCTURE.md` - Folder organization

## Troubleshooting

**Backend won't start:**
```bash
# Find the specific PID using port 8000 (do NOT use killall)
netstat -ano | findstr :8000
# Kill only that specific PID (use double slashes in bash)
taskkill //F //PID <PID>
# Check session scanning timeout (30s max in main.py)
```

**R script errors:**
```bash
# Verify packages (use full path if Rscript not on PATH)
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" -e "library(msqrob2); library(QFeatures); library(limma)"
```

**Python code changes not picked up:**
```bash
# Clear all __pycache__ directories recursively
find backend -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
find backend -name "*.pyc" -delete 2>/dev/null
```

**Port 8000 in use (Windows):**
```bash
# Find PID using port 8000
netstat -ano | findstr :8000
# Kill specific PID (use double slashes in bash)
taskkill //F //PID <PID>
```

**Test failures:**
```bash
# Clear test artifacts
rm -rf Tests/test-results/ Tests/screenshots/
rm -rf frontend/playwright-report/
```

**Virtual environment issues:**
The backend venv is at `backend/.venv/` and contains Python 3.12.10 with all dependencies. Always use it:
```bash
# Start backend
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000

# Run tests
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
```

If the venv is corrupted or missing packages:
```bash
# Recreate venv (use system Python)
rm -rf backend/.venv
cd backend && python -m venv .venv
cd backend && .venv/Scripts/activate
pip install -r requirements.txt
```

## Quick Start (Windows)

See **System Paths** section above for Python and R locations.

```bash
# Terminal 1 - Backend
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend && npm run dev
```

## Common Bug Patterns to Avoid

### Python Async Code
- **Always wrap `pd.read_csv()` in `asyncio.to_thread()`** in async functions
  ```python
  # CORRECT
  df = await asyncio.to_thread(pd.read_csv, path, sep='\t')

  # WRONG - blocks event loop
  df = pd.read_csv(path, sep='\t')
  ```
- **Never use blocking file I/O in async route handlers** - Always use `asyncio.to_thread()`

### R Scripts
- **Use `fixed=TRUE` in `grepl()`** when matching user-provided strings to avoid regex injection
  ```r
  # CORRECT
  if (grepl(treatment, x, ignore.case = TRUE, fixed = TRUE))

  # WRONG - regex special chars will be interpreted
  if (grepl(treatment, x, ignore.case = TRUE))
  ```
- **Don't use `colMedians`** (not in base R) - If needed, use `apply(x, 2, median, na.rm=TRUE)`

### TypeScript/React
- **Never use `as any` or `@ts-ignore`** - strict mode requirement
- **Use Zustand selectors** to prevent re-renders:
  ```typescript
  // CORRECT - only re-renders when sessions change
  const sessions = useSessionStore((state) => state.sessions);

  // WRONG - causes re-renders on any store change
  const store = useSessionStore();
  ```

### Testing
- **Always run tests from project root** - `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit` not `cd backend && pytest`
- **E2E tests are in `Tests/`** - Run with `cd Tests && npx playwright test`
