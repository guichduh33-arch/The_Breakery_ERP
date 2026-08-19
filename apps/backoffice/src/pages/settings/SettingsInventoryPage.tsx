// apps/backoffice/src/pages/settings/SettingsInventoryPage.tsx
//
// Réglages Inventory — toggle global "autoriser le stock négatif" (vente +
// production). Écrit business_config.allow_negative_stock via set_setting_v13.

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import { PageHeader } from '@/components/PageHeader.js';
import { formatTimeWita } from '@breakery/utils';
import { FOCUS_RING } from '@/components/focusRing.js';

export default function SettingsInventoryPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('settings.read');
  const canUpdate = hasPermission('settings.update');

  const inventory  = useSettings('inventory');
  const setSetting = useSetSetting();

  const [draft, setDraft]   = useState<boolean | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [savedAt, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!inventory.data) return;
    setDraft(Boolean(inventory.data.settings.allow_negative_stock));
  }, [inventory.data]);

  if (!canRead) {
    return <div className="text-text-secondary">Access denied — you cannot read settings.</div>;
  }

  const original = inventory.data ? Boolean(inventory.data.settings.allow_negative_stock) : null;
  const dirty = draft !== null && draft !== original;

  async function handleSave() {
    if (draft === null) return;
    setError(null);
    try {
      await setSetting.mutateAsync({ key: 'allow_negative_stock', value: draft, category: 'inventory' });
      setSaved(formatTimeWita(new Date()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Inventory settings"
        subtitle="Global stock controls. Every change writes an audit entry."
      />

      {inventory.isLoading && <div className="text-text-secondary">Loading…</div>}
      {inventory.error && <div className="text-red">Failed to load: {inventory.error.message}</div>}

      {!inventory.isLoading && !inventory.error && draft !== null && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
            <label htmlFor="allow_negative_stock" className="text-sm font-medium pt-2">
              Allow negative stock
            </label>
            <div className="md:col-span-2 space-y-1">
              <label className="inline-flex items-center gap-2 text-sm pt-2">
                <input className={FOCUS_RING} id="allow_negative_stock" type="checkbox" checked={draft} disabled={!canUpdate}
                  onChange={(e) => setDraft(e.target.checked)} />
                <span>{draft ? 'Yes' : 'No'}</span>
              </label>
              <p className="text-xs text-text-secondary">
                When on, sales and production go through even if raw materials are
                short — stock is allowed to go negative.
              </p>
            </div>
          </div>

          {error && <p className="text-red text-sm" role="alert">{error}</p>}
          {savedAt && !dirty && <p className="text-success text-xs" role="status">Saved at {savedAt}</p>}

          {canUpdate && (
            <button type="submit" disabled={!dirty || setSetting.isPending} className={TOOLBAR_BTN_PRIMARY}>
              {setSetting.isPending ? 'Saving…' : dirty ? 'Save' : 'No changes'}
            </button>
          )}
        </form>
      )}
    </div>
  );
}
