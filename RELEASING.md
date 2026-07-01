# Releasing & versioning

The suite carries **two independent version numbers**:

| Version | Source of truth | Bumps when |
|---------|-----------------|------------|
| **Toolkit** (release train) | `version` in [`package.json`](package.json) | Any release is cut — any tool ships, a new tool goes live, or the shell/backend changes. Shown in the footer and git-tagged. |
| **Per-tool** | `version` on each entry in [`src/tools/registry.tsx`](src/tools/registry.tsx) | Only that tool changes. Shown as a badge on its landing card and tool header. |

They are **decoupled**: the toolkit version is not computed from the tool versions — it's
a release train that ticks forward on every release.

## Semver conventions

**Per-tool version** (`registry.tsx`):
- **major** — breaking UX or data change (e.g. incompatible saved-list format).
- **minor** — new user-facing feature.
- **patch** — bug fix or polish, no new feature.

**Toolkit version** (`package.json`):
- **minor** — a tool ships a feature, or a new tool goes live.
- **patch** — fix-only release.
- **major** — suite-wide overhaul (redesign, breaking shared contract).

## Cutting a release

1. Bump the changed tool's `version` in `src/tools/registry.tsx`.
2. Bump `version` in `package.json` (the toolkit / release-train number).
3. Add a dated section to `CHANGELOG.md` under the **Toolkit** heading and the relevant
   tool heading(s) — the technical record.
4. Add a matching entry to `src/shell/releases.ts` — the **user-facing** "What's New".
   Write it in plain language (what a player can now do), grouped New / Improved / Fixed,
   per tool. Don't copy the technical wording from `CHANGELOG.md`.
5. Commit: `git commit -m "release: v<toolkit-version>"`.
6. Tag: `git tag -a v<toolkit-version> -m "v<toolkit-version>"`.
7. Build and deploy from the tag (`npm run build`).
