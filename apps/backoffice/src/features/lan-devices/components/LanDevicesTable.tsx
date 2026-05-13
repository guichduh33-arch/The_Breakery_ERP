// apps/backoffice/src/features/lan-devices/components/LanDevicesTable.tsx
// Session 13 / Phase 5.A — read-only LAN devices table.

import { useLanDevices } from '../hooks/useLanDevices.js';

export function LanDevicesTable() {
  const { data, isLoading, error } = useLanDevices();

  if (isLoading) {
    return <div className="text-sm text-text-secondary">Loading LAN devices…</div>;
  }
  if (error !== null) {
    return (
      <div className="text-sm text-state-danger">
        Failed to load LAN devices: {(error as Error).message}
      </div>
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <div className="text-sm text-text-secondary">
        No LAN devices registered yet. Devices appear here after their first
        heartbeat is received.
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
          <th className="py-2 text-left">Location</th>
          <th className="py-2 text-left">Status</th>
          <th className="py-2 text-left">Last heartbeat</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const isStale = d.last_heartbeat_at === null
            ? true
            : Date.now() - new Date(d.last_heartbeat_at).getTime() > 60_000;
          return (
            <tr key={d.id} className="border-b border-border-subtle">
              <td className="py-2 font-mono text-xs">{d.code}</td>
              <td className="py-2">{d.name}</td>
              <td className="py-2 capitalize">{d.device_type.replace('_', ' ')}</td>
              <td className="py-2 text-text-secondary">{d.location ?? '—'}</td>
              <td className="py-2">
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs ${
                    isStale
                      ? 'bg-state-danger-soft text-state-danger'
                      : 'bg-state-success-soft text-state-success'
                  }`}
                >
                  {isStale ? 'stale' : 'online'}
                </span>
              </td>
              <td className="py-2 font-mono text-xs">
                {d.last_heartbeat_at !== null
                  ? new Date(d.last_heartbeat_at).toLocaleString()
                  : 'never'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
