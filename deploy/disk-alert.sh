#!/usr/bin/env bash
# Warn before the volume fills.
#
# The app refuses to create new lists below a floor (server/diskGuard.ts) and the
# retention sweep bounds growth over time, but both are last-ditch. This is the
# part that tells a human, because on this host a full disk is not just an app
# outage: the database shares the boot volume with the OS, so journald and sshd
# start failing too and fixing it gets much harder.
#
# Install (as the service user):
#   sudo cp deploy/disk-alert.sh /usr/local/bin/pax-planner-disk-alert
#   sudo chmod +x /usr/local/bin/pax-planner-disk-alert
#   crontab -e   # then add:
#   */30 * * * * /usr/local/bin/pax-planner-disk-alert
#
# Output goes to the journal under the `pax-planner-disk` tag:
#   journalctl -t pax-planner-disk --since '7 days ago'
set -euo pipefail

WATCH="${WATCH_PATH:-/opt/pax-planner}"
WARN_PCT="${WARN_PCT:-80}"
CRIT_PCT="${CRIT_PCT:-90}"

used_pct="$(df --output=pcent "$WATCH" | tail -1 | tr -dc '0-9')"
avail_h="$(df -h --output=avail "$WATCH" | tail -1 | tr -d ' ')"

note() { logger -t pax-planner-disk -p "$1" "$2"; echo "$2"; }

if [[ "$used_pct" -ge "$CRIT_PCT" ]]; then
  note user.err "CRITICAL: $WATCH is ${used_pct}% full (${avail_h} free). New lists are likely being refused. Free space now."
  # Biggest usual suspects, to save a round trip.
  echo "  largest under $WATCH:"
  du -xh --max-depth=2 "$WATCH" 2>/dev/null | sort -rh | head -5 | sed 's/^/    /'
  echo "  release dirs: $(ls -1d "$WATCH"/releases/*/ 2>/dev/null | wc -l) (deploy.sh keeps 5)"
  echo "  local backups: $(ls -1 "$WATCH"/backups/*.gz 2>/dev/null | wc -l)"
  exit 1
elif [[ "$used_pct" -ge "$WARN_PCT" ]]; then
  note user.warning "WARNING: $WATCH is ${used_pct}% full (${avail_h} free)."
  exit 0
fi

# Quiet on success so cron only mails when something is wrong.
exit 0
