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
    return <div className="text-sm text-rose-600">Failed: {matrix.error.message}</div>;
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
          className="w-72 px-2 py-1.5 text-sm bg-bg-base border border-border-subtle rounded"
        />
        <span className="text-xs text-text-secondary">
          {filteredPerms.length} / {data.permissions.length} permissions
        </span>
      </div>

      <div className="overflow-x-auto border border-border-subtle rounded">
        <table className="text-xs w-full">
          <thead className="bg-bg-elevated">
            <tr>
              <th className="text-left py-2 px-3 sticky left-0 bg-bg-elevated z-10 min-w-[260px]">
                Permission
              </th>
              {data.roles.map((r) => (
                <th
                  key={r.code}
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
                  <td className="py-1.5 px-3 sticky left-0 bg-bg-base z-10">
                    <div className="font-mono">{p.code}</div>
                    {p.description !== null && (
                      <div className="text-text-secondary text-[10px] leading-tight mt-0.5">
                        {p.description}
                      </div>
                    )}
                  </td>
                  {data.roles.map((r) => {
                    const granted = isGranted(data, r.code, p.code);
                    return (
                      <td key={r.code} className="py-1.5 px-3 text-center">
                        {granted ? (
                          <Check className="h-4 w-4 text-emerald-600 inline" aria-label="granted" />
                        ) : (
                          <XIcon className="h-3.5 w-3.5 text-text-secondary/40 inline" aria-label="denied" />
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

      <p className="text-xs text-text-secondary">
        Source : <code className="font-mono">role_permissions</code> table. Authoritative since
        Phase 1.B (<code className="font-mono">has_permission()</code> is a pure lookup over this
        table plus <code className="font-mono">user_permission_overrides</code>).
      </p>
    </div>
  );
}
