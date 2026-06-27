import { useMemo, useState } from "react";
import { iconUrl, searchItems } from "../lib/data.ts";
import type { Item } from "../engine/types.ts";

export function Search({ onAdd }: { onAdd: (itemId: string) => void }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchItems(query), [query]);

  return (
    <div className="search">
      <input
        className="search-input"
        placeholder="Search items to craft…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((item: Item) => (
            <li key={item.id} className="search-row" onClick={() => onAdd(item.id)}>
              <Icon item={item} />
              <span className="search-name">{item.name}</span>
              <span className="search-cat">{item.isRaw ? "raw material" : item.mainCategoryId}</span>
              <button className="add-btn" aria-label={`Add ${item.name}`}>+</button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 && results.length === 0 && (
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
