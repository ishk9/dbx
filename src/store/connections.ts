// Connection store: the saved list, each connection's live state, and which one
// is active. Backend `conn://status` events flow straight into `states` so the
// UI always reflects the real connection state (no optimistic guessing).

import { create } from "zustand";
import { api, type ConnectInput } from "../lib/api";
import type { ConnConfig, ConnState } from "../lib/types";

interface ConnectionsStore {
  saved: ConnConfig[];
  states: Record<string, ConnState>;
  activeId: string | null;

  loadSaved: () => Promise<void>;
  connect: (input: ConnectInput) => Promise<void>;
  connectSaved: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  applyStatus: (id: string, state: ConnState) => void;
}

export const useConnections = create<ConnectionsStore>((set, get) => ({
  saved: [],
  states: {},
  activeId: null,

  loadSaved: async () => {
    set({ saved: await api.listConnections() });
  },

  connect: async (input) => {
    set((s) => ({ states: { ...s.states, [input.config.id]: { state: "connecting" } } }));
    const state = await api.connect(input);
    set((s) => ({
      states: { ...s.states, [input.config.id]: state },
      activeId: input.config.id,
    }));
    if (input.save) await get().loadSaved();
  },

  connectSaved: async (id) => {
    set((s) => ({ states: { ...s.states, [id]: { state: "connecting" } } }));
    const state = await api.connectSaved(id);
    set((s) => ({ states: { ...s.states, [id]: state }, activeId: id }));
  },

  disconnect: async (id) => {
    await api.disconnect(id);
    set((s) => ({
      states: { ...s.states, [id]: { state: "disconnected" } },
      activeId: s.activeId === id ? null : s.activeId,
    }));
  },

  remove: async (id) => {
    await api.deleteConnection(id);
    set((s) => {
      const states = { ...s.states };
      delete states[id];
      return {
        saved: s.saved.filter((c) => c.id !== id),
        states,
        activeId: s.activeId === id ? null : s.activeId,
      };
    });
  },

  setActive: (id) => set({ activeId: id }),

  applyStatus: (id, state) =>
    set((s) => ({ states: { ...s.states, [id]: state } })),
}));
