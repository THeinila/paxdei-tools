# Changelog

All notable changes to the toolkit and its tools. Entries are grouped by a **Toolkit**
section (the deployable suite, versioned in `package.json`) plus one section per tool
(each versioned independently in `src/tools/registry.tsx`). Newest release on top.
See [RELEASING.md](RELEASING.md) for how versions are bumped.

## [1.4.0] — 2026-08-23

Capacity, correctness and operations work against the real production shape: an Oracle
Always Free `VM.Standard.E2.1.Micro` — 1/8 OCPU and 1 GB RAM, roughly 125 ms of full-core
CPU per wall second. [docs/CAPACITY.md](docs/CAPACITY.md) records the arithmetic behind
every constant below.

### Crafting Planner 1.4.0
- **Poll interval 3s → 10s**, with jitter, no overlapping requests, paused while the tab is
  hidden, and an immediate catch-up poll on focus. Roughly 3× the concurrent-tab ceiling.
- **Progress writes are fenced per item** on a monotonic poll sequence number. A snapshot
  the server built *before* a local write committed could previously land afterwards and
  roll that write back on screen until the next tick — a 3-second flicker that widening
  the poll would have turned into a 10-second wrong value. A snapshot may now only replace
  an item's value if its poll was issued after the write was acknowledged. The rules live
  in `lib/progressMerge.ts` as a pure function so the ordering cases are testable directly.
- `setOwned` reads a **synchronous progress mirror** rather than React state, mirroring the
  existing `defRef` pattern. It takes an absolute quantity but sends a delta, so two quick
  edits ("5", then "8") each subtracted from 0 and landed on 13.
- **Failed progress writes roll back** instead of leaving an unsaved value looking saved.
- **Definition edits rebase up to 3 times** instead of once; clients hold a stale version
  longer at a 10s poll, so genuine 409s are more common.
- **The item dataset is a lazily loaded, separately-hashed chunk.** It is ~1.5 MB and was
  inlined into the main bundle, sharing its content hash — so every code deploy invalidated
  it and re-sent the whole catalogue. Main bundle 1,820 kB → 248 kB (182 kB → 82 kB
  gzipped); landing page ~185 KB → ~85 KB. Consumers keep the synchronous API via
  `getDataset()`, which throws rather than returning an empty catalogue if reached before
  the load resolves.
- The planner footer states the **90-day retention window**, from a constant shared with
  the server so the UI cannot misstate the policy.

### Toolkit 1.4.0

#### Serving cost
- Caddy compresses (`encode zstd gzip`); nothing was compressed at all before.
- `/icons/` gets a 30-day cache policy. Icons fell into the `no-cache` bucket, and
  `@hono/node-server`'s `serveStatic` sends `Last-Modified` but never answers a
  conditional request with a 304 — so every reload re-downloaded every icon on screen in
  full (~75 ms of CPU per page view). Long `max-age` rather than `immutable` so replaced
  artwork self-heals within a month.

#### Rate limits
- **Split by method**: reads 240/min, writes 120/min, creates 600/hour. The old flat
  60/min sat *below* the app's own poll rate — the limiter keys on client IP, so a few
  tabs behind one NAT exhausted the allowance and the app 429'd people for normal use.
- `clientKey()` falls back to the peer socket address before the global `_shared` bucket,
  so bypassing the proxy no longer collapses every client into one budget.

#### Retention
- Lists with no **write** activity for `LIST_TTL_DAYS` (default 90, `0` disables) are
  swept daily, progress cascading with them. `POST /api/lists` is unauthenticated and
  nothing ever deleted a list, so the database only grew — and it shares the boot volume
  with the OS.
- `updated_at` was the wrong clock: it moves with `version`, i.e. only on definition
  edits, so a group that had settled its targets and was only ticking items off would look
  untouched and be swept while in active use. Progress writes bump a separate
  `last_activity_at` and deliberately leave `updated_at` alone. Reads do not count — that
  would mean a write on every poll.
- The migration backfills `last_activity_at` from the later of the definition timestamp
  and any progress against the list, so the first sweep after deploying cannot delete
  lists that are in use.

#### Operations
- **`deploy/deploy.sh`**: each release is built as a git worktree in its own directory,
  and `current` only moves after the build, typecheck, tests *and* a `/healthz` probe
  pass — rolling back automatically otherwise. The old flow built in the live directory,
  where an OOM-killed `npm ci` left no `node_modules` and no way back.
- **The server is compiled** (`scripts/build-server.mjs`, esbuild → `dist-server/`), so
  `npm start` is plain `node` and nothing on the production start path is a
  devDependency. `npm prune --omit=dev` runs after each build.
- **`deploy/backup.sh`**: consistent `sqlite3 .backup` snapshots on cron (not `cp` — the
  server holds the database open in WAL mode). The off-box copy is scripted but must be
  enabled by hand.
- **`server/diskGuard.ts`** refuses `POST /api/lists` with a 503 below 256 MB free,
  failing *open* if the disk cannot be measured. `GET /healthz` reports it, and
  `deploy/disk-alert.sh` warns from cron at 80% / 90%.
- `openDb()`'s default path is anchored to cwd rather than the module's directory:
  bundling moved the module, so `npm start` silently opened a different, empty database
  than `npm run server` had been using.
- `.gitattributes` pins `*.sh` to `eol=lf`. A CRLF shebang fails on Linux with
  `bad interpreter: /usr/bin/env bash^M`, which would break exactly the deploy and backup
  scripts meant to be the safety net.
- Indexes on `visitors(first_seen, last_seen)`; `/api/stats` grouped by both with no index.

#### Security
- A strict **Content-Security-Policy** (`default-src 'self'`, `script-src 'self'` with no
  `unsafe-*`), plus `nosniff`, `Referrer-Policy` and `X-Frame-Options`, set by the app in
  `server/securityHeaders.ts` rather than the proxy — the policy has to change when the
  app loads something new, so it belongs next to the code that would break it and is
  testable locally. Caddy keeps HSTS. The only relaxation is inline *styles*, which the
  recipe tooltip needs to position itself.

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
