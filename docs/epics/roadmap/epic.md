# Epic: Roadmap
Status: Draft · Updated: 2026-11-03

## Goal
The backlog of features that aren't built yet, migrated from SPRINT_PLAN.md (open items as
of 1.5.1) so that each one can start through `/workflow:start` with a slug, a key and draft
ACs. Nothing here is committed to. The order is a rough priority, carried over from
SPRINT_PLAN's High / Medium / Backlog grouping. The draft ACs are a sketch, to be replaced
when a feature gets its spec.

Items from SPRINT_PLAN that are **not** carried over:
- *Bundle size*: done in 1.4.0, as a lazy chunk rather than the `public/dataset.json` the
  item proposed ([ADR 0004](../../adr/0004-lazy-load-the-dataset-as-its-own-hashed-chunk.md)).
- *Item detail on hover/click*: done as the recipe tooltip (planner epic, TIP).
- *Deploy target*: done (Oracle VM, [deploy/DEPLOY.md](../../../deploy/DEPLOY.md)).
- *Component tests for the plan view*: covered by the adoption plan, Phase 5.

More candidates borrowed from FFXIV Teamcraft (per-item comments, item tags, an area
breakdown) are ranked in [TEAMCRAFT_ANALYSIS.md](../../TEAMCRAFT_ANALYSIS.md). They get
an entry here when someone picks them up.

## Features

### 1. ci-checks · Key: CI
Story: As a maintainer, I want the tests, the typecheck and the AC trace to run on every push, so that a broken `main` is caught before anyone deploys it.
Depends on: —
Draft ACs:
- CI-1: A push to any branch runs `npm test`, `npm run typecheck` and the trace with `--report`, and fails if any of them fails.

### 2. error-boundary · Key: ERR
Story: As a player, I want a friendly message instead of a blank page when the plan view crashes, so that I can recover without losing my list.
Depends on: —
Draft ACs:
- ERR-1: An error thrown while rendering a tool shows a message with a way to reload, and the site header and navigation still work.

### 3. station-names · Key: STN
Story: As a player, I want each craft row to name its crafting station and tier, so that I know which bench to walk to.
Depends on: —
Draft ACs:
- STN-1: Each craft row shows the station and tier for its chosen recipe, taken from per-recipe upstream data at build time.

### 4. dataset-version · Key: DVER
Story: As a player, I want to see how current the game data is, so that I can tell whether a recent patch is reflected.
Depends on: —
Draft ACs:
- DVER-1: The footer shows the date the dataset was built.
- DVER-2: The dataset records the date it was built, and a re-run of `npm run data` updates it.

### 5. mobile-layout · Key: MOB
Story: As a player on a phone, I want plan rows that read cleanly on a narrow screen, so that I can follow the plan in-game on a second screen.
Depends on: —
Draft ACs:
- MOB-1: At 375 px wide, no row overflows horizontally, and each row's controls sit on their own line under the item name.

### 6. search-filters · Key: FLT
Story: As a player, I want to filter search by profession or category and hide building pieces, so that I can find crafting items without wading through the catalogue.
Depends on: —
Draft ACs:
- FLT-1: Search can be narrowed to one profession or category.
- FLT-2: A toggle hides building pieces from the results.

### 7. optional-source-link · Key: LNK
Story: As a privacy-minded player, I want to turn off the external "where?" link, so that the app never offers a way out to another site.
Depends on: —
Draft ACs:
- LNK-1: A setting hides every "where?" link, and the choice is remembered in this browser.

### 8. supplied-items · Key: BUY
Story: As a player, I want to mark an intermediate as bought or traded, so that the plan prunes its sub-tree without pretending I already own it.
Depends on: —
Draft ACs:
- BUY-1: Marking an item as supplied removes its sub-tree from the gather and craft totals, like owned stock.
- BUY-2: A supplied item is shown as supplied, not as owned, and the export says so too.

### 9. craft-estimates · Key: TXP
Story: As a player, I want time and XP estimates per craft and for the whole plan, so that I can plan a session.
Depends on: —
Draft ACs:
- TXP-1: Each craft row, and the plan summary, show the total craft time from the recipe's `baseDuration`.
- TXP-2: Each craft row shows its XP gain where the data has it.

### 10. row-assignments · Key: ASG
Story: As a member of a group, I want to claim rows in a shared list, so that we don't both gather the same ore.
Depends on: —
Also needs: collaboration/shared-progress
Draft ACs:
- ASG-1: Anyone with the link can claim or release a row. The claimant's display name is shown on the row for everyone within one poll.

### 11. biome-sources · Key: BIO
Story: As a player, I want to see where a material can be gathered inside the app, so that I don't depend on an external site.
Depends on: optional-source-link
Draft ACs:
- BIO-1: A gather row shows the material's biomes or sources, taken from upstream data at build time.

## Out of scope
- Specs for the `feat/market-*` branches. They get specs when they're picked up again
  (adoption plan §7).

## Open questions
- Is the priority order right? It carries SPRINT_PLAN's grouping over, plus CI moved to the top because the factory gates depend on it.
- BIO: SPRINT_PLAN says biome data has to be scraped. Is scraping acceptable, given the upstream site's terms?
