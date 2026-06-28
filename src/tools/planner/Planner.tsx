import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Search, Icon } from "./components/Search.tsx";
import { PlanView } from "./components/PlanView.tsx";
import { getItem, itemName } from "./lib/data.ts";
import { useList } from "./lib/useList.ts";
import { createList } from "./lib/api.ts";
import { ensureHandle, getHandle, promptHandle } from "./lib/handle.ts";
import { getEntry, updateEntry } from "./lib/directory.ts";

export default function Planner() {
  const { listId = "" } = useParams();
  const entry = getEntry(listId);
  const [token, setToken] = useState<string | null>(entry?.shareToken ?? null);
  const { state, result, mode, progress, ready, error, addTarget, setTargetQty, setOwned, setPathChoice, setName, clear } =
    useList(listId, token);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [handle, setHandleState] = useState<string | null>(getHandle());
  const [titleDraft, setTitleDraft] = useState(state.name);

  // Keep the title input in sync when the name changes externally (e.g. a poll
  // on a shared list adopts a collaborator's rename).
  useEffect(() => setTitleDraft(state.name), [state.name]);

  // Mirror the live state into the directory entry so the cards stay current.
  // Wait until a shared list has hydrated (ready, no load error) so we don't
  // overwrite its cached name/count with the empty pre-poll/failed state.
  useEffect(() => {
    if (!entry || !ready || (mode === "shared" && error)) return;
    updateEntry(listId, { name: state.name || "Untitled", targetCount: state.targets.length });
  }, [entry, ready, mode, error, listId, state.name, state.targets.length]);

  if (!entry) return <Navigate to="/planner" replace />;

  function commitTitle() {
    const name = titleDraft.trim() || "Untitled";
    if (name !== state.name) setName(name);
    setTitleDraft(name);
  }

  async function onShare() {
    setCopied(false);
    if (mode === "shared" && token) {
      await copyLink(token);
      return;
    }
    // First share: persist the local list, attribute seeded stock to the handle.
    setShareBusy(true);
    try {
      const who = ensureHandle();
      setHandleState(who);
      const created = await createList(
        { name: state.name, targets: state.targets, pathChoices: state.pathChoices },
        state.owned,
        who,
      );
      updateEntry(listId, { kind: "shared", shareToken: created.token });
      setToken(created.token); // re-mounts useList in shared mode
      await copyLink(created.token);
    } catch (e) {
      alert(`Could not create a shared list: ${e instanceof Error ? e.message : e}`);
    } finally {
      setShareBusy(false);
    }
  }

  async function copyLink(t: string) {
    const url = new URL(window.location.origin + "/planner");
    url.searchParams.set("list", t);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked */
    }
  }

  function onRename() {
    const next = promptHandle();
    if (next) setHandleState(next);
  }

  return (
    <>
      <div className="tool-breadcrumb">
        <Link to="/planner" className="nav-link">
          ← All lists
        </Link>
      </div>
      <div className="tool-header">
        <input
          className="tool-title-input"
          value={titleDraft}
          placeholder="Untitled"
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <div className="header-actions">
          {mode === "shared" && (
            <span className="share-badge">
              shared{handle ? ` · ${handle}` : ""}
              <button className="link-btn" onClick={onRename}>
                {handle ? "rename" : "set name"}
              </button>
            </span>
          )}
          <button className="share-btn" onClick={onShare} disabled={shareBusy || state.targets.length === 0}>
            {copied ? "Link copied!" : mode === "shared" ? "Copy link" : shareBusy ? "Sharing…" : "Share"}
          </button>
        </div>
      </div>

      {mode === "shared" && error && <div className="warning">⚠ {error}</div>}
      {mode === "shared" && !ready ? (
        <p className="hint">Loading shared list…</p>
      ) : (
        <>
          <Search onAdd={(id, qty) => addTarget(id, qty)} />

          <section className="targets">
            <div className="targets-head">
              <h2>Crafting list</h2>
              {state.targets.length > 0 && (
                <button className="link-btn" onClick={clear}>
                  clear
                </button>
              )}
            </div>
            {state.targets.length === 0 ? (
              <p className="hint">Search above and add items you want to craft.</p>
            ) : (
              <ul className="rows">
                {state.targets.map((t) => (
                  <li key={t.itemId} className="row">
                    <Icon item={getItem(t.itemId)} />
                    <span className="row-name">{itemName(t.itemId)}</span>
                    <input
                      className="target-qty"
                      type="number"
                      min={0}
                      value={t.quantity}
                      onChange={(e) => setTargetQty(t.itemId, Math.max(0, Number(e.target.value) || 0))}
                    />
                    <button className="link-btn" onClick={() => setTargetQty(t.itemId, 0)}>
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <PlanView
            result={result}
            owned={state.owned}
            pathChoices={state.pathChoices}
            progress={progress}
            setOwned={setOwned}
            setPathChoice={setPathChoice}
          />
        </>
      )}

      <p className="tool-note">Recipe data from paxdei.gaming.tools · inspired by FFXIV Teamcraft</p>
    </>
  );
}
