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

/** Set when the user dismisses the automatic prompt, so it isn't shown again on
 * this page (PRG-7). Lives in memory: a reload asks again. */
let declined = false;

/** Forget an earlier dismissal, as a page reload would. For tests, which share
 * one module instance across what would be separate page loads. */
export function resetDeclinedHandle(): void {
  declined = false;
}

/** Return the stored handle, or prompt for one (once per page) and store it.
 * Returns null when there is no name — the caller saves the write unattributed
 * rather than dropping it. */
export function ensureHandle(): string | null {
  const existing = getHandle();
  if (existing) return existing;
  if (declined) return null;
  const entered = promptHandle();
  declined = entered === null;
  return entered;
}

/** Always prompt (pre-filled with the current handle), storing the result.
 * Returns the new handle, or null if dismissed/blank. */
export function promptHandle(): string | null {
  declined = false; // an explicit "set your name" lifts an earlier dismissal
  const entered = window
    .prompt("Pick a display name so others can see who did what:", getHandle() ?? "")
    ?.trim();
  if (!entered) return null;
  setHandle(entered);
  return entered;
}
