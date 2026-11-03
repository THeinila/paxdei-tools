# 0006. Share lists by secret token with no accounts
Status: Proposed · Date: 2026-11-03
Backfilled from: README "Sharing & collaboration", `server/lists.ts`, `src/tools/planner/lib/handle.ts`

## Context
Groups want to open one link and split up the gathering and crafting. Accounts and sign-in
would be most of the work and most of the friction for a fan tool. Specs: share-link (SHR),
shared-progress (PRG).

## Decision
A list's share token is its only capability. The server generates it as 16 random bytes,
base64url-encoded (128 bits). Anyone holding `/planner/<token>` can read and write that
list. There are no accounts and no sessions.
- The **handle** is a display name kept in localStorage and sent with each progress write.
  It is attribution, not authentication: anyone can type any name.
- The first progress write on a list prompts for a handle if there isn't one.
- Because the token lives in the URL path, `Referrer-Policy` is
  `strict-origin-when-cross-origin`, outbound links are `noreferrer`, and framing is denied
  (see [0012](0012-set-security-headers-in-the-app-with-a-strict-same-origin-cs.md)).

## Consequences
- No sign-up and no personal data, and a link is all a collaborator needs.
- A leaked link can't be revoked. The only way out is a new list.
- Anyone with the link can impersonate a handle or zero out progress.
- `POST /api/lists` is unauthenticated, so database growth has to be bounded in other ways
  (see [0010](0010-sweep-shared-lists-after-a-ttl-of-write-inactivity.md) and
  [0013](0013-let-the-disk-guard-fail-open.md), plus rate limits).

## Alternatives considered
- Accounts or OAuth — rejected as out of proportion for a fan tool, and it would need
  storing personal data.
- Per-collaborator tokens or read-only links — not built. Nothing has needed them yet.
