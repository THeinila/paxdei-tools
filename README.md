# Pax Dei Planner

An FFXIV Teamcraft-style crafting & gathering planner for the MMO **Pax Dei**.
Search items, add them to a list, and get a flattened plan of every raw material
to gather and intermediate craft to make — with totals aggregated across targets
and the stock you already own subtracted at every step.

The running app is **fully self-standing**: game data is bundled and all icons are
served locally, so it makes no external requests at runtime.

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

## Quick start

```bash
npm install
npm run data      # fetch + normalize game data, download icons (build artifacts)
npm run dev       # http://localhost:5173
```

`npm run data` regenerates the gitignored build artifacts:
- `data/dataset.json` — normalized items + recipes (committed)
- `public/icons/` — item icons (gitignored; regenerate with `npm run fetch:icons`)

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm test` | Recipe-engine unit tests (vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run data` | Full data pipeline (fetch → normalize → icons) |
| `npm run fetch:raw` | Download + rehydrate the devalue recipe data |
| `npm run build:dataset` | Normalize raw data → `data/dataset.json` |
| `npm run fetch:icons` | Download item icons → `public/icons/` |

## Architecture

- **`src/engine/`** — pure-TS recipe engine (`planner.ts`): tree flattening,
  owned-stock subtraction, dependency-tier assignment, alternative-path
  selection, cycle guard. Unit-tested.
- **`src/components/`, `src/lib/`** — React UI (search, crafting list, plan view)
  with local-storage persistence.
- **`scripts/`** — one-time data pipeline.

Game data is scraped from [paxdei.gaming.tools](https://paxdei.gaming.tools/)
(a single devalue-encoded `recipes.d.json` on their CDN). Fan project; not
affiliated with Mainframe Industries.

## Status

MVP single-user planner is complete. Next up is sharing & collaboration
(lightweight handles, share links, progress check-off, near-real-time polling)
on a local Node + SQLite backend. See [SPRINT_PLAN.md](SPRINT_PLAN.md) for the
backlog of upcoming features and ideas.
