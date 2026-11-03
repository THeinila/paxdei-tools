# Trace baseline (adoption Phase 4)

Recorded: 2026-11-03, on `chore/factory-adoption`. This is the gap list for Phase 5, and it
isn't updated afterwards: re-run the trace for the current state.

Phase 4 renamed the existing tests to cite AC IDs. Only names changed: the diff touches only
`it(` title lines, and 110/110 tests still pass. 102 tests cite at least one AC, and 8 stay
uncited (below).

```bash
npm run test:report
node C:/Users/Toni/claude-projects/code-factory/plugins/verify/bin/trace.mjs --report .factory/vitest.json
```

## Summary

| Epic | Spec | ACs + NFRs | Passing test | Gap (Phase 5) | Discrepancy (fix later) |
|---|---|---|---|---|---|
| planner | [plan-engine](features/plan-engine/spec.md) | 10 | 7 | 2 | 1 |
| planner | [owned-stock](features/owned-stock/spec.md) | 8 | 3 | 4 | 1 |
| planner | [alternative-paths](features/alternative-paths/spec.md) | 5 | 2 | 3 | 0 |
| planner | [plan-layouts](features/plan-layouts/spec.md) | 10 | 9 | 1 | 0 |
| planner | [ready-and-stacks](features/ready-and-stacks/spec.md) | 8 | 8 | 0 | 0 |
| planner | [markdown-export](features/markdown-export/spec.md) | 10 | 8 | 1 | 1 |
| planner | [recipe-tooltip](features/recipe-tooltip/spec.md) | 9 | 0 | 9 | 0 |
| planner | [item-search](features/item-search/spec.md) | 10 | 0 | 9 | 1 |
| collaboration | [share-link](features/share-link/spec.md) | 12 | 4 | 6 | 2 |
| collaboration | [list-management](features/list-management/spec.md) | 12 | 1 | 9 | 2 |
| collaboration | [shared-progress](features/shared-progress/spec.md) | 15 | 6 | 8 | 1 |
| collaboration | [definition-edits](features/definition-edits/spec.md) | 10 | 2 | 7 | 1 |
| collaboration | [list-retention](features/list-retention/spec.md) | 10 | 7 | 3 | 0 |
| platform | [tool-suite-shell](features/tool-suite-shell/spec.md) | 9 | 1 | 8 | 0 |
| platform | [serving](features/serving/spec.md) | 11 | 2 | 8 | 1 |
| platform | [abuse-limits](features/abuse-limits/spec.md) | 13 | 4 | 9 | 0 |
| platform | [usage-metrics](features/usage-metrics/spec.md) | 10 | 7 | 3 | 0 |
| data | [game-data-pipeline](features/game-data-pipeline/spec.md) | 15 | 0 | 15 | 0 |
| | **Total** | **187** | **71** | **105** | **11** |

The trace exits 1, as expected at this point.

- **Gap** ACs get characterisation tests in Phase 5, each with mutation-red evidence.
- **Discrepancy** ACs (PLAN-10, OWN-8, MDX-10, SRCH-4, SHR-5, SHR-8, LST-6, LST-9, PRG-7, EDT-9, SRV-5) get no test until their fix, which is a
  normal red → green ([plan](factory-adoption-plan.md) §2.1).

## Rules applied when citing
- **A test cites an AC only when it asserts that AC's outcome.** "Covered" in the trace means
  at least one test cites the AC, not that every clause is tested. Several ACs are covered
  only in part:
  - ABU-7: no test checks that reads and edits still work when the disk is low;
  - SHR-11: the 500-target and 1,000-path-choice caps aren't tested;
  - LAY-6: tested at the view-model level, but not the caret or `aria-expanded`;
  - MDX-3, PRG-11 and RET-1 are similar.

  Phase 5 reviews each covered AC clause by clause, and adds tests where a clause is
  missing.
- **Discrepancy ACs are never cited**, even where a test exercises part of them. Otherwise the
  trace would report an AC as covered while the code still breaks it.
- Citations are per `it`, never per `describe`, because the trace applies a `describe`
  citation to every test inside it.

## Uncited tests

| Test | Why it isn't cited | What happens to it |
|---|---|---|
| `view.test.ts` "reports the same tier count whatever the grouping" | It would cite PLAN-10, which is a discrepancy. The test pins the current tier count, which counts satisfied tiers. | Revisit with the PLAN-10 fix; keep the preset-independence assertion |
| `view.test.ts` "handles an empty plan" | View-model internals; the user-facing empty state is PLAN-9 and LAY-9 | Keep uncited (internal) |
| `view.test.ts` "can also treat unfinished gathers as blocking" | An engine option the UI doesn't use; out of scope in the RDY spec | Keep uncited (internal) |
| `directory.test.ts` "returns undefined for an unknown list" | A function contract, not user behaviour | Keep uncited (internal) |
| `directory.test.ts` "still bumps updatedAt for ordinary edits" | Supports LST-1's sort order, but doesn't show it | Keep; LST-1 gets a component test in Phase 5 |
| `prefs.test.ts` "forgets one list and leaves the others" | Part of LST-9, which is a discrepancy (the button label) | Cite LST-9 when the label is fixed |
| `prefs.test.ts` "is a no-op for an unknown list" | A function contract | Keep uncited (internal) |
| `progressMerge.test.ts` "does not mutate the local map it was given" | Purity of an internal function | Keep uncited (internal) |

No test showed that a spec was missing an AC, and none was redundant.

## Matrix


### abuse-limits

| AC | Criterion | Tests | Status |
|---|---|---|---|
| ABU-1 | A client over its budget gets 429 | — | no test |
| ABU-2 | The budget comes back when the window resets | — | no test |
| ABU-3 | A client is its first forwarded address | — | no test |
| ABU-4 | Reads and writes have separate budgets | — | no test |
| ABU-5 | List creation has its own budget on top of the write budget | — | no test |
| ABU-6 | Clients don't share budgets | — | no test |
| ABU-7 | Low disk refuses only new lists | `server/diskGuard.test.ts:15` ABU-7: allows writes when there is plenty of space<br>`server/diskGuard.test.ts:24` ABU-7: refuses new lists when free space is below the floor | pass |
| ABU-8 | An unmeasurable disk doesn't block creation | `server/diskGuard.test.ts:41` ABU-8: fails OPEN when the disk cannot be measured | pass |
| ABU-9 | The disk check works before the database exists | `server/diskGuard.test.ts:58` ABU-9: falls back to the parent directory when the database file is absent | pass |
| ABU-10 | Crossing the floor is logged once each way | — | no test |
| ABU-N1 | Budgets fit real use behind one address | — | no test |
| ABU-N2 | The disk check is cheap | `server/diskGuard.test.ts:70` ABU-N2: caches, so a burst of requests does not stat the volume every time<br>`server/diskGuard.test.ts:87` ABU-N2: reports a sane default floor | pass |
| ABU-N3 | Limiter memory is bounded | — | no test |

### alternative-paths

| AC | Criterion | Tests | Status |
|---|---|---|---|
| ALT-1 | The first variant is the default | `src/tools/planner/engine/planner.test.ts:85` ALT-1: uses the default (first) variant for an alternative-path item | pass |
| ALT-2 | A path choice replaces the item's inputs | `src/tools/planner/engine/planner.test.ts:93` ALT-2: honours an explicit alternative-path choice | pass |
| ALT-3 | A choice is offered only where there is one to make | — | no test |
| ALT-4 | A path choice is saved with the list | — | no test |
| ALT-5 | An invalid choice falls back to the default | — | no test |

### definition-edits

| AC | Criterion | Tests | Status |
|---|---|---|---|
| EDT-1 | Edits show at once | — | no test |
| EDT-2 | A save based on the current version succeeds | `server/lists.test.ts:76` EDT-2: increments version on a fresh-base PATCH | pass |
| EDT-3 | A stale save is rebased, not lost | `server/lists.test.ts:87` EDT-3: rejects a stale baseVersion with 409 and returns the current state | pass |
| EDT-4 | A save that keeps conflicting is reported | — | no test |
| EDT-5 | Other save failures are reported and corrected | — | no test |
| EDT-6 | A save without a base version is rejected | — | no test |
| EDT-7 | Polls don't undo edits that are being saved | — | no test |
| EDT-8 | Quantity 0 or "remove" takes a target off the list | — | no test |
| EDT-9 | "Clear" asks before emptying a shared list | — | no test |
| EDT-10 | Clearing keeps the group's have amounts | — | no test |

### game-data-pipeline

| AC | Criterion | Tests | Status |
|---|---|---|---|
| DAT-1 | Recipes become variants of their output item | — | no test |
| DAT-2 | Forced-raw items have no recipe | — | no test |
| DAT-3 | Refinement recipes are dropped when a base recipe exists | — | no test |
| DAT-4 | Only the highest yield survives per ingredient set | — | no test |
| DAT-5 | Different ingredient sets survive as alternatives | — | no test |
| DAT-6 | Item fields are filled in | — | no test |
| DAT-7 | Market items extend the catalogue | — | no test |
| DAT-8 | The output is complete and ordered | — | no test |
| DAT-9 | A missing cache is an error | — | no test |
| DAT-10 | Icon files are named the same way by the app and the pipeline | — | no test |
| DAT-11 | Icons are fetched from the live host | — | no test |
| DAT-12 | Only real WebP files count as icons | — | no test |
| DAT-13 | Icon fetching is incremental | — | no test |
| DAT-14 | Nothing private ends up in the published icons | — | no test |
| DAT-N1 | Refactoring the pipeline doesn't change its output | — | no test |

### item-search

| AC | Criterion | Tests | Status |
|---|---|---|---|
| SRCH-1 | Queries under 2 characters show nothing | — | no test |
| SRCH-2 | Results match names, case-insensitively | — | no test |
| SRCH-3 | Results are ranked and capped | — | no test |
| SRCH-4 | Each result describes the item | — | no test |
| SRCH-5 | Each result has its own quantity, at least 1 | — | no test |
| SRCH-6 | Adding puts the quantity on the list | — | no test |
| SRCH-7 | No match says so | — | no test |
| SRCH-8 | The dropdown closes on Escape or an outside click | — | no test |
| SRCH-9 | Search takes focus only in the list editor | — | no test |
| SRCH-N1 | The landing page never downloads the catalogue | — | no test |

### list-management

| AC | Criterion | Tests | Status |
|---|---|---|---|
| LST-1 | The directory lists this browser's lists, newest first | — | no test |
| LST-2 | An empty directory invites the first list | — | no test |
| LST-3 | "Create a new list" opens a blank list | — | no test |
| LST-4 | A quick list starts from one item | — | no test |
| LST-5 | Renaming updates the shared name | — | no test |
| LST-6 | Renaming survives a concurrent edit | — | no test |
| LST-7 | "Duplicate" copies the definition, not the progress | — | no test |
| LST-8 | Archiving hides a list without reordering | `src/tools/planner/lib/directory.test.ts:35` LST-8: marks a list archived without disturbing its place in the directory<br>`src/tools/planner/lib/directory.test.ts:44` LST-8: restores a list and leaves no archivedAt behind<br>`src/tools/planner/lib/directory.test.ts:51` LST-8: leaves other fields and other lists alone | pass |
| LST-9 | "Remove" takes a list out of this browser only | — | no test |
| LST-10 | Directory actions that fail say so | — | no test |
| LST-11 | Legacy local lists are promoted when opened | — | no test |
| LST-12 | Corrupt directory storage doesn't break the page | — | no test |

### list-retention

| AC | Criterion | Tests | Status |
|---|---|---|---|
| RET-1 | Idle lists are deleted with their progress | `server/retention.test.ts:49` RET-1: deletes lists idle past the window and keeps the rest<br>`server/retention.test.ts:64` RET-1: cascades progress rows away with the list | pass |
| RET-2 | Writes keep a list alive | `server/retention.test.ts:106` RET-2: a progress write rescues a list that was about to be swept<br>`server/retention.test.ts:128` RET-2: a definition edit also counts as activity | pass |
| RET-3 | Reading doesn't keep a list alive | `server/retention.test.ts:142` RET-3: merely READING a list does not keep it alive | pass |
| RET-4 | A new list starts with a fresh clock | `server/retention.test.ts:151` RET-4: a newly created list starts with a fresh activity clock | pass |
| RET-5 | The sweep runs at start and then daily | — | no test |
| RET-6 | The TTL is configurable | `server/retention.test.ts:29` RET-6: defaults to 90 days when unset or blank<br>`server/retention.test.ts:34` RET-6: honours an explicit value<br>`server/retention.test.ts:38` RET-6: treats 0 as 'disabled' rather than 'delete everything'<br>`server/retention.test.ts:42` RET-6: falls back to the default on garbage rather than deleting unexpectedly<br>`server/retention.test.ts:58` RET-6: does nothing when retention is disabled | pass |
| RET-7 | Swept lists are counted | `server/retention.test.ts:76` RET-7: records how many it swept<br>`server/retention.test.ts:86` RET-7: leaves no metric row when nothing was swept | pass |
| RET-8 | Older databases get an activity clock | `server/retention.test.ts:163` RET-8: adds and backfills last_activity_at on a legacy database<br>`server/retention.test.ts:202` RET-8: is idempotent — re-running does not throw or clobber | pass |
| RET-9 | The editor states the window | — | no test |
| RET-N1 | The sweep is cheap and can't take the server down | — | no test |

### markdown-export

| AC | Criterion | Tests | Status |
|---|---|---|---|
| MDX-1 | The export is a titled Markdown checklist | `src/tools/planner/engine/markdown.test.ts:18` MDX-1, MDX-2, MDX-3: renders the whole plan as a checklist | pass |
| MDX-2 | The summary counts ready crafts | `src/tools/planner/engine/markdown.test.ts:18` MDX-1, MDX-2, MDX-3: renders the whole plan as a checklist | pass |
| MDX-3 | Row details match the screen | `src/tools/planner/engine/markdown.test.ts:18` MDX-1, MDX-2, MDX-3: renders the whole plan as a checklist<br>`src/tools/planner/engine/markdown.test.ts:65` MDX-3, MDX-7: includes stack counts and the share link | pass |
| MDX-4 | Satisfied rows are ticked | `src/tools/planner/engine/markdown.test.ts:45` MDX-4, MDX-5: checks off satisfied rows and notes what was hidden | pass |
| MDX-5 | The export follows the preset and Hide completed | `src/tools/planner/engine/markdown.test.ts:45` MDX-4, MDX-5: checks off satisfied rows and notes what was hidden<br>`src/tools/planner/engine/markdown.test.ts:56` MDX-5: follows the chosen preset | pass |
| MDX-6 | Collapsed sections are exported in full | `src/tools/planner/engine/markdown.test.ts:61` MDX-6: exports a collapsed section's rows anyway | pass |
| MDX-7 | The export ends with an attribution and the list's link | `src/tools/planner/engine/markdown.test.ts:65` MDX-3, MDX-7: includes stack counts and the share link | pass |
| MDX-8 | An untitled list exports as "Untitled" | `src/tools/planner/engine/markdown.test.ts:80` MDX-8: falls back to a name for an untitled list | pass |
| MDX-9 | The button confirms the copy | — | no test |
| MDX-10 | A failed copy says so | — | no test |

### owned-stock

| AC | Criterion | Tests | Status |
|---|---|---|---|
| OWN-1 | Every plan row has a "have" input | — | no test |
| OWN-2 | A have amount reduces a raw material's quantity | — | no test |
| OWN-3 | A fully covered raw material stays in the plan, satisfied | `src/tools/planner/engine/planner.test.ts:60` OWN-3: keeps a fully-owned raw leaf as a satisfied (greyed) row | pass |
| OWN-4 | A fully owned intermediate takes its sub-tree out of the work | `src/tools/planner/engine/planner.test.ts:67` OWN-4: keeps a fully-owned intermediate and its whole sub-tree as satisfied | pass |
| OWN-5 | A partly owned intermediate reduces its crafts and inputs | `src/tools/planner/engine/planner.test.ts:79` OWN-5: partially owned intermediate reduces but does not eliminate the branch | pass |
| OWN-6 | An ingredient shared with unfinished work stays active | — | no test |
| OWN-7 | Over-owning never makes a quantity negative | — | no test |
| OWN-8 | Have amounts are whole numbers, at least 0 | — | no test |

### plan-engine

| AC | Criterion | Tests | Status |
|---|---|---|---|
| PLAN-1 | A raw target is a single gather step | `src/tools/planner/engine/planner.test.ts:21` PLAN-1: treats a raw target as a pure gather | pass |
| PLAN-2 | A craftable target expands into its craft and its raw inputs | `src/tools/planner/engine/planner.test.ts:27` PLAN-2: expands a single craft and its raw inputs | pass |
| PLAN-3 | Crafts are rounded up by yield | `src/tools/planner/engine/planner.test.ts:33` PLAN-3: rounds craft batches up by yield (nail yields 5)<br>`src/tools/planner/engine/view.test.ts:184` PLAN-3: carries the craft meta the UI and the export both need | pass |
| PLAN-4 | Ingredients come before the crafts that use them | `src/tools/planner/engine/planner.test.ts:40` PLAN-4: flattens a multi-level chain with dependency-first ordering | pass |
| PLAN-5 | A shared ingredient appears once, with its demand summed | `src/tools/planner/engine/planner.test.ts:49` PLAN-5: aggregates a shared intermediate across two targets | pass |
| PLAN-6 | Each craft step sits in its deepest tier | `src/tools/planner/engine/planner.test.ts:100` PLAN-6: assigns tiers by depth (target = 0, ingredients deeper)<br>`src/tools/planner/engine/planner.test.ts:106` PLAN-6: places a component used at several depths in its deepest tier only | pass |
| PLAN-7 | A recipe cycle finishes with a warning | `src/tools/planner/engine/planner.test.ts:126` PLAN-7: guards against recipe cycles without hanging | pass |
| PLAN-8 | A target that is also an ingredient is one step | — | no test |
| PLAN-9 | Empty list | — | no test |
| PLAN-10 | Plan summary | — | no test |

### plan-layouts

| AC | Criterion | Tests | Status |
|---|---|---|---|
| LAY-1 | Tiered groups craft steps by tier, deepest first | `src/tools/planner/engine/view.test.ts:27` LAY-1: groups by tier, deepest first, with gather leading | pass |
| LAY-2 | Flat keeps the dependency order in one section | `src/tools/planner/engine/view.test.ts:36` LAY-2: flat keeps the engine's dependency-first order in one section | pass |
| LAY-3 | By profession groups craft steps by profession | `src/tools/planner/engine/view.test.ts:43` LAY-3: groups by profession, unknown last, deepest tier first within a station | pass |
| LAY-4 | The gather section is the same under every preset | `src/tools/planner/engine/view.test.ts:58` LAY-4: renders an identical gather section under every preset<br>`src/tools/planner/engine/view.test.ts:100` LAY-4: keeps `remaining` counting the section's real outstanding work | pass |
| LAY-5 | Hide completed removes satisfied rows | `src/tools/planner/engine/view.test.ts:87` LAY-5: drops satisfied rows, counts them, and removes emptied sections | pass |
| LAY-6 | A section can be collapsed and expanded | `src/tools/planner/engine/view.test.ts:117` LAY-6: flags the section but still builds its rows | pass |
| LAY-7 | View settings are kept per list in this browser | `src/tools/planner/lib/prefs.test.ts:52` LAY-7: merges, persists, and returns the merged value<br>`src/tools/planner/lib/prefs.test.ts:66` LAY-7: keeps lists independent | pass |
| LAY-8 | Defaults when nothing is stored | `src/tools/planner/lib/prefs.test.ts:23` LAY-8: defaults when nothing is stored<br>`src/tools/planner/lib/prefs.test.ts:27` LAY-8: survives corrupt or unexpected storage<br>`src/tools/planner/lib/prefs.test.ts:34` LAY-8: coerces each field independently<br>`src/tools/planner/lib/prefs.test.ts:44` LAY-8: does not throw when localStorage is unavailable<br>`src/tools/planner/lib/prefs.test.ts:73` LAY-8: sanitizes what it is handed | pass |
| LAY-9 | Empty sections say so | — | no test |
| LAY-N1 | Stored view settings are bounded | `src/tools/planner/lib/prefs.test.ts:77` LAY-N1: caps the number of remembered lists, keeping the newest<br>`src/tools/planner/lib/prefs.test.ts:85` LAY-N1: caps collapsed keys | pass |

### ready-and-stacks

| AC | Criterion | Tests | Status |
|---|---|---|---|
| RDY-1 | A craft with no unfinished craftable ingredients is ready | `src/tools/planner/engine/view.test.ts:127` RDY-1, RDY-2: marks steps whose sub-crafts are all done<br>`src/tools/planner/engine/view.test.ts:148` RDY-1: treats a craft with only raw ingredients as ready by default | pass |
| RDY-2 | An unfinished sub-craft blocks its consumer | `src/tools/planner/engine/view.test.ts:127` RDY-1, RDY-2: marks steps whose sub-crafts are all done | pass |
| RDY-3 | Owning the blocking ingredient makes the consumer ready | `src/tools/planner/engine/view.test.ts:132` RDY-3, RDY-4: promotes the consumer once its ingredients are owned | pass |
| RDY-4 | Satisfied steps are never ready | `src/tools/planner/engine/view.test.ts:132` RDY-3, RDY-4: promotes the consumer once its ingredients are owned | pass |
| RDY-5 | Steps in a recipe cycle are never ready | `src/tools/planner/engine/view.test.ts:137` RDY-5: marks nothing inside a cycle, and terminates | pass |
| RDY-6 | Hiding completed rows doesn't change readiness | `src/tools/planner/engine/view.test.ts:105` RDY-6: does not change ready flags | pass |
| RDY-7 | Amounts over one stack show a stack breakdown | `src/tools/planner/engine/view.test.ts:162` RDY-7: breaks an amount into stacks<br>`src/tools/planner/engine/view.test.ts:169` RDY-7: reaches rows through the injected item map | pass |
| RDY-8 | One stack or less shows no breakdown | `src/tools/planner/engine/view.test.ts:155` RDY-8: returns null when there's nothing useful to say | pass |

### recipe-tooltip

| AC | Criterion | Tests | Status |
|---|---|---|---|
| TIP-1 | Hovering or focusing an item label opens its card | — | no test |
| TIP-2 | The card lists every recipe variant | — | no test |
| TIP-3 | A raw material's card says it's gathered | — | no test |
| TIP-4 | Tapping toggles the card on touch | — | no test |
| TIP-5 | The card stays inside the viewport | — | no test |
| TIP-6 | Uncommon and rare items are tagged | — | no test |
| TIP-7 | Icons come from our own origin, and missing ones are hidden | — | no test |
| TIP-8 | Gather rows link to their source page | — | no test |
| TIP-N1 | Item labels are keyboard reachable | — | no test |

### serving

| AC | Criterion | Tests | Status |
|---|---|---|---|
| SRV-1 | Hashed assets are cached forever | — | no test |
| SRV-2 | Icons are cached for 30 days | — | no test |
| SRV-3 | Everything else is revalidated | — | no test |
| SRV-4 | Deep links serve the app | — | no test |
| SRV-5 | Unknown API paths are a JSON 404 | — | no test |
| SRV-6 | `/healthz` reports health without detail | — | no test |
| SRV-7 | Every response carries the security headers | `server/securityHeaders.test.ts:23` SRV-7: sets the full set on HTML responses<br>`server/securityHeaders.test.ts:31` SRV-7: applies to API responses too | pass |
| SRV-8 | The CSP is same-origin and blocks script injection | `server/securityHeaders.test.ts:37` SRV-8: does not allow inline or eval'd SCRIPT<br>`server/securityHeaders.test.ts:46` SRV-8: allows inline STYLE, which the recipe tooltip needs to position itself<br>`server/securityHeaders.test.ts:51` SRV-8: keeps everything same-origin, since the app loads no third-party assets<br>`server/securityHeaders.test.ts:59` SRV-8: refuses to be framed and blocks plugins and base-tag injection | pass |
| SRV-9 | Oversized API bodies are rejected | — | no test |
| SRV-N1 | The server listens on loopback by default | — | no test |
| SRV-N2 | A code-only deploy keeps the dataset cached | — | no test |

### share-link

| AC | Criterion | Tests | Status |
|---|---|---|---|
| SHR-1 | Creating a list returns a new token | `server/lists.test.ts:29` SHR-1, SHR-2: round-trips state and seeds progress from owned | pass |
| SHR-2 | Creation can seed progress | `server/lists.test.ts:29` SHR-1, SHR-2: round-trips state and seeds progress from owned | pass |
| SHR-3 | A list opens at its share link | — | no test |
| SHR-4 | "Copy link" copies the share link | — | no test |
| SHR-5 | A failed copy says so | — | no test |
| SHR-6 | Opening someone else's link adds it to my directory | — | no test |
| SHR-7 | Legacy links redirect | — | no test |
| SHR-8 | A list that doesn't exist says so | — | no test |
| SHR-9 | A route that is neither a list nor a token returns to the directory | — | no test |
| SHR-10 | Unknown tokens are 404 on every route | `server/lists.test.ts:60` SHR-10: 404s an unknown token | pass |
| SHR-11 | Stored definitions are sanitised | `server/lists.test.ts:44` SHR-11: round-trips the list name and bounds its length<br>`server/lists.test.ts:54` SHR-11: defaults name to an empty string when absent<br>`server/lists.test.ts:65` SHR-11: drops malformed targets instead of storing them | pass |
| SHR-N1 | Tokens can't be guessed | — | no test |

### shared-progress

| AC | Criterion | Tests | Status |
|---|---|---|---|
| PRG-1 | Concurrent deltas add up | `server/lists.test.ts:108` PRG-1: two +10 deltas on the same item sum to 20 | pass |
| PRG-2 | The stored amount stays within bounds | `server/lists.test.ts:121` PRG-2: a negative delta never drives qty below 0 | pass |
| PRG-3 | Malformed progress writes are rejected | `server/lists.test.ts:129` PRG-3: 400s a non-numeric delta | pass |
| PRG-4 | Entering a have amount writes the difference | — | no test |
| PRG-5 | Have amounts are the plan's owned stock | — | no test |
| PRG-6 | The first write asks for a display name | — | no test |
| PRG-7 | Declining the name still saves the write | — | no test |
| PRG-8 | Rows show who last set them | — | no test |
| PRG-9 | The handle can be changed | — | no test |
| PRG-10 | Others' changes appear within one poll | `src/tools/planner/lib/progressMerge.test.ts:16` PRG-10: takes the server's value when nothing is fenced<br>`src/tools/planner/lib/progressMerge.test.ts:73` PRG-10: drops a local item that is no longer fenced and no longer on the server<br>`src/tools/planner/lib/progressMerge.test.ts:82` PRG-10: adds items introduced by other clients | pass |
| PRG-11 | A poll never rolls back an acknowledged write | `src/tools/planner/lib/progressMerge.test.ts:30` PRG-11: ignores a snapshot issued before the write was acknowledged<br>`src/tools/planner/lib/progressMerge.test.ts:39` PRG-11: accepts a snapshot issued after the write was acknowledged<br>`src/tools/planner/lib/progressMerge.test.ts:46` PRG-11: lets a collaborator's newer value through once the fence is released<br>`src/tools/planner/lib/progressMerge.test.ts:56` PRG-11: fences one item without freezing the rest of the map | pass |
| PRG-12 | A write in flight isn't overwritten | `src/tools/planner/lib/progressMerge.test.ts:22` PRG-12: keeps the local value while a write is in flight<br>`src/tools/planner/lib/progressMerge.test.ts:64` PRG-12: preserves a fenced item the snapshot has never heard of | pass |
| PRG-13 | A failed write is undone and reported | — | no test |
| PRG-14 | Out-of-order poll responses are ignored | — | no test |
| PRG-N1 | Polling is cheap for the host | — | no test |

### tool-suite-shell

| AC | Criterion | Tests | Status |
|---|---|---|---|
| SHL-1 | The landing page has a card for every tool | `src/shell/Home.test.tsx:11` SHL-1: links a card to every registered tool, with its version | pass |
| SHL-2 | The header links home, every tool and What's New | — | no test |
| SHL-3 | The footer shows the toolkit version | — | no test |
| SHL-4 | What's New lists releases newest first | — | no test |
| SHL-5 | Release changes are grouped and labelled | — | no test |
| SHL-6 | Unknown paths go to the landing page | — | no test |
| SHL-7 | A tool shows a loading state while its code arrives | — | no test |
| SHL-8 | Switching between two lists starts each one fresh | — | no test |
| SHL-N1 | Adding a tool is one registry entry | — | no test |

### usage-metrics

| AC | Criterion | Tests | Status |
|---|---|---|---|
| MET-1 | Each client is counted once a day | `server/metrics.test.ts:40` MET-1: counts distinct clients once each, however many requests they make | pass |
| MET-2 | Raw addresses are never stored | `server/metrics.test.ts:51` MET-2: stores a hash, never the raw client IP | pass |
| MET-3 | The same client hashes the same after a restart | `server/metrics.test.ts:59` MET-3: gives the same client the same hash across restarts (pepper persists) | pass |
| MET-4 | Events are counted per day | `server/metrics.test.ts:79` MET-4: counts list creations<br>`server/metrics.test.ts:94` MET-4: aggregates arbitrary named events by day | pass |
| MET-5 | Stats are closed unless a token is configured | `server/metrics.test.ts:103` MET-5: 404s when no token is configured (fail closed) | pass |
| MET-6 | Stats need the exact bearer token | `server/metrics.test.ts:110` MET-6: 401s a missing or wrong token | pass |
| MET-7 | Stats return aggregates only | — | no test |
| MET-8 | Stats requests aren't visits | `server/metrics.test.ts:71` MET-8: does not count stats polls as visits | pass |
| MET-N1 | Counting visitors is cheap | — | no test |
| MET-N2 | The token check is constant-time | — | no test |

**Result: FAIL** — 187 ACs
- Missing: ABU-1, ABU-2, ABU-3, ABU-4, ABU-5, ABU-6, ABU-10, ABU-N1, ABU-N3, ALT-3, ALT-4, ALT-5, EDT-1, EDT-4, EDT-5, EDT-6, EDT-7, EDT-8, EDT-9, EDT-10, DAT-1, DAT-2, DAT-3, DAT-4, DAT-5, DAT-6, DAT-7, DAT-8, DAT-9, DAT-10, DAT-11, DAT-12, DAT-13, DAT-14, DAT-N1, SRCH-1, SRCH-2, SRCH-3, SRCH-4, SRCH-5, SRCH-6, SRCH-7, SRCH-8, SRCH-9, SRCH-N1, LST-1, LST-2, LST-3, LST-4, LST-5, LST-6, LST-7, LST-9, LST-10, LST-11, LST-12, RET-5, RET-9, RET-N1, MDX-9, MDX-10, OWN-1, OWN-2, OWN-6, OWN-7, OWN-8, PLAN-8, PLAN-9, PLAN-10, LAY-9, TIP-1, TIP-2, TIP-3, TIP-4, TIP-5, TIP-6, TIP-7, TIP-8, TIP-N1, SRV-1, SRV-2, SRV-3, SRV-4, SRV-5, SRV-6, SRV-9, SRV-N1, SRV-N2, SHR-3, SHR-4, SHR-5, SHR-6, SHR-7, SHR-8, SHR-9, SHR-N1, PRG-4, PRG-5, PRG-6, PRG-7, PRG-8, PRG-9, PRG-13, PRG-14, PRG-N1, SHL-2, SHL-3, SHL-4, SHL-5, SHL-6, SHL-7, SHL-8, SHL-N1, MET-7, MET-N1, MET-N2
