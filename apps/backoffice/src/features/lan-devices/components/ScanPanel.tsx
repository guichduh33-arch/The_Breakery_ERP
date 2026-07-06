// apps/backoffice/src/features/lan-devices/components/ScanPanel.tsx
// Scan réseau via le print-bridge (spec §5.2). Résultats croisés par IP avec
// les devices existants ; aucun auto-enregistrement — l'ajout passe par le form.
import { useRef, useState, type JSX } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { Button, Input } from '@breakery/ui';
import { useBridgeSettingsStore, resolveBridgeUrl } from '@/stores/bridgeSettingsStore.js';
import { scanPrinters, type ScanDeviceHit } from '../api/bridgeApi.js';
import { isPrivatePrefix } from '../utils/ipGuard.js';
import type { LanDeviceRow } from '../hooks/useLanDevices.js';

type ScanState = 'idle' | 'scanning' | 'done';

export function ScanPanel({ devices, onAdd }: {
  devices: LanDeviceRow[];
  onAdd: (prefill: { ip_address: string; port: number }) => void;
}): JSX.Element {
  const bridgeUrl = useBridgeSettingsStore((s) => s.bridgeUrl);
  const setBridgeUrl = useBridgeSettingsStore((s) => s.setBridgeUrl);
  const [prefix, setPrefix] = useState('192.168.1');
  const [state, setState] = useState<ScanState>('idle');
  const [hits, setHits] = useState<ScanDeviceHit[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function runScan(): Promise<void> {
    setErrorMsg(null);
    if (!isPrivatePrefix(prefix.trim())) {
      setErrorMsg('Enter a private network prefix (e.g. 192.168.1).');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setState('scanning');
    setHits([]);
    try {
      const res = await scanPrinters(resolveBridgeUrl(), prefix.trim(), controller.signal);
      setHits(res.devices);
      setState('done');
    } catch (err) {
      if (controller.signal.aborted) { setState('idle'); return; }
      const msg = err instanceof Error ? err.message : 'unknown';
      setErrorMsg(msg === 'bridge_unreachable'
        ? 'Print-bridge unreachable — check the bridge URL below and that the service is running on the shop PC.'
        : `Scan failed: ${msg}`);
      setState('idle');
    } finally {
      abortRef.current = null;
    }
  }

  function cancel(): void {
    abortRef.current?.abort();
  }

  const byIp = new Map(devices.filter((d) => d.ip_address !== null).map((d) => [d.ip_address!, d]));
  const labelCls = 'block font-bold uppercase tracking-widest text-text-muted text-xs mb-1';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
        <div>
          <label htmlFor="scan-bridge-url" className={labelCls}>Print-bridge URL</label>
          <Input id="scan-bridge-url" aria-label="Print-bridge URL" placeholder="http://localhost:3001"
            value={bridgeUrl} onChange={(e) => setBridgeUrl(e.target.value)} />
        </div>
        <div>
          <label htmlFor="scan-prefix" className={labelCls}>Network prefix</label>
          <Input id="scan-prefix" aria-label="Network prefix" placeholder="192.168.1"
            value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {state === 'scanning' ? (
          <>
            <Button variant="secondary" disabled>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Scanning…
            </Button>
            <Button variant="secondary" onClick={cancel}>
              <X className="h-4 w-4" aria-hidden /> Cancel
            </Button>
          </>
        ) : (
          <Button onClick={() => void runScan()}>
            <Search className="h-4 w-4" aria-hidden /> Scan network
          </Button>
        )}
      </div>

      {errorMsg !== null && <p className="text-sm text-danger">{errorMsg}</p>}

      {state === 'done' && hits.length === 0 && (
        <p className="text-sm text-text-secondary">
          No printer found on {prefix}.x — check the printer self-test page for its IP, or try
          another prefix.
        </p>
      )}

      {hits.length > 0 && (
        <table className="w-full text-sm max-w-2xl">
          <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
            <tr>
              <th className="py-2 text-left">Address</th>
              <th className="py-2 text-left">Latency</th>
              <th className="py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((h) => {
              const existing = byIp.get(h.ip);
              return (
                <tr key={h.ip} className="border-b border-border-subtle">
                  <td className="py-2 font-mono text-xs">{h.ip}:{h.port}</td>
                  <td className="py-2 text-xs">{h.latencyMs} ms</td>
                  <td className="py-2 text-right">
                    {existing !== undefined ? (
                      <span className="text-xs text-text-secondary">
                        Already configured — {existing.code}
                      </span>
                    ) : (
                      <Button variant="secondary" size="sm"
                        onClick={() => onAdd({ ip_address: h.ip, port: h.port })}>
                        Add
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
