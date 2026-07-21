#!/usr/bin/env bash
set -Eeuo pipefail

APP_USER="proteomicsviz"
APP_GROUP="proteomicsviz"
DEPLOY_USER="kyin"
APP_ROOT="/home/proteomicsviz"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

die() {
    echo "ERROR: $*" >&2
    exit 1
}

[[ $EUID -eq 0 ]] || die "Run this script through sudo"
[[ -f /etc/almalinux-release ]] || die "This bootstrap supports AlmaLinux only"
grep -qE 'release 10([ .]|$)' /etc/almalinux-release || \
    die "This bootstrap was reviewed for AlmaLinux 10"

for required_file in \
    "$SCRIPT_DIR/Caddyfile" \
    "$SCRIPT_DIR/backend.env.example" \
    "$SCRIPT_DIR/frontend.env.example" \
    "$SCRIPT_DIR/systemd/proteomicsviz-backend.service" \
    "$SCRIPT_DIR/systemd/proteomicsviz-frontend.service"; do
    [[ -f "$required_file" ]] || die "Missing deployment file: $required_file"
done

dnf install -y \
    git \
    nodejs \
    nodejs-npm \
    R \
    caddy \
    gcc \
    gcc-c++ \
    gcc-gfortran \
    make \
    cmake \
    ninja-build \
    python3-devel \
    libcurl-devel \
    openssl-devel \
    libxml2-devel \
    fontconfig-devel \
    freetype-devel \
    harfbuzz-devel \
    fribidi-devel \
    libpng-devel \
    libjpeg-turbo-devel \
    libtiff-devel \
    zlib-devel \
    bzip2-devel \
    xz-devel \
    pcre2-devel \
    readline-devel \
    libicu-devel \
    cairo-devel \
    policycoreutils-python-utils

if ! getent group "$APP_GROUP" >/dev/null; then
    groupadd --system "$APP_GROUP"
fi

if ! getent passwd "$APP_USER" >/dev/null; then
    useradd --system --gid "$APP_GROUP" --create-home \
        --home-dir "$APP_ROOT" --shell /sbin/nologin "$APP_USER"
fi

getent passwd "$DEPLOY_USER" >/dev/null || die "Missing deployment user: $DEPLOY_USER"
usermod --append --groups "$APP_GROUP" "$DEPLOY_USER"

install -d -m 0750 -o "$APP_USER" -g "$APP_GROUP" \
    "$APP_ROOT" \
    "$APP_ROOT/releases" \
    "$APP_ROOT/data" \
    "$APP_ROOT/data/sessions" \
    "$APP_ROOT/data/reports" \
    "$APP_ROOT/data/file-library" \
    "$APP_ROOT/data/protein-database" \
    "$APP_ROOT/data/runtime"
install -d -m 2775 -o "$APP_USER" -g "$APP_GROUP" "$APP_ROOT/R/library"

semanage fcontext --add --type usr_t "$APP_ROOT(/.*)?" 2>/dev/null || \
    semanage fcontext --modify --type usr_t "$APP_ROOT(/.*)?"
semanage fcontext --add --type var_lib_t "$APP_ROOT/data(/.*)?" 2>/dev/null || \
    semanage fcontext --modify --type var_lib_t "$APP_ROOT/data(/.*)?"
restorecon -R "$APP_ROOT"

install -d -m 0750 -o root -g "$APP_GROUP" /etc/proteomicsviz
if [[ ! -e /etc/proteomicsviz/backend.env ]]; then
    install -m 0640 -o root -g "$APP_GROUP" \
        "$SCRIPT_DIR/backend.env.example" /etc/proteomicsviz/backend.env
fi
if [[ ! -e /etc/proteomicsviz/frontend.env ]]; then
    install -m 0640 -o root -g "$APP_GROUP" \
        "$SCRIPT_DIR/frontend.env.example" /etc/proteomicsviz/frontend.env
fi

install -m 0644 -o root -g root \
    "$SCRIPT_DIR/systemd/proteomicsviz-backend.service" \
    /etc/systemd/system/proteomicsviz-backend.service
install -m 0644 -o root -g root \
    "$SCRIPT_DIR/systemd/proteomicsviz-frontend.service" \
    /etc/systemd/system/proteomicsviz-frontend.service
install -m 0644 -o root -g root "$SCRIPT_DIR/Caddyfile" /etc/caddy/Caddyfile

setsebool -P httpd_can_network_connect 1
for port in 8000 8001; do
    semanage port --add --type http_port_t --proto tcp "$port" 2>/dev/null || \
        semanage port --modify --type http_port_t --proto tcp "$port"
done

report_rule='rule family="ipv4" source address="10.202.25.0/24" port port="8000" protocol="tcp" accept'
if ! firewall-cmd --permanent --zone=public --query-rich-rule="$report_rule" >/dev/null; then
    firewall-cmd --permanent --zone=public --add-rich-rule="$report_rule"
fi
firewall-cmd --reload

caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable --now caddy.service

echo "AlmaLinux bootstrap complete"
python3 --version
node --version
npm --version
Rscript --version
caddy version
echo "Open a new SSH login before installing R packages so the new group membership is active."
