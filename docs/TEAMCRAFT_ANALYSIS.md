# FFXIV Teamcraft — feature analysis & what to borrow

Research pass (2026-08-22) for the crafting-planner refinement work. Sources are the
Teamcraft wiki (`wiki.ffxivteamcraft.com`) and the app itself. Structured as: what
Teamcraft does → what we already have → what is worth borrowing for Pax Dei.

---

## 1. Teamcraft's feature inventory

### List core
- **Item lists** cover every item in the game, including "workshop" crafts (houses,
  airships, submarines) — i.e. the big multi-stage builds, which is exactly our
  building-pieces case.
- **List kinds**: *Classic* (named, persistent), *Ephemeral* (one-button, unnamed,
  auto-deleted on completion), *Community* (published + topic-tagged, browsable).
- **Quantity semantics**: a "collectable" checkbox lets you ask for N *crafts*
  rather than N *items*, decoupling the ask from recipe yield.
- **Compact list panel**: name, item count, tags, share/clone/open/delete buttons,
  editable amounts, per-item delete, icon tooltips.
- **More-options menu**: rename, comments, tags, permissions, team assignment.
- **Archived lists** — retire finished lists without deleting them.
- **Folders + drag & drop** to organize lists, rotations, and layout panels.

### The layout system (their strongest idea)
The plan is not one fixed view. A **layout** is an ordered stack of **panels**;
each panel is a filter, and rows fall through panels top-to-bottom, landing in the
first that matches. Filters are source predicates — `IS_CRAFT`, `IS_GATHERING`,
`IS_TIMED`, `CAN_BE_BOUGHT`, `IS_MONSTER_DROP`, `IS_VENTURE`, `IS_REDUCTION`,
`IS_CRAFTED_BY_{JOB}`, and so on — combinable with AND / OR / NOT.

Per-panel display options:
- ordering **Default** (flat), **Display Crafting Tiers** (our tier view), or
  **Area Breakdown** (group by where you gather it),
- hide completed/used rows, hide empty blocks, auto-collapse finished blocks,
- choose which action buttons appear on rows,
- show craftable-item counts (how many you could make *right now*).

Layouts are unlimited, exportable/importable, and switchable per list.

### Collaboration
- **Permission levels**: OWNER / WRITE / PARTICIPATE / READ / NONE. PARTICIPATE —
  report progress, check off, comment — but *not* edit the list definition. The
  highest applicable level wins.
- **Teams**: leaders assign items to members; the member's avatar shows on the row.
- **Real-time sharing**: changes propagate to other viewers with a short delay.
- **Discord webhook** posting list-progress events to a channel.
- **Per-item comments**.
- **Commission board** — a *reverse* market board: a client posts a request (items,
  budget, materials-provided flag, contact, tags), crafters apply privately, the
  client hires one, the list becomes editable by that contractor, a progress bar
  tracks it, then both sides rate each other.

### Around the list
- **Item tags** — user-defined labels on items, autocompleted, usable as panel
  filters (INCLUDES / DOESN'T INCLUDE).
- **Alarms** for timed gathering nodes.
- **Gathering notebook** — where/when a material spawns.
- **Inventory** linked from the desktop app, plus an **Inventory Optimizer**.
- **Crafting simulator / rotations**, **gearsets & materia melding**, **custom
  items** (simulate something not in the game), **recipe finder**,
  **desynthesis guide**, **currency guide**, **macro translator**, **reset timer**,
  **metrics dashboard**, **desktop overlay**.
- **Import a list from another tool**.

### Interaction polish
Anything circular is a button; hovering an icon gives full sources/recipes;
hovering a button explains it; drag & drop everywhere; a share icon on essentially
every page produces a link to exactly that view.

---

## 2. What we already have

| Teamcraft idea | pax-planner status |
|---|---|
| Flattened plan across targets | ✅ `engine/planner.ts` |
| Crafting-tier ordering | ✅ tier view, deepest-tier-wins, profession-sorted |
| Owned-stock subtraction | ✅ incl. sub-tree pruning |
| Alternative recipe paths | ✅ `pathChoices` |
| Real-time shared progress | ✅ polling + additive deltas + attribution |
| Share link | ✅ `?list=<token>` |
| Item tooltips | ✅ `RecipeTooltip.tsx` |
| Where-to-gather | ⚠️ outbound link to gaming.tools only |
| Layouts / panels / filters | ❌ |
| Permissions | ❌ (link = full write) |
| Assignments | ❌ (attribution only, after the fact) |
| Multiple / named / archived lists | ❌ (one local list) |
| Comments | ❌ |
| Export / import | ❌ |

---

## 3. What's worth borrowing — ranked

Ranked by (value to a Pax Dei group) ÷ (cost, given our data and stack).

### Tier A — high value, cheap, no new data needed

1. **A layout-lite system.** Not the full panel builder — a small set of saved view
   presets over the existing plan: *Tiered* (today), *Flat gather list*, *By
   profession/station*, *Only what I can do now*. Panels = a filter predicate + an
   ordering, exactly Teamcraft's model but with our five or six predicates
   (`isRaw`, profession, tier, has-stock, rarity) instead of their thirty. This is
   the single most transferable idea and it subsumes several existing backlog
   items ("by profession view toggle", "collapsible tiers").
2. **Hide-completed / collapse-finished rows.** One checkbox each. On a 200-row
   building plan this is the difference between usable and not.
3. **"Craftable now" count per craft row.** Given owned stock, how many of this
   step could you make right this second. Pure engine addition, high signal.
4. **Multiple named lists + archive.** We have a server and a token model already;
   locally it is a keyed map instead of one blob. Unlocks "my keep project" vs
   "tonight's armour run".
5. **Export the plan** as Markdown / plain text for Discord. Already in the backlog
   and it is the poor-man's version of Teamcraft's Discord webhook.
6. **Permission levels on shared lists.** At minimum OWNER vs PARTICIPATE: a
   second, participate-only token so a share link cannot silently rewrite the list
   definition. Cheap given our version-guarded edits, and it closes a real footgun.

### Tier B — high value, more work

7. **Assignments / claiming.** Teamcraft is leader-assigns; for a Pax Dei clan a
   *self-claim* ("I've got the ore") fits better, and the backlog already wants it.
   Server-side it is one nullable `claimed_by` column next to `progress`.
8. **Per-item comments.** "Iron is cheaper from the east vein." One table, one
   popover. Pairs with claiming.
9. **Item tags + tag filters.** User labels feeding the layout filters. Only worth
   it once layouts (A1) exist — tags without panels are decoration.
10. **Ephemeral / quick lists.** One-button "plan this item" with no naming
    ceremony, auto-cleaned. Nice once multiple lists exist.
11. **Stack-size awareness** (already in the backlog). We have `maxStackSize`;
    Teamcraft's equivalent is inventory optimization. Showing "1,240 (13 stacks)"
    is a two-line change with real value for hauling.

### Tier C — needs data or infrastructure we don't have

12. **Area breakdown / gathering notebook.** Teamcraft's killer gathering feature is
    grouping by *where*. We currently punt to gaming.tools. This depends on
    scraping source/biome text — the backlog's "per-material biome surfacing".
    High value, gated on data.
13. **Crafting station + tier on craft rows.** Already the top backlog item;
    Teamcraft's job-based filters are only useful because they know the station.
    This is a prerequisite for a good "by station" layout.
14. **Time / XP estimates.** We have `baseDuration`; Teamcraft's simulator is far
    beyond scope, but "this tier is ~40 min of bench time" is achievable.
15. **Commission board.** A genuinely great idea and a plausible *second tool*
    ("someone craft this for me, here is the budget"), but it is a marketplace with
    reputation — its own project, not a planner refinement.
16. **Inventory linking / packet capture / overlay / simulator / gearsets.**
    Out of scope: they depend on reading the game client.

---

## 4. Suggested scope for this branch

A coherent first slice, roughly in dependency order:

1. View presets (layout-lite): Tiered / Flat / By profession.
2. Hide-completed + collapse-finished-sections.
3. "Craftable now" counts and stack counts on rows.
4. Markdown export of the current view.
5. Multiple named local lists (+ archive), reusing the existing storage layer.

Deferred to follow-ups: permissions split, claiming, comments, tags, area
breakdown (blocked on biome data), station names (blocked on the per-recipe fetch).

---

## Sources

- <https://wiki.ffxivteamcraft.com/> — wiki home and page index (`llms.txt`)
- <https://wiki.ffxivteamcraft.com/base-features/items-lists> — item lists
- <https://wiki.ffxivteamcraft.com/base-features/layout-system> — layout system
- <https://wiki.ffxivteamcraft.com/advanced-features/permissions.md> — permissions
- <https://wiki.ffxivteamcraft.com/advanced-features/teams.md> — teams
- <https://wiki.ffxivteamcraft.com/advanced-features/item-tags.md> — item tags
- <https://wiki.ffxivteamcraft.com/general-features/commission-board.md> — commissions
- <https://wiki.ffxivteamcraft.com/tips-and-tricks> — interaction polish
