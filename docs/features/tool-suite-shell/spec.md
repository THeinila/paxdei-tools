# Tool suite shell
Key: SHL · Status: Implemented · Owner: — · Updated: 2026-11-03

## Story
As a player, I want one site with a landing page and navigation across every tool, so that I
can find and switch between Pax Dei tools.

## Context
- Architecture: [architecture.md](../../architecture.md) §3 (`src/shell/`, `src/tools/registry.tsx`)
- ADRs: [0001](../../adr/0001-split-the-suite-into-tools-behind-one-registry.md) (one registry), [0004](../../adr/0004-lazy-load-the-dataset-as-its-own-hashed-chunk.md) (lazy tools), [0015](../../adr/0015-keep-a-toolkit-version-and-a-per-tool-version.md) (two versions)
- Related: [platform epic](../../epics/platform/epic.md) #1. Code: `src/routes.tsx`,
  `src/shell/{AppShell,Home,WhatsNew}.tsx`, `src/shell/releases.ts`, `src/tools/registry.tsx`.
- Terms:
  - **registry**: the list of tools in `registry.tsx`.
  - **toolkit version**: `package.json`'s version.
  - **tool version**: a registry entry's version.

## Scope
In: the landing page, header, footer, What's New page, routing and the loading state.
Out: each tool's own pages, and recovering from errors while rendering (roadmap ERR).

## Acceptance criteria

### SHL-1: The landing page has a card for every tool
Given the registry,
When `/` opens,
Then there is one card per registered tool, linking to its path and showing its name,
"v<tool version>" and its description, followed by a non-clickable "More tools coming soon"
card.

### SHL-2: The header links home, every tool and What's New
Given any page,
When it is shown,
Then the header has a "Pax Dei Tools" link to `/`, one link per registered tool, and a
"What's New" link. The link for the current page is marked active.

### SHL-3: The footer shows the toolkit version
Given any page,
When it is shown,
Then the footer reads "Fan project · not affiliated with Mainframe Industries · v<toolkit
version>", and the version links to What's New.

### SHL-4: What's New lists releases newest first
Given the releases in `releases.ts`,
When `/whats-new` opens,
Then each release shows "v<version>", its title when it has one, and its date as a readable
date (the raw string when it isn't a valid date). Releases appear in the file's order,
newest first.

### SHL-5: Release changes are grouped and labelled
Given a release with sections,
When it is shown,
Then each section shows its tool name when it has one, and each change is labelled "New",
"Improved" or "Fixed" by its kind.

### SHL-6: Unknown paths go to the landing page
Given a path that matches no route,
When it is opened,
Then the browser is redirected to `/`, replacing the history entry.

### SHL-7: A tool shows a loading state while its code arrives
Given a tool whose code or data hasn't loaded yet,
When its route opens,
Then the page body shows "Loading…" until the tool renders. The header and footer stay
visible.

### SHL-8: Switching between two lists starts each one fresh
Given the editor open on list A,
When the browser navigates to list B, by a link or with back and forward,
Then the editor shows only B's state, and nothing from A carries over.

## Non-functional requirements

### SHL-N1: Adding a tool is one registry entry
A new registry entry, with its component, produces its route, its header link and its
landing card with no other change to the shell
([ADR 0001](../../adr/0001-split-the-suite-into-tools-behind-one-registry.md)).

## Open questions
None. SHL-6 was settled on 2026-11-03: unknown paths keep redirecting to the landing page
rather than showing a 404 page. The suite has few routes, and every card is one click away.

## Changelog
- 2026-11-03 — created (backfilled from the code and `Home.test.tsx`)
- 2026-11-03 — approved
- 2026-11-03 — implemented: every AC has a passing test (trace 188/188, adoption Phase 6)
