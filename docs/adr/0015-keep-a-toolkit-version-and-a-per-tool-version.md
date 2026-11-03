# 0015. Keep a toolkit version and a per-tool version
Status: Accepted · Date: 2026-11-03
Backfilled from: `RELEASING.md`, README "Versioning", `src/shell/releases.ts`

## Context
The site is a suite ([0001](0001-split-the-suite-into-tools-behind-one-registry.md)). Users
care whether *their* tool changed. Deployment and git tags need one number for the whole
release. Spec: tool-suite-shell (SHL).

## Decision
There are two independent semver numbers.
- **Toolkit** (release train): `version` in `package.json`. It goes up on every release, is
  shown in the footer, and is git-tagged `v<version>`.
- **Per-tool:** `version` on each registry entry. It goes up only when that tool changes, and
  is shown as a badge on the tool's card and header.

Release history is kept twice, for two audiences: `CHANGELOG.md` is the technical record,
and `src/shell/releases.ts` drives the plain-language What's New page. RELEASING.md lists
the steps that keep them in step.

## Consequences
- A shell- or backend-only release doesn't bump the planner's badge.
- There are four places to update for each release (two versions, two changelogs), and
  nothing checks that they agree.
- The toolkit version isn't derived from the tool versions, so the numbers can't be compared
  with each other.

## Alternatives considered
- A single version for everything — rejected because every tool's badge would change on
  every release.
- Generating What's New from CHANGELOG — rejected because the two audiences need different
  wording (RELEASING.md step 4).
