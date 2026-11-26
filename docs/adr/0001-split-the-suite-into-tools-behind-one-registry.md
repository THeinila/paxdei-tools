# 0001. Split the suite into tools behind one registry
Status: Accepted · Date: 2026-11-03
Backfilled from: README "Architecture", `src/tools/registry.tsx`, CHANGELOG 1.0.0

## Context
The project started as one Crafting Planner, but the site is meant to host several Pax Dei
tools. Each tool needs a route, a nav entry and a landing card, and those three must not
drift apart. Spec: tool-suite-shell (SHL).

## Decision
`src/tools/registry.tsx` is the single list of tools. Both the route table
(`src/routes.tsx`) and the landing page (`src/shell/Home.tsx`) are generated from it. Each
tool is a self-contained module under `src/tools/<tool>/` and renders inside the shared
`AppShell` outlet.
- A registry entry has `id`, `name`, `path`, `blurb`, `version`, `element` and optional
  nested `children` routes.
- A tool's server routes mount under `/api/<tool>/…`. The planner's `/api/lists*` routes
  predate this rule and keep their paths.
- Unknown paths redirect to `/`.

## Consequences
- Adding a tool is one registry entry plus its component.
- Tools are lazy route chunks, so the shell never pays for a tool it isn't showing (see
  [0004](0004-lazy-load-the-dataset-as-its-own-hashed-chunk.md)).
- There is only one tool so far, so the boundary between "shell" and "tool" hasn't been
  tested by a second one. Revisit when the second tool lands.

## Alternatives considered
- Hand-written routes and landing cards — rejected because the three lists drift when a tool
  is added or renamed.
- A separate app per tool — rejected because the tools share a header, deployment and
  backend, and one 1/8-OCPU host serves them all.
