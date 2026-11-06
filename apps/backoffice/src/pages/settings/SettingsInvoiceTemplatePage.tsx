import { useAuthStore } from '@/stores/authStore.js';
import { Button } from '@/components/BackofficeUi.js';
import { PageHeader } from '@/components/PageHeader.js';
import { useInvoicePrintTemplate } from '@/features/settings/hooks/useInvoicePrintTemplate.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { InvoiceTemplateEditor } from '@/features/settings/components/InvoiceTemplateEditor.js';

export default function SettingsInvoiceTemplatePage() {
  const canRead = useAuthStore((state) => state.hasPermission('settings.read'));
  const canEdit = useAuthStore((state) => state.hasPermission('settings.update'));
  if (!canRead) return <p>You do not have permission to view invoice settings.</p>;
  return <AuthorizedInvoiceTemplatePage canEdit={canEdit} />;
}

function AuthorizedInvoiceTemplatePage({ canEdit }: { canEdit: boolean }) {
  const { query, save } = useInvoicePrintTemplate(true);
  const identity = useSettings('business');
  const settings = identity.data?.settings;
  const name = typeof settings?.name === 'string' ? settings.name : 'The Breakery';
  const contact = [settings?.fiscal_address, settings?.phone]
    .filter((value): value is string => typeof value === 'string' && value !== '').join('\n');
  const logoUrl = typeof settings?.logo_url === 'string' && settings.logo_url ? settings.logo_url : undefined;
  const taxId = typeof settings?.npwp === 'string' && settings.npwp ? settings.npwp : undefined;

  if (query.isPending) return <div><PageHeader title="Invoice template" /><p role="status" className="mt-6">Loading invoice template…</p></div>;
  if (query.isError) return <div className="space-y-4"><PageHeader title="Invoice template" />
    <p role="alert">Could not load the invoice template.</p>
    <Button variant="secondary" onClick={() => { void query.refetch(); }}>Try again</Button></div>;
  return <InvoiceTemplateEditor row={query.data} canEdit={canEdit} saving={save.isPending}
    business={{ name, contact, ...(logoUrl ? { logoUrl } : {}), ...(taxId ? { taxId } : {}) }} saveError={save.error?.message ?? null}
    onSave={(template, revision) => save.mutateAsync({ settings: template, revision })}
    onReload={async () => {
      const result = await query.refetch();
      if (result.error || !result.data) throw new Error('Template unavailable');
      save.reset();
      return result.data;
    }} />;
}
