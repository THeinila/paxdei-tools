# 0003. Bundle the game data and serve every asset from our own origin
Status: Proposed · Date: 2026-11-03
Backfilled from: README intro, `scripts/README.md`, `.gitignore`, `server/securityHeaders.ts`

## Context
Game data comes from paxdei.gaming.tools as a devalue-encoded `recipes.d.json` on their
CDN, which rejects Node's fetch. Pulling it at runtime would make the app depend on a third
party's availability and send users' requests to it. Spec: game-data-pipeline (DAT).

## Decision
A re-runnable pipeline (`npm run data`: fetch:raw → build:dataset → fetch:icons) turns the
upstream data into the files the app ships with.
- `data/dataset.json` is **committed**. It is generated and never hand-edited; a data update
  is a reviewed diff.
- Icons go to `public/icons/` as a **build artifact**. They are git-ignored, and every
  deploy host regenerates them. Filenames come from `localIconName()`, which the app and
  the script share, so no mapping file is needed.
- At runtime the app makes no external subresource requests. The only outbound links are
  the per-item "where to gather" links to gaming.tools.

## Consequences
- The app works when gaming.tools is down, and the strict CSP in
  [0012](0012-set-security-headers-in-the-app-with-a-strict-same-origin-cs.md) costs nothing.
- Game data only changes when someone runs the pipeline and commits the result.
- Icons aren't in git, so a fresh checkout shows broken icons until `fetch:icons` runs.
- The pipeline depends on the upstream format. A shape change shows up in the
  `build:dataset` summary, not in a test.

## Alternatives considered
- Fetch data and icons from gaming.tools at runtime — rejected for availability, privacy and
  CSP reasons.
- Commit the icons too — rejected because they are many binary files that can be fully
  regenerated (inferred; the reason isn't recorded).
