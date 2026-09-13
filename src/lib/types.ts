// TS mirror of the Rust types the backend serializes. Kept in one place so the
// command wrappers and components share a single contract.

export type SslMode = "disable" | "prefer" | "require";

export interface ConnConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  dbname: string;
  sslMode: SslMode;
}

// Mirrors Rust `ConnState` (serde tag = "state", content = "detail").
export type ConnState =
  | { state: "disconnected" }
  | { state: "connecting" }
  | { state: "connected" }
  | { state: "reconnecting" }
  | { state: "failed"; detail: string };

// Mirrors the serialized `AppError`.
export interface AppError {
  kind:
    | "connectionLost"
    | "unknownConnection"
    | "db"
    | "pool"
    | "keychain"
    | "other";
  message: string;
}

// Payload of the `conn://status` event.
export interface StatusEvent {
  id: string;
  state: ConnState["state"];
  detail?: string;
}
