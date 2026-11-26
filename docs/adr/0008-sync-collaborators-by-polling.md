# 0008. Sync collaborators by polling
Status: Accepted · Date: 2026-11-03
Backfilled from: `src/tools/planner/lib/useList.ts`, CHANGELOG 1.4.0, `docs/CAPACITY.md` "The three ceilings"

## Context
Collaborators need to see each other's progress "near-real-time". Each open tab costs the
host for as long as it's open, and the host has about 125 ms of CPU per second. Spec:
shared-progress (PRG); the interval becomes an NFR there.

## Decision
Clients poll `GET /api/lists/:token` for a full snapshot.
- `POLL_MS = 10_000` plus up to `POLL_JITTER_MS = 2000` of random delay. It's a recursive
  timeout, not `setInterval`, so polls never overlap.
- Polling pauses while the tab is hidden, and a catch-up poll runs when it becomes visible.
- Local edits apply optimistically, so your own changes feel instant; the poll is only how
  you see other people's.
- Progress writes are fenced per item on a monotonic poll sequence number. A snapshot may
  replace an item's value only if that poll was issued after the write was acknowledged
  (`progressMerge.ts`).

## Consequences
- Plain stateless HTTP: no connection state on the server, and it works through any proxy.
- About 0.25 ms of CPU per second per tab, so roughly 60 comfortable concurrent tabs. The 1.4.0
  move from 3 s to 10 s roughly tripled that ceiling.
- Up to about 12 s before you see someone else's change, and stale versions are held longer,
  so definition conflicts (409s) are more common. That's why `MAX_REBASE_ATTEMPTS = 3`.
- The full snapshot grows with the list. There is no delta or `If-None-Match` polling yet.

## Alternatives considered
- WebSockets or SSE — not chosen (the reason isn't recorded; inferred). They hold a
  connection per tab on a 1 GB, 1/8-OCPU box, and need proxy support and reconnect logic,
  for a latency gain that a gathering checklist doesn't need.
- A 3-second poll — the original value, replaced in 1.4.0 because of its cost per tab.
