// apps/backoffice/src/pages/settings/SettingsCustomerDisplayPage.tsx
//
// S73 Lot 2 — org-level customer display copy (business_config via
// get_settings_by_category_v10('customer_display') / set_setting_v13).
// The POS display reads the same keys; '' = built-in default.
//
// ADR-023 — la page porte en plus l'état de REPOS de l'écran client : la
// vitrine (sélection ordonnée de produits, déc. 1 et 2) et l'interrupteur de la
// file de retrait (déc. 3, éteint par défaut). On n'y modifie aucun produit :
// la sélection ne stocke que des ids, jamais un prix.
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';
import { ShowcaseCurator } from '@/features/settings/components/ShowcaseCurator.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { PageHeader } from '@/components/PageHeader.js';

const FIELDS = [
  { key: 'display_footer_message', label: 'Idle footer message', max: 120,
    helper: "Shown when no order is active. Blank = built-in default (Open daily · 07:00 — 21:00)." },
  { key: 'display_slogan', label: 'Brand slogan', max: 80,
    helper: 'Shown under the logo. Blank = built-in default (French Bakery & Pastry).' },
] as const;

// jsonb text settings decode as `unknown` — narrow instead of String()'ing
// arbitrary values (avoids [object Object] footguns on malformed rows).
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** La sélection arrive en jsonb : on la valide, on ne la caste pas. */
function asIdList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string') : [];
}

function asBool(v: unknown): boolean {
  return v === true;
}

export default function SettingsCustomerDisplayPage() {
  const canUpdate = useAuthStore((s) => s.hasPermission('settings.update'));
  const { data, isLoading, error } = useSettings('customer_display');
  const setSetting = useSetSetting();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [showcase, setShowcase] = useState<string[]>([]);
  const [showReady, setShowReady] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setDraft({
      display_footer_message: asString(data.settings.display_footer_message),
      display_slogan: asString(data.settings.display_slogan),
    });
    setShowcase(asIdList(data.settings.display_showcase_product_ids));
    setShowReady(asBool(data.settings.display_show_ready_orders));
  }, [data]);

  const savedShowcase = asIdList(data?.settings.display_showcase_product_ids);
  const savedShowReady = asBool(data?.settings.display_show_ready_orders);

  const dirty = FIELDS.filter((f) => draft[f.key] !== asString(data?.settings[f.key]));
  const showcaseDirty = showcase.join(',') !== savedShowcase.join(',');
  const showReadyDirty = showReady !== savedShowReady;
  const changeCount = dirty.length + (showcaseDirty ? 1 : 0) + (showReadyDirty ? 1 : 0);

  async function handleSave() {
    setServerError(null);
    try {
      for (const f of dirty) {
        await setSetting.mutateAsync({ key: f.key, value: draft[f.key] ?? '', category: 'customer_display' });
      }
      // Une clé par mutation : l'audit garde une entrée par champ changé.
      if (showcaseDirty) {
        await setSetting.mutateAsync({
          key: 'display_showcase_product_ids', value: showcase, category: 'customer_display',
        });
      }
      if (showReadyDirty) {
        await setSetting.mutateAsync({
          key: 'display_show_ready_orders', value: showReady, category: 'customer_display',
        });
      }
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="Customer Display"
        subtitle="Copy shown on every customer-facing display (all terminals). Audited on change."
      />
      {isLoading && <div className="text-text-secondary">Loading…</div>}
      {error && <div className="text-red">Failed to load: {error.message}</div>}
      {!isLoading && !error && (
        <form className="space-y-8" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          <div className="space-y-5">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <label htmlFor={f.key} className="text-sm font-medium">{f.label}</label>
                <input id={f.key} type="text" maxLength={f.max} disabled={!canUpdate}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  className={`h-9 w-full rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50 ${FOCUS_RING}`} />
                <p className="text-xs text-text-secondary">{f.helper}</p>
              </div>
            ))}
          </div>

          <section className="space-y-2 border-t border-border-subtle pt-6">
            <h2 className="text-sm font-medium text-text-primary">Idle showcase</h2>
            <p className="text-xs text-text-secondary">
              Between orders, the display shows these products, three at a time, page after page.
              Prices come from the catalogue at display time — nothing is copied here, so a price
              change is picked up on its own.
            </p>
            <ShowcaseCurator value={showcase} onChange={setShowcase} disabled={!canUpdate} />
          </section>

          <section className="space-y-2 border-t border-border-subtle pt-6">
            <h2 className="text-sm font-medium text-text-primary">Pickup queue</h2>
            <label className="flex items-start gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={showReady}
                disabled={!canUpdate}
                onChange={(e) => { setShowReady(e.target.checked); }}
                className={`mt-0.5 ${FOCUS_RING}`}
                data-testid="show-ready-orders"
              />
              <span>
                Show ready orders on the customer display
                <span className="block text-xs text-text-secondary">
                  Off: the showcase has the idle screen to itself, and customers are called out at
                  the counter. On: the display goes back to listing ready and recent orders, and the
                  showcase gives way.
                </span>
              </span>
            </label>
          </section>

          {serverError && <p className="text-red text-sm" role="alert">{serverError}</p>}
          {canUpdate && (
            <button type="submit" disabled={changeCount === 0 || setSetting.isPending} className={TOOLBAR_BTN_PRIMARY}>
              {setSetting.isPending ? 'Saving…' : changeCount === 0 ? 'No changes' : `Save ${changeCount} change${changeCount === 1 ? '' : 's'}`}
            </button>
          )}
        </form>
      )}
    </div>
  );
}
