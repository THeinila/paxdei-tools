# Changelog

All notable changes to the toolkit and its tools. Entries are grouped by a **Toolkit**
section (the deployable suite, versioned in `package.json`) plus one section per tool
(each versioned independently in `src/tools/registry.tsx`). Newest release on top.
See [RELEASING.md](RELEASING.md) for how versions are bumped.

## [1.3.0] — 2026-08-23

### Crafting Planner 1.3.0
- **Layout presets.** The plan can now be grouped three ways, switched from a new
  toolbar above it: **Tiered** (the previous fixed view, still the default), **Flat**
  (the engine's dependency order in one list) and **By profession** (grouped by station,
  deepest components first within each). Borrowed from FFXIV Teamcraft's layout system,
  cut down to three presets — see [docs/TEAMCRAFT_ANALYSIS.md](docs/TEAMCRAFT_ANALYSIS.md).
- **Hide completed** drops rows the owned stock already covers and reports how many it
  hid; **every section heading collapses**, caret and `aria-expanded` included.
- **Ready badges** on craft steps that nothing unfinished in the plan blocks. Raw
  ingredients deliberately don't block — computing an honest "craftable now" count would
  need a surplus/reservation pass, since owned stock is already subtracted at every node
  and a naive `min(floor(owned/count))` double-counts material spent upstream.
- **Stack counts** ("4 stacks", "1 stack + 10") on any row above one inventory stack,
  from the existing `maxStackSize`.
- **Copy as Markdown** puts the plan on the clipboard as a GitHub/Discord checklist.
- **Archive** retires a finished list without deleting it, behind a "Show archived"
  toggle; and a search box on the directory page starts a list from a single item.
- View settings (preset, hide-completed, collapsed sections) are stored **per browser and
  per list** in `lib/prefs.ts`, so collaborators on a shared list each keep their own view
  and switching views never touches the version-guarded list definition.

#### Internals
- Grouping/filtering/row derivation moved out of `PlanView.tsx` into a pure
  `engine/view.ts` (`buildPlanView`, `computeReady`, `stacksFor`). It's unit-testable
  without a DOM library — there is none in this repo — and `engine/markdown.ts` renders
  from the same view model, so the export can't drift from the screen.
- Readiness is computed over the full step list *before* hide-completed filtering, or
  hiding a row would silently unblock its consumers. It's two linear passes with no
  recursion, so a recipe cycle degrades to no badge rather than hanging.
- `totals.tierCount` derives from the step list, not the section count, so the summary
  reads the same under every preset.
- Gather is one section under every preset: `GatherStep` carries neither a tier nor a
  profession. Its rows now sort by display name rather than raw item id.
- `ListEntry.archivedAt` is optional, so stored entries need no migration. `setArchived`
  passes `updatedAt` through explicitly — the directory sorts by it, so archiving would
  otherwise reorder the list at the moment it's hidden.
- Engine test fixtures extracted to `engine/testFixtures.ts`; new tests cover the view
  model, readiness, stacks, the Markdown serializer (exact strings, not snapshots),
  prefs sanitization and archiving. 72 tests total.
- `Search` takes an `autoFocus` prop (default true) so the directory's search box doesn't
  steal focus on load; the mobile full-width `.path-select` rule is now scoped to
  `.row-controls` so it can't reach into the new toolbar.

## [1.2.1] — 2026-08-22

### Crafting Planner 1.2.1
- Game data refreshed from upstream (2026-08-22). Item and recipe counts are
  unchanged (2174 items); the update is a naming pass plus two removals.
- Crafting skill `skill_jewelerycrafting` renamed **Jewelry Making → Jewelcrafting**
  upstream (52 recipes). The skill id is unchanged and the app treats the profession
  as an opaque display/sort string, so this flows through with no code change.
- 70 items renamed, mostly the crafting-station tier scheme: the tier-1 name loses its
  `Basic ` prefix and the tier-2 name gains `Artisan ` (e.g. "Basic Alchemy Table" →
  "Alchemy Table", and the old "Alchemy Table" → "Artisan Alchemy Table"). Note the
  tier-2 rename reuses a name that previously belonged to tier 1, so a search for the
  bare station name now matches the tier-1 station. Also "Plank" → "Wooden Plank",
  "Bird Feathers" → "Feathers", "Hawthorne Heartwood" → "Hawthorn Heartwood".
- **Pure Glass** and **Intense Mead Base** lost their only recipe upstream and are now
  gathered raw materials rather than crafts (`recipeCount` 1707 → 1705). They remain in
  the item catalog via the market feed, so they still appear in search and can still be
  added to a list — the planner just no longer expands them into ingredients.
- A duplicate by-hand Wooden Arrow recipe was dropped upstream; no dataset effect, as
  the same-input rule already collapsed it into the surviving yield-5 recipe.
- Verified: both source files' schema is byte-for-byte structurally identical to the
  previous fetch, the market catalog is unchanged, all normalization rules held (same
  2 forced-raw, 5 dropped refinements, 11 items with alternative paths), no dangling
  ingredient references, and all 1693 craftable items plan without warnings.

## [1.2.0] — 2026-07-11

### Toolkit
- Static SPA now sets explicit `Cache-Control`: fingerprinted `/assets/*` are
  `immutable`, but `index.html` is `no-cache`, so a redeploy is picked up on the next
  load instead of serving a stale cached bundle. This fixes share links opening the
  landing page until a hard refresh (`server/index.ts`).
- Rate limits retuned for server-backed list creation: general `/api/*` 120→60/min,
  `POST /api/lists` 10→600/hour (`server/index.ts`).

### Crafting Planner 1.2.0
- Every list is now a shared, server-backed list with a single canonical
  `/planner/<token>` URL — the open list's address bar *is* its share link. The old
  split (local `/planner/<uuid>` vs. shared `?list=<token>`) is gone; the `useList`
  local mode and localStorage list bodies are removed.
- Backward compatible: `?list=<token>` links redirect to `/planner/<token>`; old
  `/planner/<uuid>` bookmarks still resolve; existing local lists are promoted to shared
  lists on first open (content preserved), keyed by the unguessable 128-bit token.
- Renaming a list from a directory card now pushes the new name to the shared list
  (version-guarded), so collaborators see it — not just a local relabel.

## [1.1.0] — 2026-07-07

### Toolkit
- Data pipeline documented (`scripts/README.md`): stages, normalization rules, update
  workflow, and the curation model (dataset is generated — curate in `build-dataset.ts`).
- Root README artifact-status fixes (dataset committed; icons/cache gitignored).

### Crafting Planner 1.1.0
- Game data refreshed from upstream (2026-07-07): +30 items, +23 recipes — the
  archery/hunting update (recurve bows, arrows, arrow shafts, bow strings, archery
  targets, hunting trophies, new raw materials). Purely additive; all normalization
  rules held.
- Fixed a stale-closure revert when two items' shared "have" amounts were edited in
  quick succession (shared-mode `owned` now derived from the progress map).
- Fixed history navigation between two list URLs showing the previous list's state
  (editor keyed by list id).
- Fixed the unstyled search "No items match" message (now a dropdown panel).
- Fixed an unparseable 409 body fabricating an empty version conflict that corrupted
  the client's version ref.
- Server rejects non-positive target quantities and floors fractional ones; the
  target-qty input floors client-side to match.

## [1.0.0] — 2026-07-01

### Toolkit
- First tagged release. Shared shell (header/nav, landing page), registry-driven tool
  suite, and the optional share backend (Node + SQLite).

### Crafting Planner 1.0.0
- Item search and crafting-list building with per-target quantities.
- Flattened plan rolling up every intermediate craft and raw material, aggregated
  across targets.
- Tiered craft view sorted by profession; components shown once in their deepest tier.
- Owned-stock subtraction (sub-trees pruned).
- Alternative crafting paths for recipes with genuinely different inputs.
- Sharing & near-real-time collaboration (share links, display-name handles, shared
  progress via polling).
- Mobile two-line row layout.
