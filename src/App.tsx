import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { useConnections } from "./store/connections";
import { Sidebar } from "./connection/Sidebar";
import { ConnectWizard } from "./connection/ConnectWizard";
import { StatusBanner } from "./connection/StatusBanner";
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

  // Once a connection becomes active, leave the "+ New" wizard view.
  useEffect(() => {
    if (activeId) setShowWizard(false);
  }, [activeId]);

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
            <div className="workspace-empty">
              Schema browser & query tools land here next.
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
