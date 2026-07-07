// apps/pos/src/features/settings/components/DisplaySettingsTab.tsx
//
// POS Settings → KDS & Display. Per-terminal customer-display copy. The idle
// footer message is read by CustomerDisplayPage (route `/display`) and shown
// when no orders are active. Blank → the built-in "Open daily · 07:00 — 21:00".
import type { JSX } from 'react';
import { Monitor, ExternalLink } from 'lucide-react';
import { Button, Card, Input, SectionLabel } from '@breakery/ui';
import { usePosSettingsStore } from '@/stores/posSettingsStore';

const DEFAULT_DISPLAY_FOOTER = 'Open daily · 07:00 — 21:00';
const DEFAULT_DISPLAY_SLOGAN = 'French Bakery & Pastry';

export function DisplaySettingsTab({ readOnly }: { readOnly: boolean }): JSX.Element {
  const displayFooterMessage = usePosSettingsStore((s) => s.displayFooterMessage);
  const setDisplayFooterMessage = usePosSettingsStore((s) => s.setDisplayFooterMessage);
  const displaySlogan = usePosSettingsStore((s) => s.displaySlogan);
  const setDisplaySlogan = usePosSettingsStore((s) => s.setDisplaySlogan);

  return (
    <div className="space-y-6 max-w-lg">
      <Card variant="default" padding="md" className="space-y-3">
        <SectionLabel size="sm" as="h3" className="text-text-primary normal-case tracking-normal font-serif text-base">
          Customer display
        </SectionLabel>
        <div className="space-y-2">
          <label
            htmlFor="display-footer-msg"
            className="block font-bold uppercase tracking-widest text-text-muted text-xs"
          >
            Idle footer message
          </label>
          <Input
            id="display-footer-msg"
            aria-label="Customer display idle footer message"
            placeholder={DEFAULT_DISPLAY_FOOTER}
            value={displayFooterMessage}
            disabled={readOnly}
            onChange={(e) => setDisplayFooterMessage(e.target.value)}
          />
          <p className="text-xs text-text-muted">
            Shown on the customer-facing display when no orders are active. Leave
            blank for the default ({DEFAULT_DISPLAY_FOOTER}).
          </p>
        </div>
        <div className="space-y-2">
          <label
            htmlFor="display-slogan"
            className="block font-bold uppercase tracking-widest text-text-muted text-xs"
          >
            Brand slogan
          </label>
          <Input
            id="display-slogan"
            aria-label="Customer display brand slogan"
            placeholder={DEFAULT_DISPLAY_SLOGAN}
            value={displaySlogan}
            disabled={readOnly}
            onChange={(e) => setDisplaySlogan(e.target.value)}
          />
          <p className="text-xs text-text-muted">
            Shown under the logo on the customer-facing display. Leave blank for
            the default ({DEFAULT_DISPLAY_SLOGAN}).
          </p>
        </div>
        <div className="pt-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.open('/display', '_blank', 'noopener')}
          >
            <Monitor className="h-4 w-4" aria-hidden />
            Open customer display
            <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden />
          </Button>
        </div>
      </Card>
    </div>
  );
}
