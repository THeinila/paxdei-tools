# Recipe tooltip and item labels
Key: TIP · Status: Draft · Owner: — · Updated: 2026-11-03

## Story
As a player, I want to see an item's recipe when I hover over or tap it, so that I can check
what goes into it without leaving the plan.

## Context
- Architecture: [architecture.md](../../architecture.md) §4 "Security headers": the CSP allows
  inline styles for this card.
- ADRs: [0012](../../adr/0012-set-security-headers-in-the-app-with-a-strict-same-origin-cs.md), [0003](../../adr/0003-bundle-the-game-data-and-serve-every-asset-from-our-own-orig.md) (local icons, one outbound link)
- Related: [planner epic](../../epics/planner/epic.md) #7. Depends on plan-layouts (LAY).
  Code: `ItemLabel`, `RarityTag` and `RecipeTooltip` in `components/RecipeTooltip.tsx`,
  `Icon` in `components/Search.tsx`, the "where?" link in `PlanView.tsx`.
- Terms:
  - **item label**: an item's icon, name and rarity tag, as shown on list, plan and search
    rows.
  - **card**: the floating recipe tooltip.

## Scope
In: the card's content, how it opens and closes, where it's placed, rarity tags, icons and
the "where?" link.
Out: the in-app biome data on the roadmap (BIO), and making the "where?" link optional (LNK).

## Acceptance criteria

### TIP-1: Hovering or focusing an item label opens its card
Given an item label in the list or the plan,
When a mouse pointer enters it, or it receives keyboard focus,
Then a card opens showing the item's icon, its name, and "T<tier>" when the item has a tier.
The card closes when the pointer leaves or focus moves away.

### TIP-2: The card lists every recipe variant
Given a craftable item with one or more variants,
When its card is open,
Then each variant shows "<profession> · makes ×<yield>" ("Crafting" when there's no
profession) and each ingredient with its icon, name and "×<count>". Variants are separated
by "or".

### TIP-3: A raw material's card says it's gathered
Given an item with no recipe,
When its card is open,
Then the card reads "Raw material — gathered". When the item has a "where?" link, it adds
"· see “where?” for sources".

### TIP-4: Tapping toggles the card on touch
Given a touch or pen pointer,
When the user taps an item label,
Then its card opens. A second tap on the label, or a tap anywhere outside it, closes it.

### TIP-5: The card stays inside the viewport
Given an open card,
When it is placed,
Then it sits below the label by default, flips above the label when it would overflow the
bottom of the viewport, and is kept at least 8 px inside every edge.

### TIP-6: Uncommon and rare items are tagged
Given an item label,
When the item's rarity is uncommon or rare,
Then the name is followed by an "Uncommon" or "Rare" tag. Other rarities show no tag.

### TIP-7: Icons come from our own origin, and missing ones are hidden
Given an item with an icon path,
When its label is shown,
Then the icon loads from `/icons/<name>` on the same origin. If the icon fails to load it is
hidden. An item with no icon path shows an empty placeholder of the same size.

### TIP-8: Gather rows link to their source page
Given a gather row,
When it is shown,
Then it has a "where?" link to `https://paxdei.gaming.tools/<category>/<item id>` (category
"items" when the item has none), which opens in a new tab without sending a referrer.

## Non-functional requirements

### TIP-N1: Item labels are keyboard reachable
Every item label can be reached with Tab, so keyboard users can open its card (TIP-1).

## Open questions
None.

## Changelog
- 2026-11-03 — created (backfilled from the code; no existing tests)
