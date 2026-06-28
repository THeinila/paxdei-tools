import { useState } from "react";
import { Search, Icon } from "./components/Search.tsx";
import { PlanView } from "./components/PlanView.tsx";
import { getItem, itemName } from "./lib/data.ts";
import { useList } from "./lib/useList.ts";
import { createList } from "./lib/api.ts";
import { ensureHandle, getHandle, promptHandle } from "./lib/handle.ts";

function tokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("list");
}

export default function App() {
  const [token, setToken] = useState<string | null>(tokenFromUrl);
  const { state, result, mode, progress, ready, error, addTarget, setTargetQty, setOwned, setPathChoice, clear } =
    useList(token);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [handle, setHandleState] = useState<string | null>(getHandle());

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
        { targets: state.targets, pathChoices: state.pathChoices },
        state.owned,
        who,
      );
      const url = new URL(window.location.href);
      url.searchParams.set("list", created.token);
      window.history.pushState({}, "", url);
      setToken(created.token); // re-mounts useList in shared mode
      await copyLink(created.token);
    } catch (e) {
      alert(`Could not create a shared list: ${e instanceof Error ? e.message : e}`);
    } finally {
      setShareBusy(false);
    }
  }

  async function copyLink(t: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("list", t);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked; the URL bar already reflects the link */
    }
  }

  function onRename() {
    const next = promptHandle();
    if (next) setHandleState(next);
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Pax Dei Planner</h1>
          <span className="tagline">Plan crafts &amp; gathering — Teamcraft-style</span>
        </div>
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
      </header>

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

      <footer className="footer">
        Data scraped from paxdei.gaming.tools · fan project, not affiliated with Mainframe
      </footer>
    </div>
  );
}
