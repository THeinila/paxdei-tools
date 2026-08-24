#!/usr/bin/env bash
# Nightly backup of the share database.
#
# Uses sqlite3's .backup, NOT `cp`. The server holds the database open in WAL
# mode, so copying the file with cp can capture a torn page set (and silently
# miss anything still in the -wal). `.backup` takes a consistent snapshot of a
# live database without stopping the service.
#
# Install (as the service user):
#   sudo apt-get install -y sqlite3
#   sudo cp deploy/backup.sh /usr/local/bin/pax-planner-backup
#   sudo chmod +x /usr/local/bin/pax-planner-backup
#   crontab -e   # then add:
#   17 4 * * * /usr/local/bin/pax-planner-backup >> /var/log/pax-planner-backup.log 2>&1
set -euo pipefail

DB="${DB_PATH:-/opt/pax-planner/data/data.sqlite}"
DEST="${BACKUP_DIR:-/opt/pax-planner/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$DEST"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$DEST/data-$stamp.sqlite"

sqlite3 "$DB" ".backup '$out'"
gzip -9 "$out"

# Prune local copies. Keep this window short — local snapshots protect against
# "I deleted the wrong thing", not against losing the volume. Only the off-box
# copy below protects against that.
find "$DEST" -name 'data-*.sqlite.gz' -mtime "+$KEEP_DAYS" -delete

echo "$(date -uIseconds) backed up $DB -> $out.gz ($(stat -c%s "$out.gz") bytes)"

# --- Off-box copy (REQUIRED — a backup on the same volume is not a backup) ----
# The whole point is surviving loss of the boot volume, and Oracle reclaims idle
# Always Free instances. Uncomment ONE of these once configured.
#
# Oracle Object Storage (free tier, same account) — needs `oci` CLI configured:
#   oci os object put --bucket-name pax-planner-backups --force \
#       --file "$out.gz" --name "$(basename "$out.gz")"
#
# Anywhere with SSH:
#   rsync -a "$out.gz" backup-host:/srv/pax-planner-backups/
#
# rclone (S3, B2, Drive, ...):
#   rclone copy "$out.gz" remote:pax-planner-backups/
