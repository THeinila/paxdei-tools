# Flattened crafting plan
Key: PLAN · Status: Approved · Owner: — · Updated: 2026-11-03

## Story
As a player, I want the full tree of crafts behind my targets flattened into one plan, so
that I know every material and every craft step without expanding recipes by hand.

## Context
- Architecture: [architecture.md](../../architecture.md) §3 (engine), §4 "State and data flow"
- ADRs: [0002](../../adr/0002-run-the-recipe-engine-in-the-client-and-keep-the-server-as-s.md) (the engine runs in the client)
- Related: [planner epic](../../epics/planner/epic.md) #1. Code: `src/tools/planner/engine/planner.ts`.
- Terms:
  - **target**: an item and quantity on the list.
  - **craft step**: one row per craftable item, with its quantity, number of **crafts**
    (bench runs) and the units it **produces**.
  - **gather step**: one row per raw material.
  - **tier**: a craft step's dependency depth (a target is tier 0, its ingredients tier 1,
    and so on).
  - **yield**: the units one craft produces.

## Scope
In: expanding targets into craft and gather steps, aggregation, rounding by yield, order,
tiers, cycle handling, the plan summary and the empty state.
Out: owned stock (OWN), recipe variants (ALT), grouping and filtering (LAY), ready badges
and stacks (RDY).

## Acceptance criteria

### PLAN-1: A raw target is a single gather step
Given a list whose only target is a raw material with quantity q,
When the plan is computed,
Then it has one gather step for that item with quantity q, and no craft steps.

### PLAN-2: A craftable target expands into its craft and its raw inputs
Given a target with a recipe whose ingredients are raw materials,
When the plan is computed,
Then there is a craft step for the target, and one gather step per ingredient, with
quantity = ingredient count × number of crafts.

### PLAN-3: Crafts are rounded up by yield
Given a craft step needing n units of an item whose recipe yields y,
When the plan is computed,
Then crafts = ⌈n / y⌉ and produced = crafts × y. For example, 10 nails at yield 5 is 2
crafts producing 10, and 11 nails is 3 crafts producing 15. Its ingredients are demanded for
all of those crafts.

### PLAN-4: Ingredients come before the crafts that use them
Given a chain of three or more levels (A needs B, B needs C),
When the plan is computed,
Then every craft step comes after the craft steps for all of its craftable ingredients.

### PLAN-5: A shared ingredient appears once, with its demand summed
Given two targets that both need the same intermediate,
When the plan is computed,
Then that intermediate has exactly one craft step, whose quantity is the sum of both
demands, rounded by yield once.

### PLAN-6: Each craft step sits in its deepest tier
Given a component used both directly by a target and deeper in the tree,
When the plan is computed,
Then it has exactly one craft step, whose tier is its longest dependency distance from any
target.

### PLAN-7: A recipe cycle finishes with a warning
Given a dataset in which an item's recipe eventually requires the item itself,
When the plan is computed,
Then computation finishes, every item in the cycle still has a step, and the plan shows the
warning "Recipe cycle detected; the steps involved may be listed in arbitrary order."

### PLAN-8: A target that is also an ingredient is one step
Given item X is a target with quantity a and also an ingredient that another target needs b
of,
When the plan is computed,
Then X has one step, with quantity a + b.

### PLAN-9: Empty list
Given a list with no targets,
When the planner shows the list,
Then instead of a plan it says "Add items above to see what to gather and craft."

### PLAN-10: Plan summary
Given a non-empty plan,
When it is shown,
Then the summary reads "<g> to gather · <c> crafts in <t> tiers", where g is the number of
gather steps not yet covered by owned stock, c is the total number of crafts across all
craft steps, and t is the number of distinct tiers among the craft steps that aren't
satisfied. "craft" and "tier" are singular when the count is 1. When everything is owned, it
reads "0 crafts in 0 tiers".

## Non-functional requirements
None. The engine runs in the client ([ADR 0002](../../adr/0002-run-the-recipe-engine-in-the-client-and-keep-the-server-as-s.md)), and nothing measures its time today.

## Open questions
None.

## Changelog
- 2026-11-03 — created (backfilled from the code and `planner.test.ts`)
- 2026-11-03 — PLAN-10 now counts only tiers with unfinished crafts (settled as-built question; the code still differs)
- 2026-11-03 — approved
- 2026-11-03 — PLAN-10 fixed in the code (Phase 5b); discrepancy closed
