/** The catalog of tools in the suite — the single source of truth used by both
 * the routing table (src/routes.tsx) and the landing page (src/shell/Home.tsx).
 * Adding a tool is one entry here plus its component; "soon" entries render as
 * non-clickable placeholder cards and get no route. */
import type { ReactElement } from "react";
import Planner from "./planner/Planner.tsx";

export interface Tool {
  id: string;
  /** Display name, e.g. "Crafting Planner". */
  name: string;
  /** Route path for live tools (e.g. "/planner"); ignored for "soon" tools. */
  path: string;
  /** One-line description shown on the landing card and nav. */
  blurb: string;
  status: "live" | "soon";
  /** The routed element. Present only for live tools. */
  element?: ReactElement;
}

export const tools: Tool[] = [
  {
    id: "planner",
    name: "Crafting Planner",
    path: "/planner",
    blurb:
      "Search items, build a crafting list, and get a flattened plan of every raw " +
      "material to gather and intermediate to craft — with owned stock subtracted. " +
      "Share a link to divide the work with your group.",
    status: "live",
    element: <Planner />,
  },
];

/** Tools that have a route + component. */
export const liveTools = tools.filter((t): t is Tool & { element: ReactElement } => t.status === "live");
