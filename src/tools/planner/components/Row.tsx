import type { ReactNode } from "react";
import { ItemLabel } from "./RecipeTooltip.tsx";

/**
 * One planner row: an item label, an optional `×qty`, and a `.row-controls`
 * wrapper holding the secondary controls. Shared by the crafting-list (targets),
 * gather, and craft lists so they stay structurally identical.
 *
 * On desktop `.row-controls` is `display: contents` (the controls act as direct
 * children of the flex row); below the mobile breakpoint it becomes a full-width
 * second line under the name. See styles.css.
 */
export function Row({
  itemId,
  qty,
  satisfied,
  children,
}: {
  itemId: string;
  /** When set, shown as `×{qty}` between the name and the controls. */
  qty?: number;
  /** Fully covered by owned stock: dim the row and strike the qty. */
  satisfied?: boolean;
  /** The secondary controls (inputs, meta, links). */
  children: ReactNode;
}) {
  return (
    <li className={satisfied ? "row satisfied" : "row"}>
      <ItemLabel itemId={itemId} />
      {qty != null && <span className="qty">×{qty}</span>}
      <div className="row-controls">{children}</div>
    </li>
  );
}
