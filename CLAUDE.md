# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Proteomics Visualization Web App - A full-stack scientific data analysis platform with a Next.js frontend, FastAPI backend, and R-based bioinformatics pipeline.

**Tech Stack:**
- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, Plotly.js
- Backend: FastAPI, Python 3.11+, Pydantic, asyncio
- Analysis: R 4.3+, msqrob2, QFeatures, limma, gseapy

## Common Commands

### Development (Start Both Services)
```bash
# Terminal 1 - Backend
cd backend && uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend && npm run dev

# Access at http://localhost:3000
```

### Testing
```bash
# Backend tests
cd backend && pytest
cd backend && pytest tests/unit/test_file_parser.py::TestFileParser::test_parse_valid_filename

# Frontend E2E tests (Playwright)
cd frontend && npx playwright test
cd frontend && npx playwright test e2e/04-results.spec.ts --headed

# View test report
cd frontend && npx playwright show-report
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
Rscript -e "library(msqrob2); library(QFeatures); library(limma); cat('OK\n')"
```

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
├── session-store.ts    # Session data (persisted)
├── ui-store.ts         # UI state (modals, toasts, selections)
├── data-store.ts       # Cached analysis results
└── processing-store.ts # Real-time processing status
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

## API Contract

**Base URL:** `http://localhost:8000/api/v1`

**Key Endpoints:**
- `POST /sessions` - Create session
- `POST /sessions/{id}/upload/proteomics` - Upload PSM files
- `POST /sessions/{id}/process` - Start processing pipeline
- `GET /sessions/{id}/results` - Get DE results
- `GET /sessions/{id}/qc/plots` - Get QC data (NOT `/qc/data`)
- `GET /sessions/{id}/gsea/{database}` - Get GSEA results
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

**E2E Tests (Playwright):**
- Located in `Tests/e2e/` (not `frontend/tests/e2e/`)
- 8 test suites: 01-welcome through 08-session-manager
- Test helpers in `Tests/helpers.ts`
- Run with: `cd frontend && npx playwright test`
- Tests preserve sessions in `backend/sessions/{session_id}/` for investigation
- Clear sessions between runs: `rm -rf backend/sessions/*`

**Backend Tests:**
- Located in `backend/tests/`
- pytest with asyncio support
- Run with: `cd backend && pytest`

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

**Documentation:**
- `AGENTS/` - 14 comprehensive guides
- `docs/openapi.yaml` - API specification
- `PROJECT_STRUCTURE.md` - Folder organization

## Troubleshooting

**Backend won't start:**
```bash
# Kill existing uvicorn processes
taskkill /F /IM python.exe  # Windows
# Check session scanning timeout (30s max in main.py)
```

**R script errors:**
```bash
# Verify packages
Rscript -e "library(msqrob2); library(QFeatures); library(limma)"
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

**Virtual environment Python path invalid:**
The `backend/.venv` may reference a non-existent Python installation (e.g., `C:\Python314\python.exe`). If you see "executable not found" errors when starting the backend:

```bash
# Option 1: Use global Python (recommended - all deps pre-installed)
cd backend && D:/Software/Python/python.exe -m uvicorn app.main:app --reload --port 8000

# Option 2: Recreate venv with correct Python
rm -rf backend/.venv
cd backend && D:/Software/Python/python.exe -m venv .venv
source backend/.venv/Scripts/activate
pip install -r backend/requirements.txt
```

**Python locations on this system:**
- Global Python: `D:/Software/Python/python.exe` (has all dependencies)
- R installation: `D:/Software/R-4.5.3/bin/x64/R.exe`
