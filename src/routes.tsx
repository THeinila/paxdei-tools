/** Route table: the AppShell layout wraps the landing page and every live tool
 * (routes generated from the registry). Unknown paths redirect home. */
import { createBrowserRouter, Navigate } from "react-router-dom";
import AppShell from "./shell/AppShell.tsx";
import Home from "./shell/Home.tsx";
import WhatsNew from "./shell/WhatsNew.tsx";
import { liveTools } from "./tools/registry.tsx";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      { path: "whats-new", element: <WhatsNew /> },
      // Tools with nested routes become a layout-less path prefix: the tool's own
      // element is the index (e.g. /planner) and its children sit alongside it
      // (e.g. /planner/:listId), each rendering directly in the AppShell outlet.
      ...liveTools.map((t) =>
        t.children
          ? { path: t.path, children: [{ index: true, element: t.element }, ...t.children] }
          : { path: t.path, element: t.element },
      ),
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
