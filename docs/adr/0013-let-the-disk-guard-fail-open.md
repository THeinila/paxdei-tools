# 0013. Let the disk guard fail open
Status: Accepted · Date: 2026-11-03
Backfilled from: `server/diskGuard.ts`, CHANGELOG 1.4.0, `docs/CAPACITY.md` "Guard rails"

## Context
The retention sweep runs daily and can't stop a burst of list creation. On the production
host a full volume can corrupt a SQLite database in WAL mode and break sshd and journald.
Measuring the disk takes a syscall, on a host with about 125 ms of CPU per second. Spec:
abuse-limits (ABU).

## Decision
`server/diskGuard.ts` makes `POST /api/lists` return 503 (with `retry-after: 3600`) when the
database's volume has less than 256 MB free. Reading, editing and ticking off existing lists
keep working.
- The `statfs` result is cached and refreshed at most once a minute. If the database file
  doesn't exist yet, the guard measures its directory.
- **It fails open.** If the measurement fails, or hasn't happened yet, the status is
  `low: false` and writes go through. A disk we can't measure isn't a full one.
- `GET /healthz` reports low disk as a 503. `deploy/disk-alert.sh` warns from cron at 80% and
  90%.

## Consequences
- Running low on disk takes away only the ability to start new lists.
- A broken `statfs` (permissions, an unusual filesystem) silently turns the guard off. The
  check logs the failure, but nothing alerts on it.
- Only list creation is guarded. Progress and definition writes can still grow the database
  within the size bounds in `server/lists.ts`.

## Alternatives considered
- Fail closed — rejected because a measurement glitch would block every new list.
- Rely on retention alone — rejected because it can't respond to a burst.
