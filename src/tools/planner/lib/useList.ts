/** Crafting list state for a shared, server-backed list.
 *
 * Every list lives server-side, addressed by its share token. The definition
 * (name + targets + pathChoices) is edited with version-guarded PATCHes; the
 * per-item "have" map is collaborative progress written as atomic additive
 * deltas. `owned` is DERIVED from the progress map (never stored separately), so
 * the two can't drift. Clients poll every few seconds. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDataset } from "./data.ts";
import { plan, type Target } from "../engine/planner.ts";
import {
  VersionConflict,
  getList,
  patchList,
  postProgress,
  type ListStateDef,
  type ProgressEntry,
} from "./api.ts";
import { ensureHandle } from "./handle.ts";
import { FENCE_IN_FLIGHT, mergeProgress, type ProgressMap } from "./progressMerge.ts";

export interface ListState {
  name: string;
  targets: Target[];
  owned: Record<string, number>;
  pathChoices: Record<string, string>;
}

// Single definition, shared with the merge rules that operate on it.
export type { ProgressMap };

/** Base poll interval. Deliberately slow: the host is a 1/8-OCPU box and every
 * open tab costs it a request per interval forever, so this is the single
 * biggest lever on how many people the deployment supports. Collaboration still
 * feels live because local edits apply optimistically — the poll is how you see
 * OTHER people's work, and ~10s is well inside "someone else is gathering too".
 *
 * Widening it also widens every race window by the same factor, which is why the
 * write-fencing below exists rather than relying on a fast poll to paper over a
 * clobbered value. */
const POLL_MS = 10_000;
/** Random extra delay per tick. Without it, every client that loaded during the
 * same outage resumes in lockstep and re-synchronises into a thundering herd on
 * a host that has ~125ms of CPU per second to spend. */
const POLL_JITTER_MS = 2000;
/** Attempts to rebase a definition edit onto a concurrent one before giving up.
 * A slower poll means clients hold a stale version for longer, so genuine 409s
 * get more common; one retry is no longer enough for a list two people are
 * actively editing. */
const MAX_REBASE_ATTEMPTS = 3;
const EMPTY: ListState = { name: "", targets: [], owned: {}, pathChoices: {} };

// --- Pure definition updaters (shared by both modes) -------------------------

function addTargetDef(def: ListStateDef, itemId: string, quantity: number): ListStateDef {
  const existing = def.targets.find((t) => t.itemId === itemId);
  const targets = existing
    ? def.targets.map((t) => (t.itemId === itemId ? { ...t, quantity: t.quantity + quantity } : t))
    : [...def.targets, { itemId, quantity }];
  return { ...def, targets };
}

function setTargetQtyDef(def: ListStateDef, itemId: string, quantity: number): ListStateDef {
  return {
    ...def,
    targets:
      quantity <= 0
        ? def.targets.filter((t) => t.itemId !== itemId)
        : def.targets.map((t) => (t.itemId === itemId ? { ...t, quantity } : t)),
  };
}

function setPathChoiceDef(def: ListStateDef, itemId: string, recipeId: string): ListStateDef {
  return { ...def, pathChoices: { ...def.pathChoices, [itemId]: recipeId } };
}

function progressToOwned(progress: ProgressMap): Record<string, number> {
  const owned: Record<string, number> = {};
  for (const p of Object.values(progress)) if (p.qty > 0) owned[p.itemId] = p.qty;
  return owned;
}

function indexProgress(entries: ProgressEntry[]): ProgressMap {
  const map: ProgressMap = {};
  for (const e of entries) map[e.itemId] = e;
  return map;
}

export interface UseList {
  state: ListState;
  result: ReturnType<typeof plan>;
  progress: ProgressMap;
  ready: boolean;
  error: string | null;
  addTarget: (itemId: string, quantity?: number) => void;
  setTargetQty: (itemId: string, quantity: number) => void;
  setOwned: (itemId: string, qty: number) => void;
  setPathChoice: (itemId: string, recipeId: string) => void;
  setName: (name: string) => void;
  clear: () => void;
}

/** Operate on the shared list identified by its share `token`. */
export function useList(token: string): UseList {
  const [state, setState] = useState<ListState>(EMPTY);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const versionRef = useRef(0);
  // Suppress poll-adoption of the definition while a local edit is being saved,
  // so an in-flight optimistic change isn't clobbered by a stale snapshot.
  const pendingEdits = useRef(0);
  // Synchronous mirror of the current definition, so edits can read the latest
  // value without waiting for a render to commit.
  const defRef = useRef<ListStateDef>({
    name: state.name,
    targets: state.targets,
    pathChoices: state.pathChoices,
  });
  useEffect(() => {
    defRef.current = { name: state.name, targets: state.targets, pathChoices: state.pathChoices };
  }, [state.name, state.targets, state.pathChoices]);

  // Synchronous mirror of the progress map, for the same reason defRef exists:
  // setOwned takes an ABSOLUTE quantity but has to send a DELTA, and computing
  // that delta against React state means reading a value that may be one or more
  // updates behind. Two quick edits ("5", then "8") would each subtract from 0
  // and post +5 then +8, landing on 13.
  const progressRef = useRef<ProgressMap>({});
  const writeProgress = useCallback((next: ProgressMap) => {
    progressRef.current = next;
    setProgress(next);
  }, []);

  // --- Write fencing ---------------------------------------------------------
  // Poll responses carry a whole-map snapshot, so a poll that the server answered
  // from state older than our own just-committed write will silently roll that
  // write back on screen until the next tick. At a 10s interval that is 10s of
  // showing the user a number they know is wrong.
  //
  // Each poll is tagged with a monotonic sequence number when it is ISSUED. When
  // a progress write completes we record the latest issued seq as that item's
  // fence: only a poll issued strictly after that point can have observed our
  // write, so only such a poll is allowed to replace the item's value. Polls
  // issued earlier keep our local value for that item and are applied normally
  // for every other item. While a write is in flight the fence is Infinity, so
  // nothing can overwrite the optimistic value.
  // The merge rules themselves live in ./progressMerge.ts as a pure function so
  // the ordering cases can be tested without going through React timing.
  const pollSeq = useRef(0);
  const appliedSeq = useRef(-1);
  const fences = useRef<Map<string, number>>(new Map());

  // --- Hydrate + poll --------------------------------------------------------
  const applySnapshot = useCallback(
    (
      snap: { version: number; state: ListStateDef; progress: ProgressEntry[] },
      adoptDef: boolean,
      seq: number,
      initial: boolean,
    ) => {
      versionRef.current = snap.version;
      // On the first load there is nothing local worth protecting, so take the
      // server's map wholesale and reset the fences to match.
      if (initial) {
        fences.current.clear();
        writeProgress(indexProgress(snap.progress));
      } else {
        writeProgress(mergeProgress(snap.progress, progressRef.current, fences.current, seq));
      }
      if (adoptDef) {
        defRef.current = {
          name: snap.state.name,
          targets: snap.state.targets,
          pathChoices: snap.state.pathChoices,
        };
        setState((s) => ({ ...s, ...defRef.current }));
      }
    },
    [writeProgress],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    setReady(false);
    setError(null);

    const poll = async (initial: boolean) => {
      // Never let a second poll overlap the first. On a heavily loaded host a
      // response can take longer than the interval, and two in flight can land
      // out of order — an older snapshot overwriting a newer one.
      if (inFlight) return;
      inFlight = true;
      const seq = ++pollSeq.current;
      try {
        const snap = await getList(token);
        if (cancelled) return;
        // Drop a response that lost the race to a newer one.
        if (!initial && seq <= appliedSeq.current) return;
        appliedSeq.current = seq;
        // Only adopt the definition when no edit is in flight and the server
        // actually moved ahead of what we've saved.
        const adoptDef =
          initial || (pendingEdits.current === 0 && snap.version >= versionRef.current);
        applySnapshot(snap, adoptDef, seq, initial);
        setError(null);
        if (initial) setReady(true);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "failed to load list");
        if (initial) setReady(true);
      } finally {
        inFlight = false;
      }
    };

    // Recursive timeout rather than setInterval, so the delay can carry jitter
    // and so a slow response pushes the next tick out instead of stacking.
    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(async () => {
        // A hidden tab has nobody watching it; polling it is pure cost to the
        // host. Skip the tick and let the visibility handler catch up on focus.
        if (document.visibilityState === "visible") await poll(false);
        schedule();
      }, POLL_MS + Math.random() * POLL_JITTER_MS);
    };

    const onVisible = () => {
      // Refresh immediately on focus — after a spell hidden, whatever is on
      // screen is arbitrarily stale and the user is looking straight at it.
      if (document.visibilityState === "visible") void poll(false);
    };
    document.addEventListener("visibilitychange", onVisible);

    void poll(true);
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, applySnapshot]);

  // --- Definition edits ------------------------------------------------------
  const editDef = useCallback(
    (fn: (def: ListStateDef) => ListStateDef) => {
      // Optimistic local update (both modes), reading the synchronous def mirror
      // so back-to-back edits compose correctly.
      const next = fn(defRef.current);
      defRef.current = next;
      setState((s) => ({ ...s, name: next.name, targets: next.targets, pathChoices: next.pathChoices }));

      pendingEdits.current += 1;
      void (async () => {
        try {
          // Rebase-and-retry loop. On a 409 we replay `fn` against the server's
          // current definition rather than re-sending ours, so concurrent edits
          // compose instead of overwriting: two people each adding a target both
          // end up in the list. Bounded, because a list being edited hard by
          // several people could otherwise spin here.
          let base = versionRef.current;
          let candidate = next;
          for (let attempt = 0; ; attempt++) {
            try {
              const saved = await patchList(token, candidate, base);
              versionRef.current = saved.version;
              return;
            } catch (e) {
              if (!(e instanceof VersionConflict)) throw e;
              if (attempt >= MAX_REBASE_ATTEMPTS - 1) throw e;
              base = e.current.version;
              versionRef.current = base;
              candidate = fn(e.current.state);
              defRef.current = candidate;
              setState((s) => ({
                ...s,
                name: candidate.name,
                targets: candidate.targets,
                pathChoices: candidate.pathChoices,
              }));
            }
          }
        } catch (e) {
          setError(
            e instanceof VersionConflict
              ? "someone else is editing this list — your last change may not have saved"
              : e instanceof Error
                ? e.message
                : "failed to save edit",
          );
        } finally {
          pendingEdits.current -= 1;
        }
      })();
    },
    [token],
  );

  const addTarget = useCallback(
    (itemId: string, quantity = 1) => editDef((d) => addTargetDef(d, itemId, quantity)),
    [editDef],
  );
  const setTargetQty = useCallback(
    (itemId: string, quantity: number) => editDef((d) => setTargetQtyDef(d, itemId, quantity)),
    [editDef],
  );
  const setPathChoice = useCallback(
    (itemId: string, recipeId: string) => editDef((d) => setPathChoiceDef(d, itemId, recipeId)),
    [editDef],
  );
  const setName = useCallback(
    (name: string) => editDef((d) => ({ ...d, name })),
    [editDef],
  );
  const clear = useCallback(
    () => editDef((d) => ({ name: d.name, targets: [], pathChoices: {} })),
    [editDef],
  );

  // --- The "have" map: collaborative progress deltas -------------------------
  const setOwned = useCallback(
    (itemId: string, qty: number) => {
      // Write the delta from what we currently show, attributed to the handle.
      // Read through the synchronous mirror, not React state: back-to-back edits
      // must each subtract from the previous one, not from a stale render.
      const handle = ensureHandle();
      if (!handle) return;
      const before = progressRef.current[itemId];
      const current = before?.qty ?? 0;
      const target = Math.max(0, qty);
      const delta = target - current;
      if (delta === 0) return;
      const optimistic: ProgressEntry = {
        itemId,
        qty: target,
        byHandle: handle,
        updatedAt: new Date().toISOString(),
      };
      // Fence the item for the duration of the write so no poll — including one
      // already in flight — can roll the optimistic value back.
      fences.current.set(itemId, FENCE_IN_FLIGHT);
      writeProgress({ ...progressRef.current, [itemId]: optimistic });
      void (async () => {
        try {
          const saved = await postProgress(token, itemId, delta, handle);
          // The server has our write now. Release the fence to the latest issued
          // poll seq: any poll issued from here on must have observed it, so it
          // is free to bring us newer values (including other people's).
          fences.current.set(itemId, pollSeq.current);
          writeProgress({ ...progressRef.current, [itemId]: saved });
        } catch (e) {
          // Roll back rather than leaving a value on screen that was never
          // saved — otherwise the user believes their count is recorded and
          // only finds out at some later poll.
          fences.current.delete(itemId);
          const reverted = { ...progressRef.current };
          if (before) reverted[itemId] = before;
          else delete reverted[itemId];
          writeProgress(reverted);
          setError(e instanceof Error ? e.message : "failed to save progress");
        }
      })();
    },
    [token, writeProgress],
  );

  // `owned` is a pure projection of the collaborative progress map.
  const owned = useMemo(() => progressToOwned(progress), [progress]);

  const result = useMemo(
    () => plan(getDataset(), state.targets, { owned, pathChoices: state.pathChoices }),
    [state.targets, state.pathChoices, owned],
  );

  const exposedState = useMemo(() => ({ ...state, owned }), [state, owned]);

  return {
    state: exposedState,
    result,
    progress,
    ready,
    error,
    addTarget,
    setTargetQty,
    setOwned,
    setPathChoice,
    setName,
    clear,
  };
}
