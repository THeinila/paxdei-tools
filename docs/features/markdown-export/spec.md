# Copy as Markdown
Key: MDX · Status: Approved · Owner: — · Updated: 2026-11-03

## Story
As a player, I want to copy the plan as a Markdown checklist, so that I can paste it into
Discord for my group.

## Context
- Architecture: [architecture.md](../../architecture.md) §3 (engine)
- ADRs: —
- Related: [planner epic](../../epics/planner/epic.md) #6. Depends on plan-layouts (LAY) and
  ready-and-stacks (RDY). The export renders from the same layout as the screen. Code:
  `engine/markdown.ts`, `copyMarkdown` in `PlanView.tsx`.

## Scope
In: the exported text and the copy button.
Out: other formats (plain text, CSV) and sharing the list itself (SHR).

## Acceptance criteria

### MDX-1: The export is a titled Markdown checklist
Given a plan,
When the user clicks "Copy as Markdown",
Then the clipboard holds text that starts with "# <list name>", then a bold summary line
"**<g> to gather · <c> crafts in <t> tiers**" (the same counts as PLAN-10), then one
"## <section heading> (<remaining>)" block for each section with at least one row, each row as
"- [ ] <name> ×<qty>".

### MDX-2: The summary counts ready crafts
Given a plan with r > 0 ready crafts,
When it is exported,
Then the summary line ends with " · <r> ready now". With r = 0, that part is left out.

### MDX-3: Row details match the screen
Given a craft row that isn't satisfied,
When it is exported,
Then its line ends with " — <n> craft(s)", then " → makes <produced>" when produced ≠
quantity, then " · <profession>" when known, then " — <stack breakdown>" when RDY-7 applies,
then " — **ready**" when the step is ready.

### MDX-4: Satisfied rows are ticked
Given a satisfied gather or craft row,
When it is exported,
Then its line starts "- [x]" and includes " — have enough".

### MDX-5: The export follows the preset and Hide completed
Given a preset and the Hide completed setting,
When the plan is exported,
Then the sections and their order match what LAY-1 to LAY-5 show. When rows were hidden,
there is a line "_<k> completed item(s) hidden._".

### MDX-6: Collapsed sections are exported in full
Given a collapsed section,
When the plan is exported,
Then that section and all its rows are in the export.

### MDX-7: The export ends with an attribution and the list's link
Given a list at link L,
When it is exported,
Then the last line is "Made with the Pax Dei Crafting Planner · L".

### MDX-8: An untitled list exports as "Untitled"
Given a list with an empty name,
When it is exported,
Then the first line is "# Untitled".

### MDX-9: The button confirms the copy
Given the clipboard accepts the write,
When the user clicks "Copy as Markdown",
Then the button reads "Copied!" for 2 seconds, then "Copy as Markdown" again.

### MDX-10: A failed copy says so
Given the browser rejects the clipboard write (permission denied or no clipboard access),
When the user clicks "Copy as Markdown",
Then the button reads "Copy failed" for 2 seconds, then "Copy as Markdown" again, and
nothing is put on the clipboard.

## Non-functional requirements
None.

## Open questions
None.

## Discrepancies with the code
- MDX-10: `copyMarkdown` swallows the error, and the button doesn't change. Fix pending.

## Changelog
- 2026-11-03 — created (backfilled from the code and `markdown.test.ts`)
- 2026-11-03 — MDX-10 added: a failed copy is reported (settled as-built question; the code still differs)
- 2026-11-03 — approved
