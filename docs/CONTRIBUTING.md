# Contributing to Proteomics Visualization Web App

## Prerequisites

- **Python 3.12** — backend venv at `backend/.venv/`
- **Node.js 20+** — frontend
- **R 4.5+** — with `Rscript` available on `PATH`
- **Git**

## Setup

### Backend

```bash
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
```

**Required R packages:**
```bash
Rscript -e "BiocManager::install(c('msqrob2', 'QFeatures', 'limma', 'MSstats'))"
```

### Frontend

```bash
npm --prefix frontend install
```

### Tests

```bash
# Hermetic backend PR suite (from project root)
backend/.venv/Scripts/python.exe -m pytest

# Required before a TMT/DIA release
backend/.venv/Scripts/python.exe -m pytest -m r Tests/backend/integration/pipeline

# Frontend unit/component and isolated browser tests
npm --prefix frontend test
npm --prefix frontend run test:e2e
```

## Development

```bash
# Terminal 1 - Backend
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --reload --reload-exclude "sessions" --port 8000

# Terminal 2 - Frontend
npm --prefix frontend run dev
```

## Code Quality

```bash
# Frontend
npm --prefix frontend run lint
npm --prefix frontend run lint:fix

# Backend
backend/.venv/Scripts/python.exe -m ruff check backend Tests
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
- **Test location**: Backend tests use `Tests/`; browser tests use `frontend/e2e/`; frontend unit/component tests are colocated under `frontend/src/`
- **Test quality**: Follow the risk-based standard in `AGENTS/07-testing.md`; test count alone is not a quality measure
- **TypeScript**: strict mode required, no `as any` or `@ts-ignore`

For full developer guides, see the [AGENTS/](../AGENTS/) directory.

For the current local environment and baseline verification commands, see
[DEVELOPMENT.md](DEVELOPMENT.md).
