// apps/backoffice/src/features/lan-devices/components/LanDevicesTable.tsx
// S13 (read-only) → 2026-07-06 : + IP/station + actions Edit/Delete
// (spec print-bridge §5.1). Actions gated lan.devices.manage.
//
// ADR-030 — le bouton « Test » (sonde + ticket) est parti dans POS » Settings »
// Devices : il tape sur le print-bridge en clair sur le réseau local, hors de
// portée d'une page servie en HTTPS.
import { useState, type JSX } from 'react';
import { toast } from 'sonner';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@breakery/ui';
import { formatDateTime } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { useLanDevices, type LanDeviceRow } from '../hooks/useLanDevices.js';
import { useDeleteLanDevice } from '../hooks/useDeleteLanDevice.js';

export function LanDevicesTable({ onEdit }: { onEdit: (device: LanDeviceRow) => void }): JSX.Element {
  const { data, isLoading, error } = useLanDevices();
  const canManage = useAuthStore((s) => s.hasPermission('lan.devices.manage'));
  const deleteDevice = useDeleteLanDevice();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (isLoading) return <div className="text-sm text-text-secondary">Loading LAN devices…</div>;
  if (error !== null) {
    return <div className="text-sm text-danger">Failed to load LAN devices: {error.message}</div>;
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <div className="text-sm text-text-secondary">
        No LAN devices registered yet. Use &laquo; Add device &raquo; above — run a
        network scan from POS &raquo; Settings &raquo; Devices to find a printer&apos;s address.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Code, name, type, address and port, station, status and last heartbeat per LAN device</caption>
        <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
          <tr>
            <th scope="col" className="py-2 text-left">Code</th>
            <th scope="col" className="py-2 text-left">Name</th>
            <th scope="col" className="py-2 text-left">Type</th>
            <th scope="col" className="py-2 text-left">IP : Port</th>
            <th scope="col" className="py-2 text-left">Station</th>
            <th scope="col" className="py-2 text-left">Status</th>
            <th scope="col" className="py-2 text-left">Last heartbeat</th>
            {canManage && <th scope="col" className="py-2 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const isStale = d.last_heartbeat_at === null
              ? true
              : Date.now() - new Date(d.last_heartbeat_at).getTime() > 60_000;
            const station = typeof d.capabilities.station === 'string' ? d.capabilities.station : null;
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
                  {d.last_heartbeat_at !== null ? formatDateTime(d.last_heartbeat_at) : 'never'}
                </td>
                {canManage && (
                  <td className="py-2 text-right space-x-1 whitespace-nowrap">
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
    </div>
  );
}
