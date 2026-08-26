// apps/backoffice/src/features/users/components/UsersTable.tsx
// Session 13 / Phase 5.D — Users list table.

import { Link } from 'react-router-dom';
import type { JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SectionLabel, Skeleton } from '@breakery/ui';
import { formatDateTime } from '@breakery/utils';
import { roleLabel } from '@/lib/roleLabels.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';
import { USERS_LIST_KEY, type UserRow } from '../hooks/useUsersList.js';

export interface UsersTableProps {
  rows:     UserRow[];
  loading?: boolean;
  error?:   Error | null;
  /**
   * ADR-032 — `roles.name` par code, quand la page l'a déjà chargé. Sans lui,
   * un rôle créé depuis l'écran s'affiche en titlecase de son code (« Cashier
   * senior ») au lieu de son vrai nom (« Cashier Senior »). Les rôles système
   * gardent le libellé de produit dans tous les cas.
   */
  roleNames?: Record<string, string>;
}

const USERS_HEAD = ['Employee #', 'Full name', 'Role', 'Status', 'Last login'] as const;

/**
 * Forme du badge de rôle — RECOPIE littérale de `ORDER_STATUS_BADGE`
 * (`features/orders/statusMeta.ts`), le canon partagé des badges en cellule :
 * coins 3 px, label mono capitales interlettrées. Le badge d'ici rendait en
 * Instrument Sans casse mixte avec `rounded` (6 px) — deux badges de tableau
 * dans la même app, deux formes. Recopiée plutôt qu'importée : `statusMeta`
 * appartient au domaine des commandes, la table des utilisateurs n'a rien à y
 * faire dépendre.
 */
const ROLE_BADGE_SHAPE =
  'inline-flex rounded-sm px-1.5 py-0.5 font-data text-xs font-semibold uppercase tracking-widest';

const ROLE_BADGE_CLASS: Record<string, string> = {
  SUPER_ADMIN: 'bg-cat-rose/15 text-cat-rose border border-cat-rose/30',
  ADMIN:       'bg-cat-amber/15 text-cat-amber border border-cat-amber/30',
  MANAGER:     'bg-cat-blue/15 text-cat-blue border border-cat-blue/30',
  CASHIER:     'bg-cat-emerald/15 text-cat-emerald border border-cat-emerald/30',
  waiter:      'bg-cat-violet/15 text-cat-violet border border-cat-violet/30',
};

export function UsersTable({ rows, loading, error, roleNames }: UsersTableProps): JSX.Element {
  // La reprise se prend ICI plutôt qu'en prop : la table n'a qu'un appelant, et
  // sa requête a une clé publique. `invalidateQueries` fait du préfixe, donc la
  // variante `['users-list','with-deleted']` repart avec la liste courante.
  const qc = useQueryClient();

  if (loading === true) {
    // Silhouette de la table plutôt qu'un « Loading users… » nu (audit UX/UI
    // 2026-08-13, lot 8) : quelques lignes fantômes qui gardent la forme de ce
    // qui arrive.
    return (
      <div
        className="flex flex-col gap-2 py-1"
        aria-busy="true"
        aria-live="polite"
        aria-label="Loading users"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height="2.25rem" />
        ))}
      </div>
    );
  }
  if (error != null) {
    return (
      <QueryErrorBanner
        detail={errorDetailText(error)}
        onRetry={() => { void qc.invalidateQueries({ queryKey: USERS_LIST_KEY }); }}
        data-testid="users-error"
      >
        The staff list could not be loaded — accounts exist that this page
        cannot show right now.
      </QueryErrorBanner>
    );
  }
  if (rows.length === 0) {
    return <div className="text-sm text-text-secondary">No users yet.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Employee number, full name, role, status and last login per user</caption>
        {/* Canon des tableaux (patron `WalletLedgerTable`) : papier inerte et
            libellés en label mono capitales. L'en-tête rendait en Instrument
            Sans, capitales SANS interlettrage — ni le corps, ni le canon. */}
        <thead>
          <tr className="border-b border-border-subtle bg-surface-inert text-left">
            {USERS_HEAD.map((label) => (
              <th key={label} scope="col" className="px-3 py-2.5 font-data">
                <SectionLabel as="span" size="xs">{label}</SectionLabel>
              </th>
            ))}
            <th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className="border-b border-border-subtle" data-testid={`user-row-${u.id}`}>
              <td className="py-2 px-3 font-mono text-xs">{u.employee_code}</td>
              <td className="py-2 px-3">{u.full_name}</td>
              <td className="py-2 px-3">
                <span
                  className={`${ROLE_BADGE_SHAPE} ${
                    ROLE_BADGE_CLASS[u.role_code] ?? 'bg-bg-overlay text-text-secondary'
                  }`}
                >
                  {roleLabel(u.role_code, roleNames?.[u.role_code])}
                </span>
              </td>
              <td className="py-2 px-3 text-xs">
                {u.deleted_at !== null ? (
                  <span className="text-danger">Deleted</span>
                ) : u.is_active ? (
                  <span className="text-success">Active</span>
                ) : (
                  <span className="text-text-secondary">Inactive</span>
                )}
              </td>
              {/* The Mono-Carries-Data Rule : une date de dernière connexion
                  est un chiffre qu'on compare d'une ligne à l'autre. */}
              <td className="whitespace-nowrap py-2 px-3 font-data text-xs tabular-nums text-text-secondary">
                {u.last_login_at !== null
                  ? formatDateTime(u.last_login_at)
                  : '—'}
              </td>
              <td className="py-2 px-3 text-right">
                {/* « Open », « Open », « Open »… — sorti de sa ligne (liste des
                    liens d'un lecteur d'écran), le libellé ne dit PAS qui l'on
                    ouvre. Le nom est repris dans le nom accessible. */}
                <Link
                  to={`/backoffice/users/${u.id}`}
                  className="text-xs text-gold hover:underline"
                  aria-label={`Open ${u.full_name}`}
                  data-testid={`user-open-${u.id}`}
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
