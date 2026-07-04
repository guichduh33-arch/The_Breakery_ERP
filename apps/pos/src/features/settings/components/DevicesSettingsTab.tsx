// apps/pos/src/features/settings/components/DevicesSettingsTab.tsx
//
// POS Settings → Devices. The hardware hub for this terminal: the print-server
// URL (shared with the Printing tab via posSettingsStore) plus REAL device
// checks against that server — connection probe, a test receipt, and a cash
// drawer kick. All three call printService, so what works here is exactly what
// the POS uses at checkout.
import { useState, type JSX } from 'react';
import { Plug, Printer, Inbox, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, Input, SectionLabel } from '@breakery/ui';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import {
  checkPrintServer,
  printReceipt,
  openCashDrawer,
  type ReceiptPayload,
} from '@/services/print/printService';

type Probe = 'idle' | 'busy' | 'ok' | 'fail';

const TEST_RECEIPT: ReceiptPayload = {
  business: { name: 'The Breakery', address: 'Terminal test print' },
  order: {
    order_number: 'TEST',
    created_at: new Date().toISOString(),
    cashier_name: 'Settings',
    order_type: 'take_out',
  },
  items: [{ name: 'Test line', quantity: 1, unit_price: 0, line_total: 0 }],
  totals: { items_total: 0, redemption_amount: 0, total: 0, tax_amount: 0 },
  payment: { method: 'cash', amount: 0 },
  footer: 'Printer test — The Breakery POS',
};

export function DevicesSettingsTab({ readOnly }: { readOnly: boolean }): JSX.Element {
  const printerUrl = usePosSettingsStore((s) => s.printerUrl);
  const setPrinterUrl = usePosSettingsStore((s) => s.setPrinterUrl);
  const deviceCode = usePosSettingsStore((s) => s.deviceCode);
  const setDeviceCode = usePosSettingsStore((s) => s.setDeviceCode);

  const [probe, setProbe] = useState<Probe>('idle');
  const [printBusy, setPrintBusy] = useState(false);
  const [drawerBusy, setDrawerBusy] = useState(false);

  const resolvedUrl =
    printerUrl || (import.meta.env.VITE_PRINT_SERVER_URL ?? 'http://localhost:3001');

  async function runProbe(): Promise<void> {
    setProbe('busy');
    const ok = await checkPrintServer();
    setProbe(ok ? 'ok' : 'fail');
  }

  async function runTestPrint(): Promise<void> {
    setPrintBusy(true);
    const res = await printReceipt(TEST_RECEIPT);
    setPrintBusy(false);
    if (res.success) toast.success('Test receipt sent to the printer');
    else toast.error(`Test print failed: ${res.error ?? 'unknown'}`);
  }

  async function runOpenDrawer(): Promise<void> {
    setDrawerBusy(true);
    const res = await openCashDrawer();
    setDrawerBusy(false);
    if (res.success) toast.success('Cash drawer opened');
    else toast.error(`Could not open drawer: ${res.error ?? 'unknown'}`);
  }

  return (
    <div className="space-y-6 max-w-lg">
      <Card variant="default" padding="md" className="space-y-3">
        <SectionLabel size="sm" as="h3" className="text-text-primary normal-case tracking-normal font-serif text-base">
          Print server
        </SectionLabel>
        <div className="space-y-2">
          <label
            htmlFor="devices-print-url"
            className="block font-bold uppercase tracking-widest text-text-muted text-xs"
          >
            Print server URL
          </label>
          <Input
            id="devices-print-url"
            aria-label="Print server URL"
            placeholder="http://localhost:3001"
            value={printerUrl}
            disabled={readOnly}
            onChange={(e) => setPrinterUrl(e.target.value)}
          />
          <p className="text-xs text-text-muted">
            Resolved: <span className="font-mono text-text-secondary">{resolvedUrl}</span>
            {' · '}leave blank to use the build default.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={() => void runProbe()} disabled={probe === 'busy'}>
            {probe === 'busy' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plug className="h-4 w-4" aria-hidden />
            )}
            Test connection
          </Button>
          {probe === 'ok' && (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Reachable
            </span>
          )}
          {probe === 'fail' && (
            <span className="inline-flex items-center gap-1 text-xs text-danger">
              <XCircle className="h-4 w-4" aria-hidden /> Unreachable
            </span>
          )}
        </div>
      </Card>

      <Card variant="default" padding="md" className="space-y-3">
        <SectionLabel size="sm" as="h3" className="text-text-primary normal-case tracking-normal font-serif text-base">
          LAN device code
        </SectionLabel>
        <div className="space-y-2">
          <label
            htmlFor="devices-lan-code"
            className="block font-bold uppercase tracking-widest text-text-muted text-xs"
          >
            This terminal&apos;s device code
          </label>
          <Input
            id="devices-lan-code"
            aria-label="This terminal's device code"
            placeholder="e.g. POS-FRONT-01"
            value={deviceCode}
            disabled={readOnly}
            onChange={(e) => setDeviceCode(e.target.value)}
          />
          <p className="text-xs text-text-muted">
            Must match a code registered in BO &raquo; LAN Devices. Leave blank to
            skip heartbeats on this terminal.
          </p>
        </div>
      </Card>

      <Card variant="default" padding="md" className="space-y-3">
        <SectionLabel size="sm" as="h3" className="text-text-primary normal-case tracking-normal font-serif text-base">
          Hardware checks
        </SectionLabel>
        <p className="text-text-secondary text-xs">
          Send a real command to the connected hardware to confirm it is wired up.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void runTestPrint()} disabled={readOnly || printBusy}>
            {printBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Printer className="h-4 w-4" aria-hidden />
            )}
            Test print
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void runOpenDrawer()} disabled={readOnly || drawerBusy}>
            {drawerBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Inbox className="h-4 w-4" aria-hidden />
            )}
            Open cash drawer
          </Button>
        </div>
      </Card>
    </div>
  );
}
