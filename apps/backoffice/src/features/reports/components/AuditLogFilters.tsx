// apps/backoffice/src/features/reports/components/AuditLogFilters.tsx
//
// Session 59 / Task 6c — filter bar for the Audit Log report (actor / action
// / entity type). Wires onto filters already supported server-side by
// get_audit_logs_v1/_v2 (via useAuditLogs) but never exposed in the UI.
//
// Actor options come from `useLoginUsers` (list_login_users_v1, S58) — a
// minimal, already-anon-callable id/display_name/role listing reused here
// purely for populating an admin-only <select> ; no new RPC / grant needed.

import { type JSX } from 'react';
import { useLoginUsers } from '@/features/auth/hooks/useLoginUsers.js';

export interface AuditLogFilterValues {
  actorId:    string;
  action:     string;
  entityType: string;
}

export const EMPTY_AUDIT_LOG_FILTERS: AuditLogFilterValues = {
  actorId: '', action: '', entityType: '',
};

export interface AuditLogFiltersProps {
  value:    AuditLogFilterValues;
  onChange: (next: AuditLogFilterValues) => void;
}

// Known entity_type values written by audit RPCs across the codebase — a
// <datalist> hint, not an exhaustive enum (entity_type is free text server-side).
const ENTITY_TYPE_HINTS = [
  'product', 'category', 'variant', 'order', 'expense', 'customer', 'user',
  'supplier', 'purchase_order', 'promotion', 'combo', 'account', 'recipe',
];

export function AuditLogFilters({ value, onChange }: AuditLogFiltersProps): JSX.Element {
  const users = useLoginUsers();
  const hasFilters = value.actorId !== '' || value.action !== '' || value.entityType !== '';

  function patch(p: Partial<AuditLogFilterValues>): void {
    onChange({ ...value, ...p });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
        Actor
        <select
          value={value.actorId}
          onChange={(e) => patch({ actorId: e.target.value })}
          className="mt-1 h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary min-w-40"
          data-testid="audit-filter-actor"
        >
          <option value="">All actors</option>
          {(users.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>{u.display_name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
        Action
        <input
          type="text"
          value={value.action}
          onChange={(e) => patch({ action: e.target.value })}
          placeholder="e.g. product.update"
          className="mt-1 h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          data-testid="audit-filter-action"
        />
      </label>

      <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
        Entity type
        <input
          list="audit-entity-type-hints"
          value={value.entityType}
          onChange={(e) => patch({ entityType: e.target.value })}
          placeholder="e.g. product"
          className="mt-1 h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          data-testid="audit-filter-entity"
        />
        <datalist id="audit-entity-type-hints">
          {ENTITY_TYPE_HINTS.map((t) => <option key={t} value={t} />)}
        </datalist>
      </label>

      {hasFilters && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_AUDIT_LOG_FILTERS)}
          className="h-9 rounded-md px-3 text-xs text-text-secondary hover:text-text-primary"
          data-testid="audit-filter-clear"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
