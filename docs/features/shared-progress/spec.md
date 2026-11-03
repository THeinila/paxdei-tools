# Shared progress
Key: PRG · Status: Approved · Owner: — · Updated: 2026-11-03

## Story
As a member of a group, I want to record how many of an item I've got and see what others
have recorded, with names, so that we can split the gathering and crafting without
duplicating work.

## Context
- Architecture: [architecture.md](../../architecture.md) §4 "State and data flow", "Auth"
- ADRs: [0008](../../adr/0008-sync-collaborators-by-polling.md) (polling), [0009](../../adr/0009-use-additive-deltas-for-progress-and-version-guards-for-defi.md) (additive deltas), [0006](../../adr/0006-share-lists-by-secret-token-with-no-accounts.md) (the handle is attribution only)
- Related: [collaboration epic](../../epics/collaboration/epic.md) #3. Depends on share-link
  (SHR). The have amounts are owned stock in the plan (OWN). Code: `POST /lists/:token/progress`
  in `server/lists.ts`, `setOwned` and polling in `lib/useList.ts`, `lib/progressMerge.ts`,
  `lib/handle.ts`.
- Terms:
  - **have amount**: the group's shared count of an item on a list.
  - **delta**: the change a client sends (new amount − amount shown).
  - **handle**: a display name kept in this browser.
  - **acknowledged**: the server has answered a write successfully.

## Scope
In: writing have amounts, merging them on the server, attribution, polling, and keeping
acknowledged writes on screen.
Out: definition edits (EDT), retention (RET), claiming rows (roadmap ASG).

## Acceptance criteria

### PRG-1: Concurrent deltas add up
Given an item with have amount 0,
When two clients each send a delta of +10 for it at the same time,
Then the stored amount is 20.

### PRG-2: The stored amount stays within bounds
Given an item with have amount a,
When a delta d is applied,
Then the stored amount is min(10,000,000, max(0, a + trunc(d))).

### PRG-3: Malformed progress writes are rejected
Given a progress request whose `itemId` isn't a string of at most 128 characters, or whose
`delta` isn't a finite number,
When it is sent,
Then the response is 400, and nothing is stored.

### PRG-4: Entering a have amount writes the difference
Given a row showing have amount a,
When the user enters b,
Then the client shows b at once and sends delta b − a. When b = a, nothing is sent. Several
quick edits each send the difference from the previous value (5 then 8 sends +5, then +3).

### PRG-5: Have amounts are the plan's owned stock
Given a list with have amounts,
When anyone with the link views the plan,
Then those amounts are applied as owned stock (OWN-2 to OWN-7). Items with an amount of 0
don't count.

### PRG-6: The first write asks for a display name
Given a browser with no handle,
When the user first enters a have amount on a shared list,
Then a prompt asks for a display name. If one is entered, it is stored in this browser and
sent with the write.

### PRG-7: Declining the name still saves the write
Given a browser with no handle,
When the user dismisses the name prompt or leaves it blank,
Then the write is still saved, with no attribution, and the browser isn't asked again until
the page is reloaded or the user clicks "set your name".

### PRG-8: Rows show who last set them
Given an item whose have amount is above 0 and was last written with handle H,
When its row is shown,
Then the row shows "· H", and hovering over it shows the time of that write. Rows with no
handle, or an amount of 0, show no name.

### PRG-9: The handle can be changed
Given the list editor,
When the user clicks "set your name" (or "rename" once a handle is set) and enters a name,
Then later writes from this browser use the new handle, and the header shows it. Earlier rows
keep the name they were written with.

### PRG-10: Others' changes appear within one poll
Given two clients viewing the same list,
When one of them changes a have amount,
Then the other shows the new amount and attribution within one poll interval (PRG-N1).

### PRG-11: A poll never rolls back an acknowledged write
Given a client whose write for item X has been acknowledged,
When a poll response arrives that was requested before the acknowledgement,
Then X keeps the acknowledged value, while the other items in that response are applied. A
poll requested after the acknowledgement may replace X, including with someone else's newer
value.

### PRG-12: A write in flight isn't overwritten
Given a client with a write for item X that the server hasn't answered yet,
When any poll response arrives,
Then X keeps the value the user entered. If that response doesn't mention X, X is still
shown.

### PRG-13: A failed write is undone and reported
Given a write for item X that fails (network error or an error status),
When the failure arrives,
Then X goes back to the value it had before the edit, and the editor shows an error.

### PRG-14: Out-of-order poll responses are ignored
Given two polls where the later-requested one is answered first,
When the earlier one's response arrives,
Then it is discarded.

## Non-functional requirements

### PRG-N1: Polling is cheap for the host
Each open list polls every 10 s plus up to 2 s of random jitter. A tab never has two polls in
flight. Polling stops while the tab is hidden, and one poll is sent as soon as the tab becomes
visible again ([CAPACITY.md](../../CAPACITY.md) "The three ceilings",
[ADR 0008](../../adr/0008-sync-collaborators-by-polling.md)).

## Open questions
None. Settled on 2026-11-03: deltas stay non-idempotent
([ADR 0009](../../adr/0009-use-additive-deltas-for-progress-and-version-guards-for-defi.md)).
The client never retries a failed write by itself (PRG-13), so a write is only counted twice
when a response is lost after the server committed it and the user then re-enters the same
amount. The next poll shows the doubled total, and the user can correct it.

## Changelog
- 2026-11-03 — created (backfilled from the code, `lists.test.ts` and `progressMerge.test.ts`)
- 2026-11-03 — PRG-7 specifies saving without a name (settled as-built question; the code still differs)
- 2026-11-03 — approved
- 2026-11-03 — PRG-7 fixed in the code (Phase 5b); discrepancy closed
