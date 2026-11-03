# Plan layouts
Key: LAY · Status: Draft · Owner: — · Updated: 2026-11-03

## Story
As a player, I want to view the plan by tier, in dependency order or by profession, and hide
or collapse what I'm done with, so that I can work the plan the way my session needs.

## Context
- Architecture: [architecture.md](../../architecture.md) §4 "State and data flow": view
  settings are kept per browser and aren't part of the shared list.
- ADRs: —
- Related: [planner epic](../../epics/planner/epic.md) #4. Depends on plan-engine (PLAN).
  Markdown export renders from the same layout (MDX). Code: `engine/view.ts`, `lib/prefs.ts`,
  `PlanView.tsx`.
- Terms:
  - **preset**: one of Tiered, Flat or By profession.
  - **section**: a group of rows under one heading.
  - **view settings**: the preset, "Hide completed", and the set of collapsed sections, for
    one list.

## Scope
In: the three presets, row order within sections, hiding completed rows, collapsing
sections, storing view settings, and the empty states.
Out: ready badges and stacks (RDY), the export (MDX).

## Acceptance criteria

### LAY-1: Tiered groups craft steps by tier, deepest first
Given the Tiered preset,
When the plan is shown,
Then craft steps are grouped into one section per tier, deepest first. Tier 0 is headed
"Final products", and the others "Components · Tier n". Within a section, rows are sorted by
profession, then by name.

### LAY-2: Flat keeps the dependency order in one section
Given the Flat preset,
When the plan is shown,
Then every craft step is in a single section headed "Craft (n)", where n is the number of
craft steps not yet satisfied, in the order PLAN-4 defines.

### LAY-3: By profession groups craft steps by profession
Given the By profession preset,
When the plan is shown,
Then craft steps are grouped into one section per profession, in alphabetical order, with
steps that have no profession last under "Other". Within a section, rows are sorted deepest
tier first, then by name.

### LAY-4: The gather section is the same under every preset
Given any preset,
When the plan is shown,
Then all gather steps are in one section, "Gather (n)", sorted by item name, where n is the
number not yet satisfied. The section has the same rows under every preset.

### LAY-5: Hide completed removes satisfied rows
Given a plan with satisfied rows,
When the user ticks "Hide completed",
Then satisfied rows aren't shown, any section left with no rows isn't shown, and the toolbar
shows "<k> hidden", where k is the number of rows removed. With k = 0, there is no note. Unticking it shows them again.

### LAY-6: A section can be collapsed and expanded
Given a plan,
When the user clicks a section's heading,
Then its rows are hidden, its caret shows ▸, and the heading's toggle reports
`aria-expanded="false"`. A second click shows the rows again, with ▾ and
`aria-expanded="true"`.

### LAY-7: View settings are kept per list in this browser
Given the user changed the view settings on list A,
When list A is reloaded in the same browser,
Then the same settings are in effect. List B's settings, and every other browser's settings
for list A, are unchanged.

### LAY-8: Defaults when nothing is stored
Given a list with no stored view settings, or stored settings that are corrupt, invalid or
can't be read (for example when localStorage is unavailable),
When the list is shown,
Then it uses Tiered, with "Hide completed" off and nothing collapsed, and no error is shown.
Any valid fields in the stored settings are kept.

### LAY-9: Empty sections say so
Given a plan with no gather steps, or with every gather row hidden,
When it is shown,
Then the gather panel reads "Gather (0)" and "Nothing to gather."
Given a plan with no craft rows left to show,
When it is shown,
Then the craft panel says "Nothing left to craft."

## Non-functional requirements

### LAY-N1: Stored view settings are bounded
View settings are kept for at most 50 lists per browser; when a 51st is saved, the oldest is
dropped. Each list keeps at most 64 collapsed sections.

## Open questions
None.

## Changelog
- 2026-11-03 — created (backfilled from the code, `view.test.ts` and `prefs.test.ts`)
