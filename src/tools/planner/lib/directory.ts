/** The user's directory of crafting lists, stored in localStorage.
 *
 * The index (`paxdei-planner:lists:v1`) is a lightweight array of entries — just
 * enough to render the directory cards without loading each list's content. A
 * local list's content lives under `paxdei-planner:list:<id>`; a shared list's
 * content lives server-side (the entry only keeps its share token + cached
 * name/count). A local list that gets shared keeps its `id` and flips `kind`. */
import type { ListState } from "./useList.ts";
import { readKey, removeKey, writeKey } from "./storage.ts";

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

export const EMPTY_CONTENT: ListState = {
  name: DEFAULT_NAME,
  targets: [],
  owned: {},
  pathChoices: {},
  buys: [],
};

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

function findEntryByToken(token: string): ListEntry | undefined {
  return listEntries().find((e) => e.shareToken === token);
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

// --- Content (local lists only) ----------------------------------------------

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

export function saveContent(id: string, state: ListState): void {
  writeKey(contentKey(id), JSON.stringify(state));
}

function removeContent(id: string): void {
  removeKey(contentKey(id));
}

// --- Lifecycle ---------------------------------------------------------------

export function createLocal(name: string = DEFAULT_NAME): ListEntry {
  const ts = new Date().toISOString();
  const entry: ListEntry = {
    id: newId(),
    name,
    kind: "local",
    targetCount: 0,
    createdAt: ts,
    updatedAt: ts,
  };
  putEntry(entry);
  saveContent(entry.id, { ...EMPTY_CONTENT, name });
  return entry;
}

export function deleteEntry(id: string): void {
  const entries = listEntries().filter((e) => e.id !== id);
  saveIndex(entries);
  removeContent(id); // harmless if it was a shared (no local content) list
}

/** Duplicate a list as a new LOCAL list from a definition (targets + pathChoices,
 * never progress). The caller supplies the source definition so this works for
 * both local lists and the current snapshot of a shared one. */
export function duplicate(
  name: string,
  def: {
    targets: ListState["targets"];
    pathChoices: ListState["pathChoices"];
    buys?: ListState["buys"];
  },
): ListEntry {
  const entry = createLocal(`${name} (copy)`);
  saveContent(entry.id, {
    name: entry.name,
    targets: def.targets,
    owned: {},
    pathChoices: def.pathChoices,
    buys: def.buys ?? [],
  });
  return updateEntry(entry.id, { targetCount: def.targets.length }) ?? entry;
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
