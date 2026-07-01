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
