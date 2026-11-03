# 0010. Sweep shared lists after a TTL of write inactivity
Status: Proposed · Date: 2026-11-03
Backfilled from: `server/retention.ts`, `server/db.ts`, CHANGELOG 1.4.0, `docs/CAPACITY.md` "Retention"

## Context
`POST /api/lists` is unauthenticated, and nothing ever deleted a list, so the database only
grew. On the production VM the SQLite file shares the boot volume with the OS. Filling it
would take down sshd and journald too, not just the app. Spec: list-retention (RET).

## Decision
`server/retention.ts` deletes lists with no **write** activity for `LIST_TTL_DAYS` (default
90; `0` disables it). Progress rows go with them through `ON DELETE CASCADE`. The sweep runs
at boot and then daily.
- The activity clock is a separate `last_activity_at` column. Definition edits and progress
  writes both bump it. `updated_at` only tracks the definition, so a list that's only being
  ticked off would look idle by that clock.
- Reads don't count as activity. Otherwise every poll would be a write, and one forgotten
  tab would keep a dead list alive forever.
- The migration backfills `last_activity_at` from the latest of `updated_at` and the list's
  newest progress row.
- The UI states the window from `LIST_TTL_DAYS` in `shared/listTypes.ts`.

## Consequences
- Database size is bounded over time.
- A list that people only *look at* for 90 days disappears. The footer says so, but there's
  no warning before it happens.
- An operator who changes the env var must also change the shared constant, or the UI
  misstates the policy.
- The sweep can't stop a burst; [0013](0013-let-the-disk-guard-fail-open.md) covers that.

## Alternatives considered
- Keep lists forever — rejected because of the disk-exhaustion path above.
- Count reads as activity — rejected because it would turn every poll into a write.
- Use `updated_at` as the clock — rejected because it would sweep lists that are actively in
  use.
