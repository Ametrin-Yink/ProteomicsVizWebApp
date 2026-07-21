# Local Development

Portable project setup and verification guidance belongs here. Personal AI-assistant
instructions belong in ignored `AGENT.md`, `AGENTS.md`, or `CLAUDE.md` files.

## Development environment

- Python 3.12 in `backend/.venv`
- Node.js 22 with dependencies installed by `npm ci` in `frontend/`
- R 4.5+ available as `Rscript`
- On Windows with R 4.6+, install Rtools45; the R package setup script uses it to
  build CRAN's archived `log4r` dependency required by MSstats
- Local environment overrides belong in ignored `.env` files; never commit
  machine-specific absolute paths or secrets
- `SampleData/` and `backend/file_library/` are local data stores. Preserve them
  during cleanup and do not add them to Git.

## Developer guides

Before changing application code, read the relevant topic guides in `AGENTS/`,
especially:

- `02-absolute-red-lines.md`
- `03-coding-standards.md`
- `04-api-contract.md`
- `07-testing.md`
- `08-processing-pipeline.md`
- `09-lessons-learned.md`

## Baseline checks

Run from the repository root unless noted otherwise:

```powershell
backend/.venv/Scripts/python.exe -m ruff check backend Tests
backend/.venv/Scripts/python.exe -m pytest
backend/.venv/Scripts/python.exe backend/scripts/generate_openapi.py --check
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
```

Additional lanes are deliberately separate from the hermetic backend suite:

```powershell
# Mandatory before a TMT/DIA release: R smoke and both isolated pipelines
backend/.venv/Scripts/python.exe -m pytest -m r Tests/backend/integration/pipeline

# Browser critical journeys; starts isolated frontend and backend services
npm --prefix frontend run test:e2e
```

Verify the R packages separately:

```powershell
Rscript -e "library(msqrob2); library(QFeatures); library(limma); library(MSstats); cat('OK\n')"
```

Do not run tests against `SampleData/`; automated tests must use committed fixtures
under `Tests/fixtures/`. Release qualification covers TMT and DIA only; PTM is
omitted.

See `AGENTS/07-testing.md` for the required first-principles test quality standard.

## Shared report development

Shared report pages use `/reports/{share_token}` and the capability-scoped API at
`/api/shared-reports/{share_token}`. The internal `/api/reports` surface is for
management and must not be exposed by the public production listener.

Local development can omit `NEXT_PUBLIC_REPORT_BASE_URL`; generated links then
use the current browser origin. Production builds must set it to the public
report gateway. Set `REPORTS_DIR` to a persistent directory outside the Git
checkout on the server.

Run the focused report checks with:

```powershell
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/services/test_report_store.py Tests/backend/unit/services/test_report_generator.py Tests/backend/integration/routes/test_report_routes.py -q
npm --prefix frontend test -- --run src/components/layout/AppShell.test.tsx src/lib/__tests__/api-client-contract.test.ts
```

See `docs/REPORT_SHARING.md` and `deploy/Caddyfile` for the security boundary and
production port layout.
