// apps/backoffice/src/pages/settings/SettingsReceiptTemplatesPage.tsx
//
// Session 13 / Phase 5.C — Receipt template editor + live ASCII preview.
// At-most-one default is enforced by the partial unique index and the
// useUpdateReceiptTemplate hook (auto-demote the prior default).

import { useAuthStore } from '@/stores/authStore.js';
import { useReceiptTemplatesList } from '@/features/settings/hooks/useReceiptTemplates.js';
import { ReceiptTemplateEditor } from '@/features/settings/components/ReceiptTemplateEditor.js';

export default function SettingsReceiptTemplatesPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('settings.read');
  const canUpdate = hasPermission('settings.update');

  const list = useReceiptTemplatesList();

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view settings.</div>;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="font-serif text-3xl">Receipt templates</h1>
        <p className="text-text-secondary text-sm mt-1">
          POS receipt layout for thermal printers (58mm, 80mm) and A4 invoices. Exactly one default at a time.
        </p>
      </div>

      <div
        data-testid="templates-not-wired-banner"
        className="rounded-lg border border-border-subtle bg-bg-overlay p-3 text-sm text-text-secondary"
      >
        ⚠︎ Editing is live, but these templates are <strong>not applied yet</strong> — receipt printing
        does not read them yet. Wiring is planned (Vague 3 — notifications / versioned print-bridge).
      </div>

      {list.isLoading && <div className="text-text-secondary">Loading…</div>}
      {list.error && <div className="text-red">Failed to load: {list.error.message}</div>}

      {!list.isLoading && !list.error && (
        <div className="space-y-8">
          {list.data?.map((tpl) => (
            <section key={tpl.id} className="space-y-3 bg-bg-elevated rounded-lg border border-border-subtle p-5">
              <header className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{tpl.name}</h2>
                  <p className="text-xs text-text-secondary">{tpl.paper_size}</p>
                </div>
                {tpl.is_default && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-xs bg-gold-soft text-gold border-gold/30">
                    Default
                  </span>
                )}
              </header>
              <ReceiptTemplateEditor row={tpl} canEdit={canUpdate} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
