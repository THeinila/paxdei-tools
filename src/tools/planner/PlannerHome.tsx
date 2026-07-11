/** The Crafting Planner's main page: a directory of the lists you've created and
 * the shared lists you've opened. "Create a new list" makes a server-backed list
 * and drops into the editor; each card opens / renames / duplicates / removes a
 * list. Opening a legacy `?list=<token>` share link redirects to `/planner/<token>`. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  DEFAULT_NAME,
  createShared,
  deleteEntry,
  duplicate,
  listEntries,
  listKey,
  loadContent,
  updateEntry,
  type ListEntry,
} from "./lib/directory.ts";
import { getList } from "./lib/api.ts";
import { tools } from "../registry.tsx";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default function PlannerHome() {
  // Looked up at render time (not module load) to avoid using the registry's `tools`
  // export before it initializes — registry.tsx imports this component, so the two
  // modules form a cycle.
  const plannerVersion = tools.find((t) => t.id === "planner")?.version;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [entries, setEntries] = useState<ListEntry[]>(() => listEntries());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => setEntries(listEntries());

  // Redirect a legacy share link (`?list=<token>`) to the canonical token URL;
  // the editor there adopts the token into the directory.
  const token = params.get("list");
  useEffect(() => {
    if (!token) return;
    navigate(`/planner/${token}`, { replace: true });
  }, [token, navigate]);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [entries],
  );

  async function onCreate() {
    if (busy) return;
    setBusy(true);
    try {
      const entry = await createShared();
      navigate(`/planner/${listKey(entry)}`);
    } catch (e) {
      alert(`Could not create a list: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  function startRename(entry: ListEntry) {
    setEditingId(entry.id);
    setDraftName(entry.name);
  }

  function commitRename(id: string) {
    // Updates only the local card label; the authoritative name lives on the
    // server and is edited from the list's title field inside the editor.
    const name = draftName.trim() || DEFAULT_NAME;
    updateEntry(id, { name });
    setEditingId(null);
    refresh();
  }

  async function onDuplicate(entry: ListEntry) {
    if (busy) return;
    let def = { targets: [] as ReturnType<typeof loadContent>["targets"], pathChoices: {} as Record<string, string> };
    if (entry.shareToken) {
      try {
        const snap = await getList(entry.shareToken);
        def = { targets: snap.state.targets, pathChoices: snap.state.pathChoices };
      } catch {
        alert("Could not load the list to duplicate.");
        return;
      }
    } else {
      // Legacy local list not yet promoted: duplicate straight from its content.
      const content = loadContent(entry.id);
      def = { targets: content.targets, pathChoices: content.pathChoices };
    }
    setBusy(true);
    try {
      await duplicate(entry.name, def);
      refresh();
    } catch (e) {
      alert(`Could not duplicate the list: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  function onDelete(entry: ListEntry) {
    // Removing only drops the list from this browser's directory; the shared list
    // itself lives on until everyone forgets its link.
    if (!window.confirm(`Remove "${entry.name || DEFAULT_NAME}" from your lists?`)) return;
    deleteEntry(entry.id);
    refresh();
  }

  if (token) return <p className="hint">Opening shared list…</p>;

  return (
    <>
      <div className="tool-header">
        <h2 className="tool-title">
          Crafting Planner{" "}
          {plannerVersion && <span className="tool-version">v{plannerVersion}</span>}
        </h2>
        <div className="header-actions">
          <button className="share-btn" onClick={onCreate} disabled={busy}>
            {busy ? "Working…" : "+ Create a new list"}
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="hint">No lists yet. Create one to start planning your crafts.</p>
      ) : (
        <div className="tool-grid">
          {sorted.map((entry) => (
            <div key={entry.id} className="list-card">
              {editingId === entry.id ? (
                <input
                  className="search-input list-card-rename"
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => commitRename(entry.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(entry.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <button className="list-card-open" onClick={() => navigate(`/planner/${listKey(entry)}`)}>
                  <span className="list-card-name">{entry.name || DEFAULT_NAME}</span>
                  <span className="list-card-meta">
                    {entry.targetCount} item{entry.targetCount === 1 ? "" : "s"} · {relativeTime(entry.updatedAt)}
                  </span>
                </button>
              )}
              <div className="list-card-actions">
                <button className="link-btn" onClick={() => startRename(entry)}>
                  rename
                </button>
                <button className="link-btn" onClick={() => onDuplicate(entry)}>
                  duplicate
                </button>
                <button className="link-btn" onClick={() => onDelete(entry)}>
                  delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="tool-note">Recipe data from paxdei.gaming.tools · inspired by FFXIV Teamcraft</p>
    </>
  );
}
