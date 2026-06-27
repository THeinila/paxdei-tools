/** Local-only crafting list state (targets, owned stock, path choices) with
 * localStorage persistence. Sharing/server sync is a later phase. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { dataset } from "./data.ts";
import { plan, type Target } from "../engine/planner.ts";

export interface ListState {
  targets: Target[];
  owned: Record<string, number>;
  pathChoices: Record<string, string>;
}

const KEY = "paxdei-planner:list:v1";

function load(): ListState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as ListState;
  } catch {
    /* ignore */
  }
  return { targets: [], owned: {}, pathChoices: {} };
}

export function useList() {
  const [state, setState] = useState<ListState>(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(state));
  }, [state]);

  const addTarget = useCallback((itemId: string, quantity = 1) => {
    setState((s) => {
      const existing = s.targets.find((t) => t.itemId === itemId);
      const targets = existing
        ? s.targets.map((t) => (t.itemId === itemId ? { ...t, quantity: t.quantity + quantity } : t))
        : [...s.targets, { itemId, quantity }];
      return { ...s, targets };
    });
  }, []);

  const setTargetQty = useCallback((itemId: string, quantity: number) => {
    setState((s) => ({
      ...s,
      targets:
        quantity <= 0
          ? s.targets.filter((t) => t.itemId !== itemId)
          : s.targets.map((t) => (t.itemId === itemId ? { ...t, quantity } : t)),
    }));
  }, []);

  const setOwned = useCallback((itemId: string, qty: number) => {
    setState((s) => {
      const owned = { ...s.owned };
      if (qty > 0) owned[itemId] = qty;
      else delete owned[itemId];
      return { ...s, owned };
    });
  }, []);

  const setPathChoice = useCallback((itemId: string, recipeId: string) => {
    setState((s) => ({ ...s, pathChoices: { ...s.pathChoices, [itemId]: recipeId } }));
  }, []);

  const clear = useCallback(() => setState({ targets: [], owned: {}, pathChoices: {} }), []);

  const result = useMemo(
    () => plan(dataset, state.targets, { owned: state.owned, pathChoices: state.pathChoices }),
    [state],
  );

  return { state, result, addTarget, setTargetQty, setOwned, setPathChoice, clear };
}
