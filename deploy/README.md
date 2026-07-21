# Native AlmaLinux deployment

ProteomicsViz runs without containers as two systemd services behind Caddy:

- `proteomicsviz-backend.service`: FastAPI and R children on `127.0.0.1:8100`.
- `proteomicsviz-frontend.service`: production Next.js on `127.0.0.1:3000`.
- `caddy.service`: public shared-report gateway on port 8000 and private loopback gateway on port 8001.

This is appropriate for one application on one managed server: systemd supplies lifecycle supervision, Caddy supplies the network boundary, and immutable release directories provide rollback without adding container orchestration.

Read [docs/REPORT_SHARING.md](../docs/REPORT_SHARING.md) before changing listeners or routes.
For the daily Windows SSH tunnel, Git, server-pull, and release sequence, see
[Server access and development cycle](../docs/SERVER_ACCESS_AND_DEV_CYCLE.md).

## Server prerequisites

- AlmaLinux 10.x
- Git
- Python 3.12 with venv support
- Node.js 22 with npm
- R 4.5+
- Caddy 2.10+
- System libraries required by Python and R dependencies
- A reserved address for `10.202.25.39`

`bootstrap-almalinux.sh` installs system packages, the `proteomicsviz` service account, persistent directories, SELinux/firewalld rules, Caddy, and systemd units. Review it and the example environment files before running it:

```bash
sudo bash deploy/bootstrap-almalinux.sh
```

Install R packages once into the persistent library from the trusted administrative checkout at `/home/kyin/ProteomicsViz`:

```bash
cd /home/kyin/ProteomicsViz
umask 0002
R_LIBS_USER=/home/proteomicsviz/R/library \
  Rscript backend/scripts/install_r_packages.R
```

Populate `/home/proteomicsviz/data/protein-database` with required reference files. Do not copy Windows virtual environments, `node_modules`, or `.next`.

## Layout

```text
/home/kyin/ProteomicsViz/               # administrator checkout; deployment entry point
/home/proteomicsviz/
|-- source/                             # service-account Git checkout used by deploy.sh
|-- current -> releases/<full-sha>/
|-- releases/<full-sha>/                # immutable application releases
|-- data/
|   |-- sessions/
|   |-- reports/
|   |-- file-library/
|   |-- protein-database/
|   `-- runtime/
`-- R/library/                          # persistent R library
/etc/proteomicsviz/backend.env
/etc/proteomicsviz/frontend.env
```

The earlier bootstrap directory names ending in `-bootstrap` or `-bootstrap-source` are not part of the final layout. The administrative checkout is `/home/kyin/ProteomicsViz`; the deployment script intentionally maintains `/home/proteomicsviz/source` separately under the service account.

## Release workflow

Development stays on Windows. `main` is the production branch, but a push does not automatically restart the server.

1. Develop and verify on a feature/fix branch.
2. Merge into `main` and push GitHub.
3. Resolve and record the exact 40-character commit SHA.
4. Confirm no pipeline or report computation is queued or running.
5. SSH to the server and run the deploy script from the administrative checkout.
6. Verify private and public behavior; retain the previous release and all sessions/reports.

Recommended deployment:

```bash
sudo bash /home/kyin/ProteomicsViz/deploy/deploy.sh --yes <FULL_40_CHARACTER_SHA>
```

Use `--yes` only after independently confirming the server is idle. Interactive deployment without `--yes` asks for that confirmation. `origin/main` is accepted, but an exact SHA provides a clearer audit and eliminates movement between review and deployment.

The script fetches GitHub, resolves the ref, archives it into a new staging release, builds isolated Python and Node artifacts, verifies R packages/backend import/Caddy/systemd, switches `current`, restarts services, performs health and route-denial checks, and restores the prior release if activation fails.

An abbreviated or mistyped SHA produces `Cannot resolve Git ref`. Copy the exact SHA returned after the push; do not assume a locally anticipated hash equals the remote commit.

## First activation

After the first successful release:

```bash
sudo systemctl enable proteomicsviz-backend.service
sudo systemctl enable proteomicsviz-frontend.service
```

Validate service and gateway state:

```bash
sudo systemctl status proteomicsviz-backend.service proteomicsviz-frontend.service caddy.service
sudo journalctl -u proteomicsviz-backend.service -u proteomicsviz-frontend.service --since today
curl --fail http://127.0.0.1:8100/health
curl --fail http://127.0.0.1:8001/ >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile
```

One or two initial `curl: (7)` messages during deployment can occur while systemd starts the backend; deployment is successful only if the script’s later health checks pass and it prints `Deployment succeeded` with the selected commit and release path.

## Private access

Keep server port 8001 closed. From Windows:

```powershell
ssh -N `
  -L 8000:127.0.0.1:8100 `
  -L 8001:127.0.0.1:8001 `
  kyin@10.202.25.39
```

Open `http://127.0.0.1:8001`.

## Rollback

Prefer redeploying a known-good full SHA through `deploy.sh`; it verifies the release against current deployment files. If an urgent manual symlink rollback is required, first verify the target directory is an existing full-SHA release and that its systemd/environment/Caddy contract matches the installed configuration. Persistent data is not rolled back with application code.

Do not delete old releases, sessions, or reports while validating a deployment. Establish a separately reviewed retention and backup policy before cleanup.
