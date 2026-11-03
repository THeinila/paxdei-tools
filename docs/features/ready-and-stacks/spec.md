# Ready badges and stack counts
Key: RDY · Status: Draft · Owner: — · Updated: 2026-11-03

## Story
As a player, I want to see which crafts I can do right now and how many inventory stacks an
amount is, so that I can pick my next step and plan bag space.

## Context
- Architecture: [architecture.md](../../architecture.md) §3 (engine)
- ADRs: —
- Related: [planner epic](../../epics/planner/epic.md) #5. Depends on plan-engine (PLAN).
  Code: `computeReady`, `stacksFor` and `formatStacks` in `engine/view.ts`.
- Terms:
  - **ready**: a craft step that isn't satisfied and has no unfinished craftable ingredient.
    Raw ingredients don't block it.
  - **stack size**: the most units of an item one inventory slot holds (`maxStackSize`).

## Scope
In: the "ready" badge on craft rows and the stack breakdown on gather and craft rows.
Out: treating unfinished gathers as blocking, which the engine supports but the UI doesn't
use.

## Acceptance criteria

### RDY-1: A craft with no unfinished craftable ingredients is ready
Given a craft step that isn't satisfied and whose ingredients are all raw materials, or are
craftable items whose steps are satisfied,
When the plan is shown,
Then its row shows a "ready" badge.

### RDY-2: An unfinished sub-craft blocks its consumer
Given a craft step with at least one craftable ingredient whose step isn't satisfied,
When the plan is shown,
Then its row has no "ready" badge.

### RDY-3: Owning the blocking ingredient makes the consumer ready
Given a consumer blocked only by ingredient X (RDY-2),
When X's have amount reaches its demand,
Then the consumer shows "ready".

### RDY-4: Satisfied steps are never ready
Given a satisfied craft step,
When the plan is shown,
Then its row has no "ready" badge.

### RDY-5: Steps in a recipe cycle are never ready
Given a plan with a recipe cycle (PLAN-7),
When readiness is computed,
Then it finishes, and no step in the cycle is ready.

### RDY-6: Hiding completed rows doesn't change readiness
Given a plan,
When "Hide completed" is turned on or off,
Then the same craft steps are ready.

### RDY-7: Amounts over one stack show a stack breakdown
Given a gather or craft row whose quantity q is greater than the item's stack size s (s > 1),
When the row is shown,
Then it shows "⌊q/s⌋ stack(s) + (q mod s)", or just "n stacks" when the remainder is 0.
"stack" is singular for 1. Examples: 240 at s = 100 shows "2 stacks + 40", 300 shows
"3 stacks", 120 shows "1 stack + 20".

### RDY-8: One stack or less shows no breakdown
Given a row whose quantity is at most one stack, or whose item has no stack size or a stack
size of 1,
When the row is shown,
Then no stack breakdown is shown.

## Non-functional requirements
None.

## Open questions
- (as-built) RDY-1: "ready" ignores raw materials that haven't been gathered yet, so a craft
  can be "ready" while you hold none of its inputs. The engine can treat gathers as blocking
  but the UI doesn't. Keep the looser meaning?

## Changelog
- 2026-11-03 — created (backfilled from the code and `view.test.ts`)
