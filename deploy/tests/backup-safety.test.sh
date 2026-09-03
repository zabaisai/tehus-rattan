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
grep -Fq 'rclone:*)' "$backup_lib"
grep -Fq 'backup_require_value RCLONE_CONFIG' "$backup_lib"
# The example must point at the canonical staging repository through its
# ACTIVE assignment only: blank lines and comments are ignored, so a historical
# or commented-out path can never satisfy this check, and exactly one active
# assignment is allowed. The V1 path is reserved as a read-only historical
# repository and must never come back as the effective value.
example_env="$ROOT/deploy/env/backup.env.example"
active_repo_lines="$(grep -vE '^[[:space:]]*(#|$)' "$example_env" | grep -E '^[[:space:]]*RESTIC_REPOSITORY=' || true)"
active_repo_count="$(printf '%s\n' "$active_repo_lines" | grep -c . || true)"
if [ "$active_repo_count" -ne 1 ]; then
  echo "backup.env.example must contain exactly one active RESTIC_REPOSITORY assignment (found $active_repo_count)" >&2
  exit 1
fi
active_repo_value="$(printf '%s\n' "$active_repo_lines" | sed -E 's/^[[:space:]]*RESTIC_REPOSITORY=//; s/[[:space:]]+$//')"
if [ "$active_repo_value" != 'rclone:takto-drive:TAKTO_BACKUPS_V2/staging' ]; then
  echo "backup.env.example active RESTIC_REPOSITORY must be the canonical V2 example path (found: $active_repo_value)" >&2
  exit 1
fi
if grep -vE '^[[:space:]]*(#|$)' "$example_env" | grep -Eq 'TAKTO_BACKUPS/staging([^_]|$)'; then
  echo "backup.env.example must not use the historical V1 repository path as an active value" >&2
  exit 1
fi
grep -Fq 'command -v rclone' "$installer"
grep -Fq 'unsupported RESTIC_REPOSITORY backend; expected s3: or rclone:' "$installer"
grep -Fq 'Google Drive via rclone' "$ROOT/docs/OFFSITE_BACKUPS.md"
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

cat >"$tmp/bin/rclone" <<'FAKE_RCLONE'
#!/usr/bin/env bash
exit 0
FAKE_RCLONE

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
if [ "${1:-}" = "-c" ] && [ "${2:-}" = "%a" ] && \
   { [ "${3:-}" = "${RESTIC_PASSWORD_FILE:-}" ] || \
     [ "${3:-}" = "${RCLONE_CONFIG:-}" ]; }; then
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

chmod +x "$tmp/bin/restic" "$tmp/bin/rclone" "$tmp/bin/curl" "$tmp/bin/flock" "$tmp/fake-backup.sh" "$tmp/fake-verify.sh"
printf 'test-only-password\n' >"$tmp/restic-password"
chmod 600 "$tmp/restic-password"
printf '[takto-drive]\ntype = drive\n' >"$tmp/rclone.conf"
chmod 600 "$tmp/rclone.conf"

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

# The rclone backend must work without AWS credentials. Its OAuth/config file
# remains a protected secret and is validated independently.
mkdir -p "$tmp/backups-rclone"
RESTIC_TEST_LOG="$tmp/restic-rclone.log" \
PATH="$tmp/bin:$PATH" \
RESTIC_REPOSITORY="rclone:takto-drive:TAKTO_BACKUPS/staging" \
RESTIC_PASSWORD_FILE="$tmp/restic-password" \
RCLONE_CONFIG="$tmp/rclone.conf" \
BACKUP_HEARTBEAT_URL="https://example.invalid/daily" \
BACKUP_DIR="$tmp/backups-rclone" \
BACKUP_SCRIPT="$tmp/fake-backup.sh" \
VERIFY_SCRIPT="$tmp/fake-verify.sh" \
BACKUP_LOCK_FILE="$tmp/backup-rclone.lock" \
"$offsite"

grep -Fq 'snapshots --host tehus-crm-staging --tag takto-staging' "$tmp/restic-rclone.log"
grep -Fq 'backup --host tehus-crm-staging --tag takto-staging' "$tmp/restic-rclone.log"
grep -Fq 'forget --host tehus-crm-staging --tag takto-staging --group-by host,tags --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune' "$tmp/restic-rclone.log"
grep -Fxq 'check' "$tmp/restic-rclone.log"

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

# ---------------------------------------------------------------------------
# B-03 regression: every script a systemd unit runs — the ExecStart target and
# every script those entry points invoke by path (not `source`d) — must be
# committed as 100755. The VPS checks out with core.fileMode=false, so a
# missing bit is invisible in `git status` until the unit dies with
# "Permission denied" (restore-postgres.sh did exactly that in the drill path).
unit_scripts=()
for unit in "$ROOT"/deploy/systemd/*.service; do
  exec_start="$(sed -n 's/^ExecStart=//p' "$unit" | head -1)"
  [ -n "$exec_start" ] || { echo "no ExecStart in $unit" >&2; exit 1; }
  unit_scripts+=("${exec_start#/opt/tehus-crm/}")
done
for entry in "${unit_scripts[@]}"; do
  [ -f "$ROOT/$entry" ] || { echo "ExecStart target missing: $entry" >&2; exit 1; }
  while IFS= read -r callee; do
    [ -n "$callee" ] && unit_scripts+=("deploy/scripts/$callee")
  done < <(grep -vE '^[[:space:]]*(source|\.)[[:space:]]' "$ROOT/$entry" \
           | grep -oE '\$SCRIPT_DIR/[a-z-]+\.sh' | sed 's#^\$SCRIPT_DIR/##' | sort -u)
done
while IFS= read -r script; do
  mode="$(git -C "$ROOT" ls-files --stage -- "$script" | awk '{print $1}')"
  if [ "$mode" != 100755 ]; then
    echo "script used by a systemd unit is not committed as executable (mode ${mode:-untracked}): $script" >&2
    exit 1
  fi
done < <(printf '%s\n' "${unit_scripts[@]}" | sort -u)

# ---------------------------------------------------------------------------
# B-02 regression: the uploads tarball is produced by a root container, so the
# script must hand it to the invoking user inside the container and fail closed
# if it ends up owned by anyone else. Fake docker (no daemon, no volume): the
# DB dump is a canned SQL stream and `docker run` tars a fixture directory.
local_backup="$ROOT/deploy/scripts/backup-postgres.sh"
mkdir -p "$tmp/uploads-fixture/sub" "$tmp/bin-docker" "$tmp/bin-foreign-owner"
printf 'upload one\n' >"$tmp/uploads-fixture/a.txt"
printf 'upload two\n' >"$tmp/uploads-fixture/sub/b.txt"
printf 'POSTGRES_USER=test-only\nPOSTGRES_DB=test_only\nPOSTGRES_PASSWORD=test-only\n' >"$tmp/env.staging"

cat >"$tmp/bin-docker/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
# Only the three docker invocations backup-postgres.sh makes.
set -euo pipefail
case "${1:-}" in
  volume) exit 0 ;;                                   # `volume inspect`: exists
  compose) printf 'CREATE TABLE users ();\n'; exit 0 ;; # `compose exec ... pg_dump`
  run)
    # run --rm -v VOL:/data:ro -v DIR:/backup alpine sh -c SCRIPT sh NAME OWNER
    name="${*: -2:1}"; owner="${*: -1}"; backup_dir=""
    for arg in "$@"; do case "$arg" in *:/backup) backup_dir="${arg%:/backup}" ;; esac; done
    [ -n "$backup_dir" ] || exit 2
    tar -czf "$backup_dir/$name" -C "$FAKE_UPLOADS_DIR" .
    chmod 600 "$backup_dir/$name"
    printf 'chown %s\n' "$owner" >>"$DOCKER_TEST_LOG"
    exit 0 ;;
esac
echo "fake docker: unexpected call: $*" >&2
exit 2
FAKE_DOCKER
chmod +x "$tmp/bin-docker/docker"

mkdir -p "$tmp/backups-local"
PATH="$tmp/bin-docker:$tmp/bin:$PATH" \
ENV_FILE="$tmp/env.staging" \
BACKUP_DIR="$tmp/backups-local" \
UPLOADS_VOLUME="fake_uploads" \
FAKE_UPLOADS_DIR="$tmp/uploads-fixture" \
DOCKER_TEST_LOG="$tmp/docker.log" \
RETENTION_DAYS=3650 \
bash "$local_backup" >"$tmp/local-backup.out" 2>&1 \
  || { cat "$tmp/local-backup.out" >&2; echo "local backup failed" >&2; exit 1; }

db_set=("$tmp"/backups-local/tehus-crm-staging-*.sql.gz)
up_set=("$tmp"/backups-local/tehus-crm-staging-uploads-*.tar.gz)
[ "${#db_set[@]}" -eq 1 ] && [ -f "${db_set[0]}" ] || { echo "expected exactly one DB dump" >&2; exit 1; }
[ "${#up_set[@]}" -eq 1 ] && [ -f "${up_set[0]}" ] || { echo "expected exactly one uploads tarball" >&2; exit 1; }
db_stamp="$(basename "${db_set[0]}")"; db_stamp="${db_stamp#tehus-crm-staging-}"; db_stamp="${db_stamp%.sql.gz}"
up_stamp="$(basename "${up_set[0]}")"; up_stamp="${up_stamp#tehus-crm-staging-uploads-}"; up_stamp="${up_stamp%.tar.gz}"
[ "$db_stamp" = "$up_stamp" ] || { echo "DB and uploads belong to different cycles: $db_stamp vs $up_stamp" >&2; exit 1; }
( cd "$tmp/backups-local" && sha256sum -c "$(basename "${db_set[0]}").sha256" && sha256sum -c "$(basename "${up_set[0]}").sha256" ) >/dev/null
gzip -t "${db_set[0]}"
tar --force-local -tzf "${up_set[0]}" | grep -q 'b.txt'
if ls "$tmp"/backups-local/*.partial >/dev/null 2>&1; then
  echo "partial files left behind after a successful backup" >&2; exit 1
fi
# The container is told to hand the archive to the invoking user, never root.
grep -Fxq "chown $(id -u):$(id -g)" "$tmp/docker.log"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;  # NTFS does not model POSIX bits; enforced on Linux/CI.
  *)
    for artifact in "${db_set[0]}" "${db_set[0]}.sha256" "${up_set[0]}" "${up_set[0]}.sha256"; do
      [ "$(stat -c '%u:%g' "$artifact")" = "$(id -u):$(id -g)" ] \
        || { echo "artifact not owned by the backup user: $artifact" >&2; exit 1; }
      [ "$(stat -c '%a' "$artifact")" = 600 ] \
        || { echo "artifact is readable by others: $artifact" >&2; exit 1; }
    done
    ;;
esac

# Ownership failure must be loud and must not publish the uploads archive.
# A `stat` shim reports the .partial as root-owned, as the old bug produced.
cat >"$tmp/bin-foreign-owner/stat" <<'FAKE_STAT'
#!/usr/bin/env bash
case "$*" in
  *uploads-*.tar.gz.partial*) printf '0:0\n'; exit 0 ;;
esac
exec /usr/bin/stat "$@"
FAKE_STAT
chmod +x "$tmp/bin-foreign-owner/stat"

mkdir -p "$tmp/backups-foreign"
PATH="$tmp/bin-foreign-owner:$tmp/bin-docker:$tmp/bin:$PATH" \
ENV_FILE="$tmp/env.staging" \
BACKUP_DIR="$tmp/backups-foreign" \
UPLOADS_VOLUME="fake_uploads" \
FAKE_UPLOADS_DIR="$tmp/uploads-fixture" \
DOCKER_TEST_LOG="$tmp/docker-foreign.log" \
RETENTION_DAYS=3650 \
bash "$local_backup" >"$tmp/foreign-backup.out" 2>&1 || true
grep -Fq 'uploads snapshot is owned by 0:0' "$tmp/foreign-backup.out" \
  || { cat "$tmp/foreign-backup.out" >&2; echo "ownership failure was not reported" >&2; exit 1; }
if ls "$tmp"/backups-foreign/tehus-crm-staging-uploads-*.tar.gz >/dev/null 2>&1; then
  echo "root-owned uploads archive was published" >&2; exit 1
fi
if ls "$tmp"/backups-foreign/*.partial >/dev/null 2>&1; then
  echo "partial uploads archive left behind after ownership failure" >&2; exit 1
fi
ls "$tmp"/backups-foreign/tehus-crm-staging-*.sql.gz >/dev/null 2>&1 \
  || { echo "DB dump must still be published when only uploads fail" >&2; exit 1; }

# ...and the off-site pipeline, which requires the full set, must fail closed
# on that same ownership failure and upload nothing.
mkdir -p "$tmp/backups-foreign-offsite"
if PATH="$tmp/bin-foreign-owner:$tmp/bin-docker:$tmp/bin:$PATH" \
    ENV_FILE="$tmp/env.staging" \
    UPLOADS_VOLUME="fake_uploads" \
    FAKE_UPLOADS_DIR="$tmp/uploads-fixture" \
    DOCKER_TEST_LOG="$tmp/docker-foreign-offsite.log" \
    RETENTION_DAYS=3650 \
    RESTIC_TEST_LOG="$tmp/restic-foreign.log" \
    RESTIC_REPOSITORY="s3:https://example.invalid/bucket/test" \
    RESTIC_PASSWORD_FILE="$tmp/restic-password" \
    AWS_ACCESS_KEY_ID="test-only" \
    AWS_SECRET_ACCESS_KEY="test-only" \
    BACKUP_HEARTBEAT_URL="https://example.invalid/daily" \
    BACKUP_DIR="$tmp/backups-foreign-offsite" \
    BACKUP_SCRIPT="$local_backup" \
    VERIFY_SCRIPT="$tmp/fake-verify.sh" \
    BACKUP_LOCK_FILE="$tmp/backup-foreign.lock" \
    "$offsite" >"$tmp/foreign-offsite.out" 2>&1; then
  echo "off-site backup unexpectedly succeeded with a root-owned uploads archive" >&2
  exit 1
fi
if grep -q '^backup ' "$tmp/restic-foreign.log" 2>/dev/null; then
  echo "incomplete set was uploaded after an ownership failure" >&2
  exit 1
fi

echo "Backup safety checks passed."
