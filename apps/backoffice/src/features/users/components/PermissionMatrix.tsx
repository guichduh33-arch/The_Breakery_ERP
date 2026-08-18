// apps/backoffice/src/features/users/components/PermissionMatrix.tsx
// Session 13 / Phase 5.D — Read-only matrix of role × permission grants.
//
// The grid sources truth from `role_permissions` (and `permissions`/`roles`).
// Because Phase 1.B's has_permission() is a pure lookup over these tables,
// this view is semantically equivalent to calling has_permission(role, perm)
// for every cell — without the O(R*P) RPC chatter.

import { useMemo, useState, type JSX } from 'react';
import { Check, X as XIcon } from 'lucide-react';
import { usePermissionMatrix, isGranted, type PermissionRow } from '../hooks/usePermissionMatrix.js';
import { FOCUS_RING } from '@/components/focusRing.js';

function moduleOf(p: PermissionRow): string { return p.module; }

export function PermissionMatrix(): JSX.Element {
  const matrix = usePermissionMatrix();
  const [filter, setFilter] = useState<string>('');

  const filteredPerms: PermissionRow[] = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const all = matrix.data?.permissions ?? [];
    if (f === '') return all;
    return all.filter((p) =>
      p.code.toLowerCase().includes(f)
      || p.module.toLowerCase().includes(f)
      || (p.description ?? '').toLowerCase().includes(f),
    );
  }, [matrix.data, filter]);

  if (matrix.isLoading) return <div className="text-sm text-text-secondary">Loading matrix…</div>;
  if (matrix.error != null) {
    return <div className="text-sm text-danger">Failed: {matrix.error.message}</div>;
  }
  const data = matrix.data;
  if (!data) return <div className="text-sm text-text-secondary">No data.</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          aria-label="Filter permissions"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); }}
          placeholder="Filter by code, module, or description…"
          className={`w-72 px-2 py-1.5 text-sm bg-bg-base border border-border-subtle rounded placeholder:text-text-muted ${FOCUS_RING}`}
        />
        <span className="text-xs text-text-secondary">
          {filteredPerms.length} / {data.permissions.length} permissions
        </span>
      </div>

      <div className="overflow-x-auto border border-border-subtle rounded">
        <table className="text-xs w-full">
          <caption className="sr-only">
            Permissions granted to each role. Rows are permissions, columns are roles.
            Each cell says whether the role holds that permission.
          </caption>
          <thead className="bg-bg-elevated">
            <tr>
              <th scope="col" className="text-left py-2 px-3 sticky left-0 bg-bg-elevated z-10 min-w-[260px]">
                Permission
              </th>
              {data.roles.map((r) => (
                <th
                  key={r.code}
                  scope="col"
                  className="py-2 px-3 text-center font-mono whitespace-nowrap"
                  title={r.description ?? r.name}
                >
                  {r.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredPerms.map((p, idx) => {
              const prev = idx > 0 ? filteredPerms[idx - 1] : undefined;
              const moduleChanged = prev === undefined || moduleOf(prev) !== moduleOf(p);
              return (
                <tr
                  key={p.code}
                  className={`border-t border-border-subtle ${moduleChanged ? 'border-t-2 border-t-border-strong' : ''}`}
                >
                  {/* En-tête de ligne, pas une cellule : c'est ce qui permet à
                      un lecteur d'écran d'annoncer « accounting.cash.read,
                      MANAGER, granted » au lieu de « granted » seul. */}
                  <th scope="row" className="py-1.5 px-3 sticky left-0 bg-bg-base z-10 text-left font-normal">
                    <div className="font-mono">{p.code}</div>
                    {p.description !== null && (
                      <div className="text-text-secondary text-xs leading-tight mt-0.5">
                        {p.description}
                      </div>
                    )}
                  </th>
                  {data.roles.map((r) => {
                    const granted = isGranted(data, r.code, p.code);
                    return (
                      <td key={r.code} className="py-1.5 px-3 text-center">
                        {granted ? (
                          <Check className="h-4 w-4 text-success inline" aria-label="granted" />
                        ) : (
                          // `text-text-disabled` valait 1,90:1 sur le papier —
                          // sous les 3:1 des objets graphiques (WCAG 1.4.11),
                          // alors que ce glyphe porte TOUTE l'information de la
                          // cellule. `text-text-subtle` est le token que
                          // DESIGN.md réserve au non-texte : 3,24:1.
                          <XIcon className="h-3.5 w-3.5 text-text-subtle inline" aria-label="denied" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Légende obligatoire de l'archétype Matrix : une cellule réduite à un
          signe n'est lisible que si le signe est nommé quelque part. Elle ne
          décrit QUE les deux états que la grille rend — inventer un troisième
          état « accordé par héritage » ferait dire à la vue ce qu'elle ne
          calcule pas. */}
      <div
        className="flex flex-col gap-2 rounded border border-border-subtle bg-bg-elevated px-3 py-2.5 sm:flex-row sm:items-center sm:gap-6"
        data-testid="matrix-legend"
      >
        <span className="text-xs uppercase tracking-widest font-data text-text-muted">Legend</span>
        <span className="inline-flex items-center gap-2 text-xs text-text-secondary">
          <Check className="h-4 w-4 text-success shrink-0" aria-hidden />
          Granted to the role
        </span>
        <span className="inline-flex items-center gap-2 text-xs text-text-secondary">
          <XIcon className="h-3.5 w-3.5 text-text-subtle shrink-0" aria-hidden />
          Not granted
        </span>
      </div>

      <p className="text-xs text-text-secondary">
        Reads the role grants only. Exceptions granted to a single person are
        <strong className="font-semibold text-text-primary"> not reflected here</strong>, so a
        given user may hold more than their role shows.
      </p>
    </div>
  );
}
