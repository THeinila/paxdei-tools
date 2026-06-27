import { Search, Icon } from "./components/Search.tsx";
import { PlanView } from "./components/PlanView.tsx";
import { getItem, itemName } from "./lib/data.ts";
import { useList } from "./lib/useList.ts";

export default function App() {
  const { state, result, addTarget, setTargetQty, setOwned, setPathChoice, clear } = useList();

  return (
    <div className="app">
      <header className="header">
        <h1>Pax Dei Planner</h1>
        <span className="tagline">Plan crafts &amp; gathering — Teamcraft-style</span>
      </header>

      <Search onAdd={(id, qty) => addTarget(id, qty)} />

      <section className="targets">
        <div className="targets-head">
          <h2>Crafting list</h2>
          {state.targets.length > 0 && (
            <button className="link-btn" onClick={clear}>
              clear
            </button>
          )}
        </div>
        {state.targets.length === 0 ? (
          <p className="hint">Search above and add items you want to craft.</p>
        ) : (
          <ul className="rows">
            {state.targets.map((t) => (
              <li key={t.itemId} className="row">
                <Icon item={getItem(t.itemId)} />
                <span className="row-name">{itemName(t.itemId)}</span>
                <input
                  className="target-qty"
                  type="number"
                  min={0}
                  value={t.quantity}
                  onChange={(e) => setTargetQty(t.itemId, Math.max(0, Number(e.target.value) || 0))}
                />
                <button className="link-btn" onClick={() => setTargetQty(t.itemId, 0)}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PlanView
        result={result}
        owned={state.owned}
        pathChoices={state.pathChoices}
        setOwned={setOwned}
        setPathChoice={setPathChoice}
      />

      <footer className="footer">
        Data scraped from paxdei.gaming.tools · fan project, not affiliated with Mainframe
      </footer>
    </div>
  );
}
