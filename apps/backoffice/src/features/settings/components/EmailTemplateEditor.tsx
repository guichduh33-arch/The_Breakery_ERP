// apps/backoffice/src/features/settings/components/EmailTemplateEditor.tsx
//
// Session 13 / Phase 5.C — Inline editor for a single email template row.
// Left side : subject + text + html. Right side : sandbox preview using the
// declared `variables` array filled with placeholder text.

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import {
  useUpdateEmailTemplate,
  type EmailTemplateRow,
} from '../hooks/useEmailTemplates.js';

interface Draft {
  subject:   string;
  body_html: string;
  body_text: string;
  variables: string[];
  is_active: boolean;
}

function rowToDraft(row: EmailTemplateRow): Draft {
  // variables is JSONB array of strings. supabase-js types it as Json,
  // narrow defensively.
  const vars = Array.isArray(row.variables)
    ? row.variables.filter((v): v is string => typeof v === 'string')
    : [];
  return {
    subject:   row.subject,
    body_html: row.body_html,
    body_text: row.body_text,
    variables: vars,
    is_active: row.is_active,
  };
}

function fillSample(text: string, vars: readonly string[]): string {
  let out = text;
  for (const v of vars) {
    // v is e.g. "{{customer_name}}". Show a readable preview value.
    const placeholder = v.replace(/[{}]/g, '');
    out = out.split(v).join(`[${placeholder}]`);
  }
  return out;
}

export interface EmailTemplateEditorProps {
  row: EmailTemplateRow;
  canEdit: boolean;
}

export function EmailTemplateEditor({ row, canEdit }: EmailTemplateEditorProps) {
  const update = useUpdateEmailTemplate();
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
      draft.subject   !== row.subject   ||
      draft.body_html !== row.body_html ||
      draft.body_text !== row.body_text ||
      draft.is_active !== row.is_active
    );
  }, [draft, row]);

  async function handleSave() {
    setServerError(null);
    try {
      await update.mutateAsync({
        id: row.id,
        values: {
          subject:   draft.subject,
          body_html: draft.body_html,
          body_text: draft.body_text,
          is_active: draft.is_active,
        },
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Failed to save template');
    }
  }

  const previewSubject = fillSample(draft.subject,   draft.variables);
  const previewHtml    = fillSample(draft.body_html, draft.variables);
  const previewText    = fillSample(draft.body_text, draft.variables);

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-3">
        <div>
          <label htmlFor={`tpl-subj-${row.id}`} className="text-xs uppercase tracking-widest text-text-secondary">Subject</label>
          <input id={`tpl-subj-${row.id}`} value={draft.subject} disabled={!canEdit} maxLength={200}
            onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50" />
        </div>
        <div>
          <label htmlFor={`tpl-text-${row.id}`} className="text-xs uppercase tracking-widest text-text-secondary">Plain text body</label>
          <textarea id={`tpl-text-${row.id}`} rows={6} value={draft.body_text} disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, body_text: e.target.value }))}
            className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm font-mono text-text-primary disabled:opacity-50" />
        </div>
        <div>
          <label htmlFor={`tpl-html-${row.id}`} className="text-xs uppercase tracking-widest text-text-secondary">HTML body</label>
          <textarea id={`tpl-html-${row.id}`} rows={6} value={draft.body_html} disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, body_html: e.target.value }))}
            className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm font-mono text-text-primary disabled:opacity-50" />
        </div>
        <div className="flex items-center gap-2">
          <input id={`tpl-active-${row.id}`} type="checkbox" checked={draft.is_active} disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))} />
          <label htmlFor={`tpl-active-${row.id}`} className="text-sm">Active</label>
        </div>
        <p className="text-xs text-text-secondary">
          Variables declared on this template:{' '}
          {draft.variables.length === 0 ? <span className="italic">none</span> : draft.variables.join(', ')}
        </p>
        {serverError && <p className="text-red text-sm" role="alert">{serverError}</p>}
        {savedAt && <p className="text-emerald-700 text-xs" role="status">Saved at {savedAt}</p>}
        {canEdit && (
          <Button type="button" variant="primary" disabled={!dirty || update.isPending}
            onClick={() => { void handleSave(); }}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        )}
      </div>

      <div className="space-y-3" aria-label="Preview">
        <div>
          <div className="text-xs uppercase tracking-widest text-text-secondary mb-1">Preview — Subject</div>
          <div className="border border-border-subtle bg-bg-overlay rounded-md px-3 py-2 text-sm">{previewSubject}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-text-secondary mb-1">Preview — Plain text</div>
          <pre className="border border-border-subtle bg-bg-overlay rounded-md px-3 py-2 text-xs whitespace-pre-wrap font-mono">{previewText}</pre>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-text-secondary mb-1">Preview — HTML (raw markup)</div>
          {/*
            For safety we do NOT inject HTML into the DOM here ; we render the
            escaped markup so admins can audit the template body. A future
            iteration may add a sandboxed iframe preview.
          */}
          <pre className="border border-border-subtle bg-bg-overlay rounded-md px-3 py-2 text-xs whitespace-pre-wrap font-mono">{previewHtml}</pre>
        </div>
      </div>
    </div>
  );
}
