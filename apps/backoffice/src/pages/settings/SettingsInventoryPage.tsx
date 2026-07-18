// apps/backoffice/src/pages/settings/SettingsInventoryPage.tsx
//
// Réglages Inventory — toggle global "autoriser le stock négatif" (vente +
// production). Écrit business_config.allow_negative_stock via set_setting_v4.

import { useEffect, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

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
    return <div className="text-text-secondary">Accès refusé aux réglages.</div>;
  }

  const original = inventory.data ? Boolean(inventory.data.settings.allow_negative_stock) : null;
  const dirty = draft !== null && draft !== original;

  async function handleSave() {
    if (draft === null) return;
    setError(null);
    try {
      await setSetting.mutateAsync({ key: 'allow_negative_stock', value: draft, category: 'inventory' });
      setSaved(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement");
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-serif text-3xl">Réglages Inventaire</h1>
        <p className="text-text-secondary text-sm mt-1">
          Contrôles globaux du stock. Chaque changement écrit une entrée d&apos;audit.
        </p>
      </div>

      {inventory.isLoading && <div className="text-text-secondary">Chargement…</div>}
      {inventory.error && <div className="text-red">Échec du chargement : {inventory.error.message}</div>}

      {!inventory.isLoading && !inventory.error && draft !== null && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
            <label htmlFor="allow_negative_stock" className="text-sm font-medium pt-2">
              Autoriser le stock négatif
            </label>
            <div className="md:col-span-2 space-y-1">
              <label className="inline-flex items-center gap-2 text-sm pt-2">
                <input id="allow_negative_stock" type="checkbox" checked={draft} disabled={!canUpdate}
                  onChange={(e) => setDraft(e.target.checked)} />
                <span>{draft ? 'Oui' : 'Non'}</span>
              </label>
              <p className="text-xs text-text-secondary">
                Quand activé, la vente et la production passent même si les matières
                premières sont insuffisantes (le stock devient négatif).
              </p>
            </div>
          </div>

          {error && <p className="text-red text-sm" role="alert">{error}</p>}
          {savedAt && !dirty && <p className="text-success text-xs" role="status">Enregistré à {savedAt}</p>}

          {canUpdate && (
            <Button type="submit" variant="primary" disabled={!dirty || setSetting.isPending}>
              {setSetting.isPending ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Aucun changement'}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
