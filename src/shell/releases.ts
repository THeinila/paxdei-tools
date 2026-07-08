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
    version: "1.3.0",
    date: "2026-07-08",
    title: "Is that deal real?",
    sections: [
      {
        tool: "Trade Routes",
        changes: [
          {
            kind: "new",
            text: "Routes are now ranked by profit per day, not just per trip — a giant margin on something nobody actually buys drops to the bottom where it belongs.",
          },
          {
            kind: "new",
            text: "A Sold/day column shows how briskly each item moves at the destination (estimated from stock that disappears off the market).",
          },
          {
            kind: "new",
            text: "Prices are checked against the last week: a suspiciously cheap buy or an unusually high sell gets an anomaly badge, wild swingers get a 'volatile' tag, and the expected profit falls back to the normal price so a momentary spike can't fool you.",
          },
          {
            kind: "new",
            text: "Expand a route to see 48-hour price sparklines for both ends and when the item last sold.",
          },
        ],
      },
      {
        tool: "Craft or Buy",
        changes: [
          {
            kind: "new",
            text: "The Profit tab now shows how many of each item sell per day and flags 'not selling' traps — high margins that never actually turn over.",
          },
          {
            kind: "improved",
            text: "Margins are figured against the sustainable weekly price, not a one-off spike, so the numbers hold up.",
          },
        ],
      },
      {
        changes: [
          {
            kind: "new",
            text: "The site quietly builds its own price history over time, so these week-long trends and sales estimates keep getting more accurate the longer it runs. (They appear once market data is switched on for this site.)",
          },
        ],
      },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-07-07",
    title: "Gold makes the world go round",
    sections: [
      {
        tool: "Craft or Buy",
        changes: [
          {
            kind: "new",
            text: "New tool! Pick any item and see whether it's cheaper to buy it off a market stall or craft it from parts — with every part again priced the cheapest way. One click sends the whole shopping-and-crafting plan to the planner.",
          },
          {
            kind: "new",
            text: "The Profit tab ranks what's actually worth crafting to sell in your zone, by margin, filterable by profession.",
          },
        ],
      },
      {
        tool: "Trade Routes",
        changes: [
          {
            kind: "new",
            text: "New tool! Find price gaps between zones on your server: what to buy cheap in one province and sell dear in another, with per-trip profit estimates that respect stack sizes.",
          },
        ],
      },
      {
        tool: "Crafting Planner",
        changes: [
          {
            kind: "new",
            text: "Pick your home market zone and every material in your plan shows its cheapest listing. When buying beats crafting, the row says so — apply all the suggestions with one click.",
          },
          {
            kind: "new",
            text: "Mark anything as \"buy\" and its whole ingredient tree folds into a Buy list with a gold total. Works in shared lists too — everyone sees the same plan.",
          },
        ],
      },
      {
        changes: [
          {
            kind: "new",
            text: "Market prices come from the community market data (updated hourly) and are cached gently — the tools stay fully usable when price data is unavailable. Price features are rolling out and appear once market data is switched on for this site.",
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
