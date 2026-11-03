# Adopting code-factory in pax-planner

Status: Draft · Updated: 2026-11-03

This plan brings pax-planner into the code-factory workflow
(`C:\Users\Toni\claude-projects\code-factory`). Existing features get specs after the fact,
the docs move to the factory's layout, and the test suite grows until every acceptance
criterion has a passing test that cites it. After that, new work goes through
`/workflow:start`.

Scope is `main` (v1.5.1, plus `chore/vitest-4-upgrade` once it is merged). The unmerged
`feat/market-*` branches are out of scope. They get specs when they are picked up again.

---

## 1. Where we start

| | Today | Target |
|---|---|---|
| Requirements | README feature list, SPRINT_PLAN "Done" sections, CHANGELOG prose | `docs/features/<slug>/spec.md` with stable AC IDs |
| Architecture | README "Architecture" section, CAPACITY.md, DEPLOY.md | `docs/architecture.md` (arc42-lite), linking to runbooks |
| Decisions | Embedded in README/CHANGELOG/code comments | `docs/adr/NNNN-*.md` |
| Backlog | SPRINT_PLAN.md checkboxes | `docs/epics/roadmap/epic.md` with keys and draft ACs |
| Tests | 109 Vitest tests in 11 files, engine and server only; no names cite requirements | Every AC has a test whose name cites it; trace exits 0 |
| UI tests | None (no jsdom, no Testing Library) | Component tests for the UI-only ACs |
| Gates | `npm test`, `npm run typecheck`, run by hand | autocheck hooks, `trace.mjs --report`, spec lint |

Untested today: `server/rateLimit.ts`, the routing, caching and fallback in `server/index.ts`,
every React component, `useList.ts` (polling and shared mode), `handle.ts`, `storage.ts`,
`api.ts`, `data.ts`, most of `directory.ts`, the shell and registry, and the data pipeline
(`build-dataset.ts` normalisation rules, `fetch-icons.ts` validation).

## 2. Changes to the factory's workflow for this repo

The factory assumes greenfield features: story → spec → red → green. Backfilling breaks
three of those assumptions, so these rules apply only during adoption:

1. **Spec from the code, not from a story.** The spec describes what the code does today.
   Read the code, the tests, and the CHANGELOG entry for the feature. If behaviour looks
   wrong or unintended, **don't fix it in the spec or the code**. Record it as an open
   question tagged `(as-built)`. The user decides at approval time: keep it as specified
   behaviour, or turn it into a fix AC that gets a normal red → green.
2. **Characterisation red replaces red.** A test for existing behaviour passes the first
   time it runs, and the `tdd` skill says that proves nothing. The evidence instead is a
   **mutation red**: break the code under test (comment out the guard, flip the
   comparison, return early), watch the test fail for the expected reason, then revert.
   Record it as `RED(mutation): <file:line change> → <n> failed`. A test that a plausible
   mutation can't make fail gets tightened.
3. **Lifecycle.** Backfilled specs go Draft → Approved (the user reviews each epic's specs
   as one batch) → Implemented once the trace is green for that spec. Approval stays the
   only human gate (ADR 0009 in the factory).
4. **No `plan.mjs` state machine during backfill.** `P start` creates a `feat/` branch and
   moves through intake and design phases that don't apply. Backfill runs on one
   `chore/factory-adoption` branch with one commit per verified chunk. The gates are run
   by hand instead: `spec.mjs lint`, the spec critic, `trace.mjs`, and
   `verify:review-code` per epic. New features after adoption use `/workflow:start`
   unchanged.

The factory has no adoption flow of its own. If this plan works, it should become a
`workflow:adopt` skill in code-factory. That is follow-up work, not part of this plan.

### Repo conventions (go into a new `CLAUDE.md`)

- AC citation form: `it("PLAN-3: rounds craft batches up by yield", …)`, or
  `describe("PLAN-3 …")` around a group.
- Test files sit next to their source as `*.test.ts(x)`, which is the existing convention.
- Component tests use `@testing-library/react` with `jsdom`, set per file with
  `// @vitest-environment jsdom`, so engine and server tests stay on `node`.
- Trace: `npm run test:report` writes `.factory/vitest.json`. Then run
  `node <verify>/bin/trace.mjs --report .factory/vitest.json`.
- Releases: RELEASING.md gets one more step. Specs touched in the release get a changelog
  line, and CHANGELOG entries cite AC IDs.
- Data pipeline scripts make network calls. Their tests cover the pure functions
  (normalisation, WebP magic check) and never fetch.

## 3. Feature inventory: 4 epics, 18 specs

Keys are proposed. `spec.mjs` checks that they are unique across the repo. The test counts
are existing tests that will be renamed to cite the AC.

| Epic | Slug | Key | Covers (code) | Existing tests |
|---|---|---|---|---|
| **planner** | item-search | SRCH | `Search.tsx`, `data.ts` lazy dataset | 0 |
| | plan-engine | PLAN | `planner.ts`: flatten, aggregate, yield rounding, tiers, cycle guard | 9 |
| | owned-stock | OWN | owned subtraction, satisfied subtree greying | 3 |
| | alternative-paths | ALT | variant choice, default variant | 2 |
| | plan-layouts | LAY | `view.ts` presets, hide completed, collapse, `prefs.ts` | 20 |
| | ready-and-stacks | RDY | `computeReady`, `stacksFor` | 8 |
| | markdown-export | MDX | `markdown.ts`, copy button | 6 |
| | recipe-tooltip | TIP | `RecipeTooltip.tsx`, gather "where?" link | 0 |
| | list-management | LST | `directory.ts`, named, duplicate, archive, quick list | 5 |
| **collaboration** | share-link | SHR | `POST/GET /api/lists`, Share button, `?list=` hydrate | 5 |
| | shared-progress | PRG | deltas, `progressMerge`, polling, handle, attribution | 13 |
| | definition-edits | EDT | version-guarded PATCH, 409 + rebase | 2 |
| | list-retention | RET | `retention.ts` TTL sweep, activity clock, migration | 15 |
| **platform** | tool-suite-shell | SHL | registry, routes, Home, versions, What's New | 0 |
| | serving | SRV | static cache headers, SPA fallback, `/healthz`, security headers | 6 |
| | abuse-limits | ABU | `rateLimit.ts`, `diskGuard.ts` | 6 |
| | usage-metrics | MET | `metrics.ts`, `/api/stats` | 8 |
| **data** | game-data-pipeline | DAT | `build-dataset.ts` rules, `fetch-icons.ts` validation | 0 |

Expected size is about 110–140 ACs, and about 60–90 new tests. CAPACITY.md constants
(rate limits, poll interval, chunk sizes) become `-N` NFRs in SRV, ABU and PRG, and each
cites the CAPACITY.md section that justifies it.

## 4. Doc migration map

| Existing | Becomes | Notes |
|---|---|---|
| README.md | Stays as the entry point, shorter | Features list links to specs; the Architecture section is replaced by a link to `docs/architecture.md`; Status points to the roadmap epic |
| README "Architecture" + CAPACITY summary | `docs/architecture.md` (new) | Built with `architecture:architecture-doc`; C4 context and container diagrams |
| Decisions buried in README/CHANGELOG | `docs/adr/0001…` (backfilled, `Accepted`) | See §5 |
| SPRINT_PLAN.md "Done" sections | Removed | Covered by the specs |
| SPRINT_PLAN.md open items | `docs/epics/roadmap/epic.md` | One feature per item, with key and draft ACs; "Engineering hygiene" is closed by this plan, or by CI (§7) |
| SPRINT_PLAN.md | Deleted at the end | Git history keeps it |
| docs/TEAMCRAFT_ANALYSIS.md | `docs/research/teamcraft-analysis.md` | Research input; linked from the roadmap epic |
| docs/CAPACITY.md | Stays | Linked from architecture.md "Quality goals"; cited by NFRs |
| deploy/DEPLOY.md, RELEASING.md, scripts/README.md | Stay | Runbooks; linked from architecture.md "Deployment"; RELEASING gains the spec/trace step |
| CHANGELOG.md, `src/shell/releases.ts` | Stay | History isn't rewritten; new entries cite AC IDs |
| (none) | `CLAUDE.md` | Conventions from §2 and the trace and test commands |

## 5. ADR backfill (candidates)

Each one records a decision already in the code. They are dated today with
`Context: backfilled from <source>`.

1. Split the suite into tools behind one registry (routes and landing cards generated from it).
2. Lazy-load the dataset as its own hashed chunk (CAPACITY.md).
3. Commit the generated `dataset.json`, and treat icons as a build artifact.
4. Share by secret token with no accounts. A handle is attribution, not auth.
5. Sync by polling (~3 s), not WebSockets.
6. Hono + better-sqlite3 on a single node.
7. Two concurrency strategies: additive progress deltas, version-guarded definition edits.
8. Sweep shared lists after a TTL of write inactivity.
9. Privacy-preserving metrics: HMAC-hashed IP, no cookies, stats endpoint closed unless a token is set.
10. Same-origin only. A strict CSP, with inline style allowed for the tooltip.
11. The disk guard fails open.
12. Two version tracks (toolkit release train, per-tool).

## 6. Phases

Each phase is one or more commits on `chore/factory-adoption`. Nothing merges to `main`
without explicit approval.

### Phase 0: Set up
- Merge `chore/vitest-4-upgrade` first (needs approval), then branch from `main`.
- Install the plugins: workflow, architecture, verify, code-quality, autocheck and
  react-dev. python-dev isn't needed.
- `/autocheck:init`: typecheck and test. There's no linter. **Decision:** add ESLint now,
  or leave autocheck at typecheck + test.
- Dev dependencies: `jsdom` and `@testing-library/react`. Add an `npm run test:report`
  script that writes `.factory/vitest.json` with the JSON reporter. Add `.factory/` to
  `.gitignore`.
- Write `CLAUDE.md`.
- **Done when** `npm test`, the typecheck and `/autocheck:run` pass, and one throwaway
  component test renders under jsdom.

### Phase 1: Architecture and ADRs
- `docs/architecture.md`, built from the code.
- The §5 ADRs, created with `adr.mjs new`, filled in, and marked `Accepted` on approval.
- **Gate:** the user accepts the ADRs (one batch).

### Phase 2: Epics
- `docs/epics/{planner,collaboration,platform,data}/epic.md`, with the §3 features in
  dependency order. Draft ACs come from the code and the existing test names.
- `docs/epics/roadmap/epic.md`, built from the SPRINT_PLAN open items.
- `spec.mjs lint` passes with 0 errors.

### Phase 3: Specs, one epic at a time
Order: planner → collaboration → platform → data. The pure-TS engine goes first because it
has the most tests to anchor it.
- For each feature: `spec.mjs new <slug> <KEY> "<title>"`. Fill in the ACs from the code
  and tests, run lint, then the spec critic, then the rewrites.
- `(as-built)` questions go in Open questions.
- **Gate:** the user approves the epic's specs as a batch and settles each `(as-built)`
  question.

### Phase 4: Cite existing tests
- Rename the 109 existing tests to cite AC IDs. Names change; assertions don't.
- Run `trace.mjs --report` and commit the baseline matrix. The gaps are the work list
  for Phase 5.
- A test that maps to no AC gets one of three outcomes: it shows an AC is missing (amend
  the spec), it is redundant (delete it), or it is internal (keep it uncited and list it).

### Phase 5: Fill the gaps, one epic at a time
- Chunks of about 300 lines, each covering the uncovered ACs of one or two features.
  Tests come first, with **mutation red** evidence (§2.2).
- Expected new test areas:
  - Component tests: Search, PlanView, Row, RecipeTooltip, the Planner shell flows (share,
    duplicate, archive), Home and WhatsNew.
  - `useList`: shared mode and polling, using fake timers and a mocked `fetch`.
  - Server: `rateLimit`; and in `index.ts`, the cache headers, the SPA fallback and
    `/healthz`, through `app.request()`.
  - The data pipeline's pure functions. `build-dataset.ts` and `fetch-icons.ts` may need
    small extractions to make them testable: refactor only, no behaviour change, each in
    its own commit.
- A fix AC approved in Phase 3 gets a real red → green and a `fix(<KEY>):` commit.
- At the end of each epic, run `verify:review-code` on the epic's diff. Fix blockers and
  majors.

### Phase 6: Verify and finish
- `verification-before-completion`: the full suite, the typecheck, and the trace with
  `--report`. **Gate:** every live AC has a passing test, and the trace exits 0.
- Set each spec to `Status: Implemented`, with a changelog line.
- Slim the README, update RELEASING.md, move TEAMCRAFT_ANALYSIS, delete SPRINT_PLAN.md.
- Release v1.5.2 (docs and tests only, no app change), or fold it into the next release.

## 7. Out of scope (follow-ups)

- **CI** (SPRINT_PLAN hygiene item): there is no `.github/` yet. A workflow that runs the
  tests, the typecheck and the trace would enforce the gates on push.
- **`workflow:adopt` in code-factory**: turn §2 and this phase list into a factory skill.
- Specs for the `feat/market-*` branches.
- E2E browser tests (Playwright). The component tests and `app.request()` cover the ACs.
  A two-client convergence e2e (SHR/PRG) would be the first one worth adding.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Specs that copy the code describe bugs as requirements | `(as-built)` questions, decided at approval |
| UI ACs drift into implementation detail ("button X calls Y") | spec-rules #5; the critic checks for it |
| jsdom gaps (clipboard, `window.prompt`, layout for the tooltip) | Mock only at the browser boundary; assert on the tooltip's content and visibility, not its position |
| Refactoring pipeline scripts for testability changes output | Diff `data/dataset.json` before and after; it must be byte-identical |
| Context size over 18 specs | One epic per session; this file and the specs hold the state, not the conversation |

## 9. Decisions needed before Phase 0

1. Approve merging `chore/vitest-4-upgrade` into `main`, which this plan builds on.
2. ESLint: add it now (autocheck gets a per-file lint), or later.
3. Epic and key cut in §3: accept it, or merge or split features.
4. Approve the specs per epic (4 approvals), or all at once.
