#!/usr/bin/env bash
set -Eeuo pipefail

APP_USER="${APP_USER:-proteomicsviz}"
APP_GROUP="${APP_GROUP:-proteomicsviz}"
APP_ROOT="${APP_ROOT:-/home/proteomicsviz}"
REPOSITORY_URL="${REPOSITORY_URL:-https://github.com/Ametrin-Yink/ProteomicsVizWebApp.git}"
BACKEND_ENV="${BACKEND_ENV:-/etc/proteomicsviz/backend.env}"
FRONTEND_ENV="${FRONTEND_ENV:-/etc/proteomicsviz/frontend.env}"
BACKEND_SERVICE="proteomicsviz-backend.service"
FRONTEND_SERVICE="proteomicsviz-frontend.service"
CADDY_SERVICE="caddy.service"

ASSUME_IDLE=false
GIT_REF="origin/main"
GIT_REF_SET=false

usage() {
    cat <<'EOF'
Usage: sudo bash ./deploy/deploy.sh [--yes] [GIT_REF]

Build and activate one exact ProteomicsViz Git revision. The default ref is
origin/main. Without --yes, an interactive confirmation is required before the
live service is restarted; confirmation means no analysis or report task is
currently running.
EOF
}

die() {
    echo "ERROR: $*" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --yes)
            ASSUME_IDLE=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        -*)
            die "Unknown option: $1"
            ;;
        *)
            [[ "$GIT_REF_SET" == false ]] || die "Only one Git ref is allowed"
            GIT_REF="$1"
            GIT_REF_SET=true
            shift
            ;;
    esac
done

[[ $EUID -eq 0 ]] || die "Run this script through sudo"

for command_name in caddy curl git npm python3 Rscript runuser systemctl systemd-analyze tar; do
    command -v "$command_name" >/dev/null 2>&1 || die "Missing command: $command_name"
done

getent passwd "$APP_USER" >/dev/null || die "Missing service account: $APP_USER"
getent group "$APP_GROUP" >/dev/null || die "Missing service group: $APP_GROUP"
[[ -r "$BACKEND_ENV" ]] || die "Missing backend environment file: $BACKEND_ENV"
[[ -r "$FRONTEND_ENV" ]] || die "Missing frontend environment file: $FRONTEND_ENV"

for service_name in "$BACKEND_SERVICE" "$FRONTEND_SERVICE" "$CADDY_SERVICE"; do
    systemctl cat "$service_name" >/dev/null 2>&1 || die "Service is not installed: $service_name"
done
systemctl is-active --quiet "$CADDY_SERVICE" || die "$CADDY_SERVICE must be running before deployment"

RELEASES_DIR="$APP_ROOT/releases"
SOURCE_DIR="$APP_ROOT/source"
DATA_DIR="$APP_ROOT/data"
CURRENT_LINK="$APP_ROOT/current"

install -d -m 0750 -o "$APP_USER" -g "$APP_GROUP" \
    "$APP_ROOT" "$RELEASES_DIR" "$DATA_DIR" \
    "$DATA_DIR/sessions" "$DATA_DIR/reports" "$DATA_DIR/file-library" \
    "$DATA_DIR/protein-database" "$DATA_DIR/runtime"

as_app() {
    runuser -u "$APP_USER" -- "$@"
}

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
    [[ ! -e "$SOURCE_DIR" ]] || die "$SOURCE_DIR exists but is not a Git checkout"
    as_app git clone --no-checkout "$REPOSITORY_URL" "$SOURCE_DIR"
else
    configured_url="$(as_app git -C "$SOURCE_DIR" remote get-url origin)"
    [[ "$configured_url" == "$REPOSITORY_URL" ]] || \
        die "Unexpected origin in $SOURCE_DIR: $configured_url"
fi

as_app git -C "$SOURCE_DIR" fetch --prune --tags origin
COMMIT="$(as_app git -C "$SOURCE_DIR" rev-parse --verify "${GIT_REF}^{commit}")" || \
    die "Cannot resolve Git ref: $GIT_REF"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "Resolved value is not a full commit SHA: $COMMIT"

RELEASE_DIR="$RELEASES_DIR/$COMMIT"
[[ ! -e "$RELEASE_DIR" ]] || die "Release already exists: $RELEASE_DIR"

STAGING_DIR="$(mktemp -d "$RELEASES_DIR/.${COMMIT}.XXXXXX")"
case "$STAGING_DIR" in
    "$RELEASES_DIR"/."$COMMIT".*) ;;
    *) die "Unsafe staging path: $STAGING_DIR" ;;
esac

cleanup_staging() {
    if [[ -n "${STAGING_DIR:-}" && -d "$STAGING_DIR" ]]; then
        case "$STAGING_DIR" in
            "$RELEASES_DIR"/."$COMMIT".*) rm -rf -- "$STAGING_DIR" ;;
            *) echo "Refusing to remove unsafe staging path: $STAGING_DIR" >&2 ;;
        esac
    fi
}
trap cleanup_staging EXIT

as_app git -C "$SOURCE_DIR" archive "$COMMIT" | tar -x -C "$STAGING_DIR"
chown -R "$APP_USER:$APP_GROUP" "$STAGING_DIR"

echo "Creating Python environment for $COMMIT"
as_app python3 -m venv "$STAGING_DIR/backend/.venv"
as_app "$STAGING_DIR/backend/.venv/bin/python" -m pip install \
    --disable-pip-version-check -r "$STAGING_DIR/backend/requirements.txt"

echo "Building Next.js frontend for $COMMIT"
as_app bash -c '
    set -Eeuo pipefail
    set -a
    source "$1"
    set +a
    : "${BACKEND_URL:?BACKEND_URL is required}"
    : "${NEXT_PUBLIC_REPORT_BASE_URL:?NEXT_PUBLIC_REPORT_BASE_URL is required}"
    [[ -z "${NEXT_PUBLIC_API_URL:-}" ]] || {
        echo "NEXT_PUBLIC_API_URL must remain unset in production" >&2
        exit 1
    }
    [[ -z "${NEXT_PUBLIC_WS_URL:-}" ]] || {
        echo "NEXT_PUBLIC_WS_URL must remain unset in production" >&2
        exit 1
    }
    cd "$2"
    npm ci
    npm run build
' _ "$FRONTEND_ENV" "$STAGING_DIR/frontend"

echo "Verifying the R package environment"
as_app Rscript -e 'packages <- c("msqrob2", "QFeatures", "limma", "MSstats", "MSstatsConvert", "MSstatsPTM", "MSstatsBioNet", "Biostrings", "BiocParallel", "SummarizedExperiment", "data.table", "matrixStats", "jsonlite", "arrow", "tzdb"); missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]; if (length(missing)) stop(paste("Missing R packages:", paste(missing, collapse = ", "))); cat("R package check passed\n")'

echo "Validating the release backend import"
as_app bash -c '
    set -Eeuo pipefail
    set -a
    source "$1"
    set +a
    cd "$2"
    PYTHONPATH="$3" "$4" -c "from app.main import app; print(app.title)"
' _ "$BACKEND_ENV" "$DATA_DIR/runtime" "$STAGING_DIR/backend" \
    "$STAGING_DIR/backend/.venv/bin/python"

caddy validate --config "$STAGING_DIR/deploy/Caddyfile" --adapter caddyfile

for unit_name in "$BACKEND_SERVICE" "$FRONTEND_SERVICE"; do
    committed_unit="$STAGING_DIR/deploy/systemd/$unit_name"
    installed_unit="/etc/systemd/system/$unit_name"
    [[ -f "$installed_unit" ]] || die "Missing installed unit: $installed_unit"
    cmp -s "$committed_unit" "$installed_unit" || die \
        "$unit_name differs from the release; review and install the new unit, run systemctl daemon-reload, then redeploy"
done

if [[ "$ASSUME_IDLE" != true ]]; then
    [[ -t 0 ]] || die "Interactive confirmation required; rerun with --yes only after confirming the server is idle"
    echo
    echo "Release $COMMIT is built and ready."
    echo "Confirm that no pipeline or shared-report computation is queued or running."
    read -r -p "Type DEPLOY to restart production: " confirmation
    [[ "$confirmation" == "DEPLOY" ]] || die "Deployment cancelled"
fi

PREVIOUS_RELEASE=""
if [[ -L "$CURRENT_LINK" ]]; then
    PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK")"
    case "$PREVIOUS_RELEASE" in
        "$RELEASES_DIR"/*) ;;
        *) die "Current link points outside the releases directory: $PREVIOUS_RELEASE" ;;
    esac
elif [[ -e "$CURRENT_LINK" ]]; then
    die "$CURRENT_LINK exists and is not a symbolic link"
fi

mv -- "$STAGING_DIR" "$RELEASE_DIR"
STAGING_DIR=""

CADDY_BACKUP=""
CADDY_CHANGED=false
SWITCHED=false
rollback() {
    status=$?
    trap - ERR
    set +e
    echo "Deployment failed; restoring the previous release" >&2
    if [[ "$SWITCHED" == true ]]; then
        if [[ -n "$PREVIOUS_RELEASE" ]]; then
            rollback_link="$APP_ROOT/.current.rollback.$$"
            ln -s "$PREVIOUS_RELEASE" "$rollback_link"
            mv -Tf -- "$rollback_link" "$CURRENT_LINK"
            systemctl restart "$BACKEND_SERVICE" "$FRONTEND_SERVICE"
        else
            rm -f -- "$CURRENT_LINK"
            systemctl stop "$BACKEND_SERVICE" "$FRONTEND_SERVICE"
        fi
    fi
    if [[ "$CADDY_CHANGED" == true && -n "$CADDY_BACKUP" ]]; then
        install -m 0644 -o root -g root "$CADDY_BACKUP" /etc/caddy/Caddyfile
        systemctl reload "$CADDY_SERVICE"
    fi
    [[ -z "$CADDY_BACKUP" ]] || rm -f -- "$CADDY_BACKUP"
    exit "$status"
}
trap rollback ERR

if ! cmp -s "$RELEASE_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile; then
    if [[ -f /etc/caddy/Caddyfile ]]; then
        CADDY_BACKUP="$(mktemp /run/proteomicsviz-Caddyfile.XXXXXX)"
        cp -- /etc/caddy/Caddyfile "$CADDY_BACKUP"
    fi
    install -m 0644 -o root -g root "$RELEASE_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
    CADDY_CHANGED=true
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
fi

new_link="$APP_ROOT/.current.$COMMIT"
ln -s "$RELEASE_DIR" "$new_link"
mv -Tf -- "$new_link" "$CURRENT_LINK"
SWITCHED=true

systemd-analyze verify \
    "/etc/systemd/system/$BACKEND_SERVICE" \
    "/etc/systemd/system/$FRONTEND_SERVICE"
systemctl restart "$BACKEND_SERVICE" "$FRONTEND_SERVICE"
if [[ "$CADDY_CHANGED" == true ]]; then
    systemctl reload "$CADDY_SERVICE"
fi

wait_for_url() {
    local url="$1"
    local attempts="${2:-30}"
    local attempt
    for ((attempt = 1; attempt <= attempts; attempt++)); do
        if curl --fail --silent --show-error --output /dev/null "$url"; then
            return 0
        fi
        sleep 1
    done
    return 1
}

expect_status() {
    local expected="$1"
    local url="$2"
    local actual
    actual="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$url")"
    [[ "$actual" == "$expected" ]] || {
        echo "Expected HTTP $expected from $url, received $actual" >&2
        return 1
    }
}

echo "Waiting for the backend health endpoint"
wait_for_url http://127.0.0.1:8100/health
echo "Waiting for the private frontend"
wait_for_url http://127.0.0.1:8001/
expect_status 404 http://127.0.0.1:8000/
expect_status 404 http://127.0.0.1:8000/reports
expect_status 404 http://127.0.0.1:8000/api/sessions

trap - ERR
[[ -z "$CADDY_BACKUP" ]] || rm -f -- "$CADDY_BACKUP"

echo "Deployment succeeded"
echo "Commit: $COMMIT"
echo "Release: $RELEASE_DIR"
echo "Previous: ${PREVIOUS_RELEASE:-none}"
