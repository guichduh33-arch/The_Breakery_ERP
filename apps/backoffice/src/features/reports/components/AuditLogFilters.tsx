// apps/backoffice/src/features/reports/components/AuditLogFilters.tsx
//
// Session 59 / Task 6c — filter bar for the Audit Log report (actor / action
// / entity type). Wires onto filters already supported server-side by
// get_audit_logs_v1/_v2 (via useAuditLogs) but never exposed in the UI.
//
// Actor options come from `useLoginUsers` (list_login_users_v1, S58) — a
// minimal, already-anon-callable id/display_name/role listing reused here
// purely for populating an admin-only <select> ; no new RPC / grant needed.

import { useEffect, useRef, useState, type JSX } from 'react';
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

// Review finding (S59 Task 6c) — the two free-text inputs (Action, Entity
// type) fired `onChange` on every keystroke, which flows straight into
// useAuditLogs' queryKey and re-fetches get_audit_logs_v1 per character.
// No shared useDebounce hook exists in this repo (grepped packages/utils +
// apps) — mirrors the inline setTimeout+ref idiom used elsewhere (e.g.
// apps/pos/src/features/cart/CustomerAttachModal.tsx).
const DEBOUNCE_MS = 300;

export function AuditLogFilters({ value, onChange }: AuditLogFiltersProps): JSX.Element {
  const users = useLoginUsers();
  const hasFilters = value.actorId !== '' || value.action !== '' || value.entityType !== '';

  // Local drafts so the input reflects every keystroke immediately while the
  // commit to the parent (→ RPC re-fetch) is debounced. Actor stays a plain
  // <select> — a discrete choice, not a stream of keystrokes — so it commits
  // immediately, no draft needed.
  const [actionDraft, setActionDraft] = useState(value.action);
  const [entityDraft, setEntityDraft] = useState(value.entityType);
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync drafts when `value` changes from OUTSIDE this component (Clear
  // filters, or any other external reset) — not from our own debounced echo.
  useEffect(() => {
    setActionDraft(value.action);
    setEntityDraft(value.entityType);
  }, [value.action, value.entityType]);

  useEffect(() => {
    return () => {
      if (actionTimer.current) clearTimeout(actionTimer.current);
      if (entityTimer.current) clearTimeout(entityTimer.current);
    };
  }, []);

  function patchNow(p: Partial<AuditLogFilterValues>): void {
    onChange({ ...value, ...p });
  }

  function handleActionChange(next: string): void {
    setActionDraft(next);
    if (actionTimer.current) clearTimeout(actionTimer.current);
    actionTimer.current = setTimeout(() => {
      onChange({ actorId: value.actorId, action: next, entityType: entityDraft });
    }, DEBOUNCE_MS);
  }

  function handleEntityChange(next: string): void {
    setEntityDraft(next);
    if (entityTimer.current) clearTimeout(entityTimer.current);
    entityTimer.current = setTimeout(() => {
      onChange({ actorId: value.actorId, action: actionDraft, entityType: next });
    }, DEBOUNCE_MS);
  }

  function handleClear(): void {
    if (actionTimer.current) clearTimeout(actionTimer.current);
    if (entityTimer.current) clearTimeout(entityTimer.current);
    setActionDraft('');
    setEntityDraft('');
    onChange(EMPTY_AUDIT_LOG_FILTERS);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
        Actor
        <select
          value={value.actorId}
          onChange={(e) => patchNow({ actorId: e.target.value })}
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
          value={actionDraft}
          onChange={(e) => handleActionChange(e.target.value)}
          placeholder="e.g. product.update"
          className="mt-1 h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          data-testid="audit-filter-action"
        />
      </label>

      <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
        Entity type
        <input
          list="audit-entity-type-hints"
          value={entityDraft}
          onChange={(e) => handleEntityChange(e.target.value)}
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
          onClick={handleClear}
          className="h-9 rounded-md px-3 text-xs text-text-secondary hover:text-text-primary"
          data-testid="audit-filter-clear"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
