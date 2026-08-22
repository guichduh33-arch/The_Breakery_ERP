// apps/pos/src/features/settings/components/PrinterTestPanel.tsx
//
// ADR-030 — déménagé depuis le back-office (bouton « Test » de LanDevicesTable),
// qui ne peut plus joindre un `http://` local une fois publié en HTTPS.
//
// Sonde puis ticket de test sur une imprimante enregistrée. Lecture seule sur le
// registre : renommer, ajouter ou supprimer un appareil reste au back-office.
import { useState, type JSX } from 'react';
import { Loader2, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@breakery/ui';
import type { PrinterRole } from '@breakery/domain';
import { probePrinter } from '@/services/print/bridgeDiagnostics';
import { printStationTicket } from '@/services/print/printService';
import { usePrinterDevices, type PrinterDevice } from '../hooks/usePrinterDevices';

export function PrinterTestPanel({ readOnly }: { readOnly: boolean }): JSX.Element {
  const { data, isLoading, error } = usePrinterDevices();
  const [testingId, setTestingId] = useState<string | null>(null);

  async function runTest(d: PrinterDevice): Promise<void> {
    if (d.ip_address === null || d.port === null) {
      toast.error('This printer has no IP/port configured.');
      return;
    }
    setTestingId(d.id);
    try {
      const probe = await probePrinter(d.ip_address, d.port);
      if (!probe.reachable) {
        toast.error(`${d.code}: printer unreachable on ${d.ip_address}:${d.port}`);
        return;
      }
      const res = await printStationTicket(
        { ip_address: d.ip_address, port: d.port },
        {
          kind: 'prep',
          role: (d.station ?? 'kitchen') as PrinterRole,
          order_number: 'TEST',
          created_at: new Date().toISOString(),
          server_name: 'POS Settings',
          items: [{ name: 'Test ticket — POS Settings', quantity: 1 }],
        },
      );
      if (res.success) toast.success(`${d.code}: test ticket sent (${probe.latencyMs ?? '?'} ms)`);
      else toast.error(`${d.code}: print failed — ${res.error ?? 'unknown'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      toast.error(
        msg === 'bridge_unreachable'
          ? 'Print-bridge unreachable — check the print server URL on the Printing tab and that the service is running.'
          : `Test failed: ${msg}`,
      );
    } finally {
      setTestingId(null);
    }
  }

  if (isLoading) return <p className="text-sm text-text-secondary">Loading printers…</p>;
  if (error !== null) {
    return <p className="text-sm text-danger">Failed to load printers: {error.message}</p>;
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        No printer registered yet. Add one in Back-office &raquo; LAN Devices.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Code, name, address and station per registered printer, with a test action
        </caption>
        <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
          <tr>
            <th scope="col" className="py-2 text-left">Code</th>
            <th scope="col" className="py-2 text-left">Name</th>
            <th scope="col" className="py-2 text-left">IP : Port</th>
            <th scope="col" className="py-2 text-left">Station</th>
            <th scope="col" className="py-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="border-b border-border-subtle">
              <td className="py-2 font-mono text-xs">{d.code}</td>
              <td className="py-2">{d.name}</td>
              <td className="py-2 font-mono text-xs">
                {d.ip_address !== null ? `${d.ip_address}${d.port !== null ? `:${d.port}` : ''}` : '—'}
              </td>
              <td className="py-2 text-xs">{d.station ?? '—'}</td>
              <td className="py-2 text-right">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Test ${d.code}`}
                  disabled={readOnly || testingId === d.id}
                  onClick={() => void runTest(d)}
                >
                  {testingId === d.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Radio className="h-4 w-4" aria-hidden />
                  )}
                  Test
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
