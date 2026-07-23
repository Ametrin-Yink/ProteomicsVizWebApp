# Server access and development cycle

This guide covers the normal path from Windows development to the AlmaLinux production server at `10.202.25.39`. It distinguishes connecting to the private application, updating the server checkout, and activating a production release.

## Accounts, addresses, and paths

| Item | Value | Purpose |
|---|---|---|
| SSH account | `kyin@10.202.25.39` | Administration and deployment entry point |
| Public listener | `http://10.202.25.39:8000` | Shared report links only |
| Private application | `http://127.0.0.1:8001` on Windows | Full application through an SSH tunnel |
| Local backend tunnel | `http://127.0.0.1:8000` on Windows | Direct upload/API traffic used by the private frontend |
| Administrative checkout | `/home/kyin/ProteomicsViz` | Human-managed checkout containing `deploy/deploy.sh` |
| Deployment source | `/home/proteomicsviz/source` | Service-account checkout managed by the deployment script |
| Active release | `/home/proteomicsviz/current` | Symlink to the running immutable release |
| Persistent data | `/home/proteomicsviz/data` | Sessions, reports, file library, references, and runtime state |

Do not edit `/home/proteomicsviz/current`, a release directory, or the deployment source checkout manually. Do not store runtime data inside a release.

## Port ownership

`127.0.0.1` always identifies the machine on which the URL is opened. The port determines which listener receives the request. On the Windows development PC, use these ports:

| Windows URL | Owner | Purpose |
|---|---|---|
| `http://127.0.0.1:3002` | Local Next.js development process | Development UI for the current checkout |
| `http://127.0.0.1:8002` | Local FastAPI development process | Development API and local runtime data |
| `http://127.0.0.1:8000` | SSH forward to server `127.0.0.1:8100` | Production FastAPI traffic used by the tunneled production UI |
| `http://127.0.0.1:8001` | SSH forward to server `127.0.0.1:8001` | Complete private production application |

Port `3002` is used for development instead of `3000` because the production
Next.js service occupies `127.0.0.1:3000` on the AlmaLinux server. Using a
uniform pair (`:3002` / `:8002`) on both Windows and the server keeps the
commands identical across environments.

The corresponding AlmaLinux listeners are:

| Server listener | Owner | Exposure |
|---|---|---|
| `127.0.0.1:3000` | Production Next.js service | Loopback only, behind Caddy |
| `127.0.0.1:8100` | Production FastAPI service | Loopback only, reached by Caddy and the Windows `8000` tunnel |
| `127.0.0.1:8001` | Private Caddy listener | Loopback only, reached by the Windows `8001` tunnel |
| `0.0.0.0:8000` | Public Caddy listener | Shared-report capability surface only |

Normal development pairs frontend `3002` with backend `8002` on both Windows and the AlmaLinux server. Do not point the local development frontend at Windows ports `8000` or `8001`; doing so mixes code from the current checkout with production APIs and production data.

## Verify SSH access

Passwordless SSH is configured with the Windows Ed25519 key. Verify it without allowing a password prompt:

```powershell
ssh -o BatchMode=yes kyin@10.202.25.39 "id; hostname; cat /etc/os-release"
```

If this fails, repair the SSH key or network connection before attempting a pull or deployment. Do not automate a password in a script.

## Open the private application

Start the two required local forwards from PowerShell:

```powershell
ssh -N `
  -L 8000:127.0.0.1:8100 `
  -L 8001:127.0.0.1:8001 `
  kyin@10.202.25.39
```

Keep that PowerShell process running and open:

```text
http://127.0.0.1:8001
```

Local port 8001 reaches the private Caddy/Next.js application. Local port 8000 reaches FastAPI because the current private frontend uses it for direct API/upload requests. Port 8001 remains closed on the server network; the tunnel is the access boundary.

Shared-report recipients do not use this tunnel. They receive a specific capability URL such as:

```text
http://10.202.25.39:8000/reports/<share_token>
```

The public listener intentionally does not expose the application home page, session management, files, uploads, or report management.

## Normal development cycle

Development happens only in the Windows checkout. `main` is the production branch.

### 1. Start from current main

```powershell
git switch main
git pull --ff-only origin main
git switch -c <feature-or-fix-branch>
```

Use a focused branch for normal code and scientific changes. A direct documentation-only commit to `main` can be reasonable when explicitly requested, but it should not become the default workflow.

### 2. Implement and verify

Define the observable success condition, make the smallest change, and run focused tests while developing. Before merging, run the relevant gate from [Development and verification](DEVELOPMENT.md). Route/schema changes must regenerate and verify `docs/api/openapi.yaml`.

Do not run tests against `SampleData`, `real_sample_files`, normal runtime directories, the SSH-tunneled production backend, or production sessions/reports.

### 3. Commit and publish

```powershell
git status --short
git diff --check
git add <reviewed-files>
git commit -m "<concise description>"
git push -u origin <feature-or-fix-branch>
```

After review and verification, merge the branch into `main` and push. Record the exact commit to deploy:

```powershell
git switch main
git pull --ff-only origin main
git rev-parse HEAD
git push origin main
```

Use the full 40-character SHA returned by `git rev-parse`; do not rely on an anticipated or abbreviated hash.

For a named release, create an annotated semantic-version tag on the verified
`main` commit and push it together with `main`:

```powershell
git tag -a v<version> -m "ProteomicsViz <version>"
git push origin main v<version>
```

The backend application version, frontend package version, documentation, and
release tag must agree.

## Update the server checkout

Fast-forward the clean administrative checkout after GitHub has the new commit:

```powershell
ssh kyin@10.202.25.39 `
  "git -C /home/kyin/ProteomicsViz pull --ff-only origin main"
```

Verify local, GitHub-tracking, and server commits:

```powershell
git rev-parse HEAD
ssh kyin@10.202.25.39 `
  "git -C /home/kyin/ProteomicsViz rev-parse HEAD; git -C /home/kyin/ProteomicsViz status --short"
```

Stop if the server checkout is dirty or cannot fast-forward. Inspect and preserve those changes rather than resetting or overwriting them.

### Pulling is not deployment

Updating `/home/kyin/ProteomicsViz` refreshes the administrative checkout and deployment entry point. It does **not** change `/home/proteomicsviz/current`, restart services, or update the running website.

## Activate a production release

Before deployment, confirm no pipeline, report generation, or report-scoped analysis is queued or running. Then run from an interactive SSH session because `sudo` may require the `kyin` password:

```bash
sudo bash /home/kyin/ProteomicsViz/deploy/deploy.sh --yes <FULL_40_CHARACTER_SHA>
```

`--yes` skips only the script's idle-server confirmation. Use it only after checking that the server is idle. The deployment script fetches its service-account source, creates and verifies a new immutable release, switches `current`, restarts the application services, runs health/security checks, and rolls back activation on failure.

Successful output ends with:

```text
Deployment succeeded
Commit: <full-sha>
Release: /home/proteomicsviz/releases/<full-sha>
Previous: /home/proteomicsviz/releases/<previous-sha>
```

## Post-deployment checks

```bash
readlink -f /home/proteomicsviz/current
curl --fail http://127.0.0.1:8100/health
curl --fail http://127.0.0.1:8001/ >/dev/null
sudo systemctl status proteomicsviz-backend.service proteomicsviz-frontend.service caddy.service
```

Through the Windows tunnel, verify the private app, one representative existing result session, and any workflow affected by the change. For report/security changes, also follow the checklist in [Shared report security](REPORT_SHARING.md). Do not remove result sessions during verification.

## Recovery rules

- A failed `git pull --ff-only` is a checkout problem; inspect it before deployment.
- A successful pull with an unchanged website is expected; deployment has not happened yet.
- A failed deployment should leave or restore the previous active release. Read the final script output and service logs before retrying.
- Prefer redeploying a known-good full SHA for rollback. Persistent data is not rolled back with application code.
- Never use `git reset --hard`, delete releases, or delete sessions/reports as routine recovery.

The complete server installation, service, deployment, and rollback reference remains [deploy/README.md](../deploy/README.md).
