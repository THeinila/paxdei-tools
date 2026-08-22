/** Site-level chrome shared by every tool: the header (brand + tool nav) and the
 * footer (site-wide disclaimer). The routed tool renders into <Outlet/>. Tool-
 * specific actions (e.g. the planner's Share button) live inside the tool, not here. */
import { Suspense } from "react";
import { NavLink, Link, Outlet } from "react-router-dom";
import { tools } from "../tools/registry.tsx";

export default function AppShell() {
  return (
    <div className="app">
      <header className="site-header">
        <Link to="/" className="brand">
          Pax Dei Tools
        </Link>
        <nav className="site-nav">
          {tools.map((t) => (
            <NavLink
              key={t.id}
              to={t.path}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              {t.name}
            </NavLink>
          ))}
          <NavLink
            to="/whats-new"
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            What's New
          </NavLink>
        </nav>
      </header>

      <main>
        {/* Tools are lazy (see tools/registry.tsx), so the outlet needs a
            boundary while a tool's code and data chunks arrive. */}
        <Suspense fallback={<p className="hint">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>

      <footer className="footer">
        Fan project · not affiliated with Mainframe Industries ·{" "}
        <Link to="/whats-new" className="footer-version" title="What's new">
          v{__APP_VERSION__}
        </Link>
      </footer>
    </div>
  );
}
