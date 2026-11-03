# List retention
Key: RET · Status: Implemented · Owner: — · Updated: 2026-11-03

## Story
As the operator, I want lists nobody has changed for 90 days to be deleted, so that
unauthenticated list creation can't fill the disk.

## Context
- Architecture: [architecture.md](../../architecture.md) §4 "State and data flow", §8
- ADRs: [0010](../../adr/0010-sweep-shared-lists-after-a-ttl-of-write-inactivity.md)
- Related: [collaboration epic](../../epics/collaboration/epic.md) #5. Depends on
  shared-progress (PRG) and definition-edits (EDT). A swept list's link then behaves as in
  SHR-8. Code: `server/retention.ts`, `migrate()` in `server/db.ts`, the footer in
  `Planner.tsx`.
- Terms:
  - **activity**: any write to a list: creating it, a definition save, or a progress write.
  - **TTL**: the retention window in days, `LIST_TTL_DAYS`.
  - **sweep**: one pass that deletes lists whose last activity is older than the TTL.

## Scope
In: what counts as activity, the sweep and its schedule, configuration, the migration for
the activity clock, and telling users the window.
Out: warning a group before its list is swept, and pruning the `visitors` table (MET).

## Acceptance criteria

### RET-1: Idle lists are deleted with their progress
Given a list whose last activity is more than TTL days ago,
When a sweep runs,
Then the list and all its progress rows are deleted. Lists with activity inside the window
are kept.

### RET-2: Writes keep a list alive
Given a list that is about to fall outside the window,
When anyone saves a progress write or a definition edit on it,
Then its activity clock is reset to now, and the next sweep keeps it.

### RET-3: Reading doesn't keep a list alive
Given a list outside the window,
When it is only read or polled,
Then its activity clock doesn't move, and the next sweep deletes it.

### RET-4: A new list starts with a fresh clock
Given a list that was just created,
When a sweep runs,
Then the list is kept.

### RET-5: The sweep runs at start and then daily
Given the server starts with retention enabled,
When it starts,
Then a sweep runs immediately and then every 24 hours. A sweep that fails is logged, and the
server keeps running.

### RET-6: The TTL is configurable
Given the `LIST_TTL_DAYS` environment variable,
When the server starts,
Then:
- unset or blank means 90;
- a whole number n ≥ 1 means n (fractions are rounded down);
- 0 disables the sweep and logs "lists are kept forever";
- a negative number or text that isn't a number falls back to 90.

### RET-7: Swept lists are counted
Given a sweep that deletes k > 0 lists,
When it finishes,
Then the daily `lists_swept` metric goes up by k, and the log says how many were swept. A
sweep that deletes nothing records no metric row and logs nothing.

### RET-8: Older databases get an activity clock
Given a database from before activity tracking (no `last_activity_at` column),
When the server starts,
Then the column is added, and each list's activity time is set to the later of its last
definition save and its newest progress write. Running the migration again changes nothing,
and no list is left without an activity time.

### RET-9: The editor states the window
Given the list editor,
When it is shown,
Then its footer reads "Shared lists are deleted after 90 days with no changes", using the
value of `LIST_TTL_DAYS` in `shared/listTypes.ts`.

## Non-functional requirements

### RET-N1: The sweep is cheap and can't take the server down
A sweep is one indexed `DELETE`, runs at most once a day, and doesn't keep the process alive
by itself ([CAPACITY.md](../../CAPACITY.md) "Retention").

## Open questions
None. RET-9 was settled on 2026-11-03: the footer shows the shared constant, not the server's
configured value, as [ADR 0010](../../adr/0010-sweep-shared-lists-after-a-ttl-of-write-inactivity.md)
accepts. An operator who changes the env var changes the constant too
([architecture.md](../../architecture.md) §8).

## Changelog
- 2026-11-03 — created (backfilled from the code and `retention.test.ts`)
- 2026-11-03 — approved
- 2026-11-03 — implemented: every AC has a passing test (trace 188/188, adoption Phase 6)
