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

// --- schema browser (mirror pg/repo.rs) ---

export interface Schema {
  name: string;
}

export type ObjectKind = "table" | "view";

export interface DbObject {
  name: string;
  kind: ObjectKind;
}

export interface Column {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

/** A table/view the user selected in the tree, scoped to its connection. */
export interface TableRef {
  connId: string;
  schema: string;
  name: string;
  kind: ObjectKind;
}

/** One row as returned by `to_jsonb` — keyed by column name. */
export type Row = Record<string, unknown>;

export interface TablePage {
  columns: Column[];
  rows: Row[];
}

// Mirrors Rust `QueryResult` (serde tag = "kind").
export type QueryResult =
  | { kind: "rows"; columns: Column[]; rows: Row[] }
  | { kind: "command"; message: string };
