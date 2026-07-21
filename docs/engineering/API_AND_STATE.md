# API and frontend state

The generated route-level authority is [OpenAPI](../api/openapi.yaml). Regenerate it after FastAPI route or schema changes:

```powershell
backend\.venv\Scripts\python.exe backend\scripts\generate_openapi.py
```

CI runs the same command with `--check`.

## Security surfaces

- Private application/session APIs: `/api/sessions`, `/api/files`, related analysis routes, and `/ws/sessions/{id}`.
- Private report management: `/api/reports` and session report generation.
- Public capability API: `/api/shared-reports/{share_token}`.

Shared routes never accept an internal `report_id`. Unknown, invalid, and revoked tokens return indistinguishable 404 responses. The public surface has no list, upload, session creation/execution, rename, deletion, token rotation, cancellation, or visualization-state mutation.

## Important session contracts

`Session.pipeline` is `msqrob2`, `msstats`, or `ptm`. Session states are `created`, `configuring`, `queued`, `processing`, `completed`, `error`, and `cancelled`.

Protein filtering uses independent fields:

- `resolve_shared_peptides`
- `max_missing_fraction_per_condition` (0-1)
- `min_psms_per_protein` (1-10)

New configuration fields must exist in `SessionConfig` and `AnalysisConfig`, be forwarded by processing orchestration, persist/restore through the frontend, and have a non-default contract test.

Key PTM routes provide result layers, ZIP download, comparison summaries, site evidence/abundance, and QC below both live session and copied shared-report prefixes. `/qc/plots` is the canonical QC suffix; do not introduce `/qc/data`.

## Zustand ownership

| Store | Ownership |
|---|---|
| `sessionStore.ts` | Session list/current-session lifecycle and persistence |
| `analysis-store.ts` | Workflow inputs, metadata, configuration, and restoration |
| `processing-store.ts` | Pipeline progress, logs, queue/status, WebSocket updates |
| `ui-store.ts` | Toasts, dialogs, and transient UI state |

Components select only the state they need and mutate through store actions. Do not duplicate derived values or mix domains. Page reload and session switching must recover from persisted backend/session state rather than assume an uninterrupted wizard.

Abort or disregard stale requests so an old session/report response cannot overwrite the current selection. WebSocket consumers must handle reconnects, status reconciliation, completion, error, and cancellation without duplicating events.

## Visualization scope

Reusable visualization components consume data source and permissions from `ApiProvider`:

- Private session pages use a session prefix and may persist supported visualization state.
- Shared pages use `/api/shared-reports/{share_token}` with `scope="shared-report"`.
- Shared filters and markers remain browser-local.
- Permission checks use `canPersistVisualizationState`; they never parse pathname or identifier shape.

The visualization manifest and pipeline determine navigation. Protein shared reports may expose bounded on-demand modules. PTM shared reports expose Volcano and QC, while read-only endpoints also provide layers, site details, and downloads.
