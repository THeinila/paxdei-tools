/** Site-level chrome shared by every tool: the header (brand + tool nav) and the
 * footer (site-wide disclaimer). The routed tool renders into <Outlet/>. Tool-
 * specific actions (e.g. the planner's Share button) live inside the tool, not here. */
import { NavLink, Link, Outlet } from "react-router-dom";
import { liveTools } from "../tools/registry.tsx";

export default function AppShell() {
  return (
    <div className="app">
      <header className="site-header">
        <Link to="/" className="brand">
          Pax Dei Tools
        </Link>
        <nav className="site-nav">
          {liveTools.map((t) => (
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
        <Outlet />
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
