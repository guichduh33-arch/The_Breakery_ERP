// apps/pos/src/features/settings/components/DisplaySettingsTab.tsx
//
// POS Settings → Customer Display. Org-level customer-display copy (S73 Lot
// 2 — business_config.display_footer_message / display_slogan). The idle
// footer message is read by CustomerDisplayPage (route `/display`) and shown
// when no orders are active. Blank → the built-in "Open daily · 07:00 — 21:00".
import { useEffect, useState, type JSX } from 'react';
import { Monitor, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, Input, SectionLabel } from '@breakery/ui';
import { useOrgDisplaySettings, useSetOrgDisplaySetting } from '../hooks/useOrgDisplaySettings';
import { ScopeBadge } from './ScopeBadge';

const DEFAULT_DISPLAY_FOOTER = 'Open daily · 07:00 — 21:00';
const DEFAULT_DISPLAY_SLOGAN = 'French Bakery & Pastry';

export function DisplaySettingsTab({ readOnly }: { readOnly: boolean }): JSX.Element {
  const { displayFooterMessage, displaySlogan } = useOrgDisplaySettings();
  const mutation = useSetOrgDisplaySetting();

  const [footerDraft, setFooterDraft] = useState(displayFooterMessage);
  const [sloganDraft, setSloganDraft] = useState(displaySlogan);

  // Keep drafts in sync once the org value has loaded / changes remotely —
  // does not clobber in-flight edits since the query rarely refetches
  // (staleTime 5 min) and this mirrors the GeneralTab presets pattern.
  useEffect(() => setFooterDraft(displayFooterMessage), [displayFooterMessage]);
  useEffect(() => setSloganDraft(displaySlogan), [displaySlogan]);

  function save(key: 'display_footer_message' | 'display_slogan', value: string): void {
    mutation.mutate(
      { key, value, category: 'customer_display' },
      {
        onSuccess: () => toast.success('Saved'),
        onError: (e) => toast.error(`Save failed: ${e.message}`),
      },
    );
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-2">
        <ScopeBadge scope="org" />
        <span className="text-xs text-text-muted">Réglage partagé par tous les terminaux.</span>
      </div>
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
          <div className="flex gap-2">
            <Input
              id="display-footer-msg"
              aria-label="Customer display idle footer message"
              placeholder={DEFAULT_DISPLAY_FOOTER}
              value={footerDraft}
              disabled={readOnly || mutation.isPending}
              onChange={(e) => setFooterDraft(e.target.value)}
              className="flex-1"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={readOnly || mutation.isPending || footerDraft === displayFooterMessage}
              onClick={() => save('display_footer_message', footerDraft)}
            >
              Save
            </Button>
          </div>
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
          <div className="flex gap-2">
            <Input
              id="display-slogan"
              aria-label="Customer display brand slogan"
              placeholder={DEFAULT_DISPLAY_SLOGAN}
              value={sloganDraft}
              disabled={readOnly || mutation.isPending}
              onChange={(e) => setSloganDraft(e.target.value)}
              className="flex-1"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={readOnly || mutation.isPending || sloganDraft === displaySlogan}
              onClick={() => save('display_slogan', sloganDraft)}
            >
              Save
            </Button>
          </div>
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
