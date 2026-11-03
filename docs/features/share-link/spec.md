# Share link
Key: SHR · Status: Approved · Owner: — · Updated: 2026-11-03

## Story
As a player, I want every list to have one link I can copy and send, so that anyone in my
group can open the same list.

## Context
- Architecture: [architecture.md](../../architecture.md) §4 "State and data flow", "Auth"
- ADRs: [0006](../../adr/0006-share-lists-by-secret-token-with-no-accounts.md) (the token is the only capability), [0007](../../adr/0007-make-every-list-server-backed.md) (every list is server-backed), [0005](../../adr/0005-serve-the-spa-and-api-from-one-hono-and-sqlite-process.md)
- Related: [collaboration epic](../../epics/collaboration/epic.md) #1. Code: `server/lists.ts`
  (`POST` and `GET /api/lists`), `Planner.tsx` (resolving the route, "Copy link"),
  `PlannerHome.tsx` (`?list=` redirect).
- Terms:
  - **token**: the list's secret, 16 random bytes in base64url (22 characters).
  - **share link**: `<origin>/planner/<token>`.
  - **definition**: a list's name, targets and path choices.

## Scope
In: creating a list on the server, its link, opening a link, legacy links, and the bounds on
what the server stores.
Out: the directory (LST), progress (PRG), editing the definition (EDT), rate limits and the
disk guard on creation (ABU).

## Acceptance criteria

### SHR-1: Creating a list returns a new token
Given any client,
When it sends `POST /api/lists` with a definition,
Then the response is 201 with a new 22-character base64url token, version 0, the stored
definition and the progress map. Two creations never return the same token.

### SHR-2: Creation can seed progress
Given a `POST /api/lists` body with `owned` amounts and a `handle`,
When the list is created,
Then each owned amount above 0 is stored as that item's progress, attributed to the handle.
Amounts of 0 or less, and amounts that aren't numbers, are left out.

### SHR-3: A list opens at its share link
Given a list with token T,
When anyone opens `/planner/T`,
Then the list editor shows that list's definition and progress.

### SHR-4: "Copy link" copies the share link
Given the list editor for token T,
When the user clicks "Copy link" and the clipboard accepts the write,
Then the clipboard holds `<origin>/planner/T`, and the button reads "Link copied!" for 2
seconds.

### SHR-5: A failed copy says so
Given the browser rejects the clipboard write,
When the user clicks "Copy link",
Then the button reads "Copy failed" for 2 seconds, then "Copy link" again.

### SHR-6: Opening someone else's link adds it to my directory
Given a browser whose directory has no entry for token T,
When it opens `/planner/T`,
Then a directory entry for T is added. Its name is "Shared list" until the list loads, then
the list's name.

### SHR-7: Legacy links redirect
Given a legacy share link `/planner?list=T`,
When it is opened,
Then the browser is redirected to `/planner/T`, replacing the history entry.

### SHR-8: A list that doesn't exist says so
Given a token-shaped route `/planner/T` for which the server returns 404 (never created, or
swept by retention),
When it is opened,
Then the page says "This list doesn't exist any more", explains that lists are deleted after
90 days with no changes, offers to remove it from this browser's lists, and shows no editor.

### SHR-9: A route that is neither a list nor a token returns to the directory
Given a `/planner/<x>` route where x is neither a known directory entry nor 20–24 base64url
characters,
When it is opened,
Then the browser is redirected to `/planner`.

### SHR-10: Unknown tokens are 404 on every route
Given a token with no list,
When a client calls `GET`, `PATCH` or `POST …/progress` on `/api/lists/<token>`,
Then the response is 404 `{ "error": "not found" }`.

### SHR-11: Stored definitions are sanitised
Given a create or edit request with a malformed or oversized definition,
When it is stored,
Then:
- targets whose item ID isn't a string of at most 128 characters, or whose quantity isn't a
  finite number, are dropped;
- quantities are rounded down, and those outside 1–10,000,000 are dropped;
- at most 500 targets and 1,000 path choices are kept;
- the name is cut to 80 characters, and defaults to "" when it's missing.

## Non-functional requirements

### SHR-N1: Tokens can't be guessed
Tokens carry 128 bits from a cryptographic random source, and share links are the only thing
that grants access to a list
([ADR 0006](../../adr/0006-share-lists-by-secret-token-with-no-accounts.md)).

## Open questions
None.

## Discrepancies with the code
- SHR-8: a 404 shows the editor with an empty list and the warning "⚠ not found". The user
  can add items to it, and every edit then fails. Fix pending.

## Changelog
- 2026-11-03 — created (backfilled from the code and `lists.test.ts`)
- 2026-11-03 — SHR-5 and SHR-8 specify the intended behaviour (settled as-built questions; the code still differs)
- 2026-11-03 — approved
- 2026-11-03 — SHR-5 fixed in the code (Phase 5b); discrepancy closed
