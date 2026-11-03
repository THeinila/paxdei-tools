# Concurrent definition edits
Key: EDT · Status: Approved · Owner: — · Updated: 2026-11-03

## Story
As a member of a group, I want to change the targets, quantities and path choices at the same
time as someone else, so that neither of us overwrites the other's edit.

## Context
- Architecture: [architecture.md](../../architecture.md) §4 "State and data flow"
- ADRs: [0009](../../adr/0009-use-additive-deltas-for-progress-and-version-guards-for-defi.md) (version guards)
- Related: [collaboration epic](../../epics/collaboration/epic.md) #4. Depends on share-link
  (SHR). Code: `PATCH /lists/:token` in `server/lists.ts`, `editDef` in `lib/useList.ts`, the
  targets section of `Planner.tsx`.
- Terms:
  - **definition**: a list's name, targets and path choices.
  - **version**: a counter that goes up by 1 every time the definition is saved.
  - **edit**: one change to the definition, such as adding a target, changing a quantity,
    removing a target, choosing a path, renaming or clearing.

## Scope
In: the editor's target list, saving edits, conflicts and rebasing.
Out: have amounts (PRG), what the plan does with the definition (PLAN, ALT).

## Acceptance criteria

### EDT-1: Edits show at once
Given the list editor,
When the user makes an edit,
Then the editor and the plan show the result at once, before the server answers.

### EDT-2: A save based on the current version succeeds
Given a list at version v,
When a client sends `PATCH` with `baseVersion` v,
Then the definition is stored, and the response has version v + 1.

### EDT-3: A stale save is rebased, not lost
Given a client's edit based on version v while the server is at version w > v,
When it is saved,
Then the server answers 409 with version w and its current definition, and the client
applies the same edit to that definition and saves again. It tries up to 3 times in total.
Both users' changes end up in the list (for example, two users each adding a different
target both see both targets).

### EDT-4: A save that keeps conflicting is reported
Given an edit that gets a 409 three times,
When the third one arrives,
Then the editor shows "someone else is editing this list — your last change may not have
saved", and within one poll the editor shows the server's definition.

### EDT-5: Other save failures are reported and corrected
Given an edit whose save fails for a reason other than a conflict,
When it fails,
Then the editor shows the error, and within one poll the editor shows the server's
definition.

### EDT-6: A save without a base version is rejected
Given a `PATCH` whose `baseVersion` is missing or isn't a number,
When it is sent,
Then the response is 400 `{ "error": "baseVersion required" }`, and nothing is stored.

### EDT-7: Polls don't undo edits that are being saved
Given an edit whose save is still in flight,
When a poll response arrives,
Then the definition on screen isn't replaced. Have amounts in the response are still
applied (PRG-11).

### EDT-8: Quantity 0 or "remove" takes a target off the list
Given a target on the list,
When the user sets its quantity to 0 or clicks "remove",
Then it is no longer a target. Negative quantities and text that isn't a number count as 0,
and fractions are rounded down.

### EDT-9: "Clear" asks before emptying a shared list
Given a list with targets,
When the user clicks "clear",
Then a confirmation asks whether to remove every target for everyone using the list. If the
user confirms, all targets and path choices are removed. If they cancel, nothing changes.

### EDT-10: Clearing keeps the group's have amounts
Given a list with have amounts,
When it is cleared,
Then the have amounts are kept. Adding an item again shows the group's existing amount for
it.

## Non-functional requirements
None.

## Open questions
None. EDT-10 was settled on 2026-11-03: have amounts are what the group holds, which
doesn't change when the targets do. Deleting them would silently discard other people's
records.


## Changelog
- 2026-11-03 — created (backfilled from the code and `lists.test.ts`)
- 2026-11-03 — EDT-9 adds a confirmation before clearing; EDT-10 keeps have amounts (settled as-built questions; the code still differs on EDT-9)
- 2026-11-03 — approved
- 2026-11-03 — EDT-9 fixed in the code (Phase 5b); discrepancy closed
