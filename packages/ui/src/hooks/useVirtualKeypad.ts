import { createContext, useContext } from 'react';

export type VkpLayout = 'qwerty' | 'numeric';
export type VkpTarget = HTMLInputElement | HTMLTextAreaElement;

export interface VirtualKeypadCtx {
  openFor: (el: VkpTarget, layout: VkpLayout) => void;
  close: () => void;
}

export const VirtualKeypadContext = createContext<VirtualKeypadCtx | null>(null);

export function useVirtualKeypad(): VirtualKeypadCtx {
  const ctx = useContext(VirtualKeypadContext);
  if (!ctx) throw new Error('useVirtualKeypad must be used within VirtualKeypadProvider');
  return ctx;
}
