# Changelog

All notable changes to the toolkit and its tools. Entries are grouped by a **Toolkit**
section (the deployable suite, versioned in `package.json`) plus one section per tool
(each versioned independently in `src/tools/registry.tsx`). Newest release on top.
See [RELEASING.md](RELEASING.md) for how versions are bumped.

## [1.3.0] — 2026-07-08

### Toolkit
- Market history layer. The upstream serves only current listings, so the server now
  accumulates its own history and infers demand:
  - New tables (`server/db.ts`): `market_listings` (one row per seen listing, keyed by
    the stable upstream id), `market_history_hourly` (price points, pruned after 72 h),
    `market_history_daily` (price aggregates + sold/expired counters, pruned after 60 d).
  - Snapshot processing (`server/market.ts`): each refresh appends hourly points and
    diffs listings against the previous snapshot — a listing that vanished while its
    `lifetime` was still high counts as an estimated **sale**, otherwise expired. All
    sales are estimates (cancellations are indistinguishable). `EXPIRY_EPSILON` and the
    `lifetime` decay semantics are flagged for confirmation with the API developer.
  - Background collector (`server/marketCollector.ts`): keeps every zone within the
    hourly TTL via batched 5-minute ticks through the shared `MarketService`
    single-flight, so history accumulates for all zones (not just viewed ones). Runs
    only when `MARKET_UPSTREAM` ≠ off. A fixtures-mode seeder fabricates 14 days of
    deterministic history (with engineered anomaly / zero-sales / volatility cases) so
    dev and preview have data.
  - New endpoints: `/api/market/world/:world/stats` (7-day ItemStats per zone),
    `/api/market/history/:world/:domain/:zone/:itemId` (sparkline data); `/prices/...`
    now carries an optional `stats` block.
  - `market.ts` split into a reusable `MarketService` + the HTTP router.
- Shared UI: `Sparkline` (dependency-free SVG), `useWorldStats`/`useItemHistory` hooks,
  stat-badge styles.

### Trade Routes 1.1.0
- Prices are now sanity-checked against the last 7 days:
  - **Profit/day** (new default sort): sustainable spread × estimated units the
    destination sells per day — a huge margin on an item nobody buys ranks near zero.
  - **Sold/day** column (estimated from delisted stock).
  - A dear destination price reverts to its 7-day median before profit is computed.
  - Badges: buy/sell **price anomaly** (far from the 7-day norm), **volatile**
    (cv > 0.5), **not selling** (no recent estimated sales), **no history yet**.
  - New filters: min sold/day, hide anomalies. Expanded row shows 48-h buy/sell
    sparklines and the last estimated sale.

### Craft or Buy 1.1.0
- Profit tab gains liquidity + anomaly signals: **Sold/day** column, a **price spike**
  badge when the current listing sits far above its 7-day norm (margin then uses the
  sustainable price), a **not selling** badge for zero-sales items, and a min sold/day
  filter. Margin sorts on the sustainable price; the current-listing margin is in the
  tooltip.

## [1.2.0] — 2026-07-07

### Toolkit
- Market data layer: `/api/market/*` serves per-item price rollups per zone, cached in
  SQLite with an hourly TTL (matching the upstream refresh), single-flighted refreshes,
  and stale-snapshot fallback. Upstream is the public gaming.tools market API, isolated
  behind `server/marketUpstream.ts` with three modes via `MARKET_UPSTREAM`:
  `off` (default — data endpoints 503, all market UI hidden), `fixtures`
  (`server/fixtures/market/`, used by dev + tests), and `live` (real CDN; only enable
  once the API developer has been informed). Listing `price` is interpreted as the
  listing TOTAL (unit = price/quantity) — confirm at go-live; mastercraft listings are
  excluded from rollups.
- Shared frontend market module (`src/market/`): typed client with request dedupe,
  hooks, cascading zone picker (persisted per user), gold/freshness formatting.
- Recipe engine: `buys` option — items marked "buy" become BuyStep leaves and their
  ingredient sub-trees receive no demand. `ListStateDef` gains a `buys: string[]`
  field (sanitized server-side; old lists default to `[]`).
- New pure cost engine (`engine/cost.ts`): per-unit buy-vs-craft costs over the recipe
  graph, honoring the plan's variant choices; unpriced gatherables count as free and
  flag the result as partially priced.

### Crafting Planner 1.2.0
- Market integration (only when the server enables market data): zone picker with
  snapshot freshness, per-row cheapest-listing price chips, per-row "buy" toggle that
  moves an item (and prunes its sub-tree) into a new Buy section with line costs and a
  gold total, "cheaper to buy" hints with a one-click "apply N buy recommendations".
- Buy toggles work without market data too (manual "someone else makes this").
- Buy state is part of the shared list definition and syncs to collaborators.

### Craft or Buy 1.0.0 (new tool)
- Explorer: per-item buy/craft/gather decision tree at current zone prices, with
  "send to planner" that creates a list with the buy decisions pre-set.
- Profit dashboard: craft cost (parts at their cheapest acquisition) vs. current
  cheapest listing, margin and margin %, filterable by profession; partial pricing
  flagged with ≈.

### Trade Routes 1.0.0 (new tool)
- Cross-zone arbitrage per server: cheapest buy zone vs. dearest sell zone per item,
  spread, spread %, buyable volume near the min price, and per-trip profit capped by
  stack size; expandable all-zones detail; filter/sort table.

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
