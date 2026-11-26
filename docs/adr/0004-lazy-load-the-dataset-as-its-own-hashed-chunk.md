# 0004. Lazy-load the dataset as its own hashed chunk
Status: Accepted · Date: 2026-11-03
Backfilled from: CHANGELOG 1.4.0, `docs/CAPACITY.md`, `src/tools/planner/lib/data.ts`

## Context
The dataset is about 1.5 MB raw. It used to be a static import, inlined into the main
bundle and sharing its content hash. Every visitor downloaded it before the landing page
rendered, and every code-only deploy re-sent it to every returning user. On a 1/8-OCPU
host that was one of the largest avoidable costs ([CAPACITY.md](../CAPACITY.md), "Cost per
request").

## Decision
`loadDataset()` in `src/tools/planner/lib/data.ts` dynamically imports `data/dataset.json`,
so Vite emits it as its own content-hashed chunk. The planner routes in the registry are
lazy, and their loaders await the code chunk and `loadDataset()` together
(`Promise.all`).
- Components inside a planner route keep a synchronous API (`getDataset()`), because the
  route doesn't render until the dataset has resolved.
- `getDataset()` throws if it's called before the load finishes, rather than returning an
  empty catalogue.

## Consequences
- The landing page is about 85 KB and never loads the catalogue. A cold planner visit is
  about 185 KB; after a code-only deploy it's about 95 KB.
- Growth in the game data inflates one cacheable chunk instead of the shell.
- Any new consumer of the dataset outside a planner route will throw. This is intended, but
  it's a trap for a second tool that wants item data.

## Alternatives considered
- Keep the static import — rejected for the cost above.
- Fetch a JSON file at runtime (`/dataset.json`) — not chosen (unverified). A hashed Vite
  chunk gets immutable caching from the existing `/assets/` rule without its own cache
  policy.
