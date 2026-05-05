# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. Read this throughly before starting your works.

## Project Overview

Proteomics Visualization Web App - A full-stack scientific data analysis platform with a Next.js frontend, FastAPI backend, and R-based bioinformatics pipeline.

**Tech Stack:**
- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, Plotly.js
- Backend: FastAPI, Python 3.12+, Pydantic, asyncio
- Analysis: R 4.5+, msqrob2, QFeatures, limma, MSstats, gseapy

## Quick Start (Dev)

```bash
# Install deps (first time)
cd backend && .venv/Scripts/python.exe -m pip install -r requirements.txt
cd ../frontend && npm install
cd ../Tests && npm install

# Terminal 1 - Backend (use backend venv)
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000

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
- `app/api/routes/` - 7 route modules (sessions, upload, analysis, processing, visualization, reports, compounds)
- `app/services/pipeline_engine.py` - Plugin-based step execution engine
- `app/services/pipeline_registry.py` - Pipeline template definitions (maps AnalysisTemplate to steps)
- `app/services/steps/` - Individual step handlers (one file per pipeline step)
- `app/services/` - Business logic including msqrob2_wrapper, msstats_wrapper, data_processor, gsea_service
- `app/db/session_store.py` - JSON-based session persistence
- `app/models/` - Pydantic models (AnalysisTemplate enum, AnalysisConfig, Session)
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
stores/
├── sessionStore.ts     # Session data (persisted)
├── ui-store.ts                # UI state
├── analysis-store.ts          # Analysis state
├── processing-store.ts # Real-time processing status
```

**Pattern - Store Usage:**
```typescript
const sessions = useSessionStore((state) => state.sessions);  // GOOD
const state = useSessionStore();  // BAD - causes re-renders
```

### Processing Pipeline

The pipeline uses a **plugin-based engine** (`pipeline_engine.py`) with step handlers registered via `pipeline_registry.py`. The active template is `MULTI_CONDITION` (`"multi_condition_comparison"`); `TIME_SERIES` is reserved for future use.

**9 Steps (msqrob2-based):**

| Step | Name | Tool |
|------|------|------|
| 1 | Combine Replicates | Python (DataProcessor) |
| 2 | Generate Unique PSM | Python (DataProcessor) |
| 3 | Remove Razor Peptides | Python (DataProcessor, conditional) |
| 4 | Remove Low Quality | Python (DataProcessor) |
| 5 | Filter by Criteria | Python (DataProcessor) |
| 6 | Protein Abundance | R/msqrob2 (`msqrob2_data_process.R`) |
| 7 | Differential Expression (multi-condition) | R/msqrob2 (`msqrob2_group_comparison_multi.R`) |
| 8 | QC Metrics | Python (QCCalculator) |
| 9 | GSEA Analysis | Python/gseapy (GO, KEGG, Reactome) |

**R Scripts Reference:**

| Script | Step | Purpose |
|--------|------|---------|
| `msqrob2_data_process.R` | 6 | Peptide-to-protein aggregation via msqrob2 |
| `msqrob2_group_comparison_multi.R` | 7 | Multi-condition DE with N conditions, M contrasts |
| `msstats_data_process.R` | (alt 6) | MSstats protein abundance (not wired into pipeline) |
| `msstats_group_comparison_multi.R` | (alt 7) | MSstats group comparison (not wired into pipeline) |
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
- **Required packages:** msqrob2, QFeatures, limma, MSstats
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
- Analysis: `POST /{id}/analysis/start` (deprecated, redirects to `/process`), `POST /{id}/analysis/cancel`
- Results: `GET /{id}/results`, `GET /{id}/qc/plots`, `GET /{id}/gsea/{db}`, `GET /{id}/gsea/{db}/plot`, `GET /{id}/gsea/{db}/heatmap`
- Protein: `GET /{id}/protein/{protein_id}/abundance`, `GET /{id}/protein/{protein_id}/peptide`
- Reports: `POST /{id}/reports/generate`, `GET /{id}/reports`, `GET /{id}/reports/{rid}/download`, `DELETE /{id}/reports/{rid}`
- Compounds: `GET /{id}/compounds`, `GET /{id}/compounds/{condition}`, `GET /{id}/compounds/{condition}/image`, `GET /{id}/compounds/{condition}/properties`, `POST /{id}/compounds/validate`
- WebSocket: `WS /ws/sessions/{id}`
- Organisms: `GET /api/organisms`

## Session Storage

Sessions persisted to `backend/sessions/{session_id}/`:
- `session.json` - Session metadata, config, file list
- `pipeline_state.json` - Processing progress, completed steps
- `uploads/` - User uploaded files
- `results/` - Generated analysis outputs

**Session State Lifecycle:** `created -> configuring -> processing -> completed/error`

## Key Files Reference

- `backend/app/main.py` - FastAPI application, route mounting, lifespan handlers
- `backend/app/core/config.py` - Settings (pydantic-settings: R paths, timeouts, caching)
- `backend/app/services/pipeline_engine.py` - Pipeline step execution engine
- `backend/app/services/pipeline_registry.py` - Template-to-step mapping
- `backend/app/services/processing_orchestrator.py` - Pipeline orchestration (adapts engine to session lifecycle)
- `backend/app/models/analysis.py` - AnalysisTemplate enum, AnalysisConfig, pipeline models
- `backend/scripts/msqrob2_data_process.R` - Step 6 (protein abundance)
- `backend/scripts/msqrob2_group_comparison_multi.R` - Step 7 (multi-condition DE)
- `frontend/next.config.ts` - Frontend config, API proxy to `http://127.0.0.1:8000`
- `AGENTS/` - 9 developer guides covering overview, red lines, coding standards, API contract, state management, error handling, testing, pipeline, and lessons learned
- `docs/api/openapi.yaml` - API specification
- `docs/CONTRIBUTING.md` - Contributor guidelines

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
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000

# Verify routes
curl -s http://localhost:8000/openapi.json | python -c "import sys,json; d=json.load(sys.stdin); [print(p,list(d['paths'][p].keys())) for p in sorted(d['paths']) if 'protein' in p]"
```

**Python code changes not picked up (IMPORTANT):**
uvicorn's `--reload` mode on Windows can serve stale bytecode. **Always clear `__pycache__` BEFORE restarting** when debugging:
```bash
taskkill //F //IM python.exe
find backend -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
find backend -name "*.pyc" -delete 2>/dev/null
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000
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