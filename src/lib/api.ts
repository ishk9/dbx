// Thin, typed wrappers over Tauri commands. Components call these, never
// `invoke` directly — one place to keep the command names and shapes honest.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Column,
  ConnConfig,
  ConnState,
  DbObject,
  QueryResult,
  Row,
  Schema,
  StatusEvent,
  TablePage,
} from "./types";

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

  // --- schema browser (lazy-loaded tree) ---

  listSchemas(id: string): Promise<Schema[]> {
    return invoke("list_schemas", { id });
  },

  listObjects(id: string, schema: string): Promise<DbObject[]> {
    return invoke("list_objects", { id, schema });
  },

  listColumns(id: string, schema: string, table: string): Promise<Column[]> {
    return invoke("list_columns", { id, schema, table });
  },

  // --- table data + grid CRUD ---

  tableRows(
    id: string,
    schema: string,
    table: string,
    limit: number,
    offset: number,
  ): Promise<TablePage> {
    return invoke("table_rows", { id, schema, table, limit, offset });
  },

  insertRow(id: string, schema: string, table: string, values: Row): Promise<Row> {
    return invoke("insert_row", { id, schema, table, values });
  },

  updateRow(
    id: string,
    schema: string,
    table: string,
    pk: Row,
    changes: Row,
  ): Promise<number> {
    return invoke("update_row", { id, schema, table, pk, changes });
  },

  deleteRow(id: string, schema: string, table: string, pk: Row): Promise<number> {
    return invoke("delete_row", { id, schema, table, pk });
  },

  // --- ad-hoc SQL ---

  runQuery(id: string, sql: string): Promise<QueryResult> {
    return invoke("run_query", { id, sql });
  },
};
