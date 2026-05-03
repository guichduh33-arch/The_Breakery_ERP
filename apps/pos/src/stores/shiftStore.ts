// apps/pos/src/stores/shiftStore.ts
import { create } from 'zustand';

export interface ActiveShift {
  id: string;
  opened_at: string;
  opening_cash: number;
}

interface ShiftState {
  current: ActiveShift | null;
  setCurrent: (s: ActiveShift | null) => void;
  clear: () => void;
}

export const useShiftStore = create<ShiftState>((set) => ({
  current: null,
  setCurrent: (s) => set({ current: s }),
  clear: () => set({ current: null }),
}));
