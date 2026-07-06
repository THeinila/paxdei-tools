/** Crafting list state with two modes:
 *
 *  - Local (token === null): targets/owned/pathChoices in localStorage, exactly
 *    as the single-user MVP worked.
 *  - Shared (token set): the list lives server-side. The definition
 *    (targets + pathChoices) is edited with version-guarded PATCHes; the per-item
 *    "have" map is collaborative progress written as atomic additive deltas.
 *    `owned` is DERIVED from the progress map (never stored separately), so the
 *    two can't drift. Clients poll every few seconds.
 *
 * The public surface stays source-compatible with the local MVP — `owned` and
 * `setOwned` carry the have-map in both modes — so PlanView/App need only minor
 * additions (attribution + share UX). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dataset } from "./data.ts";
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
import { loadContent, saveContent } from "./directory.ts";

export interface ListState {
  name: string;
  targets: Target[];
  owned: Record<string, number>;
  pathChoices: Record<string, string>;
}

export type Mode = "local" | "shared";
export type ProgressMap = Record<string, ProgressEntry>;

const POLL_MS = 3000;
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
  mode: Mode;
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

/** Identify the list to operate on: a directory `id` (for localStorage content)
 * and an optional share `token` (present iff the list is shared). */
export function useList(id: string, token: string | null): UseList {
  const mode: Mode = token ? "shared" : "local";
  const [state, setState] = useState<ListState>(() => (token ? EMPTY : loadContent(id)));
  const [progress, setProgress] = useState<ProgressMap>({});
  const [ready, setReady] = useState(!token); // local is ready immediately
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

  // --- Local mode: persist to localStorage -----------------------------------
  useEffect(() => {
    if (mode !== "local") return;
    saveContent(id, state);
  }, [mode, id, state]);

  // --- Shared mode: hydrate + poll -------------------------------------------
  const applySnapshot = useCallback(
    (snap: { version: number; state: ListStateDef; progress: ProgressEntry[] }, adoptDef: boolean) => {
      versionRef.current = snap.version;
      setProgress(indexProgress(snap.progress));
      if (adoptDef) {
        defRef.current = {
          name: snap.state.name,
          targets: snap.state.targets,
          pathChoices: snap.state.pathChoices,
        };
        setState((s) => ({ ...s, ...defRef.current }));
      }
    },
    [],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setReady(false);
    setError(null);

    const poll = async (initial: boolean) => {
      try {
        const snap = await getList(token);
        if (cancelled) return;
        // On a poll, only adopt the definition when no edit is in flight and the
        // server actually moved ahead of what we've saved.
        const adoptDef = initial || (pendingEdits.current === 0 && snap.version >= versionRef.current);
        applySnapshot(snap, adoptDef);
        if (initial) setReady(true);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "failed to load list");
        if (initial) setReady(true);
      }
    };

    void poll(true);
    const id = setInterval(() => void poll(false), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
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
      if (!token) return;

      pendingEdits.current += 1;
      void (async () => {
        try {
          const saved = await patchList(token, next, versionRef.current);
          versionRef.current = saved.version;
        } catch (e) {
          if (e instanceof VersionConflict) {
            // Rebase our edit on the server's current definition and retry once.
            try {
              versionRef.current = e.current.version;
              const rebased = fn(e.current.state);
              defRef.current = rebased;
              setState((s) => ({
                ...s,
                name: rebased.name,
                targets: rebased.targets,
                pathChoices: rebased.pathChoices,
              }));
              const saved = await patchList(token, rebased, e.current.version);
              versionRef.current = saved.version;
            } catch (err) {
              setError(err instanceof Error ? err.message : "failed to save edit");
            }
          } else {
            setError(e instanceof Error ? e.message : "failed to save edit");
          }
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

  // --- The "have" map: local owned, or collaborative progress deltas ---------
  const setOwned = useCallback(
    (itemId: string, qty: number) => {
      if (!token) {
        setState((s) => {
          const owned = { ...s.owned };
          if (qty > 0) owned[itemId] = qty;
          else delete owned[itemId];
          return { ...s, owned };
        });
        return;
      }
      // Shared: write the delta from what we currently show, attributed to the handle.
      const handle = ensureHandle();
      if (!handle) return;
      const current = progress[itemId]?.qty ?? 0;
      const delta = qty - current;
      if (delta === 0) return;
      const optimistic: ProgressEntry = {
        itemId,
        qty: Math.max(0, qty),
        byHandle: handle,
        updatedAt: new Date().toISOString(),
      };
      setProgress((p) => ({ ...p, [itemId]: optimistic }));
      void (async () => {
        try {
          const saved = await postProgress(token, itemId, delta, handle);
          setProgress((p) => ({ ...p, [itemId]: saved }));
        } catch (e) {
          setError(e instanceof Error ? e.message : "failed to save progress");
        }
      })();
    },
    [token, progress],
  );

  // In shared mode `owned` is a pure projection of the progress map; local mode
  // keeps its own owned in state.
  const owned = useMemo(
    () => (token ? progressToOwned(progress) : state.owned),
    [token, progress, state.owned],
  );

  const result = useMemo(
    () => plan(dataset, state.targets, { owned, pathChoices: state.pathChoices }),
    [state.targets, state.pathChoices, owned],
  );

  const exposedState = useMemo(
    () => (token ? { ...state, owned } : state),
    [token, state, owned],
  );

  return {
    state: exposedState,
    result,
    mode,
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
