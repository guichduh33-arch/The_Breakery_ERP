// apps/pos/src/features/settings/components/PrintingSettingsTab.tsx
//
// Session 35 (F-009) — POS Settings → Printing tab. Lets a manager edit the
// print-server URL and toggle auto-print / auto-open-drawer. Reads + writes
// `usePosSettingsStore` (per-terminal localStorage). Consumed by
// printService (URL) + SuccessModal (auto-toggles).
//
// Note: `@breakery/ui`'s SectionLabel only supports as=div|h2|h3|span|p (no
// `label`/`htmlFor`), so the field label uses a plain <label htmlFor=…>. The
// Input also carries aria-label="Print server URL" for redundant a11y.

import type { JSX } from 'react';
import { Input } from '@breakery/ui';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { SettingToggle } from './SettingToggle';
import { ScopeBadge } from './ScopeBadge';

export function PrintingSettingsTab({ readOnly }: { readOnly: boolean }): JSX.Element {
  const {
    printerUrl,
    autoPrint,
    autoOpenDrawer,
    setPrinterUrl,
    setAutoPrint,
    setAutoOpenDrawer,
  } = usePosSettingsStore();

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-2">
        <ScopeBadge scope="terminal" />
        <span className="text-xs text-text-muted">Réglages de ce terminal uniquement.</span>
      </div>
      <div className="space-y-2">
        <label
          htmlFor="print-server-url"
          className="block font-bold uppercase tracking-widest text-text-muted text-xs"
        >
          Print server URL
        </label>
        <Input
          id="print-server-url"
          aria-label="Print server URL"
          placeholder="http://localhost:3001"
          value={printerUrl}
          onChange={(e) => setPrinterUrl(e.target.value)}
          disabled={readOnly}
        />
        <p className="text-xs text-text-muted">
          Leave blank to use the build default (VITE_PRINT_SERVER_URL → localhost:3001).
        </p>
      </div>
      <div>
        <SettingToggle
          label="Auto-print receipt on payment"
          description="Send the receipt to the print server without tapping Print."
          checked={autoPrint}
          onChange={setAutoPrint}
          disabled={readOnly}
        />
        <SettingToggle
          label="Auto-open cash drawer (cash)"
          description="Pop the drawer when the tender is cash."
          checked={autoOpenDrawer}
          onChange={setAutoOpenDrawer}
          disabled={readOnly}
        />
      </div>
    </div>
  );
}
