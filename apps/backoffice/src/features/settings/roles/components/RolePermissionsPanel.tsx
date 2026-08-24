// apps/backoffice/src/features/settings/roles/components/RolePermissionsPanel.tsx
//
// ADR-031 — la fiche d'un rôle vue par module. Là où la matrice globale répond
// à « qui a quoi », ce panneau répond à « que peut CE rôle » : les permissions
// y sont groupées par module, chaque module portant son compteur accordé/total
// pour qu'un survol suffise à repérer un module trop ouvert.
//
// Même garde que la matrice : SUPER_ADMIN est verrouillé côté serveur
// (`super_admin_row_locked`), l'écran le dit avant le refus.

import { useMemo, useState, type JSX } from 'react';
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { FOCUS_RING } from '@/components/focusRing.js';
import {
  useRbacMatrix,
  isRoleGranted,
  SUPER_ADMIN_ROLE,
} from '../hooks/useRbacMatrix.js';
import { useSetRolePermission } from '../hooks/useSetRolePermission.js';

interface Props {
  roleCode: string;
  roleName: string;
}

export function RolePermissionsPanel({ roleCode, roleName }: Props): JSX.Element {
  const matrix = useRbacMatrix();
  const setPermission = useSetRolePermission();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const locked = roleCode === SUPER_ADMIN_ROLE;

  const groups = matrix.data?.byModule ?? [];

  const totals = useMemo(() => {
    const data = matrix.data;
    if (data === undefined) return { granted: 0, total: 0 };
    let granted = 0;
    for (const p of data.permissions) {
      if (isRoleGranted(data, roleCode, p.code)) granted++;
    }
    return { granted, total: data.permissions.length };
  }, [matrix.data, roleCode]);

  function toggleModule(module: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  }

  if (matrix.isLoading) {
    return <div className="text-sm text-text-secondary">Loading permissions…</div>;
  }
  if (matrix.error !== null) {
    return (
      <div className="text-sm text-danger-as-text" data-testid="role-permissions-error">
        Failed to load permissions: {matrix.error.message}
      </div>
    );
  }
  const data = matrix.data;
  if (data === undefined) return <div className="text-sm text-text-secondary">No data.</div>;

  return (
    <section className="space-y-3" aria-labelledby="role-permissions-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="role-permissions-heading" className="text-xl">Permissions</h2>
        <span className="text-sm text-text-secondary" data-testid="role-permissions-total">
          {totals.granted} / {totals.total} granted
        </span>
      </div>

      {locked && (
        <p className="rounded border border-border-subtle bg-surface-inert px-3 py-2 text-xs text-text-secondary"
           data-testid="role-permissions-locked">
          <Lock className="mr-1.5 inline h-3.5 w-3.5 text-text-muted" aria-hidden />
          SUPER_ADMIN permissions are locked to prevent lockout. They can only be
          changed in the database.
        </p>
      )}

      <div className="space-y-2">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.module);
          const grantedHere = group.permissions.filter((p) => isRoleGranted(data, roleCode, p.code)).length;
          return (
            <div key={group.module} className="rounded border border-border-subtle">
              <button
                type="button"
                onClick={() => { toggleModule(group.module); }}
                aria-expanded={!isCollapsed}
                data-testid={`module-toggle-${group.module}`}
                className={`flex w-full items-center justify-between gap-3 bg-bg-elevated px-3 py-2 text-left ${FOCUS_RING}`}
              >
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-text-primary">
                  {isCollapsed
                    ? <ChevronRight className="h-4 w-4 text-text-muted" aria-hidden />
                    : <ChevronDown className="h-4 w-4 text-text-muted" aria-hidden />}
                  {group.module}
                </span>
                <span className="font-data text-xs text-text-secondary" data-testid={`module-count-${group.module}`}>
                  {grantedHere} / {group.permissions.length}
                </span>
              </button>

              {!isCollapsed && (
                <ul className="divide-y divide-border-subtle">
                  {group.permissions.map((p) => {
                    const granted = isRoleGranted(data, roleCode, p.code);
                    const inputId = `perm-${roleCode}-${p.code}`;
                    return (
                      <li key={p.code} className="flex items-start gap-3 px-3 py-2">
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={granted}
                          disabled={locked || setPermission.isPending}
                          title={locked ? 'Locked to prevent lockout' : undefined}
                          data-testid={`role-perm-${p.code}`}
                          onChange={(e) => {
                            setPermission.mutate({
                              roleCode,
                              permissionCode: p.code,
                              granted:        e.target.checked,
                            });
                          }}
                          className={`mt-0.5 h-4 w-4 shrink-0 accent-gold ${FOCUS_RING}`}
                        />
                        <label htmlFor={inputId} className="min-w-0 cursor-pointer">
                          <span className="block font-mono text-xs text-text-primary">{p.code}</span>
                          {p.description !== null && (
                            <span className="block text-xs leading-tight text-text-secondary">
                              {p.description}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-text-secondary">
        Every change is audit-logged against {roleName}. Exceptions granted to a
        single person live below, not here.
      </p>
    </section>
  );
}
