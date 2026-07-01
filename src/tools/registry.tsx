/** The catalog of tools in the suite — the single source of truth used by both
 * the routing table (src/routes.tsx) and the landing page (src/shell/Home.tsx).
 * Adding a tool is one entry here plus its component; "soon" entries render as
 * non-clickable placeholder cards and get no route. */
import type { ReactElement } from "react";
import Planner from "./planner/Planner.tsx";
import PlannerHome from "./planner/PlannerHome.tsx";

export interface Tool {
  id: string;
  /** Display name, e.g. "Crafting Planner". */
  name: string;
  /** Route path for live tools (e.g. "/planner"); ignored for "soon" tools. */
  path: string;
  /** One-line description shown on the landing card and nav. */
  blurb: string;
  /** The tool's own semver, bumped only when this tool changes (independent of the
   * toolkit/release-train version in package.json). Shown as a badge in the UI. */
  version: string;
  status: "live" | "soon";
  /** The routed element. Present only for live tools. */
  element?: ReactElement;
  /** Optional nested routes mounted under `path` (e.g. "/planner/:listId"). */
  children?: { path: string; element: ReactElement }[];
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
    version: "1.0.0",
    status: "live",
    element: <PlannerHome />,
    children: [{ path: ":listId", element: <Planner /> }],
  },
];

/** Tools that have a route + component. */
export const liveTools = tools.filter((t): t is Tool & { element: ReactElement } => t.status === "live");
