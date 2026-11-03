# Item search
Key: SRCH · Status: Approved · Owner: — · Updated: 2026-11-03

## Story
As a player, I want to search the item catalogue by name and add an item with a quantity, so
that I can build a list of what I want to make.

## Context
- Architecture: [architecture.md](../../architecture.md) §2 (SPA), §6 "Fast first load"
- ADRs: [0004](../../adr/0004-lazy-load-the-dataset-as-its-own-hashed-chunk.md) (the catalogue is a lazy chunk)
- Related: [planner epic](../../epics/planner/epic.md) #8. Results are added to a server-backed
  list (collaboration/share-link). The directory page reuses the search to start a list (LST).
  Code: `components/Search.tsx`, `searchItems` in `lib/data.ts`.
- Terms:
  - **catalogue**: every item in the dataset, craftable and raw.
  - **query**: the search text with surrounding spaces removed.

## Scope
In: matching, ranking, the results dropdown, quantities, adding to the list, and loading the
catalogue.
Out: filters by profession or category (roadmap FLT), and what adding does on the directory
page (LST).

## Acceptance criteria

### SRCH-1: Queries under 2 characters show nothing
Given the search box,
When the query is empty or 1 character long,
Then no results and no "no match" message are shown.

### SRCH-2: Results match names, case-insensitively
Given a query of at least 2 characters,
When the results are shown,
Then every result's name contains the query, ignoring case. With 40 or fewer matches, every
matching catalogue item is shown.

### SRCH-3: Results are ranked and capped
Given more matches than fit,
When the results are shown,
Then items whose name starts with the query come first. Within each group, a match nearer
the start of the name ranks higher, then a shorter name. At most 40 results are shown.

### SRCH-4: Each result describes the item
Given a result,
When it is shown,
Then it shows the item's icon, name and rarity tag (TIP-6), and a category label: "Raw
material" for raw items, otherwise the category's readable name (for example
"Building pieces", never an internal ID such as "buildingpieces"). An item with no category
shows "Item".

### SRCH-5: Each result has its own quantity, at least 1
Given a result,
When it is first shown,
Then its quantity field reads 1. Entering 0, a negative number or text that isn't a number
sets it to 1. A fraction is rounded down.

### SRCH-6: Adding puts the quantity on the list
Given a result with quantity q,
When the user clicks the result row or its "+" button,
Then the item is added to the list with quantity q. If it is already a target, its quantity
increases by q.

### SRCH-7: No match says so
Given a query of at least 2 characters,
When no item matches,
Then the dropdown reads "No items match “<query>”."

### SRCH-8: The dropdown closes on Escape or an outside click
Given an open results dropdown,
When the user presses Escape or presses the mouse outside the search,
Then the dropdown closes. Focusing or clicking the search box opens it again.

### SRCH-9: Search takes focus only in the list editor
Given a page with the search box,
When the page opens,
Then the search box has focus in the list editor, and doesn't have focus on the directory
page.

## Non-functional requirements

### SRCH-N1: The landing page never downloads the catalogue
Given a production build,
When the landing page (`/`) or What's New loads,
Then the catalogue chunk isn't requested. It is requested only when a planner route opens
([ADR 0004](../../adr/0004-lazy-load-the-dataset-as-its-own-hashed-chunk.md),
[CAPACITY.md](../../CAPACITY.md) "Cost per request").

## Open questions
None. SRCH-6 was settled on 2026-11-03: the query and the dropdown stay open after an add,
so that several related items can be added in a row.

## Discrepancies with the code
- SRCH-4: `Search.tsx` shows `mainCategoryId` as is ("buildingpieces", "materials"), shows
  "raw material" in lower case, and shows nothing for items without a category. Fix pending.
  It needs a label table for the 13 category IDs in the dataset.

## Changelog
- 2026-11-03 — created (backfilled from the code; no existing tests)
- 2026-11-03 — SRCH-4 now requires readable category labels (settled as-built question; the code still differs)
- 2026-11-03 — approved
