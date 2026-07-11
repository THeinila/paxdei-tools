import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Search } from "./components/Search.tsx";
import { PlanView } from "./components/PlanView.tsx";
import { Row } from "./components/Row.tsx";
import { useList } from "./lib/useList.ts";
import { getHandle, promptHandle } from "./lib/handle.ts";
import {
  DEFAULT_NAME,
  findOrCreateForToken,
  promoteLocalEntry,
  resolveEntry,
  updateEntry,
} from "./lib/directory.ts";

// A share token is base64url of 16 random bytes → 22 chars. A legacy local id is
// a UUID (dashes) or an `l_…` fallback, so this cleanly tells an unknown-but-
// adoptable token apart from a dead local bookmark.
const TOKEN_RE = /^[A-Za-z0-9_-]{20,24}$/;

/** Resolve the `/planner/:listId` param to a shared list, then render the editor.
 * The param may be a share token (canonical), a legacy local id/bookmark, or an
 * unknown token opened from a share link. */
export default function Planner() {
  const { listId = "" } = useParams();
  const navigate = useNavigate();
  const [resolved, setResolved] = useState<{ token: string; entryId: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const promoting = useRef(false); // guard the async promotion against StrictMode double-invoke

  useEffect(() => {
    setResolved(null);
    setFailed(false);
    const entry = resolveEntry(listId);

    if (entry?.shareToken) {
      // Known shared list. Canonicalize an old `/planner/<uuid>` bookmark to the token URL.
      if (listId !== entry.shareToken) {
        navigate(`/planner/${entry.shareToken}`, { replace: true });
        return;
      }
      setResolved({ token: entry.shareToken, entryId: entry.id });
      return;
    }

    if (entry) {
      // Legacy local list: promote it server-side, then move to its token URL.
      if (promoting.current) return;
      promoting.current = true;
      let cancelled = false;
      promoteLocalEntry(entry)
        .then((updated) => {
          if (!cancelled && updated.shareToken) {
            navigate(`/planner/${updated.shareToken}`, { replace: true });
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        })
        .finally(() => {
          promoting.current = false;
        });
      return () => {
        cancelled = true;
      };
    }

    if (TOKEN_RE.test(listId)) {
      // Recipient's first open of a share link: adopt it and stay on this URL.
      const adopted = findOrCreateForToken(listId);
      setResolved({ token: listId, entryId: adopted.id });
      return;
    }

    setFailed(true);
  }, [listId, navigate]);

  if (failed) return <Navigate to="/planner" replace />;
  if (!resolved) return <p className="hint">Opening list…</p>;
  return <ListEditor key={resolved.token} token={resolved.token} entryId={resolved.entryId} />;
}

/** The list editor. Always operates on a shared, server-backed list. */
function ListEditor({ token, entryId }: { token: string; entryId: string }) {
  const { state, result, progress, ready, error, addTarget, setTargetQty, setOwned, setPathChoice, setName, clear } =
    useList(token);
  const [copied, setCopied] = useState(false);
  const [handle, setHandleState] = useState<string | null>(getHandle());
  const [titleDraft, setTitleDraft] = useState(state.name);

  // Keep the title input in sync when the name changes externally (e.g. a poll
  // adopts a collaborator's rename).
  useEffect(() => setTitleDraft(state.name), [state.name]);

  // Mirror the live state into the directory entry so the cards stay current.
  // Wait until the list has hydrated (ready, no load error) so we don't overwrite
  // its cached name/count with the empty pre-poll/failed state.
  useEffect(() => {
    if (!ready || error) return;
    updateEntry(entryId, { name: state.name || DEFAULT_NAME, targetCount: state.targets.length });
  }, [ready, error, entryId, state.name, state.targets.length]);

  function commitTitle() {
    const name = titleDraft.trim() || DEFAULT_NAME;
    if (name !== state.name) setName(name);
    setTitleDraft(name);
  }

  async function copyLink() {
    setCopied(false);
    const url = `${window.location.origin}/planner/${token}`;
    try {
      await navigator.clipboard.writeText(url);
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
          placeholder={DEFAULT_NAME}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <div className="header-actions">
          <span className="share-badge">
            {handle && <span className="share-handle">{handle}</span>}
            <button className="link-btn" onClick={onRename}>
              {handle ? "rename" : "set your name"}
            </button>
          </span>
          <button className="share-btn" onClick={copyLink}>
            {copied ? "Link copied!" : "Copy link"}
          </button>
        </div>
      </div>

      {error && <div className="warning">⚠ {error}</div>}
      {!ready ? (
        <p className="hint">Loading list…</p>
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
                  <Row key={t.itemId} itemId={t.itemId}>
                    <input
                      className="target-qty"
                      type="number"
                      min={0}
                      value={t.quantity}
                      onChange={(e) => setTargetQty(t.itemId, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    />
                    <button className="link-btn" onClick={() => setTargetQty(t.itemId, 0)}>
                      remove
                    </button>
                  </Row>
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
