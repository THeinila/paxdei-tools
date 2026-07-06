/** The catalog of tools in the suite — the single source of truth used by both
 * the routing table (src/routes.tsx) and the landing page (src/shell/Home.tsx).
 * Adding a tool is one entry here plus its component. */
import type { ReactElement } from "react";
import { useParams } from "react-router-dom";
import Planner from "./planner/Planner.tsx";
import PlannerHome from "./planner/PlannerHome.tsx";

export interface Tool {
  id: string;
  /** Display name, e.g. "Crafting Planner". */
  name: string;
  /** Route path, e.g. "/planner". */
  path: string;
  /** One-line description shown on the landing card and nav. */
  blurb: string;
  /** The tool's own semver, bumped only when this tool changes (independent of the
   * toolkit/release-train version in package.json). Shown as a badge in the UI. */
  version: string;
  /** The routed element. */
  element: ReactElement;
  /** Optional nested routes mounted under `path` (e.g. "/planner/:listId"). */
  children?: { path: string; element: ReactElement }[];
}

/** Key the editor by list id so navigating between two lists (e.g. browser
 * back/forward across /planner/a and /planner/b) remounts it instead of
 * re-rendering with the previous list's state. */
function PlannerRoute() {
  const { listId } = useParams();
  return <Planner key={listId} />;
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
    version: "1.1.0",
    element: <PlannerHome />,
    children: [{ path: ":listId", element: <PlannerRoute /> }],
  },
];
