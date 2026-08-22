# Changelog

All notable changes to the toolkit and its tools. Entries are grouped by a **Toolkit**
section (the deployable suite, versioned in `package.json`) plus one section per tool
(each versioned independently in `src/tools/registry.tsx`). Newest release on top.
See [RELEASING.md](RELEASING.md) for how versions are bumped.

## [1.2.1] — 2026-08-22

### Toolkit
- Fixed the `Cache-Control` policy added in 1.2.0, which never reached the wire:
  `@hono/node-server` 2.0.6 invokes `serveStatic`'s `onFound` *after* the response
  body is built, so headers set on the context there are discarded. `index.html` was
  served with no `Cache-Control` at all, leaving browsers to cache it heuristically —
  the exact stale-bundle failure 1.2.0 set out to fix. The policy is now applied by a
  middleware that sets the header on `c.res` after `next()`, keyed off the request
  path (the old check also tested a `node:path` `sep` that never matches on Windows).
  Verified against a built `dist/`: `/`, `/index.html` and deep links are `no-cache`,
  `/assets/*` is `immutable`, API responses are untouched (`server/index.ts`).

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
