// apps/backoffice/src/features/settings/components/ReceiptTemplateEditor.tsx
//
// Session 13 / Phase 5.C — Editor + preview for a single receipt template.

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import {
  useUpdateReceiptTemplate,
  type ReceiptTemplateRow,
  type PaperSize,
} from '../hooks/useReceiptTemplates.js';

interface Draft {
  name:        string;
  header:      string;
  footer:      string;
  paper_size:  PaperSize;
  show_qr:     boolean;
  show_logo:   boolean;
  custom_css:  string;
  is_default:  boolean;
}

function rowToDraft(row: ReceiptTemplateRow): Draft {
  return {
    name:        row.name,
    header:      row.header     ?? '',
    footer:      row.footer     ?? '',
    paper_size:  row.paper_size as PaperSize,
    show_qr:     row.show_qr,
    show_logo:   row.show_logo,
    custom_css:  row.custom_css ?? '',
    is_default:  row.is_default,
  };
}

// Width in chars at common thermal paper sizes (approximation for monospace
// preview). 80mm at 12cpi ≈ 38 chars ; 58mm ≈ 32.
function widthChars(size: PaperSize): number {
  switch (size) {
    case '58mm': return 32;
    case '80mm': return 42;
    case 'A4':   return 80;
  }
}

export interface ReceiptTemplateEditorProps {
  row: ReceiptTemplateRow;
  canEdit: boolean;
}

export function ReceiptTemplateEditor({ row, canEdit }: ReceiptTemplateEditorProps) {
  const update = useUpdateReceiptTemplate();
  const [draft, setDraft]             = useState<Draft>(rowToDraft(row));
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt]         = useState<string | null>(null);

  useEffect(() => {
    setDraft(rowToDraft(row));
    setServerError(null);
    setSavedAt(null);
  }, [row]);

  const dirty = useMemo(() => {
    return (
      draft.name       !== row.name              ||
      draft.header     !== (row.header     ?? '') ||
      draft.footer     !== (row.footer     ?? '') ||
      draft.paper_size !== row.paper_size         ||
      draft.show_qr    !== row.show_qr            ||
      draft.show_logo  !== row.show_logo          ||
      draft.custom_css !== (row.custom_css ?? '') ||
      draft.is_default !== row.is_default
    );
  }, [draft, row]);

  async function handleSave() {
    setServerError(null);
    try {
      await update.mutateAsync({
        id: row.id,
        values: {
          name:        draft.name,
          header:      draft.header.trim()    === '' ? null : draft.header,
          footer:      draft.footer.trim()    === '' ? null : draft.footer,
          paper_size:  draft.paper_size,
          show_qr:     draft.show_qr,
          show_logo:   draft.show_logo,
          custom_css:  draft.custom_css.trim() === '' ? null : draft.custom_css,
          is_default:  draft.is_default,
        },
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Failed to save template');
    }
  }

  const width = widthChars(draft.paper_size);
  const dashLine = '-'.repeat(width);

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-3">
        <div>
          <label htmlFor={`rec-name-${row.id}`} className="text-xs uppercase tracking-widest text-text-secondary">Name</label>
          <input id={`rec-name-${row.id}`} value={draft.name} disabled={!canEdit} maxLength={120}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`rec-paper-${row.id}`} className="text-xs uppercase tracking-widest text-text-secondary">Paper size</label>
            <select id={`rec-paper-${row.id}`} value={draft.paper_size} disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, paper_size: e.target.value as PaperSize }))}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50">
              <option value="58mm">58mm thermal</option>
              <option value="80mm">80mm thermal</option>
              <option value="A4">A4 invoice</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 pt-5">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.show_qr} disabled={!canEdit}
                onChange={(e) => setDraft((d) => ({ ...d, show_qr: e.target.checked }))} />
              Show QR
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.show_logo} disabled={!canEdit}
                onChange={(e) => setDraft((d) => ({ ...d, show_logo: e.target.checked }))} />
              Show logo
            </label>
          </div>
        </div>
        <div>
          <label htmlFor={`rec-header-${row.id}`} className="text-xs uppercase tracking-widest text-text-secondary">Header</label>
          <textarea id={`rec-header-${row.id}`} rows={3} value={draft.header} disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, header: e.target.value }))}
            className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm font-mono text-text-primary disabled:opacity-50" />
        </div>
        <div>
          <label htmlFor={`rec-footer-${row.id}`} className="text-xs uppercase tracking-widest text-text-secondary">Footer</label>
          <textarea id={`rec-footer-${row.id}`} rows={3} value={draft.footer} disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, footer: e.target.value }))}
            className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm font-mono text-text-primary disabled:opacity-50" />
        </div>
        <div>
          <label htmlFor={`rec-css-${row.id}`} className="text-xs uppercase tracking-widest text-text-secondary">Custom CSS (optional)</label>
          <textarea id={`rec-css-${row.id}`} rows={3} value={draft.custom_css} disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, custom_css: e.target.value }))}
            placeholder="e.g. body { font-family: monospace; }"
            className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-xs font-mono text-text-primary disabled:opacity-50" />
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.is_default} disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, is_default: e.target.checked }))} />
          Default template
        </label>
        {serverError && <p className="text-red text-sm" role="alert">{serverError}</p>}
        {savedAt && <p className="text-success text-xs" role="status">Saved at {savedAt}</p>}
        {canEdit && (
          <Button type="button" variant="primary" disabled={!dirty || update.isPending}
            onClick={() => { void handleSave(); }}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        )}
      </div>

      <div aria-label="Preview" className="font-mono text-xs">
        <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">Preview ({draft.paper_size})</div>
        <pre className="border border-border-subtle bg-bg-overlay rounded-md px-4 py-3 whitespace-pre-wrap leading-snug">
{draft.show_logo ? '[ LOGO ]' : ''}
{draft.show_logo ? '\n' : ''}{draft.header}
{dashLine}
Item 1                          15,000
Item 2                          12,000
{dashLine}
SUBTOTAL                        27,000
TAX (10%)                        2,700
TOTAL                           29,700
{dashLine}
{draft.footer}
{draft.show_qr ? `\n[ QR CODE ]` : ''}
        </pre>
      </div>
    </div>
  );
}
