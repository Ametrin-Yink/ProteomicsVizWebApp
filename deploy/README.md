# Native AlmaLinux deployment

ProteomicsViz runs as two application services behind Caddy:

- `proteomicsviz-backend.service`: FastAPI and its R child processes on
  `127.0.0.1:8100`.
- `proteomicsviz-frontend.service`: the production Next.js server on
  `127.0.0.1:3000`.
- `caddy.service`: the public report gateway on port 8000 and the private
  loopback application gateway on port 8001.

The detailed report capability model, port contract, release workflow, and
verification checklist are in [docs/REPORT_SHARING.md](../docs/REPORT_SHARING.md).

## Prerequisites

Install Git, Python 3.12 with venv support, Node.js 22 with npm, R 4.5 or newer,
Caddy 2.10 or newer, and the system libraries needed to build the Python and R
dependencies. Install the R packages listed by
`backend/scripts/install_r_packages.R` and verify them before the first release.
`bootstrap-almalinux.sh` installs the required system packages; it does not
silently update R packages during later application deployments.

The service definitions expect `/usr/bin/python3`, `/usr/bin/npm`, and
`/usr/bin/Rscript`. Update the unit or environment file deliberately if the
server installs a runtime elsewhere; do not depend on an interactive shell's
`PATH`.

## One-time server setup

The preferred setup is the reviewed bootstrap script:

```bash
sudo bash deploy/bootstrap-almalinux.sh
```

It installs distribution packages, creates the service account and directories,
configures SELinux and the port-8000 firewalld rule, and installs Caddy and the
systemd units. The equivalent individual file-installation steps are documented
below for audit and recovery.

Run these administrative steps after reviewing the paths and account names:

```bash
sudo useradd --system --create-home \
  --home-dir /home/proteomicsviz \
  --shell /sbin/nologin proteomicsviz

sudo install -d -m 0750 -o proteomicsviz -g proteomicsviz \
  /home/proteomicsviz/releases \
  /home/proteomicsviz/data/sessions \
  /home/proteomicsviz/data/reports \
  /home/proteomicsviz/data/file-library \
  /home/proteomicsviz/data/protein-database \
  /home/proteomicsviz/data/runtime \
  /home/proteomicsviz/R/library

sudo install -d -m 0750 -o root -g proteomicsviz /etc/proteomicsviz
sudo install -m 0640 -o root -g proteomicsviz \
  deploy/backend.env.example /etc/proteomicsviz/backend.env
sudo install -m 0640 -o root -g proteomicsviz \
  deploy/frontend.env.example /etc/proteomicsviz/frontend.env

sudo install -m 0644 -o root -g root \
  deploy/systemd/proteomicsviz-backend.service \
  /etc/systemd/system/proteomicsviz-backend.service
sudo install -m 0644 -o root -g root \
  deploy/systemd/proteomicsviz-frontend.service \
  /etc/systemd/system/proteomicsviz-frontend.service

sudo install -m 0644 -o root -g root deploy/Caddyfile /etc/caddy/Caddyfile
```

Review both files under `/etc/proteomicsviz` before continuing. Populate
`/home/proteomicsviz/data/protein-database` with the required FASTA and gene-name
files. Do not copy Windows virtual environments, `node_modules`, or `.next`.

Install the application R packages into the dedicated library after opening a
new SSH login so membership in the `proteomicsviz` group is active:

```bash
cd /path/to/ProteomicsVizWebApp
umask 0002
R_LIBS_USER=/home/proteomicsviz/R/library \
  Rscript backend/scripts/install_r_packages.R
```

Validate the gateway configuration and load the units:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now caddy.service
```

The application services cannot start until the first release creates the
`current` link, so enable them after that deployment succeeds. The deployment
script runs `systemd-analyze verify` after creating that link, allowing systemd
to validate the release-specific executable paths as well as the unit syntax.

## Deploy a release

From a trusted checkout, deploy `origin/main` interactively:

```bash
sudo bash ./deploy/deploy.sh origin/main
```

The script:

1. Fetches GitHub and resolves the requested ref to one full commit SHA.
2. Builds in a new staging directory.
3. Creates a release-specific Python virtual environment with `pip`.
4. Installs the locked Node tree with `npm ci` and builds Next.js with the
   production environment.
5. Verifies the R packages, backend import, and Caddy configuration.
6. Refuses activation if the installed systemd units differ from the release.
7. Requires confirmation that no analysis or report computation is active.
8. Switches the `current` symlink and verifies/restarts the application services.
9. Checks backend, private frontend, and public route-denial behavior.
10. Restores the previous release if activation or health checks fail.

For a reviewed non-interactive invocation, `--yes` skips only the idle-server
confirmation:

```bash
sudo bash ./deploy/deploy.sh --yes origin/main
```

Do not use `--yes` until another mechanism has established that no task is
queued or running.

After the first successful release:

```bash
sudo systemctl enable proteomicsviz-backend.service
sudo systemctl enable proteomicsviz-frontend.service
```

Inspect service output with:

```bash
sudo journalctl -u proteomicsviz-backend.service -u proteomicsviz-frontend.service
```

Uvicorn access logging is disabled because shared report tokens appear in URL
paths. Application errors and R output remain available through journald.

## Roll back a release

Use this only when the selected release uses the currently installed systemd
units, environment files, and Caddy configuration. Replace `<PREVIOUS_SHA>`
with a full commit SHA already present under `/home/proteomicsviz/releases`:

```bash
sudo bash -c '
set -Eeuo pipefail
release=/home/proteomicsviz/releases/<PREVIOUS_SHA>
test -d "$release"
link=/home/proteomicsviz/.current.rollback.$$
ln -s "$release" "$link"
mv -Tf -- "$link" /home/proteomicsviz/current
systemctl restart proteomicsviz-backend.service proteomicsviz-frontend.service
curl --fail http://127.0.0.1:8100/health
curl --fail http://127.0.0.1:8001/ >/dev/null
'
```

If a release changes deployment configuration, review and install its systemd,
environment, and Caddy files before switching to it.

## Private application access

Keep port 8001 closed in firewalld. From Windows, create the two tunnels:

```powershell
ssh -N `
  -L 8000:127.0.0.1:8100 `
  -L 8001:127.0.0.1:8001 `
  kyin@10.202.25.39
```

Open `http://127.0.0.1:8001` while the SSH session remains connected.
