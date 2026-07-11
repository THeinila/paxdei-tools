/** User-facing "What's New" — the source of truth for the What's New page.
 *
 * This is deliberately SEPARATE from CHANGELOG.md (the technical record). Write these
 * in plain language, in terms of what a player can now do — no version internals, no
 * jargon. Group each change as "new", "improved", or "fixed", per tool. Add an entry
 * here whenever you cut a release (see RELEASING.md); keep it in sync with CHANGELOG.md
 * but don't copy the technical wording. */

export type ChangeKind = "new" | "improved" | "fixed";

export interface ReleaseSection {
  /** Tool display name, e.g. "Crafting Planner". Omit for suite-wide items. */
  tool?: string;
  changes: { kind: ChangeKind; text: string }[];
}

export interface Release {
  /** Matches the toolkit version, but shown subtly — users care about what & when. */
  version: string;
  /** ISO date (YYYY-MM-DD); rendered as a friendly date. */
  date: string;
  /** Optional short headline for the release. */
  title?: string;
  sections: ReleaseSection[];
}

/** Newest release first. */
export const releases: Release[] = [
  {
    version: "1.2.0",
    date: "2026-07-11",
    title: "One link for every list",
    sections: [
      {
        tool: "Crafting Planner",
        changes: [
          {
            kind: "improved",
            text: "Every list now has a single link that works for everyone — the address bar of a list you're viewing is exactly the link you share. No more separate \"share\" step or two different URLs.",
          },
          {
            kind: "fixed",
            text: "Opening a shared link no longer sometimes lands on the home page: after an update the app now refreshes itself instead of running an old cached version.",
          },
          {
            kind: "improved",
            text: "Your existing lists are carried over automatically the first time you open them — nothing to re-create.",
          },
        ],
      },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-07-07",
    title: "The hunt is on",
    sections: [
      {
        tool: "Crafting Planner",
        changes: [
          {
            kind: "new",
            text: "The archery & hunting update is in: plan recurve bows, arrows, bow strings, archery targets and hunting trophies — 30 new items with their recipes and icons.",
          },
          {
            kind: "fixed",
            text: "Quickly checking off two materials in a shared list no longer makes the first edit snap back.",
          },
          {
            kind: "fixed",
            text: "Going back and forward between two shared lists now shows the right list instead of the previous one's contents.",
          },
          {
            kind: "fixed",
            text: "Searching for something that doesn't exist now shows a proper \"no items match\" message instead of a bare line of text.",
          },
          {
            kind: "improved",
            text: "Item quantities are kept to sensible whole numbers everywhere — no more accidental fractional or zero targets.",
          },
        ],
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-07-01",
    title: "First release",
    sections: [
      {
        tool: "Crafting Planner",
        changes: [
          {
            kind: "new",
            text: "Search the item catalog and build a crafting list with the quantities you want.",
          },
          {
            kind: "new",
            text: "Get one flattened plan of every raw material to gather and everything to craft, totalled across your whole list.",
          },
          {
            kind: "new",
            text: "See crafts laid out in tiers by profession, so you know what to make first.",
          },
          {
            kind: "new",
            text: "Enter what you already have and the plan subtracts it — whole branches disappear when you're already stocked.",
          },
          {
            kind: "new",
            text: "Choose between alternative recipes when a material can be made more than one way.",
          },
          {
            kind: "new",
            text: "Share a link so your group can split the gathering and crafting and check things off together in near-real-time.",
          },
          {
            kind: "new",
            text: "Works comfortably on mobile with a two-line layout.",
          },
        ],
      },
    ],
  },
];
