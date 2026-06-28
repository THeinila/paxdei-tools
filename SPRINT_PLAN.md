# Sprint Plan & Backlog

Forward-looking backlog for Pax Dei Tools (Crafting Planner). The single-user MVP (search →
tiered plan → owned-stock subtraction, fully self-standing) is done. This doc
tracks what's next. Grouped by priority; checkboxes are unstarted.

---

## ✅ Done — Sharing & Collaboration (completes the MVP)

Shipped per the locked design (see `../.claude/plans/`): lightweight handle (no
real auth), near-real-time polling, local **Node + SQLite** backend. A group can
open one link and divide the gathering/crafting. Run with `npm run dev:all`.

- [x] **Backend skeleton** — Hono + better-sqlite3 (`server/`). Tables `lists`
      (id, share_token, version, state JSON, timestamps) and `progress`
      (list_id, item_id, qty, by_handle, updated_at). `kind` was dropped — owned
      merged into progress, so an item's kind is derivable from `isRaw`.
- [x] **Create / load list** — `POST /lists` returns a secret share token;
      `GET /lists/:token` returns list + progress (the poll endpoint). Targets and
      pathChoices persist server-side; owned seeds the shared progress map.
- [x] **Handle** — prompt for a display name, store in localStorage, attach to
      every progress write. Rename supported.
- [x] **Progress check-off** — a per-item "have" count (partial quantities),
      attributed to the editing handle, fed into the engine as owned stock.
- [x] **Polling sync** — clients `GET` every ~3s and merge. **Concurrency:**
      progress is **atomic additive deltas** (no lost updates when two gather at
      once — verified to sum); definition edits are **version-guarded** (409 +
      rebase). Rows show who last touched them.
- [x] **Share UX** — "Share" button creates the list + copies the link
      (`?list=<token>`); opening a link hydrates and starts polling.
- [x] **E2E check** — verified two sessions converge: one gathers, the other sees
      it after a poll with attribution; concurrent +10/+10 → 20.

---

## High priority — Data accuracy & polish

- [ ] **Crafting station / tier names.** The master `recipes.d.json` has the
      profession but *not* the station. Fetch per-recipe `recipe_<id>.d.json`
      (has `crafters`) at build time to add station + tier to each recipe, and
      show it on craft rows ("Barrel Bottler", "Tier 2 Carpenter's Bench").
- [ ] **UI error boundary.** A mid-edit HMR crash showed there's no boundary —
      wrap the plan view so a bad state shows a friendly message, not a blank page.
- [ ] **Data refresh + versioning.** A dated/versioned dataset and a one-command
      `npm run data` refresh for when the game patches; surface the data date in
      the footer.
- [ ] **Bundle size.** Dataset is inlined into JS (~1.6 MB / 137 KB gz). Move it
      to a same-origin `public/dataset.json` fetched at startup (with a loading
      state) to shrink and speed the initial parse — stays self-standing.

---

## Medium — UX improvements

- [ ] **Mobile layout pass** — rows wrap awkwardly on narrow screens.
- [ ] **Collapsible tiers / sections** and a per-tier summary (e.g. counts).
- [ ] **Copy / export** the plan (Markdown or plain text) to paste into Discord.
- [ ] **Search filters** — by profession/category, and a toggle to hide building
      pieces (they dominate the catalog).
- [ ] **Item detail on hover/click** — recipe preview, tier, categories.
- [ ] **Optional "by profession" view toggle** — the previous grouping was useful
      for splitting work by station; offer it as an alternate to the tier view.
- [ ] **Make the "where?" link optional / configurable** for users who want a
      strictly air-gapped app (it's the only outbound link, click-only today).

---

## Backlog — Feature ideas

- [ ] **"I'll buy/trade this" toggle** — treat a chosen intermediate as supplied,
      like owned-stock but semantically distinct, to prune its sub-tree.
- [ ] **Stack-size awareness** — show how many inventory stacks a gather total is.
- [ ] **Time / XP estimates** per craft (the data has `baseDuration`, XP fields).
- [ ] **Multiple saved lists** locally (and named lists once sharing lands).
- [ ] **Assignments** — in a shared list, claim rows ("I've got the ore").
- [ ] **Per-material biome surfacing** in-app (scrape source/biome text), reducing
      reliance on the external map link.

---

## Engineering hygiene

- [ ] CI: run `npm test` + `tsc --noEmit` on push.
- [ ] A couple of component/integration tests for the plan view.
- [ ] Deploy target (static frontend + small API) — Fly.io / a cheap VPS.
