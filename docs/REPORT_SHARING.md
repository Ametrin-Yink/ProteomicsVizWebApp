# Shared report security and deployment

ProteomicsViz publishes a completed session as a self-contained snapshot. A recipient receives an opaque URL for one report and does not receive access to the full application.

## Capability model

Each report has two identifiers:

- `report_id`: internal management ID used by the private application to list, rename, delete, and rotate links.
- `share_token`: random 256-bit bearer capability used in `/reports/{share_token}` and `/api/shared-reports/{share_token}`.

Anyone holding the URL can access that report. There is no recipient account, identity, per-user permission, or expiration in the current early deployment. Treat a report link like a password. Rotation invalidates the old token; deletion invalidates all links.

Report generation copies the completed session except `uploads/` and `pipeline_state.json`. It publishes through a staging directory and atomic rename, so an incomplete snapshot is not listed or shared. The report remains available if the source session is later deleted.

## Capabilities by report type

| Capability | Protein report | PTM report |
|---|---:|---:|
| View result tables and volcano plots | Yes | Yes, across available PTM/protein/adjusted layers |
| View QC | Yes | Yes, at available PTM and protein levels |
| View protein/site detail and abundance | Protein detail | PTM site evidence and abundance |
| Download immutable result archive | Existing result downloads | `ptm_results.zip` through `Download Results` |
| Run report-scoped GSEA, BioNet, or Compare | Yes, bounded and queued | No; shared UI exposes Volcano and QC only |
| Upload, create/run sessions, or manage reports | No | No |

Viewer filters and markers remain browser-local and are never persisted to the shared snapshot. Derived protein-report computations are validated against comparisons in the snapshot, bounded, and scheduled through `TaskManager`; all holders of the link see the same generated artifacts.

## Network contract

| Listener | Exposure | Purpose |
|---|---|---|
| `10.202.25.39:8000` | Intended internal network | Shared report pages, approved shared APIs, and frontend assets |
| `127.0.0.1:8001` | Server loopback; SSH tunnel only | Full application and report management |
| `127.0.0.1:3000` | Server loopback | Next.js upstream |
| `127.0.0.1:8100` | Server loopback | FastAPI upstream |

Caddy is the only network-facing application process. Its public listener uses an explicit allowlist and a 404 fallback. The public port must not expose `/`, `/reports`, `/api/reports`, `/api/sessions`, `/api/files`, uploads, WebSockets, private navigation, or report mutation methods.

From Windows, create both tunnels because the current upload client uses the direct local backend mapping:

```powershell
ssh -N `
  -L 8000:127.0.0.1:8100 `
  -L 8001:127.0.0.1:8001 `
  kyin@10.202.25.39
```

Open `http://127.0.0.1:8001` and keep the SSH process running.

## Production configuration

The relevant values are:

```text
NEXT_PUBLIC_REPORT_BASE_URL=http://10.202.25.39:8000
BACKEND_URL=http://127.0.0.1:8100
REPORTS_DIR=/home/proteomicsviz/data/reports
CORS_ORIGINS=["http://127.0.0.1:8001","http://localhost:8001"]
```

`NEXT_PUBLIC_REPORT_BASE_URL` is embedded during the Next.js build. Leave `NEXT_PUBLIC_API_URL` unset in production so shared browsers use the same-origin gateway. A loopback API URL embedded in the public frontend would point recipients at their own computers.

## Required controls

- Bind backend and frontend upstreams to loopback.
- Open TCP 8000 only to the intended internal network; keep server port 8001 closed.
- Run one Uvicorn worker. Current task/report locks are process-local.
- Run services as the unprivileged `proteomicsviz` account.
- Protect and back up `/home/proteomicsviz/data`; tokens are stored in report metadata.
- Keep access logging disabled or redact full report paths because URLs contain bearer tokens.
- Use internal TLS before the system carries sensitive data across a network where plain HTTP interception is a concern.
- Monitor disk space, backup age, service state, task failures, report count, and abandoned `.rpt_*.staging` directories.

## Verification checklist

After a deployment that affects reports, routing, or security:

1. Validate `/etc/caddy/Caddyfile`.
2. Confirm only SSH and port 8000 are reachable from another network machine.
3. Confirm the SSH tunnel opens the full app on local port 8001.
4. Generate a protein report and verify its expected modules and one bounded on-demand analysis.
5. Generate a PTM report and verify Volcano, QC, all available layers, site details, and `Download Results`.
6. Confirm the public listener denies private routes and mutation methods.
7. Rotate a link and verify the old link returns 404.
8. Delete a source session and verify its published report still works.
9. Restart services and verify reports persist.
10. Verify backups, monitoring, restart policy, and token-safe logging.

## Limitations

This capability-link model does not provide recipient identity, individual revocation, expiration, audit, download prevention, or protection against forwarding. Add authentication and authorization before those properties are required. Token lookup and full report snapshots are acceptable for early internal use but will need indexing, quotas, and a retention policy as volume grows.
