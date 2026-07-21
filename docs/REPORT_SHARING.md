# Shared Report Security and Deployment

ProteomicsViz reports are self-contained, interactive snapshots. A recipient can
view the exported results and run GSEA, BioNet, and comparison analyses against
that report's copied data. A recipient cannot upload files, create a session,
enumerate reports, rename a report, rotate a link, or delete a report.

## Security model

Each report has two identifiers:

- `report_id` is an internal management identifier. It is used only by the full
  application for listing, renaming, link rotation, and deletion.
- `share_token` is a random 256-bit bearer capability. The public URL is
  `/reports/{share_token}` and report data is served below
  `/api/shared-reports/{share_token}`.

Possession of a shared link grants access to that one report. There is no user
account or login requirement in this early deployment. Treat the URL like a
password: anyone who receives or forwards it has the same report access.

The management UI can rotate a report link. Rotation immediately invalidates the
old token without rebuilding the report. Deleting the report invalidates every
link to it.

## Report contents and behavior

Report generation copies the completed session snapshot, excluding `uploads/`
and `pipeline_state.json`. The copied result and analysis artifacts remain
available after the source session is deleted. Generation happens in a staging
directory and the report is published with an atomic directory rename, so an
incomplete report is never listed or shared.

GSEA, BioNet, and Compare are intentionally enabled for shared recipients. Their
inputs are validated against comparisons present in the report, request sizes are
bounded, and CPU-heavy work uses the central task queue with timeouts. Generated
analysis artifacts are stored in the report and are therefore shared by all
recipients of that link.

Viewer-specific volcano filters and marked proteins are kept in the browser and
are not written back to the report. This prevents one recipient's browsing state
from changing the initial view for everyone else.

## Port allocation

| Listener | Exposure | Purpose |
|---|---|---|
| `10.202.25.39:8000` | Same-network users | Shared report pages, shared-report API, and required frontend assets only |
| `127.0.0.1:8001` | SSH tunnel only | Full application and report management |
| `127.0.0.1:3000` | Server loopback | Next.js frontend upstream |
| `127.0.0.1:8100` | Server loopback | FastAPI backend upstream |

The reference gateway is [deploy/Caddyfile](../deploy/Caddyfile). Its fallback is
404, so `/`, `/reports`, `/api/reports`, `/api/sessions`, `/api/files`, uploads,
and WebSockets are not reachable on port 8000. It also caps shared API request
bodies at 2 MB; use Caddy 2.10 or newer for the `request_body` directive.

From Windows, open the private application through SSH:

```powershell
ssh -N `
  -L 8000:127.0.0.1:8100 `
  -L 8001:127.0.0.1:8001 `
  kyin@10.202.25.39
```

Then browse to `http://127.0.0.1:8001`. Keep the PowerShell window open while
using the private application. The local port-8000 tunnel supports the existing
direct-upload client without exposing the backend on the server network.

For production builds, set:

```text
NEXT_PUBLIC_REPORT_BASE_URL=http://10.202.25.39:8000
BACKEND_URL=http://127.0.0.1:8100
REPORTS_DIR=/home/proteomicsviz/data/reports
CORS_ORIGINS=["http://127.0.0.1:8001","http://localhost:8001"]
```

`NEXT_PUBLIC_REPORT_BASE_URL` is embedded by Next.js at build time. Rebuild the
frontend after changing it. Leave `NEXT_PUBLIC_API_URL` unset in the production
frontend build so shared viewers use the public same-origin gateway; setting it
to server loopback would make their browsers call their own computers.

## Required server controls

- Bind the frontend and backend upstream ports to `127.0.0.1`, not all network
  interfaces.
- Open TCP 8000 only to the intended internal network. Do not open port 8001;
  use the SSH tunnel.
- Run the current backend with exactly one Uvicorn worker. Report locks and task
  coordination are in memory and are not safe across multiple backend workers.
- Run the services as an unprivileged service account. Restrict the report data
  directory to that account because capability tokens are stored in
  `report.json`.
- Back up the persistent data directory separately from the Git checkout and
  test restore procedures.
- Disable or redact HTTP access logs that record full report URLs. Tokens in URL
  paths can otherwise be copied into logs. The application sends `no-referrer`,
  `no-store`, and `noindex` headers, but browser history and manually copied URLs
  still contain the token.
- Prefer internal TLS before using the system for sensitive data. Plain HTTP on
  a shared LAN does not protect a report token from network interception.

## Release and deployment workflow

Development stays on Windows. AlmaLinux runs only verified revisions from
`main`; do not edit production source files on the server.

Use this initial, deliberately manual release flow:

1. Create a feature or fix branch from `main` on the development PC.
2. Run the required checks in `docs/DEVELOPMENT.md`, including the R-backed
   scientific release gate for TMT/DIA changes.
3. Merge the verified branch into `main` and push it to GitHub.
4. Record the commit to deploy and, for an important release, create a version
   tag. A production release must always be traceable to one exact commit.
5. From an SSH session, fetch that commit into a new release directory such as
   `/home/proteomicsviz/releases/<commit>`; never update the live directory in
   place and never store runtime data inside a release directory.
6. Create the release's Python virtual environment, install its dependencies,
   and build the Next.js frontend with the production environment values. Do
   not copy the Windows virtual environment, `node_modules`, or `.next` output.
7. Before switching traffic, verify the R package set, validate
   `deploy/Caddyfile`, start or smoke-test the new backend and frontend on
   loopback, and confirm the backend health endpoint succeeds.
8. Point `/home/proteomicsviz/current` at the new release, restart the backend
   and frontend systemd services, and run the checks in
   [Pre-deployment verification](#pre-deployment-verification).
9. Keep the previous release until the new release has passed a representative
   report and pipeline check. Roll back by restoring the previous `current`
   target and restarting the two application services; persistent data is not
   rolled back with application code.

The first deployments should be initiated explicitly over SSH after a merge.
Do not restart production automatically on every push to `main`. Automate this
workflow only after the health check, rollback, data compatibility, and backup
restore procedures have been exercised successfully.

The intended server layout is:

```text
/home/proteomicsviz/
|-- current -> releases/<commit>
|-- releases/
|   `-- <commit>/
`-- data/
    |-- sessions/
    |-- reports/
    |-- file-library/
    `-- protein-database/
```

Run the FastAPI and Next.js processes as separate systemd services under an
unprivileged service account. Caddy is the only network-facing service. The
backend service must use one Uvicorn worker and systemd must stop its R child
processes with the backend service.

## Current limitations

This is a capability-link design, not a full authorization system. It does not
provide recipient identity, per-user revocation, expiration, access audit,
download prevention, or protection against link forwarding. Add authentication
before reports need those properties.

All holders of a link share derived GSEA, BioNet, and Compare outputs. A later run
can replace an earlier derived result for that report. There is task concurrency
control and input bounding, but no per-recipient rate limit or compute quota yet.

Token lookup currently scans report metadata and broad report snapshots consume
disk space. Both are acceptable for early use, but report count, disk usage,
backup age, task failures, and gateway availability should be monitored. Add a
metadata index and a retention policy before report volume becomes large. A
process crash during generation can also leave an ignored `.rpt_*.staging`
directory; inspect and remove old staging directories during maintenance only
after confirming no generation is active.

## Pre-deployment verification

Before moving application data or opening port 8000:

1. Validate the Caddy configuration with `caddy validate --config deploy/Caddyfile`.
2. Confirm only 8000 and SSH are reachable from another same-network machine.
3. Confirm the SSH tunnel can open the full app on local port 8001.
4. Generate a report and verify its shared link can view results and run one
   bounded analysis.
5. Verify the public port returns 404/405 for `/`, `/reports`, `/api/reports`,
   `/api/sessions`, and DELETE/PATCH requests under `/api/shared-reports`.
6. Rotate the link and verify the old link returns 404 while the new link works.
7. Delete the source session and verify the report still works.
8. Restart the services and verify reports remain available from `REPORTS_DIR`.
9. Confirm backup, disk monitoring, service restart policy, and log handling.
