#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

scripts=(
  "$ROOT/deploy/scripts/backup-lib.sh"
  "$ROOT/deploy/scripts/backup-offsite.sh"
  "$ROOT/deploy/scripts/backup-restic-init.sh"
  "$ROOT/deploy/scripts/backup-restore-drill.sh"
  "$ROOT/deploy/scripts/install-backup-systemd.sh"
  "$ROOT/deploy/scripts/restore-postgres.sh"
)

for script in "${scripts[@]}"; do
  [ -f "$script" ] || { echo "required backup script missing: $script" >&2; exit 1; }
  bash -n "$script"
done

backup_lib="$ROOT/deploy/scripts/backup-lib.sh"
offsite="$ROOT/deploy/scripts/backup-offsite.sh"
drill="$ROOT/deploy/scripts/backup-restore-drill.sh"
installer="$ROOT/deploy/scripts/install-backup-systemd.sh"
restore="$ROOT/deploy/scripts/restore-postgres.sh"
timer="$ROOT/deploy/systemd/tehus-backup.timer"
drill_timer="$ROOT/deploy/systemd/tehus-backup-drill.timer"

grep -Fq -- '--keep-daily 7' "$offsite"
grep -Fq -- '--keep-weekly 4' "$offsite"
grep -Fq -- '--keep-monthly 6' "$offsite"
grep -Fq -- '--group-by host,tags' "$offsite"
grep -Fq -- 'restic check --read-data' "$drill"
grep -Fq 'backup_validate_tar_archive "$uploads_backup"' "$drill"
grep -Fq -- '--target-db "$RESTORE_DRILL_DB"' "$drill"
grep -Fq "grep -qE '^tehus_restore_drill(_[A-Za-z0-9_]+)?\$'" "$drill"
grep -Fq 'docker compose --env-file "$ENV_FILE"' "$restore"
grep -Fq 'backup_require_value BACKUP_HEARTBEAT_URL' "$offsite"
grep -Fq 'backup_require_value BACKUP_DRILL_HEARTBEAT_URL' "$drill"
grep -Fxq '/.env.backup' "$ROOT/.gitignore"
grep -Fxq '/.secrets/' "$ROOT/.gitignore"
# Installation must not enable or start Persistent timers before the operator
# has run the first backup and restore drill under observation. Ignore comments
# and echo text; reject executable systemctl enable/start commands.
if grep -Eq '^[[:space:]]*systemctl[[:space:]]+(enable|start)([[:space:]]|$)' "$installer"; then
  echo "installer changes timer activation before validation" >&2
  exit 1
fi
grep -Fq 'OnCalendar=*-*-* 03:00:00 America/Bogota' "$timer"
grep -Fq 'Persistent=true' "$timer"
if grep -Fq 'RandomizedDelaySec=' "$timer"; then
  echo "daily timer must remain anchored to 03:00 without randomized delay" >&2
  exit 1
fi
grep -Fq 'OnCalendar=*-*-01 04:30:00 America/Bogota' "$drill_timer"
grep -Fq 'Persistent=true' "$drill_timer"

# The example may contain empty values and placeholders, but never a concrete
# credential or Restic password.
if grep -Eq '^(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)=.+' \
    "$ROOT/deploy/env/backup.env.example"; then
  echo "backup.env.example contains a credential" >&2
  exit 1
fi

# Behavioral test with a fake Restic binary and a fake local backup producer.
# It proves that a complete DB+uploads set is selected and that retention is
# applied as one lineage despite timestamped paths. No network or Docker used.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/backups" "$tmp/fixture"

cat >"$tmp/bin/restic" <<'FAKE_RESTIC'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$RESTIC_TEST_LOG"
exit 0
FAKE_RESTIC

cat >"$tmp/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
exit 0
FAKE_CURL

cat >"$tmp/bin/flock" <<'FAKE_FLOCK'
#!/usr/bin/env bash
exit 0
FAKE_FLOCK

# Git Bash/MSYS on Windows does not model POSIX mode bits on NTFS reliably:
# `chmod 600` can still be reported by GNU stat as 644. Production runs on the
# Linux VPS, where the real mode check must remain strict. Only for this local
# Windows test harness, fake the password-file mode so behavioral tests can run.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    cat >"$tmp/bin/stat" <<'FAKE_STAT'
#!/usr/bin/env bash
if [ "${1:-}" = "-c" ] && [ "${2:-}" = "%a" ] && [ "${3:-}" = "${RESTIC_PASSWORD_FILE:-}" ]; then
  printf '600\n'
  exit 0
fi
exec /usr/bin/stat "$@"
FAKE_STAT
    chmod +x "$tmp/bin/stat"
    ;;
esac

cat >"$tmp/fake-backup.sh" <<'FAKE_BACKUP'
#!/usr/bin/env bash
set -euo pipefail
stamp="20990101-030000"
db="$BACKUP_DIR/tehus-crm-staging-$stamp.sql.gz"
uploads="$BACKUP_DIR/tehus-crm-staging-uploads-$stamp.tar.gz"
printf 'safe sql\n' | gzip >"$db"
printf 'safe upload\n' >"$BACKUP_DIR/upload.txt"
tar -czf "$uploads" -C "$BACKUP_DIR" upload.txt
(cd "$BACKUP_DIR" && sha256sum "$(basename "$db")" >"$(basename "$db").sha256")
(cd "$BACKUP_DIR" && sha256sum "$(basename "$uploads")" >"$(basename "$uploads").sha256")
rm -f "$BACKUP_DIR/upload.txt"
FAKE_BACKUP

cat >"$tmp/fake-verify.sh" <<'FAKE_VERIFY'
#!/usr/bin/env bash
exit 0
FAKE_VERIFY

chmod +x "$tmp/bin/restic" "$tmp/bin/curl" "$tmp/bin/flock" "$tmp/fake-backup.sh" "$tmp/fake-verify.sh"
printf 'test-only-password\n' >"$tmp/restic-password"
chmod 600 "$tmp/restic-password"

RESTIC_TEST_LOG="$tmp/restic.log" \
PATH="$tmp/bin:$PATH" \
RESTIC_REPOSITORY="s3:https://example.invalid/bucket/test" \
RESTIC_PASSWORD_FILE="$tmp/restic-password" \
AWS_ACCESS_KEY_ID="test-only" \
AWS_SECRET_ACCESS_KEY="test-only" \
BACKUP_HEARTBEAT_URL="https://example.invalid/daily" \
BACKUP_DIR="$tmp/backups" \
BACKUP_SCRIPT="$tmp/fake-backup.sh" \
VERIFY_SCRIPT="$tmp/fake-verify.sh" \
BACKUP_LOCK_FILE="$tmp/backup.lock" \
"$offsite"

grep -Fq 'snapshots --host tehus-crm-staging --tag takto-staging' "$tmp/restic.log"
grep -Fq 'backup --host tehus-crm-staging --tag takto-staging' "$tmp/restic.log"
grep -Fq 'forget --host tehus-crm-staging --tag takto-staging --group-by host,tags --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune' "$tmp/restic.log"
grep -Fxq 'check' "$tmp/restic.log"

# Missing uploads must fail closed: the DB-only snapshot is not an acceptable
# disaster-recovery set and must never be uploaded.
mkdir -p "$tmp/backups-incomplete"
cat >"$tmp/fake-db-only.sh" <<'FAKE_DB_ONLY'
#!/usr/bin/env bash
set -euo pipefail
db="$BACKUP_DIR/tehus-crm-staging-20990102-030000.sql.gz"
printf 'safe sql\n' | gzip >"$db"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$db")" >"$(basename "$db").sha256")
FAKE_DB_ONLY
chmod +x "$tmp/fake-db-only.sh"

if RESTIC_TEST_LOG="$tmp/restic-incomplete.log" \
    PATH="$tmp/bin:$PATH" \
    RESTIC_REPOSITORY="s3:https://example.invalid/bucket/test" \
    RESTIC_PASSWORD_FILE="$tmp/restic-password" \
    AWS_ACCESS_KEY_ID="test-only" \
    AWS_SECRET_ACCESS_KEY="test-only" \
    BACKUP_HEARTBEAT_URL="https://example.invalid/daily" \
    BACKUP_DIR="$tmp/backups-incomplete" \
    BACKUP_SCRIPT="$tmp/fake-db-only.sh" \
    VERIFY_SCRIPT="$tmp/fake-verify.sh" \
    BACKUP_LOCK_FILE="$tmp/backup-incomplete.lock" \
    "$offsite"; then
  echo "DB-only backup unexpectedly succeeded" >&2
  exit 1
fi

if grep -q '^backup ' "$tmp/restic-incomplete.log"; then
  echo "DB-only backup was uploaded" >&2
  exit 1
fi

# Generate hostile tar metadata directly so traversal, escaping symlinks and
# unsafe hard links are regression-tested. CI must never silently skip this
# behavioral gate; local Git Bash without python3 still gets the static check.
if [ "${CI:-}" = true ] && ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required for the hostile-tar CI regression test" >&2
  exit 1
fi
if command -v python3 >/dev/null 2>&1; then
  python3 - "$tmp" <<'PY_TAR_FIXTURES'
import io
import pathlib
import sys
import tarfile

root = pathlib.Path(sys.argv[1])

def write_archive(filename, member_name, kind="file", linkname=None):
    with tarfile.open(root / filename, "w:gz") as archive:
        member = tarfile.TarInfo(member_name)
        member.mode = 0o644
        if kind == "file":
            payload = b"safe"
            member.size = len(payload)
            archive.addfile(member, io.BytesIO(payload))
        elif kind == "symlink":
            member.type = tarfile.SYMTYPE
            member.linkname = linkname
            archive.addfile(member)
        elif kind == "hardlink":
            member.type = tarfile.LNKTYPE
            member.linkname = linkname
            archive.addfile(member)

write_archive("uploads-safe.tar.gz", "safe/file.txt")
write_archive("uploads-traversal.tar.gz", "../escape.txt")
write_archive("uploads-symlink.tar.gz", "safe/link", "symlink", "../../escape")
write_archive("uploads-hardlink.tar.gz", "safe/link", "hardlink", "../../escape")
PY_TAR_FIXTURES

  # The valid archive must pass. Each hostile archive must fail closed.
  ( source "$backup_lib"; backup_validate_tar_archive "$tmp/uploads-safe.tar.gz" )
  for unsafe_tar in uploads-traversal.tar.gz uploads-symlink.tar.gz uploads-hardlink.tar.gz; do
    if ( source "$backup_lib"; backup_validate_tar_archive "$tmp/$unsafe_tar" ) \
        >/dev/null 2>&1; then
      echo "unsafe uploads archive unexpectedly passed validation: $unsafe_tar" >&2
      exit 1
    fi
  done
fi

echo "Backup safety checks passed."
