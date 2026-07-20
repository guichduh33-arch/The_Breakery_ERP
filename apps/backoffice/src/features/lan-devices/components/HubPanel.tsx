// apps/backoffice/src/features/lan-devices/components/HubPanel.tsx
// Spec 006x lot 1 — état du hub LAN vu depuis le print-bridge : joignable ou
// non, appareils connectés au bus (présence temps réel LOCALE, distincte du
// heartbeat cloud de la table lan_devices), stats du ring-buffer, token.
import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CloudOff, CloudUpload, Radio, ShieldCheck, ShieldOff } from 'lucide-react';
import { resolveBridgeUrl } from '@/stores/bridgeSettingsStore.js';
import { getHubStatus } from '../api/bridgeApi.js';

const REFRESH_MS = 10_000;

function formatUptime(totalS: number): string {
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${totalS % 60}s`;
}

export function HubPanel(): JSX.Element {
  const { data, isError, isPending } = useQuery({
    queryKey: ['hub-status'],
    queryFn: () => getHubStatus(resolveBridgeUrl()),
    refetchInterval: REFRESH_MS,
    retry: false,
  });

  if (isPending) {
    return <p className="text-sm text-text-secondary">Contacting the hub…</p>;
  }
  if (isError) {
    return (
      <p className="text-sm text-text-secondary">
        Hub unreachable — check the bridge URL in the scan panel below and that
        the print-bridge service is running on the shop PC.
      </p>
    );
  }
  if (!data.enabled) {
    return (
      <p className="text-sm text-text-secondary">
        The bridge answered but its hub is disabled — update the print-bridge
        service to a build with hub support.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-1 text-success">
          <Radio className="h-4 w-4" aria-hidden /> Hub online
        </span>
        <span>v{data.version}</span>
        <span>up {formatUptime(data.uptime_s)}</span>
        <span className="inline-flex items-center gap-1">
          {data.token_required ? (
            <><ShieldCheck className="h-4 w-4 text-success" aria-hidden /> Token required</>
          ) : (
            <><ShieldOff className="h-4 w-4 text-warning" aria-hidden /> No token (set HUB_TOKEN)</>
          )}
        </span>
        <span>
          Buffer: {data.buffer.count} message{data.buffer.count === 1 ? '' : 's'}
        </span>
        {/* Spec 006x lot 2 — le hub est l'écrivain cloud du heartbeat. */}
        {data.cloud_sync?.enabled === true ? (
          <span className="inline-flex items-center gap-1">
            <CloudUpload
              className={`h-4 w-4 ${data.cloud_sync.last_result === 'error' ? 'text-warning' : 'text-success'}`}
              aria-hidden
            />
            {data.cloud_sync.last_result === 'error'
              ? `Cloud sync failing (${data.cloud_sync.last_error ?? 'unknown'})`
              : data.cloud_sync.last_push_at !== null
                ? `Cloud sync ${new Date(data.cloud_sync.last_push_at).toLocaleTimeString()}`
                : 'Cloud sync idle'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <CloudOff className="h-4 w-4 text-warning" aria-hidden />
            Cloud sync off (set HUB_CLOUD_URL + HUB_CLOUD_SECRET)
          </span>
        )}
      </div>

      {data.devices.length === 0 ? (
        <p className="text-sm text-text-secondary">
          No device connected to the hub bus yet. Terminals join automatically
          once their device code is set in POS Settings → Devices.
        </p>
      ) : (
        <table className="w-full text-sm max-w-2xl">
          <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
            <tr>
              <th className="py-2 text-left">Device</th>
              <th className="py-2 text-left">Type</th>
              <th className="py-2 text-left">IP</th>
              <th className="py-2 text-left">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {data.devices.map((d, i) => (
              <tr key={`${d.device_code}-${i}`} className="border-b border-border-subtle">
                <td className="py-2 font-mono text-xs">{d.device_code}</td>
                <td className="py-2 text-xs">{d.device_type}</td>
                <td className="py-2 font-mono text-xs">{d.ip}</td>
                <td className="py-2 text-xs">{new Date(d.last_seen_at).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
