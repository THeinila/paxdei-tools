/** User-facing "What's New" page: plain-language release highlights rendered from the
 * structured `releases` data (src/shell/releases.ts). This is the friendly counterpart
 * to the technical CHANGELOG.md — changes are grouped New / Improved / Fixed, per tool. */
import { releases, type ChangeKind } from "./releases.ts";

const kindLabel: Record<ChangeKind, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
};

function friendlyDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function WhatsNew() {
  return (
    <>
      <div className="tool-header">
        <h2 className="tool-title">What's New</h2>
      </div>

      <div className="whatsnew">
        {releases.map((r) => (
          <section key={r.version} className="release">
            <div className="release-head">
              <h3 className="release-version">
                v{r.version}
                {r.title && <span className="release-title"> · {r.title}</span>}
              </h3>
              <span className="release-date">{friendlyDate(r.date)}</span>
            </div>

            {r.sections.map((s, i) => (
              <div key={i} className="release-section">
                {s.tool && <h4 className="release-tool">{s.tool}</h4>}
                <ul className="change-list">
                  {s.changes.map((c, j) => (
                    <li key={j} className="change">
                      <span className={`change-kind ${c.kind}`}>{kindLabel[c.kind]}</span>
                      <span className="change-text">{c.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
