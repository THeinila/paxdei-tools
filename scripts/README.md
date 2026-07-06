# Data pipeline

Three re-runnable scripts turn the upstream gaming.tools game data into the
dataset the planner ships with. Run the whole chain with:

```bash
npm run data      # fetch:raw → build:dataset → fetch:icons
```

| Stage | Script | Reads | Writes | Git status |
|-------|--------|-------|--------|------------|
| 1. `npm run fetch:raw` | `fetch-raw.ts` | gaming.tools CDN | `scripts/.cache/recipes.raw.json`, `scripts/.cache/items.market.json` | gitignored cache |
| 2. `npm run build:dataset` | `build-dataset.ts` | `scripts/.cache/` | `data/dataset.json` | **committed** |
| 3. `npm run fetch:icons` | `fetch-icons.ts` | `data/dataset.json` | `public/icons/*.webp` | gitignored build artifact |

- **Stage 1** downloads the devalue-encoded master recipe file
  (`recipes.d.json`) and the market item catalog, and rehydrates them to plain
  JSON. It shells out to the system `curl` with a browser User-Agent because
  Node's built-in fetch is 403'd by the CDN (it fingerprints non-browser
  clients).
- **Stage 2** normalizes the raw recipes into `data/dataset.json` (rules below)
  and prints a summary of everything it dropped or collapsed.
- **Stage 3** downloads every icon referenced by the dataset. It is
  **incremental**: already-present files are skipped, so re-running after a
  dataset update only fetches new icons. Filenames are derived by the same
  `localIconName()` the app uses, so no mapping file is needed.

## Updating game data (new recipes/items upstream)

1. `npm run data` (or the three stages individually).
2. Read the console summary from `build:dataset`: forced-raw items, dropped
   refinement recipes, collapsed same-input variants, and which items still
   have alternative paths. Surprises here usually mean upstream data changed
   shape or a rule needs adjusting.
3. Sanity-check `git diff --stat data/dataset.json` and spot-check a few items
   in the app (`npm run dev`).
4. Commit the regenerated `data/dataset.json` (together with any rule changes
   in `build-dataset.ts` that prompted it).
5. Make sure `fetch:icons` ran — new items reference icons that don't exist
   locally yet and would 404 in the app. Deployment re-runs it on every host
   (see `../deploy/DEPLOY.md`).

## Normalization rules (`build-dataset.ts`)

Applied per output item, in this order:

- **Rule 0 — `FORCE_RAW`:** items in the hardcoded `FORCE_RAW` set keep no
  recipe and become gathered raw materials. Currently the medium/"normal"
  animal hides: their only recipes combine small hides or split large ones, so
  treating the normal hide as the gathered unit avoids recursing into those.
- **Rule 1 — drop refinement recipes:** if an ingredient is a tier/quality
  variant of the output itself (ids collapse to the same stem after stripping a
  qualifier suffix — `fine`, `coarse`, `refined`, `pure`, `raw`, `cloudy`,
  `clear`, `clarified` — and trailing digits), the recipe is dropped, e.g.
  "Fine Linen Cloth ← Linen Cloth". Only applies when a from-base recipe
  survives ("Fine Linen Cloth ← Linen String" is kept).
- **Rule 2 — keep highest yield:** among variants with the exact same
  ingredient set (e.g. by-hand vs passive station), only the highest-yield one
  is kept.
- **Rule 3 — keep alternative paths:** variants with genuinely different
  ingredients all survive as user-selectable alternatives (e.g. Charcoal from
  Sapwood vs Heartwood).

Market catalog items that never appear in the recipe graph are added as raw
materials so the item search covers the full catalog.

## Curation model — never hand-edit `data/dataset.json`

`build:dataset` **fully overwrites** `data/dataset.json` on every run; there is
no merge step, so any manual edit to that file is silently lost on the next
regeneration. All permanent curation lives in `build-dataset.ts` itself — add
an item id to `FORCE_RAW`, extend the qualifier list, or add a new rule — and
is committed as code, which guarantees it is reapplied every time the pipeline
runs against fresh upstream data.

## Data shape & consumers

The output structure (`Dataset`, `Item`, `ItemRecipes`, `RecipeVariant`) is
defined in `../src/tools/planner/engine/types.ts`; `build-dataset.ts` imports
those types, so shape changes are type-checked end to end. The app loads the
dataset in `../src/tools/planner/lib/data.ts` and feeds it to the recipe engine
(`../src/tools/planner/engine/planner.ts`). Changing the output shape means
updating the types and every consumer together.
