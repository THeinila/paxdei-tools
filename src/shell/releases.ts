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
    version: "1.5.0",
    date: "2026-10-30",
    title: "Saddle up",
    sections: [
      {
        tool: "Crafting Planner",
        changes: [
          {
            kind: "new",
            text: "Saddles are in. All nine — riding, pack and courser, across every tier — can be added to a list and broken down to the last stud, hide and plank.",
          },
          {
            kind: "new",
            text: "The rest of the latest game update is in too: the Shepherd’s Hushed Canopy helms, the Ancient Sylvan Staves, and the Radiant Hart decorations — the chandelier, the trophy and the Ward of Demira. New gatherables like Radiant Hart Antlers, Blessed Sevenfold, Hemp Fiber and Pumice come with them.",
          },
          {
            kind: "improved",
            text: "Building and trophy recipes now match the current costs. Several building pieces changed price, and the hunting trophies now ask for the animal itself — a carcass, antlers or horns — on top of the materials.",
          },
          {
            kind: "fixed",
            text: "The game stopped listing some decorations twice under two different internal names, so searching for a prop no longer turns up a duplicate that cannot be crafted.",
          },
          {
            kind: "improved",
            text: "If an old list of yours shows a decoration as a code-like name instead of its proper title, that item was one of those duplicates. Search for it by name and add it again to get the craftable version.",
          },
        ],
      },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-08-23",
    title: "Faster, and easier to share",
    sections: [
      {
        tool: "Crafting Planner",
        changes: [
          {
            kind: "improved",
            text: "The site loads a lot faster — noticeably so on the first visit, on a phone, or on a slow connection. Opening a list is quicker too.",
          },
          {
            kind: "fixed",
            text: "Sharing a connection with other players — the same house, or the same mobile network — could make the planner start refusing to work for everyone. Several people can now use a list from one connection without tripping over each other.",
          },
          {
            kind: "fixed",
            text: "A count you had just changed could briefly flip back to its old number before correcting itself. It now stays where you put it.",
          },
          {
            kind: "improved",
            text: "A list left open in a background tab pauses until you come back to it, which is kinder to phone batteries and mobile data. Switching back to it refreshes straight away. While you are looking at a list, other people's changes appear within about ten seconds.",
          },
          {
            kind: "new",
            text: "Shared lists are now kept for 90 days after the last change. Anything anyone is still adding to or ticking off stays put — only genuinely forgotten lists are cleared out. Every list shows this at the bottom.",
          },
        ],
      },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-08-23",
    title: "See the plan your way",
    sections: [
      {
        tool: "Crafting Planner",
        changes: [
          {
            kind: "new",
            text: "The plan can now be arranged three ways: by tier (as before), as one flat list in the order you'd work through it, or grouped by profession so you can split the work by station. Pick with the buttons above the plan.",
          },
          {
            kind: "new",
            text: "Hide completed tidies away everything you've already got, and every section heading now folds up — so a big keep project stops being a wall of rows.",
          },
          {
            kind: "new",
            text: "Craft steps show a \"ready\" badge when nothing else in the plan is holding them up, so it's obvious what you can go and do next.",
          },
          {
            kind: "new",
            text: "Big amounts now show how many inventory stacks they come to — \"2 stacks + 40\" — which is what you actually need to know before a hauling run.",
          },
          {
            kind: "new",
            text: "Copy as Markdown puts the whole plan on your clipboard as a tick-box checklist, ready to paste into Discord.",
          },
          {
            kind: "new",
            text: "Finished with a list? Archive it instead of deleting it — it moves out of the way but stays there, and the link keeps working for everyone else.",
          },
          {
            kind: "new",
            text: "You can now start a list straight from a single item on the planner's home page, without creating and naming one first.",
          },
          {
            kind: "improved",
            text: "How you arrange the plan is remembered for each list separately, and it's yours alone — on a shared list the gatherer and the crafter can each use the view that suits them.",
          },
        ],
      },
    ],
  },
  {
    version: "1.2.1",
    date: "2026-08-22",
    title: "Caught up with the game update",
    sections: [
      {
        tool: "Crafting Planner",
        changes: [
          {
            kind: "improved",
            text: "Item and station names now match the latest game update — crafting stations follow the new naming (the starter one is just \"Alchemy Table\", the upgraded one is \"Artisan Alchemy Table\"), and the Jewelry Making skill is now called Jewelcrafting.",
          },
          {
            kind: "improved",
            text: "Pure Glass and Intense Mead Base are no longer craftable in-game, so the planner now lists them as things you gather or trade for instead of breaking them down into ingredients.",
          },
        ],
      },
    ],
  },
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
