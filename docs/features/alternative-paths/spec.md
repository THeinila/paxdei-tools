# Alternative recipe paths
Key: ALT · Status: Draft · Owner: — · Updated: 2026-11-03

## Story
As a player, I want to pick between recipes that use different inputs, so that the plan uses
the materials I actually have access to.

## Context
- Architecture: [architecture.md](../../architecture.md) §4 "State and data flow". Path
  choices are part of the shared list definition.
- ADRs: [0009](../../adr/0009-use-additive-deltas-for-progress-and-version-guards-for-defi.md) (definition edits are version-guarded)
- Related: [planner epic](../../epics/planner/epic.md) #3. Depends on plan-engine (PLAN). The
  data pipeline keeps only variants whose ingredient sets differ (DAT-4). Code:
  `pickVariant` in `planner.ts`, the path select in `PlanView.tsx`.
- Terms:
  - **variant**: one recipe for an item.
  - **path choice**: the variant chosen for an item on a list.

## Scope
In: choosing a variant per item, the default variant, and falling back when a choice is no
longer valid.
Out: how definition edits are saved and merged (EDT).

## Acceptance criteria

### ALT-1: The first variant is the default
Given an item with several variants and no path choice for it,
When the plan is computed,
Then the item's step uses the dataset's first variant.

### ALT-2: A path choice replaces the item's inputs
Given an item with variants A (the default) and B,
When the user chooses B,
Then the plan uses B's ingredients, yield and profession for that item, and A's ingredients
are no longer demanded because of it.

### ALT-3: A choice is offered only where there is one to make
Given a plan,
When it is shown,
Then each craft row whose item has more than one variant has a selector showing the current
variant. Each option is labelled with its ingredients ("Sapwood×2 + Water×1"). Craft rows
for items with one variant have no selector.

### ALT-4: A path choice is saved with the list
Given a user has chosen a variant for an item,
When the list is opened again, in this browser or by a collaborator,
Then the plan uses the chosen variant.

### ALT-5: An invalid choice falls back to the default
Given a list whose path choice names a recipe that no longer exists for that item (for
example after a dataset update),
When the plan is computed,
Then the item uses its first variant, and nothing breaks.

## Non-functional requirements
None.

## Open questions
- (as-built) ALT-1: the default is upstream's order, not a choice of ours (for example the
  cheapest path). Is that the order we want to promise?

## Changelog
- 2026-11-03 — created (backfilled from the code and `planner.test.ts`)
