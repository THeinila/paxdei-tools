/** Per-browser view preferences for the plan, keyed by list token.
 *
 * Deliberately local, not part of the shared list definition: two people working
 * the same list want different views of it — the gatherer wants the flat gather
 * list, the crafter wants tiers. Keeping it out of the definition also means no
 * version-guarded PATCH (and no 409) just to switch a view.
 *
 * One key holding a `token -> prefs` map, mirroring the directory index in
 * `directory.ts`: one read, one write, and easy to prune. */
import { DEFAULT_PREFS, PRESETS, type PresetId, type ViewPrefs } from "../engine/view.ts";
import { readKey, writeKey } from "./storage.ts";

const KEY = "paxdei-planner:prefs:v1";
/** Caps, so a browser that plans many lists can't grow this without bound. */
const MAX_ENTRIES = 50;
const MAX_COLLAPSED = 64;

type PrefsFile = Record<string, ViewPrefs>;

/** Coerce anything at all into valid prefs. Runs on every read and every write,
 * so a hand-edited or half-written value can never reach the view model. */
function sanitize(raw: unknown): ViewPrefs {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...DEFAULT_PREFS };
  const v = raw as Partial<Record<keyof ViewPrefs, unknown>>;
  const preset = PRESETS.includes(v.preset as PresetId)
    ? (v.preset as PresetId)
    : DEFAULT_PREFS.preset;
  const collapsed = Array.isArray(v.collapsed)
    ? [...new Set(v.collapsed.filter((k): k is string => typeof k === "string"))].slice(
        0,
        MAX_COLLAPSED,
      )
    : [];
  return {
    preset,
    hideCompleted: typeof v.hideCompleted === "boolean" ? v.hideCompleted : false,
    collapsed,
  };
}

function readFile(): PrefsFile {
  const raw = readKey(KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as PrefsFile;
  } catch {
    return {}; // corrupt: start over rather than break the page
  }
}

export function readPrefs(token: string): ViewPrefs {
  return sanitize(readFile()[token]);
}

/** Merge `patch` over the stored value, persist, and return the merged result —
 * so React state and storage can't drift apart. */
export function writePrefs(token: string, patch: Partial<ViewPrefs>): ViewPrefs {
  const file = readFile();
  const next = sanitize({ ...sanitize(file[token]), ...patch });
  const entries = Object.entries({ ...file, [token]: next });
  // Oldest insertion order goes first; the current token was just re-inserted,
  // so it survives the trim.
  const trimmed = entries.slice(Math.max(0, entries.length - MAX_ENTRIES));
  writeKey(KEY, JSON.stringify(Object.fromEntries(trimmed)));
  return next;
}

export function clearPrefs(token: string): void {
  const file = readFile();
  if (!(token in file)) return;
  delete file[token];
  writeKey(KEY, JSON.stringify(file));
}
