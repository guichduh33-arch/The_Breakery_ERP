import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
interface Device {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  paired_at: string | null;
  revoked_at: string | null;
  permissions: string[];
}
const CAPS = [
  'orders.publish',
  'orders.read',
  'kitchen.publish',
  'kitchen.read',
  'receipts.print',
  'tickets.print',
  'drawer.open',
  'payments.publish',
  'payments.read',
  'cart.publish',
  'cart.read',
  'diagnostics',
];
const LABELS: Record<string, string> = {
  'orders.publish': 'Send orders',
  'orders.read': 'Receive orders',
  'kitchen.publish': 'Update kitchen status',
  'kitchen.read': 'Receive kitchen status',
  'receipts.print': 'Print receipts',
  'tickets.print': 'Print kitchen tickets',
  'drawer.open': 'Open cash drawer',
  'payments.publish': 'Publish offline payments',
  'payments.read': 'Read offline payments',
  diagnostics: 'Network diagnostics',
};
const KEY = ['lan-device-authorizations'];
export function LanDeviceAccess() {
  const allowed = useAuthStore((s) => s.hasPermission('lan.devices.manage'));
  return allowed ? <Controls /> : null;
}
function Controls() {
  const session = useAuthStore((s) => s.sessionToken);
  const qc = useQueryClient();
  const [code, setCode] = useState<{ pairing_code: string; expires_at: string } | null>(null);
  const [selected, setSelected] = useState<Device | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{ action: string; id: string } | null>(null);
  async function call<T>(body: Record<string, unknown>): Promise<T> {
    if (!session) throw Error('Please sign in again.');
    const response: { data: T | null; error: unknown } = await supabase.functions.invoke<T>(
      'lan-device-access',
      {
        body,
        headers: { 'x-session-token': session },
      },
    );
    const { data, error } = response;
    if (error || data === null) throw Error('Unable to manage device access.');
    return data;
  }
  const devices = useQuery({
    queryKey: KEY,
    enabled: !!session,
    queryFn: () => call<Device[]>({ action: 'list' }),
    refetchInterval: 10_000,
  });
  const change = useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const result = await call<{ pairing_code?: string; expires_at?: string }>(input);
      if (result.pairing_code && result.expires_at)
        setCode({ pairing_code: result.pairing_code, expires_at: result.expires_at });
    },
    onSuccess: () => {
      setConfirm(null);
      setSelected(null);
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
  return (
    <Card padding="md" className="space-y-4">
      <h2 className="text-base font-semibold">Authorized LAN terminals</h2>
      <p className="text-sm text-text-secondary">
        Revocation reaches an offline hub when Internet returns. Use the local emergency block for
        immediate protection in the shop.
      </p>
      {code && (
        <div role="status">
          <p className="font-mono select-all">{code.pairing_code}</p>
          <p>Valid until {new Date(code.expires_at).toLocaleTimeString()}.</p>
          <Button variant="secondary" onClick={() => setCode(null)}>
            Hide code
          </Button>
        </div>
      )}
      {(devices.isError || change.isError) && (
        <p role="alert" className="text-danger-as-text">
          Unable to manage device access. Check your connection and permissions.
        </p>
      )}
      {devices.isPending && <p>Loading devices…</p>}
      {devices.data?.map((d) => (
        <div
          key={d.id}
          className="flex flex-wrap items-center gap-3 border-b border-border-subtle py-3"
        >
          <span className="flex-1">
            {d.name} ({d.code}) —{' '}
            {!d.is_active
              ? 'Inactive'
              : d.revoked_at
                ? 'Revoked'
                : d.paired_at
                  ? 'Paired'
                  : 'Not paired'}
          </span>
          <Button
            variant="secondary"
            disabled={change.isPending || !d.is_active}
            onClick={() => setConfirm({ action: 'issue', id: d.id })}
          >
            Create activation code
          </Button>
          <Button
            variant="secondary"
            disabled={change.isPending || !d.paired_at || !!d.revoked_at}
            onClick={() => {
              setSelected(d);
              setPermissions(d.permissions);
            }}
          >
            Permissions
          </Button>
          <Button
            variant="secondary"
            disabled={change.isPending || !!d.revoked_at}
            onClick={() => setConfirm({ action: 'revoke', id: d.id })}
          >
            Revoke
          </Button>
        </div>
      ))}
      {confirm && (
        <div className="space-y-2" role="alert">
          <p>
            {confirm.action === 'issue'
              ? 'Replace authorization and require pairing again?'
              : 'Revoke this terminal?'}
          </p>
          <Button
            disabled={change.isPending}
            onClick={() => change.mutate({ action: confirm.action, device_id: confirm.id })}
          >
            Confirm
          </Button>
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
        </div>
      )}
      {selected && (
        <section className="space-y-3" aria-label="Device permissions">
          <h3>{selected.name}</h3>
          <div className="grid gap-2">
            {CAPS.filter((cap) => LABELS[cap]).map((cap) => (
              <label key={cap} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={permissions.includes(cap)}
                  onChange={(e) =>
                    setPermissions((p) =>
                      e.target.checked ? [...p, cap] : p.filter((c) => c !== cap),
                    )
                  }
                />
                {LABELS[cap]}
              </label>
            ))}
          </div>
          <Button
            disabled={change.isPending}
            onClick={() =>
              change.mutate({ action: 'permissions', device_id: selected.id, permissions })
            }
          >
            Save permissions
          </Button>
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Cancel
          </Button>
        </section>
      )}
    </Card>
  );
}
