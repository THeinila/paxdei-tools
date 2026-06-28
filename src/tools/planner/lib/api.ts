/** Typed fetch wrappers for the sharing backend. Same-origin (/api is proxied
 * to the backend in dev, served by it in prod). 409 conflicts on PATCH are
 * surfaced distinctly so callers can rebase on the returned current state. */
import type { Target } from "../engine/planner.ts";

export interface ListStateDef {
  name: string;
  targets: Target[];
  pathChoices: Record<string, string>;
}

export interface ProgressEntry {
  itemId: string;
  qty: number;
  byHandle: string | null;
  updatedAt: string;
}

export interface ListSnapshot {
  version: number;
  state: ListStateDef;
  progress: ProgressEntry[];
  updatedAt: string;
}

export interface CreatedList extends ListSnapshot {
  token: string;
}

/** Thrown by patchList when the server rejects a stale baseVersion (409). The
 * caller can rebase its edit on `current` and retry. */
export class VersionConflict extends Error {
  constructor(public current: ListSnapshot) {
    super("version conflict");
    this.name = "VersionConflict";
  }
}

async function asJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

export async function createList(
  state: ListStateDef,
  owned: Record<string, number>,
  handle: string | null,
): Promise<CreatedList> {
  const res = await fetch("/api/lists", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, owned, handle }),
  });
  if (!res.ok) throw new Error(`createList failed: ${res.status}`);
  return (await res.json()) as CreatedList;
}

export async function getList(token: string): Promise<ListSnapshot> {
  const res = await fetch(`/api/lists/${encodeURIComponent(token)}`);
  if (res.status === 404) throw new Error("not found");
  if (!res.ok) throw new Error(`getList failed: ${res.status}`);
  return (await res.json()) as ListSnapshot;
}

export async function patchList(
  token: string,
  state: ListStateDef,
  baseVersion: number,
): Promise<ListSnapshot> {
  const res = await fetch(`/api/lists/${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, baseVersion }),
  });
  if (res.status === 409) {
    throw new VersionConflict((await asJson(res)) as ListSnapshot);
  }
  if (!res.ok) throw new Error(`patchList failed: ${res.status}`);
  return (await res.json()) as ListSnapshot;
}

export async function postProgress(
  token: string,
  itemId: string,
  delta: number,
  handle: string | null,
): Promise<ProgressEntry> {
  const res = await fetch(`/api/lists/${encodeURIComponent(token)}/progress`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId, delta, handle }),
  });
  if (!res.ok) throw new Error(`postProgress failed: ${res.status}`);
  return (await res.json()) as ProgressEntry;
}
