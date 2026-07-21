# ProteomicsViz

ProteomicsViz is an internal web application for end-to-end proteomics analysis. It supports TMT protein, DIA protein, and PTM TMT workflows, then presents interactive results and publishable capability-link reports.

## What it does

- Uploads local files or reuses files from the server file library.
- Configures sample/channel metadata, comparisons, filtering, normalization, and modeling.
- Runs six-stage pipelines with persistent status, logs, cancellation, and retry.
- Visualizes differential abundance, quality control, protein details, enrichment, networks, and comparisons where supported.
- Publishes completed sessions as immutable report snapshots. A report recipient can access only the report identified by the opaque link.

## Supported workflows

| Workflow | Pipeline key | Statistical engine | Primary results |
|---|---|---|---|
| TMT protein | `msstats` | MSstats | Protein differential abundance and QC |
| DIA protein | `msqrob2` | msqrob2/QFeatures | Protein differential abundance and QC |
| PTM TMT | `ptm` | MSstatsPTM | PTM sites, protein results when supplied, protein-adjusted PTM, and QC |

See [Pipeline workflows](docs/PIPELINES.md) for inputs, stages, and output behavior.

## Runtime requirements

- Python 3.12+
- Node.js 22+
- R 4.5+
- The Python packages in `backend/requirements.txt`
- The Node packages locked by `frontend/package-lock.json`
- The R packages installed by `backend/scripts/install_r_packages.R`

## Local development on Windows

Create the backend environment from the repository root:

```powershell
py -3.12 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Rscript backend\scripts\install_r_packages.R
npm --prefix frontend ci
```

Start the backend:

```powershell
backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --port 8000
```

In a second PowerShell window, start the frontend:

```powershell
npm --prefix frontend run dev
```

Open [http://localhost:3000](http://localhost:3000). Runtime data defaults to `backend/sessions`, `backend/reports`, and `backend/file_library`; these directories are not source-controlled.

## Production

Production runs natively on AlmaLinux as separate FastAPI and Next.js systemd services behind Caddy. Development remains on Windows, verified work is merged to `main`, and the server deploys one exact Git commit into an immutable release directory.

- Shared reports: `http://10.202.25.39:8000/reports/<share_token>`
- Full private application: `http://127.0.0.1:8001` through the documented SSH tunnel
- Deployment runbook: [deploy/README.md](deploy/README.md)
- Security and port contract: [docs/REPORT_SHARING.md](docs/REPORT_SHARING.md)

Do not edit production releases in place and do not deploy an abbreviated commit hash copied before a push completes. Use the full 40-character commit SHA shown by GitHub or `git rev-parse origin/main`.

## Verification

The normal development gate is:

```powershell
backend\.venv\Scripts\python.exe -m ruff check backend Tests
backend\.venv\Scripts\python.exe backend\scripts\generate_openapi.py --check
backend\.venv\Scripts\python.exe -m pytest
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
```

R-backed and browser suites are explicit additional gates; see [Development and verification](docs/DEVELOPMENT.md).

## Documentation

- [Documentation index](docs/README.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Development and verification](docs/DEVELOPMENT.md)
- [Server access and development cycle](docs/SERVER_ACCESS_AND_DEV_CYCLE.md)
- [Pipeline workflows](docs/PIPELINES.md)
- [Shared reports](docs/REPORT_SHARING.md)
- [Generated OpenAPI contract](docs/api/openapi.yaml)
- [Repository instructions](AGENTS.md)
- [Engineering architecture](docs/engineering/ARCHITECTURE.md)
