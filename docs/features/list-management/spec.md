# List directory
Key: LST · Status: Approved · Owner: — · Updated: 2026-11-03

## Story
As a player, I want a directory of my lists where I can create, rename, duplicate, archive and
remove them, or start one from a single item, so that I can keep several plans going.

## Context
- Architecture: [architecture.md](../../architecture.md) §4 "State and data flow", "Browser storage"
- ADRs: [0007](../../adr/0007-make-every-list-server-backed.md)
- Related: [collaboration epic](../../epics/collaboration/epic.md) #2. Depends on share-link
  (SHR). Code: `PlannerHome.tsx`, `lib/directory.ts`.
- Terms:
  - **directory**: this browser's index of lists (token, cached name, target count, times,
    archived flag), kept in localStorage. It isn't shared.
  - **card**: one list's entry on the `/planner` page.

## Scope
In: the `/planner` page, creating, renaming, duplicating, archiving and removing lists, the
quick list, and promoting legacy local lists.
Out: the list editor (SHR, EDT, PRG), deleting a list on the server (lists are only swept,
RET).

## Acceptance criteria

### LST-1: The directory lists this browser's lists, newest first
Given a directory with active lists,
When `/planner` opens,
Then there is one card per active list, sorted by last update, newest first. Each card shows
its name ("Untitled" when blank), "<n> item(s)", and its age ("just now", "<m>m ago",
"<h>h ago" or "<d>d ago").

### LST-2: An empty directory invites the first list
Given a directory with no lists,
When `/planner` opens,
Then the page says "No lists yet. Create one to start planning your crafts."

### LST-3: "Create a new list" opens a blank list
Given the directory page,
When the user clicks "+ Create a new list",
Then a list named "Untitled" is created on the server, added to the directory, and opened at
its share link. While the request runs, the button reads "Working…" and is disabled.

### LST-4: A quick list starts from one item
Given the directory page's search,
When the user adds an item with quantity q,
Then a new list named after that item, holding it as its only target with quantity q, is
created and opened.

### LST-5: Renaming updates the shared name
Given a list's card, or its title in the editor,
When the user renames it and confirms (Enter, or leaving the field),
Then the card shows the new name at once, and the shared list's name changes, so
collaborators see it within one poll. A blank name becomes "Untitled". Escape on a card
cancels the rename.

### LST-6: Renaming survives a concurrent edit
Given someone else edited the list since it was loaded,
When the user renames it from its card,
Then the rename is applied on top of the other edit, retrying up to 3 times as in EDT-3, and
neither change is lost.

### LST-7: "Duplicate" copies the definition, not the progress
Given a list named N,
When the user clicks "duplicate" on its card,
Then a new list named "N (copy)" is created with the same targets and path choices, and no
progress. It appears in the directory, and the original is unchanged.

### LST-8: Archiving hides a list without reordering
Given an active list,
When the user clicks "archive",
Then its card moves to a hidden "Show archived (n)" section, and its last-update time is
unchanged. "unarchive" moves it back to the same position.

### LST-9: "Remove" takes a list out of this browser only
Given a list's card,
When the user clicks "remove" and confirms "Remove "<name>" from your lists?",
Then the card and that list's view settings are removed from this browser. The shared list is
unchanged, and its link keeps working. Cancelling the confirmation changes nothing.

### LST-10: Directory actions that fail say so
Given a create, rename or duplicate whose server request fails,
When it fails,
Then a message names the action and the error ("Could not create a list: …"), and the
directory is unchanged apart from a rename's local label.

### LST-11: Legacy local lists are promoted when opened
Given a directory entry from before 1.2.0 with local content and no token,
When it is opened,
Then it is created on the server with its name, targets, path choices and have amounts, the
entry keeps its identity and gains the token, the local content is deleted, and the browser
moves to `/planner/<token>`. If the promotion fails, the browser returns to `/planner`.

### LST-12: Corrupt directory storage doesn't break the page
Given a directory index in localStorage that is corrupt, isn't an array, or can't be read,
When `/planner` opens,
Then it shows the empty directory (LST-2) without an error.

## Non-functional requirements
None.

## Open questions
None.


## Changelog
- 2026-11-03 — created (backfilled from the code and `directory.test.ts`)
- 2026-11-03 — LST-9 renames the button to "remove", and LST-6 aligns the rename retries with EDT-3 (settled as-built questions; the code still differs)
- 2026-11-03 — approved
- 2026-11-03 — LST-9 fixed in the code (Phase 5b); discrepancy closed
- 2026-11-03 — LST-6 fixed in the code (Phase 5b); discrepancy closed
