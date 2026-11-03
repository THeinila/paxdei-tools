# pax-planner

Pax Dei Tools: a React + Vite SPA (the Crafting Planner) with a Hono + better-sqlite3
share backend. Start with [README.md](README.md). Production runs on a 1/8-OCPU free-tier
VM, so read [docs/CAPACITY.md](docs/CAPACITY.md) before changing any constant in the
serving path.

## Workflow: code-factory

This repo uses the code-factory plugins (`C:\Users\Toni\claude-projects\code-factory`).
New features go through `/workflow:start`: approved spec → chunk plan → test-first
implementation → review → local PR draft.

Adoption is in progress: [docs/factory-adoption-plan.md](docs/factory-adoption-plan.md).
Until it's finished, existing features may not have specs yet. During the backfill:
- Specs describe the code as it is. Record suspect behaviour as an `(as-built)` open
  question; don't fix it silently.
- A test for behaviour that already exists needs **mutation red**: break the code under
  test, watch the test fail for the expected reason, revert, and record
  `RED(mutation): <file:line change> → <n> failed`.

## Layout

- Specs: `docs/features/<slug>/spec.md`. AC IDs are `<KEY>-<n>` and NFRs are
  `<KEY>-N<n>`. IDs are never renumbered or reused.
- Epics: `docs/epics/<epic>/epic.md`. ADRs: `docs/adr/NNNN-<slug>.md`.
- Architecture overview: `docs/architecture.md`.
- `.factory/` holds reports and PR drafts. It's git-ignored; never commit it.

## Tests

- Vitest. Test files sit next to their source as `*.test.ts(x)`.
- Every test that proves an AC cites it in its name: `it("PLAN-3: rounds craft batches up
  by yield", …)`, or a `describe("PLAN-3 …")` around a group.
- Component tests start with `// @vitest-environment jsdom` and use
  `@testing-library/react`, with `afterEach(cleanup)`. Engine and server tests stay on the
  default `node` environment.
- Server routes are tested through `app.request()`, not a listening port.
- Data-pipeline tests cover pure functions only. They never touch the network.
- Mock only at boundaries we don't own (`fetch`, timers, `window.prompt`, clipboard).

## Commands

```bash
npm test                 # all tests
npm run typecheck        # tsc --noEmit
npm run test:report      # tests + .factory/vitest.json for the trace
node C:/Users/Toni/claude-projects/code-factory/plugins/verify/bin/trace.mjs --report .factory/vitest.json
node C:/Users/Toni/claude-projects/code-factory/plugins/architecture/bin/spec.mjs lint
```

autocheck (`.claude/autocheck.json`) runs the typecheck, then the tests, when an editing
agent stops. The build is left out: it rewrites `dist/` and is slow.

## Git

Work on a branch. The convention is branch → `--no-ff` merge → push `main`, and merging
to `main` needs explicit approval each time. Releases follow [RELEASING.md](RELEASING.md).
