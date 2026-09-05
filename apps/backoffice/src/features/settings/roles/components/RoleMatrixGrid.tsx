// apps/backoffice/src/features/settings/roles/components/RoleMatrixGrid.tsx
//
// ADR-031 — la matrice globale, désormais ÉDITABLE. Lignes = permissions,
// colonnes = rôles, cellule = une case à cocher qui poste directement
// `set_role_permission_v1`.
//
// Ce que la vue lecture-seule avait acquis et qu'on garde intégralement :
//   · les en-têtes sont de vrais en-têtes (`scope`), sinon un lecteur d'écran
//     annonce « coché » sans dire de quoi ni pour qui ;
//   · une légende nomme les états, parce qu'une cellule réduite à un signe
//     n'est lisible que si le signe est nommé quelque part ;
//   · la réserve sur les exceptions par personne reste dite — la grille lit
//     `role_permissions`, jamais `user_permission_overrides`.
//
// La colonne SUPER_ADMIN est verrouillée : le serveur la refuse
// (`super_admin_row_locked`), l'écran ne fait que dire pourquoi avant le refus.

import { memo, useCallback, useMemo, useState, type JSX } from 'react';
import { Check, Lock } from 'lucide-react';
import { useDebouncedValue } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
import {
  useRbacMatrix,
  grantKey,
  SUPER_ADMIN_ROLE,
  type RbacPermission,
  type RbacRole,
} from '../hooks/useRbacMatrix.js';
import { useSetRolePermission } from '../hooks/useSetRolePermission.js';

const CONTROL_CLS =
  `h-9 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`;

interface MatrixRowProps {
  permission:    RbacPermission;
  roles:         readonly RbacRole[];
  grants:        ReadonlySet<string>;
  moduleChanged: boolean;
  /** Le rôle dont la cellule est en cours d'écriture SUR CETTE LIGNE, sinon
   *  `null` : les autres lignes reçoivent une valeur inchangée et `memo` les
   *  saute. */
  pendingRole:   string | null;
  onToggle:      (roleCode: string, permissionCode: string, granted: boolean) => void;
}

// Une ligne = autant de cases que de rôles ; la grille en compte ~760. Sans
// `memo`, chaque frappe du filtre les réconciliait toutes. Les props sont
// choisies pour rester STABLES d'un rendu à l'autre (le `Set` de grants et le
// tableau de rôles viennent du cache, le rappel est mémoïsé).
const MatrixRow = memo(function MatrixRow({
  permission: p, roles, grants, moduleChanged, pendingRole, onToggle,
}: MatrixRowProps): JSX.Element {
  return (
    <tr
      className={`border-t border-border-subtle ${moduleChanged ? 'border-t-2 border-t-border-strong' : ''}`}
    >
      {/* En-tête de ligne, pas une cellule : c'est ce qui permet à
          un lecteur d'écran d'annoncer « accounting.cash.read,
          MANAGER, coché » au lieu de « coché » seul. */}
      <th scope="row" className="sticky left-0 z-10 bg-bg-base px-3 py-1.5 text-left font-normal">
        <div className="font-mono">{p.code}</div>
        {p.description !== null && (
          <div className="mt-0.5 text-xs leading-tight text-text-secondary">
            {p.description}
          </div>
        )}
      </th>
      {roles.map((r) => {
        const locked  = r.code === SUPER_ADMIN_ROLE;
        const granted = grants.has(grantKey(r.code, p.code));
        return (
          <td key={r.code} className="px-3 py-1.5 text-center">
            <input
              type="checkbox"
              checked={granted}
              // L'attente ne gèle QUE la case postée : `setPermission.isPending`
              // désactivait les ~760 cases de la grille le temps d'un
              // aller-retour, y compris celles d'autres rôles.
              disabled={locked || pendingRole === r.code}
              title={locked ? 'Locked to prevent lockout' : undefined}
              aria-label={`${p.code} for ${r.name}`}
              data-testid={`rbac-cell-${r.code}-${p.code}`}
              onChange={(e) => { onToggle(r.code, p.code, e.target.checked); }}
              className={`h-4 w-4 accent-gold ${FOCUS_RING}`}
            />
          </td>
        );
      })}
    </tr>
  );
});

export function RoleMatrixGrid(): JSX.Element {
  const matrix = useRbacMatrix();
  const setPermission = useSetRolePermission();
  const [search, setSearch] = useState<string>('');
  const [moduleFilter, setModuleFilter] = useState<string>('');

  // La saisie vit en local, le FILTRAGE attend 250 ms (le cran du Command
  // Palette et du journal) : à la frappe, la grille entière se recalculait et se
  // réconciliait à chaque touche.
  const debouncedSearch = useDebouncedValue(search, 250);

  const allPermissions = matrix.data?.permissions;

  const filtered: RbacPermission[] = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    return (allPermissions ?? []).filter((p) => {
      if (moduleFilter !== '' && p.module !== moduleFilter) return false;
      if (needle === '') return true;
      return (
        p.code.toLowerCase().includes(needle)
        || p.module.toLowerCase().includes(needle)
        || (p.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [allPermissions, debouncedSearch, moduleFilter]);

  // eslint-disable-next-line @typescript-eslint/unbound-method -- la mutation
  // de React Query est déjà liée ; on ne fait que la refermer dans un rappel.
  const mutate = setPermission.mutate;
  const handleToggle = useCallback(
    (roleCode: string, permissionCode: string, granted: boolean) => {
      mutate({ roleCode, permissionCode, granted });
    },
    [mutate],
  );

  const pending = setPermission.isPending ? setPermission.variables : undefined;

  if (matrix.isLoading) {
    return <div className="text-sm text-text-secondary">Loading matrix…</div>;
  }
  if (matrix.error !== null) {
    return (
      <div className="text-sm text-danger-as-text" data-testid="matrix-error">
        Failed to load the matrix: {matrix.error.message}
      </div>
    );
  }
  const data = matrix.data;
  if (data === undefined) return <div className="text-sm text-text-secondary">No data.</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="rbac-search" className="font-data font-semibold block text-xs uppercase tracking-widest text-text-secondary">
            Filter
          </label>
          <input
            id="rbac-search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            placeholder="Code, module, or description…"
            className={`${CONTROL_CLS} w-72 placeholder:text-text-muted`}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="rbac-module" className="font-data font-semibold block text-xs uppercase tracking-widest text-text-secondary">
            Module
          </label>
          <select
            id="rbac-module"
            value={moduleFilter}
            onChange={(e) => { setModuleFilter(e.target.value); }}
            className={CONTROL_CLS}
          >
            <option value="">All modules</option>
            {data.modules.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <span className="pb-2 text-xs text-text-secondary" data-testid="matrix-count">
          {filtered.length} / {data.permissions.length} permissions
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-border-subtle">
        <table className="w-full text-xs">
          <caption className="sr-only">
            Permissions granted to each role. Rows are permissions, columns are
            roles. Each checkbox grants or revokes that permission for that role.
          </caption>
          <thead className="bg-bg-elevated">
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-[260px] bg-bg-elevated px-3 py-2 text-left">
                Permission
              </th>
              {data.roles.map((r) => {
                const locked = r.code === SUPER_ADMIN_ROLE;
                return (
                  <th
                    key={r.code}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 text-center font-mono"
                    title={locked ? 'Locked to prevent lockout' : (r.description ?? r.code)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {r.name}
                      {locked && <Lock className="h-3 w-3 text-text-muted" aria-label="locked" />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={data.roles.length + 1} className="px-3 py-6 text-text-secondary">
                  No permission matches the current filter.
                </td>
              </tr>
            )}
            {filtered.map((p, idx) => {
              const prev = idx > 0 ? filtered[idx - 1] : undefined;
              return (
                <MatrixRow
                  key={p.code}
                  permission={p}
                  roles={data.roles}
                  grants={data.grants}
                  moduleChanged={prev?.module !== p.module}
                  pendingRole={pending?.permissionCode === p.code ? pending.roleCode : null}
                  onToggle={handleToggle}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Légende obligatoire de l'archétype Matrix : elle ne décrit QUE les
          états que la grille rend — inventer un « accordé par héritage » ferait
          dire à la vue ce qu'elle ne calcule pas. */}
      <div
        className="flex flex-col gap-2 rounded border border-border-subtle bg-bg-elevated px-3 py-2.5 sm:flex-row sm:items-center sm:gap-6"
        data-testid="matrix-legend"
      >
        <span className="font-data text-xs uppercase tracking-widest text-text-muted">Legend</span>
        {/* Échantillons purement décoratifs : des <span>, pas des <input> — un
            contrôle non focusable dans une légende serait un mensonge d'a11y. */}
        <span className="inline-flex items-center gap-2 text-xs text-text-secondary">
          <span
            aria-hidden
            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-strong"
          >
            <Check className="h-3 w-3 text-gold" />
          </span>
          Granted to the role
        </span>
        <span className="inline-flex items-center gap-2 text-xs text-text-secondary">
          <span
            aria-hidden
            className="inline-block h-3.5 w-3.5 rounded-sm border border-border-strong"
          />
          Not granted
        </span>
        <span className="inline-flex items-center gap-2 text-xs text-text-secondary">
          <Lock className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
          Locked to prevent lockout
        </span>
      </div>

      <p className="text-xs text-text-secondary">
        Role grants only. Exceptions granted to a single person are
        <strong className="font-semibold text-text-primary"> not reflected here</strong>, so a
        given user may hold more than their role shows.
      </p>
    </div>
  );
}
