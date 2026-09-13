// Inline connection status — the anti-modal. Always visible when a connection is
// active, colored by state, with a Retry affordance on failure. This is the
// fix for pgAdmin's "Cancel/Continue" dialog spam and blank-grid-on-drop.

import type { ConnState } from "../lib/types";

const LABEL: Record<ConnState["state"], string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Connection dropped — reconnecting…",
  failed: "Connection failed",
};

export function StatusBanner({
  name,
  state,
  onRetry,
}: {
  name: string;
  state: ConnState;
  onRetry: () => void;
}) {
  const detail = state.state === "failed" ? state.detail : undefined;
  return (
    <div className={`banner ${state.state}`} role="status" aria-live="polite">
      <span className="banner-msg">
        <strong>{name}</strong> — {LABEL[state.state]}
        {detail ? `: ${detail}` : ""}
      </span>
      {state.state === "failed" && (
        <button className="btn btn-ghost" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
