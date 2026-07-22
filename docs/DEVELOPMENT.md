# Development and verification

## Supported toolchain

- Python 3.12+
- Node.js 22+
- R 4.5+

Install Python and Node dependencies from their committed manifests. Install and verify R packages with the repository scripts:

```powershell
Rscript backend\scripts\install_r_packages.R
Rscript backend\scripts\verify_r_packages.R
```

Local runtime roots default below `backend/`. Tests replace them with isolated temporary directories and must never read from `SampleData/`, `real_sample_files/`, or production data.

## Local development ports

Run the Windows development frontend on `127.0.0.1:3000` and its FastAPI backend on `127.0.0.1:8002`:

```powershell
# PowerShell window 1
backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --port 8002

# PowerShell window 2
$env:BACKEND_URL = "http://127.0.0.1:8002"
$env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:8002"
npm --prefix frontend run dev -- --hostname 127.0.0.1 --port 3000
```

These per-process environment variables override any production-tunnel URL in `frontend/.env.local`. Ports `8000` and `8001` on Windows belong to the optional production SSH tunnel and are not local-development backend ports. See [Server access and development cycle](SERVER_ACCESS_AND_DEV_CYCLE.md#port-ownership) for the complete mapping.

## Required development gate

Run from the repository root:

```powershell
backend\.venv\Scripts\python.exe -m ruff check backend Tests
backend\.venv\Scripts\python.exe backend\scripts\generate_openapi.py --check
backend\.venv\Scripts\python.exe -m pytest
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
```

Regenerate the API contract after a route or schema change:

```powershell
backend\.venv\Scripts\python.exe backend\scripts\generate_openapi.py
```

## Additional gates

Use the R environment smoke test whenever R integration, deployment dependencies, or scientific code changes:

```powershell
backend\.venv\Scripts\python.exe -m pytest Tests\backend\integration\pipeline\test_r_integration.py
```

Run the R-backed pipeline integration suite for changes that can affect scientific outputs:

```powershell
backend\.venv\Scripts\python.exe -m pytest -m r Tests\backend\integration\pipeline
```

Run browser journeys for user-flow, routing, upload, report, or cross-stack changes:

```powershell
npm --prefix frontend run test:e2e
```

PTM has unit/component coverage and has been exercised end-to-end with real data, but its representative live scientific test lane is not yet equivalent to the committed TMT/DIA known-answer lane. Do not describe that gap as PTM being unsupported.

## Change workflow

1. Create a focused branch from the latest `main`.
2. Reproduce a bug with a failing test or define the observable success condition.
3. Make the smallest scoped change.
4. Run the relevant focused tests, then the required gate above.
5. Update current documentation and regenerate OpenAPI when applicable.
6. Merge the verified change into `main`, push, and deploy the exact full commit SHA.

The end-to-end Windows-to-server workflow is documented in
[Server access and development cycle](SERVER_ACCESS_AND_DEV_CYCLE.md).
Production installation and release internals are documented in
[deploy/README.md](../deploy/README.md).
