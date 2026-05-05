import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { HeldOrder } from '@breakery/domain';

export const HELD_ORDERS_LIMIT = 20;

export class HeldOrdersLimitError extends Error {
  constructor() {
    super('Held orders limit reached');
    this.name = 'HeldOrdersLimitError';
  }
}

interface HeldOrdersState {
  entries: HeldOrder[];
  add: (held: HeldOrder) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useHeldOrdersStore = create<HeldOrdersState>()(
  persist(
    (set, get) => ({
      entries: [],

      add: (held) => {
        if (get().entries.length >= HELD_ORDERS_LIMIT) {
          throw new HeldOrdersLimitError();
        }
        set((s) => ({ entries: [...s.entries, held] }));
      },

      remove: (id) =>
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

      clear: () => set({ entries: [] }),
    }),
    {
      name: 'breakery-held-orders',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
