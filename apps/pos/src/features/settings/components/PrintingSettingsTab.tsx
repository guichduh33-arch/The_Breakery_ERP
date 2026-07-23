// apps/pos/src/features/settings/components/PrintingSettingsTab.tsx
//
// Session 35 (F-009) — POS Settings → Printing tab. Lets a manager edit the
// print-server URL (per-terminal, `usePosSettingsStore`) and toggle
// auto-print / auto-open-drawer (S73 Lot 2 — org-level, `business_config`
// via `useOrgDisplaySettings`/`useSetOrgDisplaySetting`). Consumed by
// printService (URL) + SuccessModal (auto-toggles).
//
// Note: `@breakery/ui`'s SectionLabel only supports as=div|h2|h3|span|p (no
// `label`/`htmlFor`), so the field label uses a plain <label htmlFor=…>. The
// Input also carries aria-label="Print server URL" for redundant a11y.

import type { JSX } from 'react';
import { toast } from 'sonner';
import { Input, QuantityStepper } from '@breakery/ui';
import type { PrepStation } from '@breakery/domain';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { useOrgDisplaySettings, useSetOrgDisplaySetting } from '../hooks/useOrgDisplaySettings';
import { useKotCopies, KOT_COPIES_DEFAULTS } from '../hooks/useKotCopies';
import { SettingToggle } from './SettingToggle';
import { ScopeBadge } from './ScopeBadge';

// Copies du KOT papier par station prep (org-wide, [0,5] — set_setting_v7).
const KOT_STATIONS: readonly { station: PrepStation; key: `kot_copies_${PrepStation}`; label: string }[] = [
  { station: 'kitchen', key: 'kot_copies_kitchen', label: 'Kitchen' },
  { station: 'barista', key: 'kot_copies_barista', label: 'Barista' },
  { station: 'display', key: 'kot_copies_display', label: 'Display (vitrine)' },
];

export function PrintingSettingsTab({ readOnly }: { readOnly: boolean }): JSX.Element {
  const { printerUrl, setPrinterUrl } = usePosSettingsStore();
  const { autoPrint, autoOpenDrawer } = useOrgDisplaySettings();
  const { data: kotCopies } = useKotCopies();
  const mutation = useSetOrgDisplaySetting();

  function setAutoPrint(value: boolean): void {
    mutation.mutate(
      { key: 'pos_auto_print_receipt', value, category: 'printing' },
      { onError: (e) => toast.error(`Save failed: ${e.message}`) },
    );
  }
  function setAutoOpenDrawer(value: boolean): void {
    mutation.mutate(
      { key: 'pos_auto_open_drawer', value, category: 'printing' },
      { onError: (e) => toast.error(`Save failed: ${e.message}`) },
    );
  }
  function setKotCopies(key: `kot_copies_${PrepStation}`, value: number): void {
    mutation.mutate(
      { key, value, category: 'printing' },
      { onError: (e) => toast.error(`Save failed: ${e.message}`) },
    );
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <div className="flex items-center gap-2">
          <ScopeBadge scope="org" />
          <span className="text-xs text-text-muted">Réglage partagé par tous les terminaux.</span>
        </div>
        <div className="mt-4">
          <SettingToggle
            label="Auto-print receipt on payment"
            description="Send the receipt to the print server without tapping Print."
            checked={autoPrint}
            onChange={setAutoPrint}
            disabled={readOnly || mutation.isPending}
          />
          <SettingToggle
            label="Auto-open cash drawer (cash)"
            description="Pop the drawer when the tender is cash."
            checked={autoOpenDrawer}
            onChange={setAutoOpenDrawer}
            disabled={readOnly || mutation.isPending}
          />
        </div>
        <div className="mt-6 space-y-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Kitchen ticket copies (KOT)</p>
            <p className="text-xs text-text-muted">
              Copies papier par station à chaque envoi cuisine. 0 = pas de papier
              pour la station — le KDS écran reçoit toujours.
            </p>
          </div>
          {KOT_STATIONS.map(({ station, key, label }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-sm text-text-primary">{label}</span>
              <QuantityStepper
                value={kotCopies?.[station] ?? KOT_COPIES_DEFAULTS[station]}
                min={0}
                max={5}
                onChange={(next) => {
                  if (readOnly || mutation.isPending) return;
                  setKotCopies(key, next);
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ScopeBadge scope="terminal" />
          <span className="text-xs text-text-muted">Réglage de ce terminal uniquement.</span>
        </div>
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
    </div>
  );
}
