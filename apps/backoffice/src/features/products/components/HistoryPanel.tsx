// apps/backoffice/src/features/products/components/HistoryPanel.tsx
//
// Product detail "History" tab — the change-log for this product, read from
// audit_logs via get_audit_logs_v2 (entity_type='product', entity_id=<id>).
// The RPC is SECURITY INVOKER and audit_logs is admin_read RLS-gated, so a
// MANAGER (or any non-admin) sees an empty trail by design.

import { type JSX } from 'react';
import { Badge, Card, EmptyState, SectionLabel } from '@breakery/ui';
import { History } from 'lucide-react';
import {
  useProductAuditLog,
  type ProductAuditEntry,
} from '../hooks/useProductAuditLog.js';

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// Render the audit metadata as a compact, human-scannable summary. Falls back
// to a JSON dump for shapes we don't special-case.
function summariseMetadata(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return '—';
  if (typeof metadata !== 'object') return String(metadata);
  const obj = metadata as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return '—';
  return keys
    .map((k) => {
      const v = obj[k];
      const text = v === null || v === undefined
        ? '—'
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v);
      return `${k}: ${text}`;
    })
    .join(' · ');
}

interface Props {
  productId: string;
}

export function HistoryPanel({ productId }: Props): JSX.Element {
  const q = useProductAuditLog(productId);

  const rows: ProductAuditEntry[] = q.data ?? [];

  if (q.isLoading) {
    return <div className="py-12 text-center text-sm text-text-secondary">Loading history…</div>;
  }
  if (q.error !== null && q.error !== undefined) {
    return (
      <div className="rounded-lg border border-red bg-red-soft p-4 text-sm text-red" role="alert">
        Failed to load history: {(q.error as Error).message}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No change history"
        description="Edits to this product (price, settings, recipe, deletion) appear here. Only admins can view the audit trail."
        size="lg"
      />
    );
  }

  return (
    <Card variant="default" padding="none">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border-subtle bg-bg-base/40">
            <tr>
              <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">When</SectionLabel></th>
              <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Action</SectionLabel></th>
              <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Actor</SectionLabel></th>
              <th className="px-4 py-3 text-left"><SectionLabel as="span" size="xs">Details</SectionLabel></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border-subtle align-top">
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">{fmtDateTime(r.created_at)}</td>
                <td className="px-4 py-3"><Badge variant="outline">{r.action}</Badge></td>
                <td className="px-4 py-3 font-mono text-xs text-text-secondary">{r.actor_id !== null ? r.actor_id.slice(0, 8) : '—'}</td>
                <td className="px-4 py-3 text-text-secondary">{summariseMetadata(r.metadata)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
