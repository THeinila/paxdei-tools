/** The collaborator's display name ("handle"). No real auth — the handle is
 * just attribution attached to every progress write. Stored locally. */
import { readKey, writeKey } from "./storage.ts";

const KEY = "paxdei-planner:handle:v1";

export function getHandle(): string | null {
  return readKey(KEY);
}

function setHandle(name: string): void {
  writeKey(KEY, name);
}

/** Return the stored handle, or prompt for one and store it. Returns null if the
 * user dismisses the prompt. Used to gate the first progress write on a shared list. */
export function ensureHandle(): string | null {
  const existing = getHandle();
  if (existing) return existing;
  return promptHandle();
}

/** Always prompt (pre-filled with the current handle), storing the result.
 * Returns the new handle, or null if dismissed/blank. */
export function promptHandle(): string | null {
  const entered = window
    .prompt("Pick a display name so others can see who did what:", getHandle() ?? "")
    ?.trim();
  if (!entered) return null;
  setHandle(entered);
  return entered;
}
