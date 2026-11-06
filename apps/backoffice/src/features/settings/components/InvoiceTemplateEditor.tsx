import { useState } from 'react';
import { Input, Select } from '@breakery/ui';
import { Button, Card } from '@/components/BackofficeUi.js';
import { PageHeader } from '@/components/PageHeader.js';
import { invoiceTemplateError, templateSettings, type InvoicePrintTemplate, type InvoiceTemplateSettings } from '../invoiceTemplate.js';
import { InvoicePaperFields } from './InvoicePaperFields.js';
import { InvoiceTemplatePreview, type InvoicePreviewBusiness } from './InvoiceTemplatePreview.js';

const TEXT_FIELDS = [
  { key: 'business_name', label: 'Business name override', max: 100 },
  { key: 'contact_text', label: 'Address and contact text override', max: 500 },
  { key: 'heading', label: 'Document heading', max: 60 },
  { key: 'payment_instructions', label: 'Payment instructions', max: 1000 },
  { key: 'footer_message', label: 'Footer message', max: 500 },
] as const;
const TOGGLES = [
  { key: 'show_logo', label: 'Show business logo' }, { key: 'show_contact', label: 'Show address and contact text' },
  { key: 'show_unit_prices', label: 'Show unit prices' }, { key: 'show_due_date', label: 'Show payment due date' },
] as const;
const TEXTAREA_CLASS = 'mt-1 min-h-20 w-full rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold';

export function InvoiceTemplateEditor({ row, canEdit, business, saving, saveError, onSave, onReload }: {
  row: InvoicePrintTemplate; canEdit: boolean; business: InvoicePreviewBusiness; saving: boolean;
  saveError: string | null; onSave: (settings: InvoiceTemplateSettings, revision: number) => Promise<InvoicePrintTemplate>;
  onReload: () => Promise<InvoicePrintTemplate>;
}) {
  const [saved, setSaved] = useState(row);
  const [draft, setDraft] = useState(templateSettings(row));
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(templateSettings(saved));
  const validation = invoiceTemplateError(draft);
  const disabled = !canEdit || saving || reloading;
  const patch = (values: Partial<InvoiceTemplateSettings>) => { setNotice(null); setDraft((value) => ({ ...value, ...values })); };

  async function save() {
    if (disabled || validation || !dirty) return;
    setNotice(null);
    try {
      const next = await onSave(draft, saved.revision);
      setSaved(next); setDraft(templateSettings(next)); setNotice('Invoice template saved. New PDF generations will use these settings.');
    } catch { /* Le hook fournit le message d'erreur sans perdre le brouillon. */ }
  }
  async function reload() {
    setReloading(true); setReloadError(null);
    try { const next = await onReload(); setSaved(next); setDraft(templateSettings(next)); setNotice('Saved template loaded.'); }
    catch { setReloadError('Could not reload the template. Your draft has been kept.'); }
    finally { setReloading(false); }
  }

  return <div className="space-y-6">
    <PageHeader title="Invoice template" subtitle="B2B invoice appearance, paper size and print alignment. Changes apply to new PDF generations."
      actions={<><Button variant="secondary" disabled={saving || reloading} onClick={() => { void reload(); }}>Reload saved</Button>
        <Button variant="secondary" disabled={disabled || !dirty} onClick={() => { setDraft(templateSettings(saved)); setNotice(null); }}>Reset changes</Button>
        <Button disabled={disabled || !dirty || validation !== null} onClick={() => { void save(); }}>
          {saving ? 'Saving…' : 'Save template'}</Button></>} />
    {!canEdit && <p className="text-sm text-text-secondary">You can view this template. You do not have permission to change invoice settings.</p>}
    {row.revision !== saved.revision && <p role="status" className="text-sm text-text-secondary">A newer template is available. Reload saved to review it before saving.</p>}
    {(saveError ?? reloadError) && <p role="alert" className="text-sm text-red-as-text">{saveError ?? reloadError}</p>}
    {notice && <p role="status" className="text-sm text-text-secondary">{notice}</p>}
    <div className="grid items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-4">
        <InvoicePaperFields value={draft} disabled={disabled} onChange={patch} />
        <Card padding="md" className="space-y-4"><h2 className="font-semibold">Branding and document text</h2>
          <p className="text-xs text-text-muted">Leave business overrides blank to use General settings. The logo is managed in General settings.</p>
          {TEXT_FIELDS.map(({ key, label, max }) => <label key={key} className="block text-xs text-text-secondary">
            {label}{key === 'heading' || key === 'business_name'
              ? <Input className="mt-1 w-full" value={draft[key]} maxLength={max} disabled={disabled}
                placeholder={key === 'business_name' ? business.name : 'INVOICE'} onChange={(event) => patch({ [key]: event.target.value })} />
              : <textarea className={TEXTAREA_CLASS} value={draft[key]} maxLength={max} disabled={disabled}
                placeholder={key === 'contact_text' ? business.contact : ''} onChange={(event) => patch({ [key]: event.target.value })} />}
          </label>)}
        </Card>
        <Card padding="md" className="space-y-3"><h2 className="font-semibold">Visible details</h2>
          {TOGGLES.map(({ key, label }) => <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft[key]} disabled={disabled} onChange={(event) => patch({ [key]: event.target.checked })} />{label}
          </label>)}
          <label className="block text-sm">Density
            <Select className="mt-1 w-full" value={draft.density} disabled={disabled} onChange={(event) => {
              const density = event.target.value;
              if (density === 'comfortable' || density === 'compact') patch({ density });
            }}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></Select>
          </label>
        </Card>
        {validation && <p role="alert" className="text-sm text-red-as-text">{validation}</p>}
        {dirty && <p className="text-xs text-text-muted">Unsaved changes. Save the template before generating an invoice PDF.</p>}
      </div>
      <div className="min-w-0 xl:sticky xl:top-6">{validation
        ? <Card padding="md"><p className="text-sm text-text-secondary">Enter valid template settings to display the preview.</p></Card>
        : <InvoiceTemplatePreview value={draft} business={business} />}</div>
    </div>
  </div>;
}
