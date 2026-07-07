// apps/backoffice/src/pages/settings/SettingsEmailTemplatesPage.tsx
//
// Session 13 / Phase 5.C — Customer-facing email template editor. Renders
// one editor block per template ; live preview substitutes declared variables
// with bracketed placeholders.

import { useAuthStore } from '@/stores/authStore.js';
import { useEmailTemplatesList } from '@/features/settings/hooks/useEmailTemplates.js';
import { EmailTemplateEditor } from '@/features/settings/components/EmailTemplateEditor.js';

function humanLabel(code: string): string {
  switch (code) {
    case 'welcome':          return 'Welcome';
    case 'order_complete':   return 'Order complete';
    case 'payment_received': return 'Payment received';
    case 'password_reset':   return 'Password reset';
    default: return code;
  }
}

export default function SettingsEmailTemplatesPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('settings.read');
  const canUpdate = hasPermission('settings.update');

  const list = useEmailTemplatesList();

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view settings.</div>;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="font-serif text-3xl">Email templates</h1>
        <p className="text-text-secondary text-sm mt-1">
          Customer-facing emails (welcome, order ready, payment, password reset). System notifications live in
          Notifications (Phase 5.B).
        </p>
      </div>

      {list.isLoading && <div className="text-text-secondary">Loading…</div>}
      {list.error && <div className="text-red">Failed to load: {list.error.message}</div>}

      {!list.isLoading && !list.error && (
        <div className="space-y-8">
          {list.data?.map((tpl) => (
            <section key={tpl.id} className="space-y-3 bg-bg-elevated rounded-lg border border-border-subtle p-5">
              <header className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{humanLabel(tpl.code)}</h2>
                  <p className="text-xs text-text-secondary font-mono">{tpl.code}</p>
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs ${
                  tpl.is_active
                    ? 'bg-success-soft text-success border-success'
                    : 'bg-bg-overlay text-text-secondary border-border-subtle'
                }`}>
                  {tpl.is_active ? 'Active' : 'Inactive'}
                </span>
              </header>
              <EmailTemplateEditor row={tpl} canEdit={canUpdate} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
