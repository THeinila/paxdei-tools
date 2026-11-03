# Epic: Game data
Status: Draft · Updated: 2026-11-03

## Goal
The planner ships with a dataset and icons built from upstream game data, by a pipeline
anyone can re-run, applying rules that are code rather than hand edits
([ADR 0003](../../adr/0003-bundle-the-game-data-and-serve-every-asset-from-our-own-orig.md)).
It worked if a re-run against fresh upstream data gives a correct dataset with no manual
fix-ups, and every item in it has a local icon.

**Backfill.** Already built. The pipeline scripts call the network, so tests cover only
their pure functions (CLAUDE.md). Some of those functions may need extracting from the
scripts first, as a refactor that leaves `data/dataset.json` byte-identical. The rules are
documented in [scripts/README.md](../../../scripts/README.md).

## Features

### 1. game-data-pipeline · Key: DAT
Story: As a maintainer, I want one command that rebuilds the dataset and icons from upstream with our curation rules applied, so that a game patch is a re-run and a reviewed diff, not hand edits.
Depends on: —
Draft ACs:
- DAT-1: Items listed in `FORCE_RAW` have no recipe and are treated as gathered raw materials.
- DAT-2: A recipe whose ingredient is a quality or tier variant of its own output (same stem after removing a qualifier such as `_fine` or `_refined`, and trailing digits) is dropped, but only when a recipe from a base material survives.
- DAT-3: Of the variants with exactly the same ingredient set, only the one with the highest yield is kept.
- DAT-4: Variants with different ingredient sets all survive as alternative paths.
- DAT-5: Market-catalogue items that never appear in any recipe are added as raw materials, so search covers the whole catalogue.
- DAT-6: A downloaded icon is kept only if it is a real WebP file ("RIFF" at byte 0, "WEBP" at byte 8). Anything else is treated as missing and fetched again.
- DAT-7: Icon fetching is incremental: valid icons already on disk are skipped. Icon URLs on dead CDN hosts are moved to the current host.
- DAT-8: An icon's local filename comes from the same `localIconName()` the app uses, so the app finds every icon without a mapping file.

## Out of scope
- A dated or versioned dataset shown in the footer, and per-recipe station names: roadmap.
- The upstream download itself (`fetch-raw.ts`, which uses curl because the CDN rejects Node's fetch): not testable without the network.

## Open questions
- (as-built) DAT-1: `FORCE_RAW` currently lists only the medium animal hides. Is that list a requirement or just current curation?
- Extracting the rule functions from `build-dataset.ts` and `fetch-icons.ts` is a refactor in Phase 5. Confirm the byte-identical dataset check is a sufficient guard.
