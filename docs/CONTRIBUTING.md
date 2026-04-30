# Contributing to Proteomics Visualization Web App

## Prerequisites

- **Python 3.12** — backend venv at `backend/.venv/`
- **Node.js 20+** — frontend
- **R 4.5+** — installed at `C:/Program Files/R/R-4.5.1/`
- **Git**

## Setup

### Backend

```bash
cd backend
.venv/Scripts/python.exe -m pip install -r requirements.txt
```

**Required R packages:**
```bash
Rscript -e "BiocManager::install(c('msqrob2', 'QFeatures', 'limma'))"
```

### Frontend

```bash
cd frontend && npm install
```

### Tests

```bash
# Backend tests (from project root)
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration -v

# E2E tests (Playwright)
cd Tests && npx playwright test
```

## Development

```bash
# Terminal 1 - Backend
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000

# Terminal 2 - Frontend
cd frontend && npm run dev
```

## Code Quality

```bash
# Frontend
cd frontend && npm run lint && npm run lint:fix

# Backend
cd backend && ruff check . && ruff format .
```

## Commit Messages

Use conventional commits:

```
feat: add volcano plot selection modes
fix: resolve QC plots empty issue
docs: update API documentation
test: add E2E tests for bioinformatics
refactor: simplify data transformation
```

## Pull Request Process

1. Create feature branch from `main`
2. Run all tests and lint checks
3. Update documentation if needed
4. Submit PR with clear description

## Architecture Notes

- **R integration**: Always via `subprocess.run(['Rscript', ...])`, never rpy2
- **Session storage**: JSON files in `backend/sessions/{session_id}/`
- **Test location**: ALL tests go in `Tests/`, never in `backend/tests/` or `frontend/tests/`
- **TypeScript**: strict mode required, no `as any` or `@ts-ignore`

For full developer guides, see the [AGENTS/](../AGENTS/) directory.
