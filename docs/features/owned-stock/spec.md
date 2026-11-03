# Owned stock
Key: OWN · Status: Draft · Owner: — · Updated: 2026-11-03

## Story
As a player, I want to enter what I already have, raw or crafted, so that the plan shows
only what's left to do.

## Context
- Architecture: [architecture.md](../../architecture.md) §4 "State and data flow"
- ADRs: [0002](../../adr/0002-run-the-recipe-engine-in-the-client-and-keep-the-server-as-s.md)
- Related: [planner epic](../../epics/planner/epic.md) #2. Depends on plan-engine (PLAN).
  Code: `src/tools/planner/engine/planner.ts`, `OwnedInput` in `PlanView.tsx`.
- Terms:
  - **have**: the amount entered on a row. On a shared list this is the shared progress
    amount (PRG-3).
  - **demand**: what the plan needs of an item before anything owned is taken off.
  - **satisfied**: a step whose demand is fully covered by have amounts. A satisfied row is
    shown dimmed, with its quantity struck through.

## Scope
In: the "have" input on gather and craft rows, subtracting have amounts, and marking steps
satisfied.
Out: how have amounts are stored and shared (PRG), hiding satisfied rows (LAY-5).

## Acceptance criteria

### OWN-1: Every plan row has a "have" input
Given a plan with gather and craft steps,
When it is shown,
Then every gather row and every craft row has a numeric "have" input showing the stored
amount, or an empty field with the placeholder 0.

### OWN-2: A have amount reduces a raw material's quantity
Given a gather step with demand d and a have amount h < d,
When the plan is computed,
Then the gather step's quantity is d − h, and it isn't satisfied.

### OWN-3: A fully covered raw material stays in the plan, satisfied
Given a gather step with demand d and a have amount h ≥ d,
When the plan is computed,
Then the step is still listed, satisfied, showing quantity d, and it isn't counted in
"to gather".

### OWN-4: A fully owned intermediate takes its sub-tree out of the work
Given a craftable item with demand d and a have amount h ≥ d,
When the plan is computed,
Then its craft step is satisfied with 0 crafts and shows "have enough", and every step that
was only needed for it is also satisfied. Those steps still show the quantities the full
recipe tree would need.

### OWN-5: A partly owned intermediate reduces its crafts and inputs
Given a craftable item with demand d, yield y and a have amount 0 < h < d,
When the plan is computed,
Then its crafts = ⌈(d − h) / y⌉, and its ingredients are demanded only for those crafts.

### OWN-6: An ingredient shared with unfinished work stays active
Given an ingredient needed both by a fully owned intermediate and by another craft that isn't
owned,
When the plan is computed,
Then the ingredient isn't satisfied, and its quantity covers only the craft that isn't owned.

### OWN-7: Over-owning never makes a quantity negative
Given any step whose have amount is greater than its demand,
When the plan is computed,
Then no quantity, craft count or total in the plan is below 0.

### OWN-8: Invalid have input becomes 0
Given the "have" input on a row,
When the user enters a negative number or text that isn't a number,
Then the have amount is stored as 0.

## Non-functional requirements
None.

## Open questions
- (as-built) OWN-8: fractional amounts (for example 2.5) aren't rounded on the client; the
  server truncates the delta. Should the input accept only whole numbers?

## Changelog
- 2026-11-03 — created (backfilled from the code and `planner.test.ts`)
