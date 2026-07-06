// apps/backoffice/src/features/lan-devices/components/LanDevicesTable.tsx
// S13 (read-only) → 2026-07-06 : + IP/station + actions Edit/Delete/Test
// (spec print-bridge §5.1). Actions gated lan.devices.manage.
import { useState, type JSX } from 'react';
import { toast } from 'sonner';
import { Pencil, Trash2, Radio, Loader2 } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { resolveBridgeUrl } from '@/stores/bridgeSettingsStore.js';
import { probePrinter, sendTestTicket } from '../api/bridgeApi.js';
import { useLanDevices, type LanDeviceRow } from '../hooks/useLanDevices.js';
import { useDeleteLanDevice } from '../hooks/useDeleteLanDevice.js';

export function LanDevicesTable({ onEdit }: { onEdit: (device: LanDeviceRow) => void }): JSX.Element {
  const { data, isLoading, error } = useLanDevices();
  const canManage = useAuthStore((s) => s.hasPermission('lan.devices.manage'));
  const deleteDevice = useDeleteLanDevice();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  async function runTest(d: LanDeviceRow): Promise<void> {
    if (d.ip_address === null || d.port === null) {
      toast.error('This printer has no IP/port configured.');
      return;
    }
    setTestingId(d.id);
    try {
      const bridge = resolveBridgeUrl();
      const probe = await probePrinter(bridge, d.ip_address, d.port);
      if (!probe.reachable) {
        toast.error(`${d.code}: printer unreachable on ${d.ip_address}:${d.port}`);
        return;
      }
      const station = typeof d.capabilities?.['station'] === 'string' ? (d.capabilities['station'] as string) : 'kitchen';
      const res = await sendTestTicket(bridge, { ip_address: d.ip_address, port: d.port }, station);
      if (res.success) toast.success(`${d.code}: test ticket sent (${probe.latencyMs ?? '?'} ms)`);
      else toast.error(`${d.code}: print failed — ${res.error ?? 'unknown'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      toast.error(msg === 'bridge_unreachable'
        ? 'Print-bridge unreachable — check the bridge URL and that the service is running.'
        : `Test failed: ${msg}`);
    } finally {
      setTestingId(null);
    }
  }

  if (isLoading) return <div className="text-sm text-text-secondary">Loading LAN devices…</div>;
  if (error !== null) {
    return <div className="text-sm text-danger">Failed to load LAN devices: {(error as Error).message}</div>;
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <div className="text-sm text-text-secondary">
        No LAN devices registered yet. Add one manually or run a network scan above.
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
        <tr>
          <th className="py-2 text-left">Code</th>
          <th className="py-2 text-left">Name</th>
          <th className="py-2 text-left">Type</th>
          <th className="py-2 text-left">IP : Port</th>
          <th className="py-2 text-left">Station</th>
          <th className="py-2 text-left">Status</th>
          <th className="py-2 text-left">Last heartbeat</th>
          {canManage && <th className="py-2 text-right">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const isStale = d.last_heartbeat_at === null
            ? true
            : Date.now() - new Date(d.last_heartbeat_at).getTime() > 60_000;
          const station = typeof d.capabilities?.['station'] === 'string' ? (d.capabilities['station'] as string) : null;
          return (
            <tr key={d.id} className="border-b border-border-subtle">
              <td className="py-2 font-mono text-xs">{d.code}</td>
              <td className="py-2">{d.name}</td>
              <td className="py-2 capitalize">{d.device_type.replace('_', ' ')}</td>
              <td className="py-2 font-mono text-xs">
                {d.ip_address !== null ? `${d.ip_address}${d.port !== null ? `:${d.port}` : ''}` : '—'}
              </td>
              <td className="py-2">
                {station !== null
                  ? <span className="inline-block px-2 py-0.5 rounded text-xs bg-bg-overlay">{station}</span>
                  : '—'}
              </td>
              <td className="py-2">
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                  isStale ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'
                }`}>
                  {isStale ? 'stale' : 'online'}
                </span>
              </td>
              <td className="py-2 font-mono text-xs">
                {d.last_heartbeat_at !== null ? new Date(d.last_heartbeat_at).toLocaleString() : 'never'}
              </td>
              {canManage && (
                <td className="py-2 text-right space-x-1 whitespace-nowrap">
                  {d.device_type === 'printer' && (
                    <Button variant="secondary" size="sm" aria-label={`Test ${d.code}`}
                      disabled={testingId === d.id} onClick={() => void runTest(d)}>
                      {testingId === d.id
                        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        : <Radio className="h-4 w-4" aria-hidden />}
                      Test
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" aria-label={`Edit ${d.code}`} onClick={() => onEdit(d)}>
                    <Pencil className="h-4 w-4" aria-hidden /> Edit
                  </Button>
                  {confirmingId === d.id ? (
                    <Button variant="ghostDestructive" size="sm" aria-label={`Confirm delete ${d.code}`}
                      disabled={deleteDevice.isPending}
                      onClick={() => deleteDevice.mutate({ id: d.id }, {
                        onSuccess: () => { toast.success(`${d.code} removed`); setConfirmingId(null); },
                        onError: (e) => { toast.error(e.message); setConfirmingId(null); },
                      })}>
                      Confirm?
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" aria-label={`Delete ${d.code}`}
                      onClick={() => setConfirmingId(d.id)}>
                      <Trash2 className="h-4 w-4" aria-hidden /> Delete
                    </Button>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
