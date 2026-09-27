import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '@/lib/supabase';
export interface LanCredential {
  id: string;
  code: string;
  device_type: string;
  secret: string;
}
interface State {
  credential: LanCredential | null;
  setCredential: (value: LanCredential | null) => void;
}
export const useLanCredential = create<State>()(
  persist(
    (set) => ({
      credential: null,
      setCredential: (credential) => set({ credential }),
    }),
    { name: 'lan:device', partialize: (s) => ({ credential: s.credential }) },
  ),
);
export function lanHeaders(): Record<string, string> {
  const d = useLanCredential.getState().credential;
  if (!d) throw new Error('Pair this terminal in Settings > Devices.');
  return { 'x-lan-device-code': d.code, 'x-lan-secret': d.secret };
}
export async function pairLanDevice(code: string): Promise<LanCredential> {
  const key = 'lan:pairing-pending';
  let pending: { code: string; secret: string } | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(key) ?? 'null') as {
      code: string;
      secret: string;
    } | null;
  } catch {
    /* Nouveau code. */
  }
  if (pending?.code !== code) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    pending = { code, secret: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') };
    sessionStorage.setItem(key, JSON.stringify(pending));
  }
  const response: { data: { id: string; code: string; device_type: string } | null; error: unknown } =
    await supabase.functions.invoke<{
      id: string;
      code: string;
      device_type: string;
    }>('lan-device-access', {
      body: { action: 'pair' },
      headers: { 'x-lan-secret': pending.secret, 'x-lan-pairing-code': code },
    });
  const { data, error } = response;
  if (
    error ||
    !data ||
    typeof data.id !== 'string' ||
    typeof data.code !== 'string' ||
    !['pos', 'tablet', 'kds'].includes(data.device_type)
  )
    throw new Error('Activation failed. Check the code and your connection.');
  const credential = { ...data, secret: pending.secret };
  useLanCredential.getState().setCredential(credential);
  sessionStorage.removeItem(key);
  return credential;
}
