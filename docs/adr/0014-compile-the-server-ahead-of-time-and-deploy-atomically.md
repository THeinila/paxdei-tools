# 0014. Compile the server ahead of time and deploy atomically
Status: Proposed · Date: 2026-11-03
Backfilled from: `scripts/build-server.mjs`, `deploy/deploy.sh`, `deploy/pax-planner.service`, CHANGELOG 1.4.0, `docs/CAPACITY.md` "Memory"

## Context
The old deploy built in the live directory, and `npm start` ran `tsx server/index.ts`, so a
devDependency was on the production start path. On the 1 GB host, `npm ci` deletes
`node_modules` before reinstalling. An OOM partway through left a service that couldn't
start, and there was no way to roll back.

## Decision
- `npm run build:server` bundles the server with esbuild to `dist-server/index.js`, keeping
  every `node_modules` package external (better-sqlite3 is native). `npm start` and the systemd unit run plain
  `node dist-server/index.js`. Production needs only `dependencies`; `deploy.sh` runs
  `npm prune --omit=dev` after building.
- `deploy/deploy.sh` builds each release in its own git worktree (`npm ci`, `fetch:icons`,
  build, typecheck, prune). Only a successful build gets the `current` symlink. The script
  then restarts the service and checks `/healthz`, and swaps back to the previous release if
  the check fails. `deploy.sh --rollback` does the same by hand.
- The database lives outside every release, at `/opt/pax-planner/data/data.sqlite`, so
  deploys and rollbacks never touch it.

## Consequences
- A failed build can't affect the running service, and a rollback is a symlink swap.
- The bundled server differs from the code that dev and tests run (`tsx`), so something
  that only breaks when bundled shows up only in `npm run build`. autocheck doesn't run
  the build.
- The deploy runs on the host, and only the user can reach it. There's no CI.

## Alternatives considered
- Keep `tsx` in production — rejected because it puts a devDependency on the start path.
- Build off-host and copy the artifacts — mentioned in DEPLOY.md as an option on the 1 GB
  shape, but not what `deploy.sh` does.
