// apps/pos/src/features/settings/components/NetworkScanPanel.tsx
//
// ADR-030 — déménagé depuis le back-office (`features/lan-devices/components/ScanPanel`),
// qui ne peut plus joindre un `http://` local une fois publié en HTTPS.
//
// Différence assumée avec la version back-office : PAS de bouton « Add ». Le
// registre des appareils est une donnée cloud, il reste géré depuis le BO. Ici
// on découvre une adresse et on la copie ; l'enregistrement se fait dans
// Back-office » LAN Devices.
import { useRef, useState, type JSX } from 'react';
import { Copy, Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input } from '@breakery/ui';
import { scanPrinters, type ScanDeviceHit } from '@/services/print/bridgeDiagnostics';
import { isPrivatePrefix } from '@/features/lan/utils/ipGuard';
import { usePrinterDevices } from '../hooks/usePrinterDevices';

type ScanState = 'idle' | 'scanning' | 'done';

export function NetworkScanPanel({ readOnly }: { readOnly: boolean }): JSX.Element {
  const { data: printers } = usePrinterDevices();
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
      const res = await scanPrinters(prefix.trim(), controller.signal);
      setHits(res.devices);
      setState('done');
    } catch (err) {
      if (controller.signal.aborted) {
        setState('idle');
        return;
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      setErrorMsg(
        msg === 'bridge_unreachable'
          ? 'Print-bridge unreachable — check the print server URL on the Printing tab and that the service is running on the shop PC.'
          : `Scan failed: ${msg}`,
      );
      setState('idle');
    } finally {
      abortRef.current = null;
    }
  }

  function cancel(): void {
    abortRef.current?.abort();
  }

  async function copyAddress(hit: ScanDeviceHit): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${hit.ip}:${hit.port}`);
      toast.success(`${hit.ip}:${hit.port} copied — paste it in BO » LAN Devices`);
    } catch {
      toast.error('Could not copy — write the address down instead.');
    }
  }

  const byIp = new Map(
    (printers ?? []).filter((d) => d.ip_address !== null).map((d) => [d.ip_address!, d]),
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2 max-w-xs">
        <label
          htmlFor="scan-prefix"
          className="block font-bold uppercase tracking-widest text-text-muted text-xs"
        >
          Network prefix
        </label>
        <Input
          id="scan-prefix"
          aria-label="Network prefix"
          placeholder="192.168.1"
          value={prefix}
          disabled={readOnly}
          onChange={(e) => setPrefix(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-2">
        {state === 'scanning' ? (
          <>
            <Button variant="secondary" size="sm" disabled>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Scanning…
            </Button>
            <Button variant="secondary" size="sm" onClick={cancel}>
              <X className="h-4 w-4" aria-hidden /> Cancel
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" disabled={readOnly} onClick={() => void runScan()}>
            <Search className="h-4 w-4" aria-hidden /> Scan network
          </Button>
        )}
      </div>

      {errorMsg !== null && <p className="text-sm text-danger-as-text">{errorMsg}</p>}

      {state === 'done' && hits.length === 0 && (
        <p className="text-sm text-text-secondary">
          No printer found on {prefix}.x — check the printer self-test page for
          its IP, or try another prefix.
        </p>
      )}

      {hits.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Address and latency per printer found on the scanned subnet
            </caption>
            <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
              <tr>
                <th scope="col" className="py-2 text-left">Address</th>
                <th scope="col" className="py-2 text-left">Latency</th>
                <th scope="col" className="py-2 text-right">Action</th>
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
                          Already registered — {existing.code}
                        </span>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={`Copy ${h.ip}:${h.port}`}
                          onClick={() => void copyAddress(h)}
                        >
                          <Copy className="h-4 w-4" aria-hidden /> Copy
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-text-muted">
        Found a new printer? Register it in Back-office &raquo; LAN Devices — the
        device registry lives in the cloud and is managed there.
      </p>
    </div>
  );
}
