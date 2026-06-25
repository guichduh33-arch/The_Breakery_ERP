// apps/pos/src/features/settings/components/AutomationSettingsTab.tsx
//
// POS Settings → POS → Automation. Per-terminal automation toggles persisted in
// posSettingsStore and consumed at payment success (SuccessModal): auto-print
// the receipt and auto-open the cash drawer on cash tenders. These mirror the
// same two switches on the Printing tab — both write the same store so they
// stay in sync.
import type { JSX } from 'react';
import { Card, SectionLabel } from '@breakery/ui';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { SettingToggle } from './SettingToggle';

export function AutomationSettingsTab({ readOnly }: { readOnly: boolean }): JSX.Element {
  const autoPrint = usePosSettingsStore((s) => s.autoPrint);
  const autoOpenDrawer = usePosSettingsStore((s) => s.autoOpenDrawer);
  const setAutoPrint = usePosSettingsStore((s) => s.setAutoPrint);
  const setAutoOpenDrawer = usePosSettingsStore((s) => s.setAutoOpenDrawer);

  return (
    <div className="space-y-6 max-w-lg">
      <Card variant="default" padding="md" className="space-y-1">
        <SectionLabel size="sm" as="h3" className="text-text-primary normal-case tracking-normal font-serif text-base">
          On payment success
        </SectionLabel>
        <p className="text-text-secondary text-xs pb-2">
          Runs automatically the moment a payment is confirmed.
        </p>
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
      </Card>
    </div>
  );
}
