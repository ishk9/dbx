// What the user is looking at inside the active connection: the selected table
// (drives the data grid) and, later, open query tabs. Kept separate from the
// connections store so connection lifecycle and view state don't entangle.

import { create } from "zustand";
import type { TableRef } from "../lib/types";

type View = { kind: "table"; table: TableRef } | { kind: "query" } | null;

interface WorkspaceStore {
  view: View;
  openTable: (table: TableRef) => void;
  openQuery: () => void;
  clear: () => void;
}

export const useWorkspace = create<WorkspaceStore>((set) => ({
  view: null,
  openTable: (table) => set({ view: { kind: "table", table } }),
  openQuery: () => set({ view: { kind: "query" } }),
  clear: () => set({ view: null }),
}));
