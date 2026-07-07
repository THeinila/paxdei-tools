/** Wire types for the sharing API, used by both the client fetch wrappers
 * (src/tools/planner/lib/api.ts) and the server routes (server/lists.ts). */

/** The collaboratively-editable definition of a list. "Owned" stock is NOT here
 * — it lives in the per-item progress map. `name` is the shared list title so
 * every collaborator sees the same label. */
export interface ListStateDef {
  name: string;
  targets: { itemId: string; quantity: number }[];
  pathChoices: Record<string, string>;
  /** Items to buy instead of craft/gather (prunes their sub-trees). Shared like
   * pathChoices — collaborators must see the same plan shape. Absent in lists
   * stored before this field existed; treat as []. */
  buys: string[];
}

/** One item's collaborative "have" entry, attributed to the last toucher. */
export interface ProgressEntry {
  itemId: string;
  qty: number;
  byHandle: string | null;
  updatedAt: string;
}
