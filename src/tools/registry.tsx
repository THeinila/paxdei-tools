/** The catalog of tools in the suite — the single source of truth used by both
 * the routing table (src/routes.tsx) and the landing page (src/shell/Home.tsx).
 * Adding a tool is one entry here plus its component. */
import { lazy, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import { loadDataset } from "./planner/lib/data.ts";

// The planner is loaded on demand, together with its ~1.5 MB item dataset.
// Neither is needed by the shell or the landing page, and keeping them out of
// the main bundle is what lets a first visit render before the whole item
// catalogue has arrived. Promise.all so the code chunk and the data chunk
// download in parallel rather than one after the other; the component is only
// handed back once the dataset is in place, so everything inside it can keep
// reading the dataset synchronously.
const withDataset = <T,>(load: () => Promise<{ default: T }>) => async () => {
  const [mod] = await Promise.all([load(), loadDataset()]);
  return mod;
};

const Planner = lazy(withDataset(() => import("./planner/Planner.tsx")));
const PlannerHome = lazy(withDataset(() => import("./planner/PlannerHome.tsx")));

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
    version: "1.5.0",
    element: <PlannerHome />,
    children: [{ path: ":listId", element: <PlannerRoute /> }],
  },
];
