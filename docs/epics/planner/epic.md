# Epic: Crafting plan
Status: Draft · Updated: 2026-11-03

## Goal
A player picks what they want to make and gets a correct, readable plan: every raw
material to gather and every intermediate to craft, in an order they can work through,
with what they already have taken off. It worked if the totals match what the game needs
and a player can follow the plan top to bottom without working anything out by hand.

**Backfill.** Every feature here is already built (Crafting Planner 1.5.1). The order
records dependencies, not delivery. The draft ACs come from the code and the existing
tests in `src/tools/planner/engine/*.test.ts`. They become specs in adoption Phase 3.
`Also needs:` lines record dependencies on other epics, which `spec.mjs lint` can't check
yet.

## Features

### 1. plan-engine · Key: PLAN
Story: As a player, I want the full tree of crafts behind my targets flattened into one plan, so that I know every material and every craft step without expanding recipes by hand.
Depends on: —
Draft ACs:
- PLAN-1: A raw target appears as a single gather step for its quantity, with no craft steps.
- PLAN-2: A craftable target expands into a craft step plus gather steps for its raw inputs.
- PLAN-3: Craft batches are rounded up by the recipe's yield (10 nails at yield 5 is 2 crafts producing 10; 11 is 3 crafts producing 15).
- PLAN-4: A multi-level chain is listed in dependency order: every ingredient comes before the craft that uses it.
- PLAN-5: An intermediate shared by two targets appears once, with the quantities summed.
- PLAN-6: Each craft step has a tier by depth (target = 0, ingredients deeper). A component used at several depths appears once, in its deepest tier.
- PLAN-7: A recipe cycle in the data ends planning with a warning instead of hanging.

### 2. owned-stock · Key: OWN
Story: As a player, I want to enter what I already have, raw or crafted, so that the plan shows only what's left to do.
Depends on: plan-engine
Draft ACs:
- OWN-1: An owned raw material reduces its gather quantity. When it is fully covered, the row stays in the plan, marked satisfied.
- OWN-2: A fully owned intermediate is marked satisfied, and its whole sub-tree drops out of the gather and craft totals.
- OWN-3: A partly owned intermediate reduces its crafts and its inputs without removing the branch.
- OWN-4: Owned stock counts only up to demand; owning more than needed never makes a total negative.

### 3. alternative-paths · Key: ALT
Story: As a player, I want to pick between recipes that use different inputs, so that the plan uses the materials I actually have access to.
Depends on: plan-engine
Draft ACs:
- ALT-1: An item with several recipe variants uses the first variant unless one was chosen.
- ALT-2: Choosing a variant replaces that item's inputs in the plan with the chosen variant's inputs.
- ALT-3: A craft row whose item has more than one variant offers a choice, with each option labelled by its ingredients and counts.

### 4. plan-layouts · Key: LAY
Story: As a player, I want to view the plan by tier, in dependency order or by profession, and hide or collapse what I'm done with, so that I can work the plan the way my session needs.
Depends on: plan-engine
Draft ACs:
- LAY-1: The tiered preset groups craft steps by tier, deepest first, so final products come last.
- LAY-2: The flat preset shows every craft step in one section, in dependency order.
- LAY-3: The profession preset groups craft steps by profession, with unknown professions last and the deepest tier first within each.
- LAY-4: The gather section, and the tier count in the summary, are the same under every preset.
- LAY-5: "Hide completed" removes satisfied rows, drops sections that end up empty, and shows how many rows are hidden.
- LAY-6: Any section can be collapsed and expanded, and its heading reports which state it is in.
- LAY-7: Preset, hide-completed and collapsed sections are remembered per list in this browser only, and survive reloads and corrupt or unavailable storage.

### 5. ready-and-stacks · Key: RDY
Story: As a player, I want to see which crafts I can do right now and how many inventory stacks an amount is, so that I can pick my next step and plan bag space.
Depends on: plan-engine
Draft ACs:
- RDY-1: A craft step is marked ready when none of its sub-crafts is unfinished. A craft with only raw ingredients is ready by default.
- RDY-2: Once a craft's ingredients are owned, it becomes ready.
- RDY-3: Steps inside a recipe cycle are never marked ready, and the check terminates.
- RDY-4: An amount larger than one inventory stack shows a stack breakdown ("2 stacks + 50"). One stack or less, or an unknown stack size, shows nothing.

### 6. markdown-export · Key: MDX
Story: As a player, I want to copy the plan as a Markdown checklist, so that I can paste it into Discord for my group.
Depends on: plan-layouts, ready-and-stacks
Draft ACs:
- MDX-1: "Copy as Markdown" puts the plan on the clipboard as a tick-box checklist, with satisfied rows ticked.
- MDX-2: The export follows the current preset, includes collapsed sections' rows, and notes how many rows hide-completed left out.
- MDX-3: The export includes stack counts, the list's name (or a default for an untitled list), and the list's link.
- MDX-4: The button confirms with "Copied!" for 2 seconds. If clipboard access is blocked, nothing visible changes (as-built).

### 7. recipe-tooltip · Key: TIP
Story: As a player, I want to see an item's recipe when I hover over or tap it, so that I can check what goes into it without leaving the plan.
Depends on: plan-layouts
Draft ACs:
- TIP-1: Hovering with a mouse, or focusing an item label, shows a card with the item's icon, name, tier and each recipe variant (profession, yield, ingredients with counts), with variants separated by "or".
- TIP-2: A raw material's card says it's gathered and points to the "where?" link.
- TIP-3: On touch, a tap toggles the card, and tapping anywhere else closes it.
- TIP-4: Uncommon and rare items carry a rarity tag after their name. Common items have none.
- TIP-5: A gather row with a known item has a "where?" link to its gaming.tools page, which opens in a new tab with no referrer.

### 8. item-search · Key: SRCH
Story: As a player, I want to search the item catalogue by name and add an item with a quantity, so that I can build a list of what I want to make.
Depends on: —
Also needs: collaboration/share-link (results are added to a server-backed list)
Draft ACs:
- SRCH-1: Typing at least 2 characters lists matching items by case-insensitive substring. Prefix matches rank first, then shorter names, up to 40 results.
- SRCH-2: Each result shows its icon, name, rarity tag and category ("raw material" for raws), and a quantity field that defaults to 1 and can't go below 1.
- SRCH-3: Clicking a result or its "+" adds that quantity to the list. Adding an item already on the list increases its quantity.
- SRCH-4: A query of 2 or more characters with no match says "No items match …".
- SRCH-5: Escape or a click outside the search closes the results.
- SRCH-6: The catalogue loads only when a planner page opens. The landing page never downloads it ([ADR 0004](../../adr/0004-lazy-load-the-dataset-as-its-own-hashed-chunk.md)).

## Out of scope
- Saving, naming, sharing and syncing lists: the collaboration epic.
- Generating the dataset: the data epic.
- Backlog items such as station names, search filters and a "bought" toggle: the roadmap epic.

## Open questions
None. All eight specs were approved on 2026-11-03, and their as-built questions were settled
in the specs. Four behaviours are specified differently from what the code does today, and
are fixed later:

| AC | Spec says | Code does |
|---|---|---|
| [PLAN-10](../../features/plan-engine/spec.md) | Tier count only counts tiers with unfinished crafts | Counts every tier |
| [OWN-8](../../features/owned-stock/spec.md) | Fractional have amounts are rounded down | Passes them through |
| [MDX-10](../../features/markdown-export/spec.md) | A failed copy shows "Copy failed" | Fails silently |
| [SRCH-4](../../features/item-search/spec.md) | Readable category labels | Internal category IDs |
