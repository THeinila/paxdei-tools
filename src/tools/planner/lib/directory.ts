/** The user's directory of crafting lists, stored in localStorage.
 *
 * Every list is server-backed: it's created via POST /api/lists and lives at
 * `/planner/<token>`, the unguessable token being the only capability needed.
 * The index (`paxdei-planner:lists:v1`) is a lightweight, per-browser array of
 * entries — just the share token plus a cached name/count — enough to render the
 * directory cards without fetching each list.
 *
 * `kind` and the local-content helpers (`loadContent`) survive only to recognize
 * and migrate lists from the pre-share era: a legacy `kind: "local"` entry keeps
 * its content under `paxdei-planner:list:<id>` until it's opened, at which point
 * it's promoted to a shared list (see `promoteLocalEntry`). */
import type { ListState } from "./useList.ts";
import { readKey, removeKey, writeKey } from "./storage.ts";
import { VersionConflict, createList, getList, patchList } from "./api.ts";
import { getHandle } from "./handle.ts";

const INDEX_KEY = "paxdei-planner:lists:v1";
const CONTENT_PREFIX = "paxdei-planner:list:";

export const DEFAULT_NAME = "Untitled";

export interface ListEntry {
  id: string;
  name: string;
  kind: "local" | "shared";
  shareToken?: string;
  targetCount: number;
  createdAt: string;
  updatedAt: string;
}

export const EMPTY_CONTENT: ListState = { name: DEFAULT_NAME, targets: [], owned: {}, pathChoices: {} };

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `l_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

function contentKey(id: string): string {
  return `${CONTENT_PREFIX}${id}`;
}

// --- Index -------------------------------------------------------------------

export function listEntries(): ListEntry[] {
  const raw = readKey(INDEX_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as ListEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveIndex(entries: ListEntry[]): void {
  writeKey(INDEX_KEY, JSON.stringify(entries));
}

export function getEntry(id: string): ListEntry | undefined {
  return listEntries().find((e) => e.id === id);
}

export function findEntryByToken(token: string): ListEntry | undefined {
  return listEntries().find((e) => e.shareToken === token);
}

/** The URL key for a list: its share token (canonical) or, for a not-yet-migrated
 * legacy local list, its local id. Every list link is built from this. */
export function listKey(entry: ListEntry): string {
  return entry.shareToken ?? entry.id;
}

/** Resolve a `/planner/:key` route param, which may be a share token (canonical)
 * or a legacy local id / bookmark. */
export function resolveEntry(key: string): ListEntry | undefined {
  return getEntry(key) ?? findEntryByToken(key);
}

/** Insert or replace an entry, leaving the rest untouched. */
function putEntry(entry: ListEntry): void {
  const entries = listEntries();
  const i = entries.findIndex((e) => e.id === entry.id);
  if (i === -1) entries.push(entry);
  else entries[i] = entry;
  saveIndex(entries);
}

export function updateEntry(id: string, patch: Partial<Omit<ListEntry, "id">>): ListEntry | undefined {
  const entries = listEntries();
  const cur = entries.find((e) => e.id === id);
  if (!cur) return undefined;
  const next: ListEntry = { ...cur, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() };
  saveIndex(entries.map((e) => (e.id === id ? next : e)));
  return next;
}

/** Rename a list from the directory. Updates the local card label immediately,
 * then — for a shared list — pushes the new name into the server definition with
 * a version-guarded PATCH (rebasing once on a concurrent edit). A not-yet-migrated
 * legacy local list has no server copy yet; it adopts its name on promotion. */
export async function renameEntry(entry: ListEntry, name: string): Promise<void> {
  updateEntry(entry.id, { name });
  if (!entry.shareToken) return;
  try {
    const snap = await getList(entry.shareToken);
    await patchList(entry.shareToken, { ...snap.state, name }, snap.version);
  } catch (e) {
    if (e instanceof VersionConflict) {
      await patchList(entry.shareToken, { ...e.current.state, name }, e.current.version);
    } else {
      throw e;
    }
  }
}

// --- Legacy local content (read-only, for migration) -------------------------

export function loadContent(id: string): ListState {
  const raw = readKey(contentKey(id));
  if (raw) {
    try {
      return { ...EMPTY_CONTENT, ...(JSON.parse(raw) as ListState) };
    } catch {
      /* corrupt content: fall through to empty */
    }
  }
  return { ...EMPTY_CONTENT };
}

function removeContent(id: string): void {
  removeKey(contentKey(id));
}

// --- Lifecycle ---------------------------------------------------------------

/** Create a new list server-side and record it in the directory. Optionally
 * seeded (name/targets/pathChoices/owned) — used both for a blank "new list" and
 * for Duplicate. Creation is anonymous (handle attached only if one is already
 * set); the handle prompt is reserved for the first progress contribution. */
export async function createShared(seed?: {
  name?: string;
  targets?: ListState["targets"];
  pathChoices?: ListState["pathChoices"];
  owned?: Record<string, number>;
}): Promise<ListEntry> {
  const name = seed?.name?.trim() || DEFAULT_NAME;
  const targets = seed?.targets ?? [];
  const pathChoices = seed?.pathChoices ?? {};
  const created = await createList({ name, targets, pathChoices }, seed?.owned ?? {}, getHandle());
  const ts = new Date().toISOString();
  const entry: ListEntry = {
    id: newId(),
    name,
    kind: "shared",
    shareToken: created.token,
    targetCount: targets.length,
    createdAt: ts,
    updatedAt: ts,
  };
  putEntry(entry);
  return entry;
}

/** Promote a legacy local list to a shared one in place: create it server-side
 * from its stored content, flip the existing entry to carry the share token, and
 * drop the now-obsolete local content. Keeps the entry id so directory identity
 * and any `/planner/<id>` bookmark stay valid. */
export async function promoteLocalEntry(entry: ListEntry): Promise<ListEntry> {
  const content = loadContent(entry.id);
  const created = await createList(
    { name: content.name, targets: content.targets, pathChoices: content.pathChoices },
    content.owned,
    getHandle(),
  );
  const updated = updateEntry(entry.id, {
    kind: "shared",
    shareToken: created.token,
    name: content.name || DEFAULT_NAME,
    targetCount: content.targets.length,
  });
  removeContent(entry.id);
  return updated ?? entry;
}

export function deleteEntry(id: string): void {
  const entries = listEntries().filter((e) => e.id !== id);
  saveIndex(entries);
  removeContent(id); // harmless if it was already a shared (no local content) list
}

/** Duplicate a list as a new list from a definition (targets + pathChoices, never
 * progress). The caller supplies the source definition so this works from the
 * current snapshot of any list. */
export function duplicate(
  name: string,
  def: { targets: ListState["targets"]; pathChoices: ListState["pathChoices"] },
): Promise<ListEntry> {
  return createShared({ name: `${name} (copy)`, targets: def.targets, pathChoices: def.pathChoices });
}

/** Adopt a share token: return the existing entry for it, or create one. Used
 * when opening a `?list=<token>` link so it lands in the directory. */
export function findOrCreateForToken(token: string, seedName?: string, seedCount = 0): ListEntry {
  const existing = findEntryByToken(token);
  if (existing) return existing;
  const ts = new Date().toISOString();
  const entry: ListEntry = {
    id: newId(),
    name: seedName?.trim() || "Shared list",
    kind: "shared",
    shareToken: token,
    targetCount: seedCount,
    createdAt: ts,
    updatedAt: ts,
  };
  putEntry(entry);
  return entry;
}
