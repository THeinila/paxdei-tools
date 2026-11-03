# Epic: Lists and collaboration
Status: Draft · Updated: 2026-11-03

## Goal
Every list lives on the server behind an unguessable link
([ADR 0007](../../adr/0007-make-every-list-server-backed.md)). A group can open one link,
divide the work, and see each other's progress without losing anyone's updates. It worked
if two people checking items off at the same time both see the right total within one
poll, and a list nobody touches for 90 days is cleaned up.

**Backfill.** Every feature here is already built (Crafting Planner 1.5.1). The order
records dependencies, not delivery. Draft ACs come from `server/*.test.ts`,
`progressMerge.test.ts`, `directory.test.ts` and the code. `list-management` moved here
from the planner epic: it creates lists through the share endpoint, so keeping it in planner
made the two epics depend on each other.

## Features

### 1. share-link · Key: SHR
Story: As a player, I want every list to have one link I can copy and send, so that anyone in my group can open the same list.
Depends on: —
Draft ACs:
- SHR-1: Creating a list returns a new 128-bit token, and the list opens at `/planner/<token>`. That URL is its share link.
- SHR-2: "Copy link" puts `<origin>/planner/<token>` on the clipboard and shows "Link copied!" for 2 seconds.
- SHR-3: Opening a share link for a list this browser hasn't seen adds it to the directory and opens it.
- SHR-4: A legacy `?list=<token>` link redirects to `/planner/<token>`.
- SHR-5: An unknown token returns 404 from the API. A route parameter that is neither a known list nor token-shaped goes back to `/planner`.
- SHR-6: The server stores only a size-bounded definition. Malformed targets are dropped, and the name is cut to 80 characters (500 targets, 1,000 path choices, 128-character IDs).

### 2. list-management · Key: LST
Story: As a player, I want a directory of my lists where I can create, rename, duplicate, archive and remove them, or start one from a single item, so that I can keep several plans going.
Depends on: share-link
Draft ACs:
- LST-1: The directory shows this browser's lists, most recently updated first, each with its name ("Untitled" if blank), item count and relative age.
- LST-2: "Create a new list" makes a server-backed list and opens it. Searching on the directory page and picking an item creates a list named after it, holding that item.
- LST-3: Renaming a list from its card, or from the editor's title, updates the shared name, so collaborators see it too.
- LST-4: "Duplicate" creates a new list with the original's targets and path choices, but not its progress.
- LST-5: Archiving moves a list to a collapsible "archived" section without changing its order. Unarchiving restores it.
- LST-6: "Delete" asks for confirmation, then removes the list from this browser's directory only. The shared list is unchanged.
- LST-7: A legacy local list is promoted to a server list, with its content, the first time it's opened, and its URL changes to the token.

### 3. shared-progress · Key: PRG
Story: As a member of a group, I want to record how many of an item I've got and see what others have recorded, with names, so that we can split the gathering and crafting without duplicating work.
Depends on: share-link
Draft ACs:
- PRG-1: Setting a "have" amount on a row sends the difference as an additive delta. Two concurrent +10 deltas on one item total 20.
- PRG-2: The stored amount never goes below 0, and a non-numeric delta is rejected with 400.
- PRG-3: The shared "have" amounts act as owned stock in the plan for everyone with the link.
- PRG-4: The first progress write in a browser asks for a display name. Each row shows the name of whoever last set it, and the name can be changed later.
- PRG-5: Other people's changes appear within one poll interval, and a poll never rolls back a write the server has acknowledged.
- PRG-6: If a progress write fails, the row goes back to its previous value and an error is shown.
- PRG-N1: Clients poll every 10 s plus up to 2 s of random jitter, never overlap polls, pause while the tab is hidden, and poll at once when it becomes visible ([CAPACITY.md](../../CAPACITY.md), "The three ceilings").

### 4. definition-edits · Key: EDT
Story: As a member of a group, I want to change the targets, quantities and path choices at the same time as someone else, so that neither of us overwrites the other's edit.
Depends on: share-link
Draft ACs:
- EDT-1: Adding, changing or removing a target, choosing a path, renaming or clearing is applied on screen at once, then saved.
- EDT-2: A save based on the current version succeeds and increments the version.
- EDT-3: A save based on a stale version gets a 409 with the current state. The client re-applies its edit to that state and retries, up to 3 times.
- EDT-4: Setting a target's quantity to 0, or pressing "remove", takes it off the list. "Clear" removes every target and path choice.

### 5. list-retention · Key: RET
Story: As the operator, I want lists nobody has changed for 90 days to be deleted, so that unauthenticated list creation can't fill the disk.
Depends on: shared-progress, definition-edits
Draft ACs:
- RET-1: Lists with no write activity for `LIST_TTL_DAYS` (default 90) are deleted at server start and daily after that, along with their progress.
- RET-2: Progress writes and definition edits both count as activity. Reading or polling a list does not.
- RET-3: `LIST_TTL_DAYS=0` turns the sweep off. Blank or invalid values fall back to 90.
- RET-4: Upgrading a database from before activity tracking backfills each list's activity time from its latest edit or progress write. Running the migration again changes nothing.
- RET-5: The list editor's footer states the retention window in days.
- RET-6: Each sweep that deletes lists adds the count to a daily metric. A sweep that deletes nothing records no row.

## Out of scope
- Accounts, revocable links and per-collaborator permissions ([ADR 0006](../../adr/0006-share-lists-by-secret-token-with-no-accounts.md)).
- Claiming rows ("I've got the ore"): roadmap.
- Rate limits and the disk guard on list creation: the platform epic (abuse-limits).

## Open questions
None. All five specs were approved on 2026-11-03, and their as-built questions were settled
in the specs. Keeping have amounts on clear (EDT-10), non-idempotent deltas (PRG) and the
footer's constant (RET-9) stay as they are. Six behaviours are specified differently from what
the code does today, and are fixed later:

| AC | Spec says | Code does |
|---|---|---|
| [SHR-5](../../features/share-link/spec.md) | A failed "Copy link" shows "Copy failed" | Fails silently |
| [SHR-8](../../features/share-link/spec.md) | A missing or swept list says it no longer exists, and offers removal | Shows an empty, editable list with "⚠ not found" |
| [LST-6](../../features/list-management/spec.md) | Directory rename retries a conflict up to 3 times | Retries once |
| [LST-9](../../features/list-management/spec.md) | The card's button reads "remove" | Reads "delete" |
| [PRG-7](../../features/shared-progress/spec.md) | Declining the name prompt still saves, unattributed, and doesn't ask again on this page | Drops the write, and asks again on every keystroke |
| [EDT-9](../../features/definition-edits/spec.md) | "Clear" asks for confirmation | Clears for everyone at once |
