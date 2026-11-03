# Game data pipeline
Key: DAT · Status: Approved · Owner: — · Updated: 2026-11-03

## Story
As a maintainer, I want one command that rebuilds the dataset and icons from upstream with our
curation rules applied, so that a game patch is a re-run and a reviewed diff, not hand edits.

## Context
- Architecture: [architecture.md](../../architecture.md) §2 "Data pipeline", §3 (`scripts/`)
- ADRs: [0003](../../adr/0003-bundle-the-game-data-and-serve-every-asset-from-our-own-orig.md) (bundled data, local icons)
- Related: [data epic](../../epics/data/epic.md) #1, [scripts/README.md](../../../scripts/README.md).
  Code: the rules in `scripts/datasetRules.ts` and `scripts/iconPlan.ts`, wired to files and
  the network by `scripts/build-dataset.ts` and `scripts/fetch-icons.ts`;
  `src/tools/planner/lib/iconName.ts`. `npm run check:dataset` checks DAT-N1 on the real cache.
  The scripts call the network, so tests cover only their pure functions (CLAUDE.md). The
  rules were extracted from the scripts in Phase 5, as refactors that didn't change the
  output (DAT-N1).
- Terms:
  - **raw recipes**: the rehydrated upstream recipe list (`scripts/.cache/recipes.raw.json`).
  - **market catalogue**: the upstream item list (`items.market.json`).
  - **output item**: the item a recipe makes; only a recipe's first output counts.
  - **stem**: an item ID with one trailing `_<digits>` and then one quality qualifier
    (`_fine`, `_coarse`, `_refined`, `_pure`, `_raw`, `_cloudy`, `_clear`, `_clarified`)
    removed.
  - **ingredient set**: a variant's ingredient IDs, ignoring order and counts.

## Scope
In: turning raw recipes and the market catalogue into `data/dataset.json` (the curation rules,
item fields and metadata), and downloading and validating icons.
Out: the upstream download in `fetch-raw.ts`, which needs the network; per-recipe station
names (roadmap STN); showing the data date in the UI (roadmap DVER).

## Acceptance criteria

### DAT-1: Recipes become variants of their output item
Given a raw recipe with an output entity and at least one ingredient with a count,
When the dataset is built,
Then its output item gets a variant with the recipe's ID, a yield equal to the output count
(1 when missing), its ingredients with counts, and the required skill's name and ID as its
profession (null when missing). Recipes with no output, and ingredients with no ID or a count
of 0, are skipped. A recipe left with no ingredients is skipped too.

### DAT-2: Forced-raw items have no recipe
Given an output item listed in `FORCE_RAW`,
When the dataset is built,
Then it has no recipe entry, it is marked raw, and it is listed under "forced to raw" in the
summary.

### DAT-3: Refinement recipes are dropped when a base recipe exists
Given an output item with a variant that has an ingredient (other than the item itself) with
the same stem as the item,
When the dataset is built,
Then that variant is dropped, and listed under "dropped refinement recipes", provided at least
one variant without such an ingredient remains. If every variant is a refinement, they're all
kept.

### DAT-4: Only the highest yield survives per ingredient set
Given variants of one output item with the same ingredient set,
When the dataset is built,
Then only the one with the highest yield is kept. On a tie, the first one is kept.

### DAT-5: Different ingredient sets survive as alternatives
Given variants of one output item with different ingredient sets, after DAT-3 and DAT-4,
When the dataset is built,
Then each is kept as a variant, in upstream order, and the summary lists the item under
"alternative paths".

### DAT-6: Item fields are filled in
Given an item seen in any recipe,
When the dataset is built,
Then its record has the name (the ID when there is no name), icon path, main category,
categories, tier and stack size, with null or [] when missing. It is marked raw unless it has
a recipe entry. Its rarity is "uncommon" or "rare" when its own recipe output says so, and
null otherwise.

### DAT-7: Market items extend the catalogue
Given a market catalogue item that isn't in any recipe,
When the dataset is built,
Then it is added as a raw item, with its English name (the ID when there is none), icon path
and stack size, and no category, tier or rarity.

### DAT-8: The output is complete and ordered
Given a build,
When `data/dataset.json` is written,
Then items are sorted by ID, and `meta` holds `generatedAt` (ISO time), `source`,
`recipeCount` (the total number of variants) and `itemCount`. The file replaces the old one
completely.

### DAT-9: A missing cache is an error
Given no `scripts/.cache/recipes.raw.json`,
When the dataset build runs,
Then it fails with "run `npm run fetch:raw` first", and writes nothing. A missing market file
isn't an error; the catalogue then comes from recipes only.

### DAT-10: Icon files are named the same way by the app and the pipeline
Given an icon path,
When its local filename is derived,
Then the scheme (`http://` or `https://`) is removed, and every character other than a
letter, digit, `_`, `.` or `-` becomes `_`. The app and the icon script use the same
function, so their names always match.

### DAT-11: Icons are fetched from the live host
Given an icon path,
When its download URL is built,
Then a site-relative path is prefixed with `https://cdn-hosted.gaming.tools/paxdei`, and an
absolute URL on the dead `gtcdn.info` host is moved onto that host. The local filename still
comes from the original path (DAT-10).

### DAT-12: Only real WebP files count as icons
Given a file in `public/icons/`,
When it is checked,
Then it is valid only if it is at least 12 bytes, starts with "RIFF" and has "WEBP" at byte
8. Invalid files, before or after a download, are deleted, so the app shows its placeholder
and the next run fetches them again.

### DAT-13: Icon fetching is incremental
Given valid icons already on disk,
When the icon script runs,
Then only the missing ones are downloaded, each icon path is fetched at most once, and the
summary reports how many were downloaded and which failed. A failed icon doesn't stop the
run.

### DAT-14: Nothing private ends up in the published icons
Given an icon run,
When it finishes,
Then `public/icons/` holds only icon files. The download configuration, which lists absolute
build paths, is written outside it and deleted afterwards, and a leftover `_curl.cfg` from
older runs is removed.

## Non-functional requirements

### DAT-N1: Refactoring the pipeline doesn't change its output
Run on the same cached inputs before and after a pipeline refactor, `data/dataset.json` is
identical apart from `meta.generatedAt`.

## Open questions
None. Settled on 2026-11-03: `FORCE_RAW` (DAT-2) is curation, not a requirement. The AC
covers the mechanism, and the list's contents may change with the game.

## Changelog
- 2026-11-03 — created (backfilled from the code and `scripts/README.md`; no existing tests)
- 2026-11-03 — approved
- 2026-11-03 — Context updated for the Phase 5 extraction and `check:dataset` (no AC change)
