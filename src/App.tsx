import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { useConnections } from "./store/connections";
import { Sidebar } from "./connection/Sidebar";
import { ConnectWizard } from "./connection/ConnectWizard";
import { StatusBanner } from "./connection/StatusBanner";
import { SchemaTree } from "./browser/SchemaTree";
import { TableView } from "./browser/TableView";
import { QueryTool } from "./query/QueryTool";
import { useWorkspace } from "./store/workspace";
import type { ConnState } from "./lib/types";
import "./styles/tokens.css";
import "./styles/app.css";

function App() {
  const { saved, states, activeId, loadSaved, applyStatus, connectSaved } =
    useConnections();
  // When true, show the wizard even if a connection is active (the "+ New" flow).
  const [showWizard, setShowWizard] = useState(false);

  // Load saved connections and subscribe to backend status pushes once.
  useEffect(() => {
    loadSaved();
    const unlisten = api.onStatus((e) => {
      const state: ConnState =
        e.state === "failed"
          ? { state: "failed", detail: e.detail ?? "" }
          : { state: e.state };
      applyStatus(e.id, state);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadSaved, applyStatus]);

  const { view, openQuery, clear } = useWorkspace();

  // Once a connection becomes active, leave the "+ New" wizard view.
  useEffect(() => {
    if (activeId) setShowWizard(false);
  }, [activeId]);

  // Switching connection resets what's open in the workspace.
  useEffect(() => {
    clear();
  }, [activeId, clear]);

  const active = activeId ? saved.find((c) => c.id === activeId) : undefined;
  const activeState = activeId ? states[activeId] : undefined;

  const wizardVisible = showWizard || !activeId;

  return (
    <div className="app">
      <Sidebar onNew={() => setShowWizard(true)} />

      <main className="main">
        {wizardVisible ? (
          <div className="center">
            <ConnectWizard />
          </div>
        ) : (
          <>
            {active && activeState && (
              <StatusBanner
                name={active.name || active.dbname}
                state={activeState}
                onRetry={() => connectSaved(active.id)}
              />
            )}
            {active && (
              <div className="workspace">
                <aside className="browser-panel">
                  <div className="browser-head">
                    <span className="browser-title">{active.name || active.dbname}</span>
                    <button
                      className={`btn-sql ${view?.kind === "query" ? "active" : ""}`}
                      onClick={openQuery}
                    >
                      SQL
                    </button>
                  </div>
                  <SchemaTree connId={active.id} />
                </aside>
                <section className="content">
                  {view?.kind === "table" ? (
                    <TableView table={view.table} />
                  ) : view?.kind === "query" ? (
                    <QueryTool connId={active.id} />
                  ) : (
                    <div className="content-empty">
                      Select a table to browse its data, or open the SQL editor.
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
