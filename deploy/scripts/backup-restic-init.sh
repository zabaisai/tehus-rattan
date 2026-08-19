#!/usr/bin/env bash
# One-time initialization of the encrypted Restic repository.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/backup-lib.sh
source "$SCRIPT_DIR/backup-lib.sh"

backup_validate_restic_environment

if restic cat config >/dev/null 2>&1; then
  backup_log "repository already initialized; nothing changed"
  exit 0
fi

backup_log "initializing the encrypted off-site repository"
restic init
backup_log "repository initialized"
