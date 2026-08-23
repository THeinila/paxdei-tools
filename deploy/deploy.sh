#!/usr/bin/env bash
# Atomic deploy with rollback.
#
# The old runbook was `git pull && npm ci && npm run build` in the live
# directory. Two things made that dangerous on a 1 GB box: `npm ci` deletes
# node_modules before reinstalling, and the service starts from that same
# directory. A build that ran out of memory partway left the live tree broken
# with no way back except fixing it by hand, under an outage.
#
# This builds a NEW release directory and only swaps the `current` symlink once
# the build has fully succeeded. A failed build touches nothing the running
# service depends on, so the worst case is "the deploy didn't happen".
#
# Layout it expects:
#   /opt/pax-planner/
#     repo/                  bare-ish git checkout, only used as a source
#     releases/<timestamp>/   built trees
#     current -> releases/... symlink the systemd unit runs from
#     data/data.sqlite        database, outside every release
#
# Usage:
#   deploy.sh            deploy origin/main
#   deploy.sh <ref>      deploy a specific branch/tag/sha
#   deploy.sh --rollback go back to the previous release
set -euo pipefail

ROOT="${PAX_ROOT:-/opt/pax-planner}"
REPO="$ROOT/repo"
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
KEEP="${KEEP_RELEASES:-5}"
SERVICE="${SERVICE_NAME:-pax-planner}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31merror: %s\033[0m\n' "$*" >&2; exit 1; }

restart_and_verify() {
  log "Restarting $SERVICE"
  sudo systemctl restart "$SERVICE"

  # Give it a moment, then prove it actually answers. `systemctl restart`
  # returning 0 only means the process spawned, not that it works.
  local url="http://127.0.0.1:${PORT:-8787}/healthz"
  for _ in $(seq 1 20); do
    sleep 0.5
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      log "Healthy: $(readlink "$CURRENT")"
      return 0
    fi
  done
  return 1
}

# --- rollback ----------------------------------------------------------------
if [[ "${1:-}" == "--rollback" ]]; then
  mapfile -t all < <(ls -1d "$RELEASES"/*/ 2>/dev/null | sort)
  [[ ${#all[@]} -ge 2 ]] || die "nothing to roll back to"
  previous="${all[-2]%/}"
  log "Rolling back to $(basename "$previous")"
  ln -sfn "$previous" "$CURRENT"
  restart_and_verify || die "rollback failed health check — investigate by hand"
  exit 0
fi

REF="${1:-origin/main}"

command -v node >/dev/null || die "node not on PATH"
[[ -d "$REPO/.git" ]] || die "no git checkout at $REPO (see DEPLOY.md)"

mkdir -p "$RELEASES" "$ROOT/data"

log "Fetching $REF"
git -C "$REPO" fetch --all --prune --tags
SHA="$(git -C "$REPO" rev-parse --short "$REF")"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$SHA"
TARGET="$RELEASES/$STAMP"
[[ -e "$TARGET" ]] && die "release $STAMP already exists"

log "Building release $STAMP"
# Build somewhere the running service does not read from. If anything below
# fails, `set -e` aborts and the live symlink is untouched.
git -C "$REPO" worktree add --detach "$TARGET" "$REF" >/dev/null
cleanup_failed() {
  log "Build failed — discarding $STAMP, leaving the running release alone"
  git -C "$REPO" worktree remove --force "$TARGET" 2>/dev/null || rm -rf "$TARGET"
}
trap cleanup_failed ERR

cd "$TARGET"

# Reuse the previous release's icons: they are a gitignored build artifact and
# re-downloading ~2000 files on every deploy is slow and pointless.
if [[ -d "$CURRENT/public/icons" ]]; then
  mkdir -p "$TARGET/public/icons"
  cp -rn "$CURRENT/public/icons/." "$TARGET/public/icons/" 2>/dev/null || true
fi

npm ci
npm run fetch:icons
npm run build          # vite -> dist/, esbuild -> dist-server/
npm run typecheck
npm test

# Production only needs `dependencies` now that the server is compiled ahead of
# time — nothing on the start path comes from devDependencies any more.
npm prune --omit=dev

trap - ERR

log "Activating $STAMP"
PREVIOUS="$(readlink "$CURRENT" 2>/dev/null || true)"
ln -sfn "$TARGET" "$CURRENT"

if ! restart_and_verify; then
  log "New release failed its health check — rolling back"
  if [[ -n "$PREVIOUS" ]]; then
    ln -sfn "$PREVIOUS" "$CURRENT"
    restart_and_verify || die "rollback ALSO failed — investigate by hand"
    die "deploy of $STAMP failed health check; rolled back to $(basename "$PREVIOUS")"
  fi
  die "deploy of $STAMP failed health check and there is no previous release"
fi

# --- prune old releases ------------------------------------------------------
log "Pruning old releases (keeping $KEEP)"
mapfile -t old < <(ls -1d "$RELEASES"/*/ 2>/dev/null | sort | head -n "-$KEEP")
for dir in "${old[@]:-}"; do
  [[ -z "$dir" ]] && continue
  [[ "${dir%/}" == "$(readlink "$CURRENT")" ]] && continue
  echo "  removing $(basename "${dir%/}")"
  git -C "$REPO" worktree remove --force "${dir%/}" 2>/dev/null || rm -rf "${dir%/}"
done

log "Deployed $STAMP"
