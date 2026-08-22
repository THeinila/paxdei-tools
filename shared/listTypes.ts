/** Wire types for the sharing API, used by both the client fetch wrappers
 * (src/tools/planner/lib/api.ts) and the server routes (server/lists.ts). */

/** How long a shared list survives without a write before the retention sweep
 * deletes it (server/retention.ts). Shared so the UI can tell people the real
 * number rather than a hardcoded guess that drifts. An operator overriding
 * LIST_TTL_DAYS should change this too, or the app will misstate the policy. */
export const LIST_TTL_DAYS = 90;

/** The collaboratively-editable definition of a list. "Owned" stock is NOT here
 * — it lives in the per-item progress map. `name` is the shared list title so
 * every collaborator sees the same label. */
export interface ListStateDef {
  name: string;
  targets: { itemId: string; quantity: number }[];
  pathChoices: Record<string, string>;
}

/** One item's collaborative "have" entry, attributed to the last toucher. */
export interface ProgressEntry {
  itemId: string;
  qty: number;
  byHandle: string | null;
  updatedAt: string;
}
