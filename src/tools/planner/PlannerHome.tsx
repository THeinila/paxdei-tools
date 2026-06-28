/** The Crafting Planner's main page: a directory of the lists you've created and
 * the shared lists you've opened. "Create a new list" drops into the editor; each
 * card opens / renames / duplicates / deletes a list. Opening a legacy
 * `?list=<token>` share link adopts it into the directory, then redirects to it. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createLocal,
  deleteEntry,
  duplicate,
  findOrCreateForToken,
  listEntries,
  loadContent,
  saveContent,
  updateEntry,
  type ListEntry,
} from "./lib/directory.ts";
import { getList } from "./lib/api.ts";

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
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [entries, setEntries] = useState<ListEntry[]>(() => listEntries());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const refresh = () => setEntries(listEntries());

  // Adopt a legacy/share link (`?list=<token>`) into the directory and open it.
  const token = params.get("list");
  useEffect(() => {
    if (!token) return;
    const entry = findOrCreateForToken(token);
    navigate(`/planner/${entry.id}`, { replace: true });
  }, [token, navigate]);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [entries],
  );

  function onCreate() {
    const entry = createLocal();
    navigate(`/planner/${entry.id}`);
  }

  function startRename(entry: ListEntry) {
    setEditingId(entry.id);
    setDraftName(entry.name);
  }

  function commitRename(id: string) {
    const name = draftName.trim() || "Untitled";
    updateEntry(id, { name });
    // Keep the local content's name in sync; shared lists rename inside the editor.
    const entry = listEntries().find((e) => e.id === id);
    if (entry && entry.kind === "local") {
      saveContent(id, { ...loadContent(id), name });
    }
    setEditingId(null);
    refresh();
  }

  async function onDuplicate(entry: ListEntry) {
    let def = { targets: [] as ReturnType<typeof loadContent>["targets"], pathChoices: {} as Record<string, string> };
    if (entry.kind === "local") {
      const content = loadContent(entry.id);
      def = { targets: content.targets, pathChoices: content.pathChoices };
    } else if (entry.shareToken) {
      try {
        const snap = await getList(entry.shareToken);
        def = { targets: snap.state.targets, pathChoices: snap.state.pathChoices };
      } catch {
        alert("Could not load the shared list to duplicate.");
        return;
      }
    }
    duplicate(entry.name, def);
    refresh();
  }

  function onDelete(entry: ListEntry) {
    const what = entry.kind === "shared" ? "Remove this shared list from your directory?" : `Delete "${entry.name}"?`;
    if (!window.confirm(what)) return;
    deleteEntry(entry.id);
    refresh();
  }

  if (token) return <p className="hint">Opening shared list…</p>;

  return (
    <>
      <div className="tool-header">
        <h2 className="tool-title">Crafting Planner</h2>
        <div className="header-actions">
          <button className="share-btn" onClick={onCreate}>
            + Create a new list
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
                <button className="list-card-open" onClick={() => navigate(`/planner/${entry.id}`)}>
                  <span className="list-card-name">{entry.name || "Untitled"}</span>
                  <span className="list-card-meta">
                    {entry.kind === "shared" && <span className="list-badge">shared</span>}
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
