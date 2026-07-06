# Pax Dei Tools

A suite of tools for the MMO **Pax Dei**. The first is the **Crafting Planner**,
an FFXIV Teamcraft-style crafting & gathering planner.
Search items, add them to a list, and get a flattened plan of every raw material
to gather and intermediate craft to make — with totals aggregated across targets
and the stock you already own subtracted at every step.

The planner runs **fully self-standing** out of the box — game data is bundled and
all icons are served locally, so the single-user flow makes no external requests at
runtime. An optional **share backend** (Node + SQLite) lets a group open one link
and divide the gathering/crafting, tracking each other's progress in near-real-time.

## Features

- **Search** the full item catalog and add targets with a chosen quantity.
- **Flattened plan** rolling up every intermediate craft and raw material, with
  totals aggregated across all targets.
- **Tiered craft view** — final products at the bottom, their ingredients above,
  sub-materials above those; a component used at several depths shows once in its
  deepest tier. Sorted by profession within each tier.
- **Owned-stock subtraction** — enter what you already have (raw or intermediate)
  and the plan prunes it, sub-trees included.
- **Alternative paths** — pick between recipes with genuinely different inputs
  (e.g. Charcoal from Sapwood vs Heartwood).
- **Gather guidance** — per-material link to its gaming.tools source page.
- Crafting list persists in local storage.
- **Sharing & collaboration** — hit **Share** to push the list to the backend and
  copy a secret link. Anyone with the link sets a display name and helps gather/craft;
  progress (a per-item "have" count) is shared, attributed, and synced by polling.

## Quick start

```bash
npm install
npm run data      # fetch + normalize game data, download icons (build artifacts)
npm run dev       # http://localhost:5173  (single-user, no backend)
```

To use sharing, run the frontend and the share backend together:

```bash
npm run dev:all   # Vite (5173) + share API (8787); Vite proxies /api to the API
```

`npm run data` regenerates the data artifacts:
- `data/dataset.json` — normalized items + recipes (**committed**; generated, never hand-edited)
- `public/icons/` — item icons (gitignored build artifact; regenerate with `npm run fetch:icons`)

See [scripts/README.md](scripts/README.md) for the pipeline details, the
normalization rules, and how to update or curate the game data.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server (single-user) |
| `npm run server` | Share backend (Hono + SQLite) on port 8787 |
| `npm run dev:all` | Frontend + backend together (sharing enabled) |
| `npm run build` | Production build to `dist/` |
| `npm start` | Serve the built SPA **and** the API from one origin |
| `npm test` | Recipe-engine + backend tests (vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run data` | Full data pipeline (fetch → normalize → icons) |
| `npm run fetch:raw` | Download + rehydrate the devalue recipe data |
| `npm run build:dataset` | Normalize raw data → `data/dataset.json` |
| `npm run fetch:icons` | Download item icons → `public/icons/` |

## Architecture

The site is a multi-tool suite. A shared shell provides the header/nav and a
landing page; each tool is a self-contained module under `src/tools/<tool>/`.

- **`src/shell/`** — site chrome: `AppShell.tsx` (header + nav + footer with an
  `<Outlet/>`) and `Home.tsx` (the tool-directory landing page).
- **`src/tools/registry.tsx`** — the single source of truth listing every tool;
  both the routing table (`src/routes.tsx`) and the landing page are generated
  from it. Adding a tool is one registry entry plus its component.
- **`src/tools/planner/`** — the Crafting Planner (the first tool):
  - **`engine/`** — pure-TS recipe engine (`planner.ts`): tree flattening,
    owned-stock subtraction, dependency-tier assignment, alternative-path
    selection, cycle guard. Unit-tested.
  - **`components/`, `lib/`** — React UI (search, crafting list, plan view).
    `useList` runs in two modes: local (localStorage) or shared (server-backed,
    polled). The shared "have" map is fed into the engine exactly as owned stock.
- **`server/`** — share backend (Hono + better-sqlite3). Two concurrency strategies:
  progress writes are atomic additive deltas (`qty = qty + delta`, no lost updates);
  list-definition edits are version-guarded (optimistic concurrency → 409 + rebase).
  The planner's routes live under `/api/lists*`; future tools mount their own
  routers under `/api/<tool>/…`.
- **`scripts/`** — re-runnable data pipeline (fetch → normalize → icons); see
  [scripts/README.md](scripts/README.md).

Recipe data is sourced from [paxdei.gaming.tools](https://paxdei.gaming.tools/)
(a single devalue-encoded `recipes.d.json` on their CDN). Fan project; not
affiliated with Mainframe Industries.

## Status

**v1.0** — the single-user planner plus sharing & collaboration (lightweight handles,
share links, progress check-off, near-real-time polling) on a local Node + SQLite
backend. See [SPRINT_PLAN.md](SPRINT_PLAN.md) for the backlog of upcoming features.

## Versioning

The suite carries two independent versions: a **toolkit** release-train version
(`package.json`, shown in the footer and git-tagged) and a **per-tool** version (in
`src/tools/registry.tsx`, shown as a badge on each tool).

Release history lives in two places for two audiences: [CHANGELOG.md](CHANGELOG.md) is
the technical record, while `src/shell/releases.ts` drives the plain-language **What's
New** page users see in the app. See [RELEASING.md](RELEASING.md) for how releases are
cut and how to keep both in sync.
