import { useEffect, useMemo, useRef, useState } from "react";
import { iconUrl, searchItems } from "../lib/data.ts";
import type { Item } from "../engine/types.ts";
import { RarityTag } from "./RecipeTooltip.tsx";

export function Search({ onAdd }: { onAdd: (itemId: string, quantity: number) => void }) {
  const [query, setQuery] = useState("");
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchItems(query), [query]);

  const qtyFor = (id: string) => qtys[id] ?? 1;
  const setQty = (id: string, n: number) => setQtys((q) => ({ ...q, [id]: Math.max(1, n) }));

  // Close the dropdown when clicking outside the search. Using mousedown (not
  // click) so selecting a result still registers before this fires.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="search" ref={containerRef}>
      <input
        className="search-input"
        placeholder="Search items to craft…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onMouseDown={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        autoFocus
      />
      {open && results.length > 0 && (
        <ul className="search-results">
          {results.map((item: Item) => (
            <li key={item.id} className="search-row" onClick={() => onAdd(item.id, qtyFor(item.id))}>
              <Icon item={item} />
              <span className="search-name">{item.name}</span>
              <RarityTag itemId={item.id} />
              <span className="search-cat">{item.isRaw ? "raw material" : item.mainCategoryId}</span>
              <input
                className="search-qty"
                type="number"
                min={1}
                value={qtyFor(item.id)}
                aria-label={`Quantity of ${item.name}`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setQty(item.id, Math.floor(Number(e.target.value) || 1))}
              />
              <button
                className="add-btn"
                aria-label={`Add ${qtyFor(item.id)} ${item.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd(item.id, qtyFor(item.id));
                }}
              >
                +
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim().length >= 2 && results.length === 0 && (
        <div className="empty">No items match “{query}”.</div>
      )}
    </div>
  );
}

export function Icon({ item }: { item: Item | undefined }) {
  const url = iconUrl(item);
  if (!url) return <span className="icon icon-placeholder" />;
  return (
    <img
      className="icon"
      src={url}
      alt=""
      loading="lazy"
      onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
    />
  );
}
