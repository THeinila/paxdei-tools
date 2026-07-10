import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { dataset, getItem, itemName, sourceUrl } from "../lib/data.ts";
import { Icon } from "./Search.tsx";

/**
 * Item icon + name that pops a recipe tooltip on hover/focus. Drop-in
 * replacement for the inline `<Icon/> + <span class="row-name">` pair used in
 * the planner rows; sized to occupy exactly the space that pair did.
 */
export function ItemLabel({
  itemId,
  nameClassName = "row-name",
}: {
  itemId: string;
  nameClassName?: string;
}) {
  const item = getItem(itemId);
  const ref = useRef<HTMLDivElement>(null);
  const lastPointer = useRef<string>("mouse");
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const show = () => ref.current && setAnchor(ref.current.getBoundingClientRect());
  const hide = () => setAnchor(null);

  // Touch has no hover, so a tap toggles the card. We key hover to the mouse
  // pointer type and the toggle to touch/pen, so the two don't fight (a tap
  // that also synthesises a mouseenter must not immediately re-close the card).
  useEffect(() => {
    if (!anchor) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) hide();
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [anchor]);

  return (
    <div
      className="item-label"
      ref={ref}
      tabIndex={0}
      onPointerDown={(e) => (lastPointer.current = e.pointerType)}
      onPointerEnter={(e) => e.pointerType === "mouse" && show()}
      onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
      onFocus={show}
      onBlur={hide}
      onClick={() => lastPointer.current !== "mouse" && setAnchor((a) => (a ? null : ref.current!.getBoundingClientRect()))}
    >
      <Icon item={item} />
      <span className={nameClassName}>{itemName(itemId)}</span>
      <RarityTag itemId={itemId} />
      {anchor && createPortal(<RecipeTooltip itemId={itemId} anchor={anchor} />, document.body)}
    </div>
  );
}

/**
 * Small colored pill after an item name marking uncommon/rare items. Normal
 * (common/poor/absent) items render nothing, to keep the UI uncluttered. Used
 * to disambiguate armor/clothing variants that share the same display name.
 */
export function RarityTag({ itemId }: { itemId: string }) {
  const rarity = getItem(itemId)?.rarity;
  if (rarity !== "uncommon" && rarity !== "rare") return null;
  return (
    <span className={`rarity-tag rarity-${rarity}`}>
      {rarity === "rare" ? "Rare" : "Uncommon"}
    </span>
  );
}

/** Floating recipe card positioned relative to the hovered row's anchor rect. */
function RecipeTooltip({ itemId, anchor }: { itemId: string; anchor: DOMRect }) {
  const item = getItem(itemId);
  const variants = dataset.recipes[itemId]?.variants ?? [];
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Place after the card has a measurable size: below-left by default, flipped
  // above when it would overflow the bottom, and clamped into the viewport.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    let left = anchor.left;
    let top = anchor.bottom + 6;
    if (top + height + margin > window.innerHeight) top = anchor.top - height - 6;
    if (top < margin) top = margin;
    left = Math.min(left, window.innerWidth - width - margin);
    left = Math.max(margin, left);
    setPos({ left, top });
  }, [anchor]);

  return (
    <div
      ref={cardRef}
      className="recipe-tooltip"
      style={{ left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.bottom + 6, visibility: pos ? "visible" : "hidden" }}
    >
      <div className="rt-head">
        <Icon item={item} />
        <span className="rt-name">{itemName(itemId)}</span>
        {item?.tier != null && <span className="rt-tier">T{item.tier}</span>}
      </div>

      {variants.length === 0 ? (
        <div className="rt-raw">
          Raw material — gathered
          {sourceUrl(item) && <span className="rt-hint"> · see “where?” for sources</span>}
        </div>
      ) : (
        variants.map((v, i) => (
          <div key={v.recipeId}>
            {i > 0 && <div className="rt-or">or</div>}
            <div className="rt-variant">
              <div className="rt-meta">
                {v.profession ?? "Crafting"} · makes ×{v.yield}
              </div>
              <ul className="rt-ings">
                {v.ingredients.map((ing) => (
                  <li key={ing.itemId} className="rt-ing">
                    <Icon item={getItem(ing.itemId)} />
                    <span className="rt-ing-name">{itemName(ing.itemId)}</span>
                    <span className="rt-ing-qty">×{ing.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
