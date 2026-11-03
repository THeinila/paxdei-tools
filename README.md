# Pax Dei Tools

A suite of fan-made tools for the MMO **Pax Dei**. The first is the **Crafting Planner**,
an FFXIV Teamcraft-style crafting and gathering planner: search items, add them to a
list, and get a flattened plan of every raw material to gather and every intermediate to
craft, with totals aggregated across targets and what you already have subtracted at
every step. Share a list's link and a group can divide the work, seeing each other's
progress.

Game data is bundled and every icon is served from the same origin, so the app makes no
requests to other sites at runtime. Lists live on a small Node + SQLite backend and are
addressed by a secret link; there are no accounts.

## Features

Each feature has a spec with numbered acceptance criteria, and every criterion has a
passing test that cites it.

| Area | Specs |
|---|---|
| The plan | [plan-engine](docs/features/plan-engine/spec.md) · [owned-stock](docs/features/owned-stock/spec.md) · [alternative-paths](docs/features/alternative-paths/spec.md) · [plan-layouts](docs/features/plan-layouts/spec.md) · [ready-and-stacks](docs/features/ready-and-stacks/spec.md) · [markdown-export](docs/features/markdown-export/spec.md) · [recipe-tooltip](docs/features/recipe-tooltip/spec.md) · [item-search](docs/features/item-search/spec.md) |
| Lists and sharing | [share-link](docs/features/share-link/spec.md) · [list-management](docs/features/list-management/spec.md) · [shared-progress](docs/features/shared-progress/spec.md) · [definition-edits](docs/features/definition-edits/spec.md) · [list-retention](docs/features/list-retention/spec.md) |
| The site and server | [tool-suite-shell](docs/features/tool-suite-shell/spec.md) · [serving](docs/features/serving/spec.md) · [abuse-limits](docs/features/abuse-limits/spec.md) · [usage-metrics](docs/features/usage-metrics/spec.md) |
| Game data | [game-data-pipeline](docs/features/game-data-pipeline/spec.md) |

What's planned is in the [roadmap epic](docs/epics/roadmap/epic.md).

## Quick start

```bash
npm install
npm run data      # fetch + normalise game data, download icons
npm run dev:all   # Vite on 5173 + the list API on 8787; Vite proxies /api
```

Open http://localhost:5173. `npm run dev` alone serves the frontend, but lists need the
API.

`npm run data` regenerates `data/dataset.json` (committed; generated, never hand-edited)
and `public/icons/` (git-ignored). See [scripts/README.md](scripts/README.md) for the
pipeline and its rules.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev:all` | Frontend and API together |
| `npm run dev` / `npm run server` | Frontend only / API only (port 8787) |
| `npm run build` | Production build: `dist/` (Vite) and `dist-server/` (esbuild) |
| `npm start` | Serve the built SPA and the API from one origin |
| `npm test` | All tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:report` | Tests, plus `.factory/vitest.json` for the AC trace |
| `npm run data` | The whole data pipeline (`fetch:raw` → `build:dataset` → `fetch:icons`) |
| `npm run check:dataset` | Rebuild the dataset in memory and compare it with the committed one |

## Documentation

- [docs/architecture.md](docs/architecture.md): how the system fits together, with the
  decision records in [docs/adr/](docs/adr/).
- [docs/CAPACITY.md](docs/CAPACITY.md): what the 1/8-OCPU production host can carry, and
  why each tuning constant is set the way it is.
- [deploy/DEPLOY.md](deploy/DEPLOY.md) and [RELEASING.md](RELEASING.md): deploying and
  cutting releases.
- [CHANGELOG.md](CHANGELOG.md): the technical history. Players see the plain-language
  What's New page instead, driven by `src/shell/releases.ts`.
- [CLAUDE.md](CLAUDE.md): the conventions and the spec → test workflow
  ([code-factory](docs/factory-adoption-plan.md)).
- [docs/research/teamcraft-analysis.md](docs/research/teamcraft-analysis.md): what was
  borrowed from FFXIV Teamcraft, and what's still worth borrowing.

## Versioning

There are two independent versions: the **toolkit** release train (`package.json`, shown
in the footer and git-tagged) and a **per-tool** version (`src/tools/registry.tsx`, shown
on each tool's badge). See [ADR 0015](docs/adr/0015-keep-a-toolkit-version-and-a-per-tool-version.md)
and [RELEASING.md](RELEASING.md).

Recipe data comes from [paxdei.gaming.tools](https://paxdei.gaming.tools/). Fan project;
not affiliated with Mainframe Industries.
