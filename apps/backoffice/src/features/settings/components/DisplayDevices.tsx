import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { supabase } from '@/lib/supabase.js';

interface Device {
  id: string;
  label: string;
  paired_at: string | null;
  revoked_at: string | null;
  pairing_expires_at: string;
}
interface PairingCode { id: string; pairing_code: string; expires_at: string }
const KEY = ['settings', 'display-devices'] as const;

export function DisplayDevices() {
  const allowed = useAuthStore((s) => s.hasPermission('kiosk.issue'));
  return allowed ? <DeviceControls /> : null;
}

function DeviceControls() {
  const sessionToken = useAuthStore((s) => s.sessionToken);
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [code, setCode] = useState<PairingCode | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function call<T>(body: Record<string, string>): Promise<T> {
    if (!sessionToken) throw new Error('Please sign in again.');
    const result = await supabase.functions.invoke<T>('kiosk-issue-jwt', {
      body, headers: { 'x-session-token': sessionToken },
    });
    const data = result.data;
    const error: unknown = result.error;
    if (error || data === null) throw new Error('Unable to manage displays. Check your connection and access.');
    return data;
  }
  const devices = useQuery({
    queryKey: [...KEY, sessionToken !== null], enabled: Boolean(sessionToken),
    queryFn: () => call<Device[]>({ action: 'list' }), refetchInterval: 10_000,
  });
  const create = useMutation({
    mutationFn: () => call<PairingCode>({ action: 'create', label: label.trim() }),
    onSuccess: (value) => { setCode(value); setLabel(''); void qc.invalidateQueries({ queryKey: KEY }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => call<{ ok: boolean }>({ action: 'revoke', device_id: id }),
    onSuccess: () => { setConfirmId(null); setCode(null); void qc.invalidateQueries({ queryKey: KEY }); },
  });

  return <section className="space-y-4 border-t border-border-subtle pt-6" aria-label="Authorized displays">
    <div>
      <h2 className="text-sm font-medium">Authorized displays</h2>
      <p className="text-sm text-text-secondary">Create a code here, then enter it on the customer display. Each code activates one device and expires after ten minutes.</p>
    </div>
    <form className="flex items-end gap-3" onSubmit={(event) => { event.preventDefault(); if (label.trim()) create.mutate(); }}>
      <label className="flex-1 space-y-1 text-sm">Display name
        <Input value={label} maxLength={80} onChange={(event) => { setLabel(event.target.value); }} placeholder="Front counter" />
      </label>
      <Button type="submit" variant="ink" disabled={!label.trim() || create.isPending}>Create pairing code</Button>
    </form>
    {code && <div className="space-y-2 border border-border-strong p-4" role="status">
      <p className="text-sm">Enter this code on the display:</p>
      <p className="font-mono text-xl select-all">{code.pairing_code.match(/.{1,4}/g)?.join('-')}</p>
      <p className="text-xs text-text-secondary">Expires at {new Date(code.expires_at).toLocaleTimeString()}.</p>
    </div>}
    {(devices.isError || create.isError || revoke.isError) && <p className="text-danger-as-text text-sm" role="alert">Unable to manage displays. Check your connection and access.</p>}
    {devices.isLoading && <p role="status">Loading displays…</p>}
    {devices.data?.length === 0 && <p className="text-sm text-text-secondary">No displays authorized yet.</p>}
    <ul className="divide-y divide-border-subtle">
      {devices.data?.map((device) => <li key={device.id} className="flex items-center justify-between gap-3 py-3">
        <div><p className="text-sm font-medium">{device.label}</p><p className="text-xs text-text-secondary">
          {device.revoked_at ? 'Access revoked' : device.paired_at ? 'Paired' : new Date(device.pairing_expires_at).getTime() < Date.now() ? 'Pairing code expired' : 'Waiting for pairing'}
        </p></div>
        {!device.revoked_at && (confirmId === device.id
          ? <div className="flex gap-2"><Button variant="ghostDestructive" disabled={revoke.isPending} onClick={() => { revoke.mutate(device.id); }}>Confirm revoke</Button>
            <Button variant="secondary" onClick={() => { setConfirmId(null); }}>Cancel</Button></div>
          : <Button variant="secondary" onClick={() => { setConfirmId(device.id); }}>Revoke access</Button>)}
      </li>)}
    </ul>
  </section>;
}
