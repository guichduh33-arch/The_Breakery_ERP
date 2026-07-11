// apps/pos/src/features/settings/components/AdvancedSettingsTab.tsx
//
// POS Settings → POS → Advanced. Terminal diagnostics + maintenance actions.
// Read-only environment facts plus two real maintenance gestures: reset the
// per-terminal settings (posSettingsStore) to factory defaults, and reload the
// terminal. No business data is touched — this is device-scoped only.
import { useState, type JSX } from 'react';
import { RotateCcw, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, SectionLabel } from '@breakery/ui';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { ScopeBadge } from './ScopeBadge';

function DiagRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-border-subtle last:border-0">
      <span className="text-xs uppercase tracking-widest text-text-muted">{label}</span>
      <span className="font-mono text-sm text-text-secondary truncate max-w-[60%] text-right">{value}</span>
    </div>
  );
}

export function AdvancedSettingsTab({ readOnly }: { readOnly: boolean }): JSX.Element {
  const printerUrl = usePosSettingsStore((s) => s.printerUrl);
  const resetToDefaults = usePosSettingsStore((s) => s.resetToDefaults);
  const [confirmReset, setConfirmReset] = useState(false);

  const resolvedPrintUrl =
    printerUrl || (import.meta.env.VITE_PRINT_SERVER_URL ?? 'http://localhost:3001');
  const version = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev';
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  function doReset(): void {
    resetToDefaults();
    setConfirmReset(false);
    toast.success('Terminal settings reset to defaults');
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-2">
        <ScopeBadge scope="terminal" />
        <span className="text-xs text-text-muted">Réglages de ce terminal uniquement.</span>
      </div>
      <Card variant="default" padding="md" className="space-y-2">
        <SectionLabel size="sm" as="h3" className="text-text-primary normal-case tracking-normal font-serif text-base">
          Diagnostics
        </SectionLabel>
        <div>
          <DiagRow label="App version" value={version} />
          <DiagRow label="Environment" value={import.meta.env.MODE} />
          <DiagRow label="Print server" value={resolvedPrintUrl} />
          <DiagRow label="Network" value={online ? 'Online' : 'Offline'} />
        </div>
      </Card>

      <Card variant="default" padding="md" className="space-y-3">
        <SectionLabel size="sm" as="h3" className="text-text-primary normal-case tracking-normal font-serif text-base">
          Maintenance
        </SectionLabel>
        <p className="text-text-secondary text-xs">
          These affect this terminal only — printer URL, automation toggles,
          default order type and display copy. No sales or business data is touched.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!confirmReset ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={readOnly}
              onClick={() => setConfirmReset(true)}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Reset terminal settings
            </Button>
          ) : (
            <>
              <Button variant="ghostDestructive" size="sm" className="border border-red-fg/30" onClick={doReset}>
                Confirm reset
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
                Cancel
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Reload terminal
          </Button>
        </div>
      </Card>
    </div>
  );
}
