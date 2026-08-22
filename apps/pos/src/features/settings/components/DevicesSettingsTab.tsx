// apps/pos/src/features/settings/components/DevicesSettingsTab.tsx
//
// POS Settings → Devices. The hardware hub for this terminal: the print-server
// URL (shared with the Printing tab via posSettingsStore) plus REAL device
// checks against that server — connection probe, a test receipt, and a cash
// drawer kick. All three call printService, so what works here is exactly what
// the POS uses at checkout.
//
// ADR-030 — ce terminal est servi en local, il peut donc parler au réseau local ;
// le back-office publié en HTTPS ne le peut plus. Les diagnostics LAN (hub,
// balayage réseau, test d'imprimante) ont déménagé du BO vers le bas de cet
// onglet. Le registre des appareils, lui, reste une donnée cloud gérée au BO.
import { useState, type JSX } from 'react';
import { Plug, Printer, Inbox, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, Input, SectionLabel } from '@breakery/ui';
import { ORDER_SOURCE_CODE_REGEX, usePosSettingsStore } from '@/stores/posSettingsStore';
import { emitPosEvent } from '@/features/audit/emitPosEvent';
import { ScopeBadge } from './ScopeBadge';
import { HubStatusPanel } from './HubStatusPanel';
import { NetworkScanPanel } from './NetworkScanPanel';
import { PrinterTestPanel } from './PrinterTestPanel';
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
  const deviceCode = usePosSettingsStore((s) => s.deviceCode);
  const setDeviceCode = usePosSettingsStore((s) => s.setDeviceCode);
  const hubToken = usePosSettingsStore((s) => s.hubToken);
  const setHubToken = usePosSettingsStore((s) => s.setHubToken);
  const orderSourceCode = usePosSettingsStore((s) => s.orderSourceCode);
  const setOrderSourceCode = usePosSettingsStore((s) => s.setOrderSourceCode);
  const sourceCodeValid = ORDER_SOURCE_CODE_REGEX.test(orderSourceCode);

  const [probe, setProbe] = useState<Probe>('idle');
  const [printBusy, setPrintBusy] = useState(false);
  const [drawerBusy, setDrawerBusy] = useState(false);

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
    // S72 audit — a manual till kick has no sale attached; a prime fraud signal.
    emitPosEvent('cash_drawer_opened', {
      payload: { trigger: 'manual', opened: res.success },
    });
    if (res.success) toast.success('Cash drawer opened');
    else toast.error(`Could not open drawer: ${res.error ?? 'unknown'}`);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-6 max-w-lg">
        <div className="flex items-center gap-2">
          <ScopeBadge scope="terminal" />
          <span className="text-xs text-text-muted">This terminal only.</span>
        </div>
        <Card variant="default" padding="md" className="space-y-3">
          <SectionLabel
            size="sm"
            as="h3"
            className="text-text-primary normal-case tracking-normal font-semibold text-base"
          >
            Print server
          </SectionLabel>
          <div className="space-y-1">
            <span className="block font-bold uppercase tracking-widest text-text-muted text-xs">
              Print server URL
            </span>
            <p className="text-sm font-mono text-text-secondary">
              {printerUrl || 'default (VITE_PRINT_SERVER_URL → localhost:3001)'}
            </p>
            <p className="text-xs text-text-muted">Edit it on the Printing tab.</p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void runProbe()}
              disabled={probe === 'busy'}
            >
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
          <SectionLabel
            size="sm"
            as="h3"
            className="text-text-primary normal-case tracking-normal font-semibold text-base"
          >
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
              Must match a code registered in BO &raquo; LAN Devices. Leave blank to skip heartbeats
              on this terminal.
            </p>
          </div>
          <div className="space-y-2">
            <label
              htmlFor="devices-hub-token"
              className="block font-bold uppercase tracking-widest text-text-muted text-xs"
            >
              Hub token
            </label>
            <Input
              id="devices-hub-token"
              aria-label="Hub token"
              type="password"
              placeholder="Shared LAN hub secret"
              value={hubToken}
              disabled={readOnly}
              onChange={(e) => setHubToken(e.target.value)}
            />
            <p className="text-xs text-text-muted">
              Must match the bridge&apos;s HUB_TOKEN. Leave blank if the hub runs without a token.
            </p>
          </div>
        </Card>

        <Card variant="default" padding="md" className="space-y-3">
          <SectionLabel
            size="sm"
            as="h3"
            className="text-text-primary normal-case tracking-normal font-semibold text-base"
          >
            Order numbering
          </SectionLabel>
          <div className="space-y-2">
            <label
              htmlFor="devices-source-code"
              className="block font-bold uppercase tracking-widest text-text-muted text-xs"
            >
              Order source code
            </label>
            <Input
              id="devices-source-code"
              aria-label="Order source code"
              placeholder="P, T1, T2…"
              value={orderSourceCode}
              disabled={readOnly}
              onChange={(e) => setOrderSourceCode(e.target.value)}
            />
            <p className="text-xs text-text-muted">
              Prefix stamped on this device&apos;s order numbers (P = counter, T1/T2 = tablets).
              Format: P16082026001.
            </p>
            {!sourceCodeValid && (
              <p className="text-xs text-danger">
                Invalid code — use P, T1, T2… or BO. The server default applies until this is fixed.
              </p>
            )}
          </div>
        </Card>

        <Card variant="default" padding="md" className="space-y-3">
          <SectionLabel
            size="sm"
            as="h3"
            className="text-text-primary normal-case tracking-normal font-semibold text-base"
          >
            Hardware checks
          </SectionLabel>
          <p className="text-text-secondary text-xs">
            Send a real command to the connected hardware to confirm it is wired up.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void runTestPrint()}
              disabled={readOnly || printBusy}
            >
              {printBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Printer className="h-4 w-4" aria-hidden />
              )}
              Test print
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void runOpenDrawer()}
              disabled={readOnly || drawerBusy}
            >
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

      {/* ADR-030 — diagnostics du réseau local, déménagés du back-office. */}
      <div className="space-y-6 max-w-3xl">
        <Card variant="default" padding="md" className="space-y-3">
          <SectionLabel
            size="sm"
            as="h3"
            className="text-text-primary normal-case tracking-normal font-semibold text-base"
          >
            Hub
          </SectionLabel>
          <p className="text-text-secondary text-xs">
            Live view of the LAN bus that keeps the kitchen fed when the internet drops.
          </p>
          <HubStatusPanel />
        </Card>

        <Card variant="default" padding="md" className="space-y-3">
          <SectionLabel
            size="sm"
            as="h3"
            className="text-text-primary normal-case tracking-normal font-semibold text-base"
          >
            Network scan
          </SectionLabel>
          <p className="text-text-secondary text-xs">
            Sweep the shop subnet for ESC/POS printers listening on port 9100.
          </p>
          <NetworkScanPanel readOnly={readOnly} />
        </Card>

        <Card variant="default" padding="md" className="space-y-3">
          <SectionLabel
            size="sm"
            as="h3"
            className="text-text-primary normal-case tracking-normal font-semibold text-base"
          >
            Registered printers
          </SectionLabel>
          <p className="text-text-secondary text-xs">
            Probe a printer and send it a real test ticket. Read-only — add, rename or remove
            printers in Back-office &raquo; LAN Devices.
          </p>
          <PrinterTestPanel readOnly={readOnly} />
        </Card>
      </div>
    </div>
  );
}
