// Saved connections rail. One click reconnects (keychain password), so you're
// never retyping credentials every launch. Status dot mirrors live state.

import { useConnections } from "../store/connections";
import type { ConnState } from "../lib/types";

export function Sidebar({ onNew }: { onNew: () => void }) {
  const { saved, states, activeId, connectSaved, setActive } = useConnections();

  async function open(id: string) {
    const st = states[id]?.state;
    if (st === "connected") {
      setActive(id);
    } else {
      await connectSaved(id);
    }
  }

  return (
    <nav className="sidebar">
      <div className="wordmark">
        <b>dbx</b>
        <span>postgres</span>
      </div>

      <div className="side-label">Connections</div>
      <ul className="conn-list">
        {saved.length === 0 && (
          <li className="conn-sub" style={{ padding: "0 12px" }}>
            No saved connections yet.
          </li>
        )}
        {saved.map((c) => {
          const state: ConnState = states[c.id] ?? { state: "disconnected" };
          return (
            <li key={c.id}>
              <button
                className="conn-item"
                aria-current={activeId === c.id}
                onClick={() => open(c.id)}
              >
                <span className={`dot ${state.state}`} aria-hidden />
                <span className="conn-name">{c.name || c.dbname}</span>
                <span className="conn-sub">{c.host}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <button className="btn btn-ghost btn-block" onClick={onNew}>
        + New connection
      </button>
    </nav>
  );
}
