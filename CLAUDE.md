# CLAUDE.md

Guidance for Claude Code working in this repository.

## Project Overview

Full-stack proteomics data analysis platform. Next.js 16 + FastAPI + R bioinformatics.

| Layer | Stack |
|-------|-------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4, Zustand (Immer), Plotly.js, Cytoscape.js, Radix UI |
| Backend | FastAPI, Python 3.12+, Pydantic v2, scipy, scikit-learn |
| Analysis | R 4.5+, msqrob2, QFeatures, limma, MSstats, MSstatsBioNet, gseapy |

## Quick Start

```bash
# First time: install deps + pre-commit hooks
cd backend && .venv/Scripts/python.exe -m pip install -r requirements.txt
cd ../frontend && npm install && cd ../Tests && npm install
cd ../backend && .venv/Scripts/pre-commit.exe install

# Terminal 1 — Backend (must start FIRST)
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000

# Terminal 2 — Frontend (proxies /api/* → 127.0.0.1:8000)
cd frontend && npm run dev
# → http://localhost:3000
```

**Startup order matters.** If frontend shows 502/ECONNREFUSED, the backend isn't running on port 8000.

## System Paths

- **Python:** `backend/.venv/Scripts/python.exe` (3.12.10) — always use venv Python
- **R:** `C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe`

## Key Commands

```bash
# Tests (run from project root)
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration -v
cd Tests && npx playwright test && npx playwright show-report

# Lint
backend/.venv/Scripts/python.exe -m ruff check . && ruff format .
cd frontend && npm run lint
backend/.venv/Scripts/pre-commit.exe run --all-files   # manual pre-commit

# R verification
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" -e "library(msqrob2); library(QFeatures); library(limma); library(MSstats); cat('OK\n')"
```

## Architecture

```
HTTP Request → API Router → Service Layer → R Script / Python Processing
                                ↓
                        Session Store (JSON files)
```

**Key modules:**
- `app/api/routes/` — 8 route modules (sessions, upload, processing, visualization, reports, compounds, compare)
- `app/services/pipeline_engine.py` — Plugin-based step execution with PipelineState
- `app/services/pipeline_registry.py` — Pipeline definitions (msqrob2 + MSstats)
- `app/services/steps/` — Individual step handlers (10 + helpers)
- `app/services/base_r_wrapper.py` — Template Method base for R subprocess wrappers
- `app/services/task_manager.py` — Thread-pool-isolated background computation (TaskKind: PIPELINE, GSEA, BIONET, COMPUTE)
- `app/db/session_store.py` — JSON session persistence
- `app/models/` — Pydantic models: analysis.py, data.py, session.py

**Critical patterns:**
```python
# R integration — subprocess only, NEVER rpy2
subprocess.run(['Rscript', 'scripts/script.R', input_file, output_file], ...)

# Async — no blocking I/O in async functions
content = await asyncio.to_thread(read_file, file_path)
```

**Frontend stores (Zustand + Immer):**
```
sessionStore.ts | ui-store.ts | analysis-store.ts | processing-store.ts
```
Always use selectors: `useSessionStore(s => s.sessions)` — never the full store.

## Processing Pipeline

Plugin-based engine. Two pipelines, selected via `PipelineTool`. GSEA/BioNet/Compare are on-demand, not pipeline steps.

### msqrob2 (5 steps)
| # | Step | Tool |
|---|------|------|
| 1-2 | Combine Replicates → Unique PSM | Python (shared with MSstats) |
| 3 | Protein Abundance | R (QFeatures: filter, log2, normalize, impute, aggregate, gene map, batch correct) |
| 4 | Differential Expression | R (msqrob v1.16: `msqrob()` + `makeContrast()` + `hypothesisTest()`) |
| 5 | QC Metrics | Python |

### MSstats (8 steps)
| # | Step | Tool |
|---|------|------|
| 1-2 | Combine Replicates → Unique PSM | Python (shared) |
| 3-5 | Remove Razor → Low Quality → Filter | Python |
| 6 | Protein Abundance | R (MSstats dataProcess) |
| 7 | Differential Expression | R (MSstats groupComparison) |
| 8 | QC Metrics | Python |

### R Scripts
| Script | Step | Purpose |
|--------|------|---------|
| `msqrob2_data_process.R` | msqrob2-3 | Full QFeatures pipeline |
| `msqrob2_group_comparison_multi.R` | msqrob2-4 | Multi-condition DE |
| `msstats_data_process.R` | MSstats-6 | Protein abundance |
| `msstats_group_comparison_multi.R` | MSstats-7 | Group comparison |
| `bionet_network.R` | on-demand | INDRA subnetwork (MSstatsBioNet) |

## Data Flow

1. Upload `PSM_ExperimentName_Condition_Replicate.csv`
2. Parse filename → experiment, conditions, replicate
3. Validate columns: Sequence, Modifications, Charge, Contaminant, Master Protein Accessions, Quan Info, Abundance
4. Convert to TSV → R processing
5. Backend returns column-based → frontend transforms to row-based for Plotly

WebSocket: `ws://localhost:8000/ws/sessions/{session_id}` for real-time pipeline progress.

## API Contract

Base: `http://localhost:8000/api/sessions/{id}`

| Group | Endpoints |
|-------|-----------|
| Sessions | `POST /` `GET /` `GET /{id}` `PUT /{id}` `DELETE /{id}` `PUT /{id}/config` `POST /{id}/config` `PATCH /{id}/visualization-state` |
| Upload | `POST /{id}/upload/proteomics` `POST /{id}/upload/compound` `DELETE /{id}/files/{type}/{filename}` |
| Processing | `POST /{id}/process` `POST /{id}/cancel` `GET /{id}/status` `GET /{id}/logs` `POST /{id}/retry` |
| Visualization | `GET /{id}/results` `GET /{id}/qc/plots` `GET /{id}/protein/{pid}/abundance` `GET /{id}/protein/{pid}/peptide` |
| GSEA | `POST /{id}/gsea/run` `GET /{id}/gsea/status` `GET /{id}/gsea/{db}` `GET /{id}/gsea/{db}/plot` `GET /{id}/gsea/{db}/heatmap` |
| BioNet | `POST /{id}/bionet/run` `GET /{id}/bionet/status` `GET /{id}/bionet/subnetwork` |
| Compare | `POST /{id}/compare/protein` `POST /{id}/compare/matrix` `POST /{id}/compare/venn` `GET /{id}/compare/status` `GET /{id}/compare/result` `DELETE /{id}/compare/result` |
| Reports | `POST /{id}/reports/generate` `GET /{id}/reports` `GET /{id}/reports/{rid}/download` `DELETE /{id}/reports/{rid}` |
| Compounds | `GET /{id}/compounds` `GET /{id}/compounds/{cond}` `GET /{id}/compounds/{cond}/image` `GET /{id}/compounds/{cond}/properties` `POST /{id}/compounds/validate` |
| Other | `WS /ws/sessions/{id}` `GET /api/organisms` |

## Session Storage

`sessions/{session_id}/` contains `session.json`, `pipeline_state.json`, `uploads/`, `results/`.

State lifecycle: `created → configuring → queued → processing → completed/error/cancelled`

## Critical Red Lines

- **R:** NEVER rpy2 — always subprocess. UTF-8 with latin-1 fallback. Args are positional.
- **Files:** `PSM_ExperimentName_Condition_Replicate.csv`. Abundance column: `Abundance F{code} Sample`. Min 3 reps/condition.
- **TypeScript:** `strict: true`. NEVER `as any` or `@ts-ignore`. Never mutate Zustand state directly.
- **Python:** NEVER blocking I/O in async — use `asyncio.to_thread()`. Max upload 500MB.
- **Tests:** ALL tests in `Tests/`. Python in `Tests/backend/unit/` and `Tests/backend/integration/`. E2E in `Tests/e2e/`.
- **Data:** Internal format is TSV. R outputs column-based → frontend transforms to row-based.

## Troubleshooting

### Port 8000 in use (most common)
```powershell
taskkill /F /IM python.exe
netstat -ano | findstr ":8000.*LISTENING"   # should be empty
cd backend; .venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000
```

### Stale bytecode (code changes not picked up)
If a fix works in isolation but the API still fails, **it's always a cache issue:**
```powershell
taskkill /F /IM python.exe
Get-ChildItem -Recurse -Directory -Filter "__pycache__" -Path backend | Remove-Item -Recurse -Force
cd backend; .venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000
```

### Frontend issues
- **`npm run dev` fails:** `cd frontend && npm install` (missing/ stale node_modules)
- **API 404/502:** Backend must be running on port 8000 before frontend
- **Multipart upload fails with 6+ files:** Next.js dev proxy limitation — the app batches uploads into groups of 5. Try `npm run build && npm start` instead.
- **Port 3000 in use:** `netstat -ano | findstr ":3000.*LISTENING"` then `taskkill /F /PID <PID>`

### Tests
```powershell
backend\.venv\Scripts\python.exe -m pytest Tests/backend/ -v --tb=short
cd Tests && npx playwright install chromium && npx playwright test
Remove-Item -Recurse -Force Tests/test-results, Tests/screenshots, Tests/playwright-report -ErrorAction SilentlyContinue
```

### Pre-commit hooks
```powershell
backend\.venv\Scripts\pip.exe install pre-commit
backend\.venv\Scripts\pre-commit.exe install
# If blocked by core.hooksPath (Claude Code worktrees):
backend\.venv\Scripts\pre-commit.exe run --all-files
```

### Rebuild venv
```powershell
Remove-Item -Recurse -Force backend\.venv
cd backend; python -m venv .venv; .venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Common Bugs

- **R:** Use `fixed=TRUE` in `grepl()` for user-provided strings. Use `apply(x, 2, median, na.rm=TRUE)` not `colMedians`.
- **Tests:** Always run from project root — `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit`
- **R script args:** Check count with `length(args)` — arguments are positional only.
- **Biomart:** Always implement fallback for offline — return UniProt IDs as-is.
