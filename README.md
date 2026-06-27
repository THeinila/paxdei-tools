# Pax Dei Planner

An FFXIV Teamcraft-style crafting & gathering planner for the MMO **Pax Dei**.
Search items, add them to a list, and get a flattened plan of every raw material
to gather and intermediate craft to make — with totals aggregated across targets
and the stock you already own subtracted at every step.

The running app is **fully self-standing**: game data is bundled and all icons are
served locally, so it makes no external requests at runtime.

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
  owned-stock subtraction, alternative-path selection, cycle guard. Unit-tested.
- **`src/components/`, `src/lib/`** — React UI (search, crafting list, plan view)
  with local-storage persistence.
- **`scripts/`** — one-time data pipeline.

Game data is scraped from [paxdei.gaming.tools](https://paxdei.gaming.tools/)
(a single devalue-encoded `recipes.d.json` on their CDN). Fan project; not
affiliated with Mainframe Industries.

## Status

MVP single-user planner is complete. Remaining phase: sharing & collaboration
(lightweight handles, share links, progress check-off, near-real-time polling)
on a local Node + SQLite backend.
