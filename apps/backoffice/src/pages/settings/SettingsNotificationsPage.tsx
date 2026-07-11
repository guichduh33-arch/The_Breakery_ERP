// apps/backoffice/src/pages/settings/SettingsNotificationsPage.tsx
//
// S73 Lot 3 — System notification templates editor (channel email/sms/push/
// inapp; consumed by enqueue_notification_v1). Update-only: codes are system
// events, no create/delete from the UI. Mirrors SettingsEmailTemplatesPage's
// card-per-template rendering for visual homogeneity. Edit gate is
// `notifications.send` (matches the RLS write policy), NOT `settings.update`
// — read is ungated here (route-level `settings.read` only).
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useNotificationTemplatesList,
  useUpdateNotificationTemplate,
  type NotificationTemplateRow,
} from '@/features/settings/hooks/useNotificationTemplates.js';

const CHANNEL_VARIANT: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  email: 'info',
  sms: 'warning',
  push: 'success',
  inapp: 'neutral',
};

function channelVariant(channel: string) {
  return CHANNEL_VARIANT[channel] ?? 'neutral';
}

function templateVariables(row: NotificationTemplateRow): string[] {
  return Array.isArray(row.variables)
    ? row.variables.filter((v): v is string => typeof v === 'string')
    : [];
}

interface Draft {
  subject_template: string;
  body_template: string;
  is_active: boolean;
}

function rowToDraft(row: NotificationTemplateRow): Draft {
  return {
    subject_template: row.subject_template ?? '',
    body_template: row.body_template,
    is_active: row.is_active,
  };
}

interface NotificationTemplateCardProps {
  row: NotificationTemplateRow;
  canEdit: boolean;
}

function NotificationTemplateCard({ row, canEdit }: NotificationTemplateCardProps) {
  const update = useUpdateNotificationTemplate();
  const [draft, setDraft] = useState<Draft>(rowToDraft(row));
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    setDraft(rowToDraft(row));
    setServerError(null);
    setSavedAt(null);
  }, [row]);

  const dirty = useMemo(() => {
    return (
      draft.subject_template !== (row.subject_template ?? '') ||
      draft.body_template !== row.body_template ||
      draft.is_active !== row.is_active
    );
  }, [draft, row]);

  async function handleSave() {
    setServerError(null);
    try {
      await update.mutateAsync({
        id: row.id,
        values: {
          subject_template: draft.subject_template || null,
          body_template: draft.body_template,
          is_active: draft.is_active,
        },
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Failed to save template');
    }
  }

  const variables = templateVariables(row);

  return (
    <section className="space-y-3 bg-bg-elevated rounded-lg border border-border-subtle p-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold font-mono">{row.code}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={channelVariant(row.channel)}>{row.channel}</Badge>
          <label htmlFor={`notif-active-${row.id}`} className="flex items-center gap-2 text-sm">
            <input
              id={`notif-active-${row.id}`}
              type="checkbox"
              checked={draft.is_active}
              disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))}
            />
            Active
          </label>
        </div>
      </header>

      <div>
        <label htmlFor={`notif-subj-${row.id}`} className="text-xs uppercase tracking-widest text-text-secondary">
          Subject template
        </label>
        <textarea
          id={`notif-subj-${row.id}`}
          rows={2}
          value={draft.subject_template}
          disabled={!canEdit}
          onChange={(e) => setDraft((d) => ({ ...d, subject_template: e.target.value }))}
          className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm font-mono text-text-primary disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor={`notif-body-${row.id}`} className="text-xs uppercase tracking-widest text-text-secondary">
          Body template
        </label>
        <textarea
          id={`notif-body-${row.id}`}
          rows={6}
          value={draft.body_template}
          disabled={!canEdit}
          onChange={(e) => setDraft((d) => ({ ...d, body_template: e.target.value }))}
          className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm font-mono text-text-primary disabled:opacity-50"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs uppercase tracking-widest text-text-secondary mr-1">Variables</span>
        {variables.length === 0 ? (
          <span className="text-xs italic text-text-secondary">none</span>
        ) : (
          variables.map((v) => (
            <span
              key={v}
              className="inline-flex items-center rounded-full border border-border-subtle bg-surface-4 px-2 py-0.5 text-xs font-mono text-text-secondary"
            >
              {v}
            </span>
          ))
        )}
      </div>

      {serverError && <p className="text-red text-sm" role="alert">{serverError}</p>}
      {savedAt && <p className="text-success text-xs" role="status">Saved at {savedAt}</p>}

      {canEdit && (
        <Button
          type="button"
          variant="primary"
          disabled={!dirty || update.isPending}
          onClick={() => { void handleSave(); }}
        >
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      )}
    </section>
  );
}

export default function SettingsNotificationsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = hasPermission('notifications.send');

  const list = useNotificationTemplatesList();

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="font-serif text-3xl">Notifications</h1>
        <p className="text-text-secondary text-sm mt-1">
          System notification templates consumed by enqueue_notification_v1 (order ready, payment
          received, low stock…). Codes are system events — no create/delete from here. Customer-facing
          emails live in Email templates.
        </p>
      </div>

      {list.isLoading && <div className="text-text-secondary">Loading…</div>}
      {list.error && <div className="text-red">Failed to load: {list.error.message}</div>}

      {!list.isLoading && !list.error && (
        <div className="space-y-8">
          {list.data?.map((tpl) => (
            <NotificationTemplateCard key={tpl.id} row={tpl} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  );
}
