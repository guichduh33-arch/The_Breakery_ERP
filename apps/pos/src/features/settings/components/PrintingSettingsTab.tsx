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

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full py-3 border-b border-border-subtle"
    >
      <span className="text-sm text-text-primary">{label}</span>
      <span
        className={`h-6 w-11 rounded-full transition-colors ${checked ? 'bg-gold' : 'bg-bg-overlay'} relative`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-text-primary transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}

export function PrintingSettingsTab(): JSX.Element {
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
        />
        <p className="text-xs text-text-muted">
          Leave blank to use the build default (VITE_PRINT_SERVER_URL → localhost:3001).
        </p>
      </div>
      <div>
        <Toggle label="Auto-print receipt on payment" checked={autoPrint} onChange={setAutoPrint} />
        <Toggle
          label="Auto-open cash drawer (cash)"
          checked={autoOpenDrawer}
          onChange={setAutoOpenDrawer}
        />
      </div>
    </div>
  );
}
