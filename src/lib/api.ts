// Thin, typed wrappers over Tauri commands. Components call these, never
// `invoke` directly — one place to keep the command names and shapes honest.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ConnConfig, ConnState, StatusEvent } from "./types";

/** New-connection form data: a config plus its plaintext password (never persisted to disk in the clear). */
export interface ConnectInput {
  config: ConnConfig;
  password: string;
  /** Persist config + keychain password so it survives restarts. */
  save: boolean;
}

export const api = {
  testConnection(config: ConnConfig, password: string): Promise<void> {
    return invoke("test_connection", { config, password });
  },

  connect(input: ConnectInput): Promise<ConnState> {
    return invoke("connect", {
      config: input.config,
      password: input.password,
      save: input.save,
    });
  },

  connectSaved(id: string): Promise<ConnState> {
    return invoke("connect_saved", { id });
  },

  disconnect(id: string): Promise<void> {
    return invoke("disconnect", { id });
  },

  listConnections(): Promise<ConnConfig[]> {
    return invoke("list_connections");
  },

  deleteConnection(id: string): Promise<void> {
    return invoke("delete_connection", { id });
  },

  connectionState(id: string): Promise<ConnState | null> {
    return invoke("connection_state", { id });
  },

  /** Subscribe to backend-pushed connection status (drives the inline banner). */
  onStatus(handler: (e: StatusEvent) => void): Promise<UnlistenFn> {
    return listen<StatusEvent>("conn://status", (event) => handler(event.payload));
  },
};
