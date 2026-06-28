/** Route table: the AppShell layout wraps the landing page and every live tool
 * (routes generated from the registry). Unknown paths redirect home. */
import { createBrowserRouter, Navigate } from "react-router-dom";
import AppShell from "./shell/AppShell.tsx";
import Home from "./shell/Home.tsx";
import { liveTools } from "./tools/registry.tsx";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      ...liveTools.map((t) => ({ path: t.path, element: t.element })),
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
