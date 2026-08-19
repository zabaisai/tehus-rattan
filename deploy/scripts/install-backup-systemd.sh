#!/usr/bin/env bash
# Installs only the versioned unit files. It never initializes a repository and
# never runs an immediate backup; activation remains an explicit operator step.
set -euo pipefail

[ "${EUID:-$(id -u)}" -eq 0 ] || {
  echo "ERROR: run with sudo" >&2
  exit 1
}

REPO_ROOT="${REPO_ROOT:-/opt/tehus-crm}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"

[ -d "$REPO_ROOT/deploy/systemd" ] || {
  echo "ERROR: systemd unit source directory not found" >&2
  exit 1
}
[ -f "$REPO_ROOT/.env.backup" ] || {
  echo "ERROR: create /opt/tehus-crm/.env.backup first" >&2
  exit 1
}
[ "$(stat -c '%a' "$REPO_ROOT/.env.backup")" = 600 ] || {
  echo "ERROR: /opt/tehus-crm/.env.backup must have mode 600" >&2
  exit 1
}
command -v restic >/dev/null 2>&1 || {
  echo "ERROR: restic is not installed" >&2
  exit 1
}
id deploy >/dev/null 2>&1 || {
  echo "ERROR: deploy user does not exist" >&2
  exit 1
}

install -m 0644 "$REPO_ROOT/deploy/systemd/tehus-backup.service" "$SYSTEMD_DIR/"
install -m 0644 "$REPO_ROOT/deploy/systemd/tehus-backup.timer" "$SYSTEMD_DIR/"
install -m 0644 "$REPO_ROOT/deploy/systemd/tehus-backup-drill.service" "$SYSTEMD_DIR/"
install -m 0644 "$REPO_ROOT/deploy/systemd/tehus-backup-drill.timer" "$SYSTEMD_DIR/"
install -m 0644 "$REPO_ROOT/deploy/systemd/tehus-backup-init.service" "$SYSTEMD_DIR/"

systemctl daemon-reload
# Enable for future boots, but deliberately do not start Persistent timers here:
# starting one after its scheduled time may immediately run the service.
systemctl enable tehus-backup.timer tehus-backup-drill.timer

echo "Unit files installed and enabled, but timers are not running yet."
echo "Run the one-time repository initialization explicitly:"
echo "  sudo systemctl start tehus-backup-init.service"
echo "Then run and inspect the first backup explicitly:"
echo "  sudo systemctl start tehus-backup.service"
echo "  journalctl -u tehus-backup.service --since today"
echo "After the first backup and restore drill pass, start the timers explicitly:"
echo "  sudo systemctl start tehus-backup.timer tehus-backup-drill.timer"
