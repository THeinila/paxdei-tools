# 0009. Use additive deltas for progress and version guards for definitions
Status: Proposed · Date: 2026-11-03
Backfilled from: `server/lists.ts`, `server/db.ts`, README "Architecture"

## Context
Several people edit one list at once. Progress (how many of an item the group has) changes
often and from many people. The definition (name, targets, path choices) changes rarely, and
a merge has to keep the list coherent. Specs: shared-progress (PRG), definition-edits (EDT).

## Decision
Two strategies, one for each kind of data.
- **Progress:** `POST /lists/:token/progress` takes `{ itemId, delta, handle }`, and one
  transaction reads, adds, clamps (0 ≤ qty ≤ 10,000,000) and writes. Two near-simultaneous
  "+10" requests sum to +20. The last writer's handle is recorded as attribution.
- **Definition:** `PATCH /lists/:token` takes `{ baseVersion, state }` and updates only
  `WHERE version = baseVersion`, incrementing the version. A stale `baseVersion` gets a
  409 with the current version and state. The client replays its edit against that state
  (rebase), up to `MAX_REBASE_ATTEMPTS = 3`.
- Every incoming state goes through `sanitizeState`, which enforces size bounds (500
  targets, 1,000 path choices, 128-character IDs, 80-character names).

## Consequences
- No lost updates for progress, and no locks held across requests.
- The delta's atomicity depends on one process and one synchronous connection
  ([0005](0005-serve-the-spa-and-api-from-one-hono-and-sqlite-process.md)). A second writer
  process would break it.
- Definition edits are updater functions on the client, so a rebase replays intent rather
  than overwriting.
- Deltas aren't idempotent. A retried request that had already succeeded counts twice.

## Alternatives considered
- Last-write-wins for everything — rejected because concurrent check-offs would lose
  counts.
- CRDTs or operational transform — rejected as far more machinery than two kinds of data
  need (inferred).
