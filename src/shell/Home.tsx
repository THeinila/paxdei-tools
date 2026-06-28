/** Landing page: an intro and a grid of tool cards driven by the registry. Live
 * tools link to their route; "soon" tools render as dimmed, non-clickable cards. */
import { Link } from "react-router-dom";
import { tools } from "../tools/registry.tsx";

export default function Home() {
  return (
    <div className="home">
      <p className="home-intro">
        A growing suite of fan-made tools for the MMO <strong>Pax Dei</strong>.
      </p>
      <div className="tool-grid">
        {tools
          .filter((t) => t.status === "live")
          .map((t) => (
            <Link key={t.id} to={t.path} className="tool-card">
              <h2>{t.name}</h2>
              <p>{t.blurb}</p>
            </Link>
          ))}
        <div className="tool-card disabled" aria-disabled>
          <h2>More tools coming soon</h2>
        </div>
      </div>
    </div>
  );
}
