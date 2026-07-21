# Repository instructions

These instructions apply to the entire ProteomicsViz repository.

## Working method

- State assumptions explicitly. If scientific intent, destructive scope, or the requested behavior is unclear, stop and ask.
- For multi-step changes, state a short plan with a verification condition for each step.
- Implement the minimum code that solves the requested problem. Do not add speculative options, abstractions, or adjacent refactors.
- Touch only required files. Preserve unrelated user changes and match existing style.
- For a bug, first add or identify a test that reproduces it, then loop until the focused test and relevant gate pass.
- Update the nearest current document when behavior, configuration, dependencies, APIs, security boundaries, or operations change.

## Non-negotiable project boundaries

- Invoke R through `Rscript`; never add `rpy2`.
- Preserve DuckDB/Python/R artifact schemas and scientific semantics. Do not silently change filtering, identifiers, normalization, imputation, aggregation, contrasts, or adjustment.
- Quote dynamic DuckDB identifiers through the established helpers. Vendor headers and TMT channel keys are data, not SQL syntax.
- Keep TypeScript strict. Do not use `as any` or `@ts-ignore` to bypass contracts.
- Do not block the async event loop with filesystem, CPU, or subprocess work.
- Never let user-provided paths escape configured session, report, file-library, or reference roots.
- Tests must use isolated roots and must not read or mutate real samples, sessions, reports, file-library data, or production services.
- Shared report routes accept only opaque `share_token` capabilities. Never expose private session/file/report-management routes or the private shell on the public listener.
- Protein shared analyses must be snapshot-scoped, bounded, and queued. PTM shared reports remain read-only.
- Keep one Uvicorn worker until task/report coordination uses durable shared infrastructure.
- Never edit an activated production release in place or deploy while a pipeline/report computation is active.

## Change verification

Run the narrowest reproducing test while developing. Before handing off a code change, run the relevant commands from the repository root:

```powershell
backend\.venv\Scripts\python.exe -m ruff check backend Tests
backend\.venv\Scripts\python.exe backend\scripts\generate_openapi.py --check
backend\.venv\Scripts\python.exe -m pytest
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
```

Scientific, R-environment, and browser changes have additional gates in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [docs/engineering/TESTING.md](docs/engineering/TESTING.md).

## Reference documentation

- [Architecture](docs/engineering/ARCHITECTURE.md)
- [API and frontend state](docs/engineering/API_AND_STATE.md)
- [Error handling and recovery](docs/engineering/ERROR_HANDLING.md)
- [Testing standard](docs/engineering/TESTING.md)
- [Engineering lessons](docs/engineering/LESSONS_LEARNED.md)
- [Pipeline contracts](docs/PIPELINES.md)
- [Shared-report security](docs/REPORT_SHARING.md)
- [Deployment](deploy/README.md)
