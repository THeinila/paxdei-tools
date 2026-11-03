# 0007. Make every list server-backed
Status: Proposed · Date: 2026-11-03
Backfilled from: CHANGELOG 1.2.0, `src/tools/planner/lib/directory.ts`, `src/tools/planner/lib/useList.ts`

## Context
Until 1.2.0 a list was either local (localStorage, `/planner/<uuid>`) or shared
(`?list=<token>`), and `useList` had two modes. Two URL schemes, two storage paths and a
"promote to shared" step made sharing awkward. Specs: list-management (LST), share-link
(SHR).

## Decision
Every list is created with `POST /api/lists` and lives at a single canonical
`/planner/<token>`. The address bar *is* the share link.
- `useList` has one mode: it polls the server, and applies edits optimistically.
- The browser keeps only a directory index (`paxdei-planner:lists:v1`): the token plus a
  cached name and target count, enough to render the directory cards.
- For compatibility, `?list=<token>` links redirect to `/planner/<token>`, and legacy
  `kind: "local"` entries are promoted to server lists, with their content, when they're
  first opened.

## Consequences
- One code path for every list, and sharing needs no extra step.
- The planner now needs the backend for any list at all. The README still describes a
  "fully self-standing" single-user flow with an optional backend, which no longer matches.
- List creation went from rare to routine, so the create limit was raised (10 → 600 per
  hour), and the lists table grows faster.
- The migration code for local lists (`kind`, `loadContent`, `promoteLocalEntry`) stays until
  nobody has pre-1.2.0 lists left.

## Alternatives considered
- Keep the local and shared modes — rejected because of the duplicated paths and the
  confusing URLs described above.
