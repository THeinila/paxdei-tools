# 0002. Run the recipe engine in the client and keep the server as storage
Status: Proposed · Date: 2026-11-03
Backfilled from: `server/lists.ts` header comment, `src/tools/planner/engine/`

## Context
The plan (flatten, aggregate, owned-stock subtraction, tiers, alternative paths) is computed
from the item dataset. The production host has about 125 ms of CPU per second
([CAPACITY.md](../CAPACITY.md)), and the engine has to stay testable without I/O. Specs:
plan-engine (PLAN), owned-stock (OWN), shared-progress (PRG).

## Decision
The recipe engine is pure TypeScript in `src/tools/planner/engine/` and runs only in the
browser. The server is "dumb storage". It stores a list's definition (`name`, `targets`,
`pathChoices`) and a per-item progress map, and never loads the dataset or runs the engine.
- The shared "have" map is fed into the engine as owned stock. `owned` is derived from
  progress and never stored separately.
- The server clamps progress at ≥ 0. The upper bound (demand) is the engine's job, so the
  server doesn't need to know what an item is needed for.

## Consequences
- Server CPU per request stays tiny (a poll is about 2.5 ms), and server memory doesn't
  include the dataset.
- The engine is unit-testable with no I/O.
- The server can't validate a list against the game data. An unknown item ID is stored as
  given, within the size bounds in `sanitizeState`.
- Clients on different dataset versions can compute different plans from the same list.

## Alternatives considered
- Compute plans on the server — rejected because it spends the host's scarcest resource
  (CPU) and would load the 1.5 MB dataset into server memory.
