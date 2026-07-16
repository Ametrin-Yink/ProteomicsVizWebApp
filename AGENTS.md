# ProteomicsViz Development Guide

Before changing application code, read the topic guides in `AGENTS/`, especially:

- `02-absolute-red-lines.md`
- `03-coding-standards.md`
- `04-api-contract.md`
- `07-testing.md`
- `08-processing-pipeline.md`
- `09-lessons-learned.md`

## Local development environment

- Python 3.12 in `backend/.venv`
- Node.js 22 with dependencies installed by `npm ci` in `frontend/`
- R 4.5+ available as `Rscript`
- On Windows with R 4.6+, install Rtools45; the R package setup script uses it to build CRAN's archived `log4r` dependency required by MSstats
- Local environment overrides belong in ignored `.env` files; never commit machine-specific absolute paths or secrets
- `SampleData/` and `backend/file_library/` are local data stores. Preserve them during cleanup and do not add them to Git.

## Baseline checks

Run from the repository root unless noted otherwise:

```powershell
backend/.venv/Scripts/python.exe -m ruff check backend Tests
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/routes -v
Set-Location frontend
npm run lint
npx tsc --noEmit
npx vitest run
npm run build
```

Verify the R packages separately:

```powershell
Rscript -e "library(msqrob2); library(QFeatures); library(limma); library(MSstats); cat('OK\n')"
```

Do not run tests against `SampleData/`; automated tests must use committed fixtures under `Tests/fixtures/`.
