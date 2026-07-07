// apps/backoffice/src/pages/settings/SettingsPermissionsPage.tsx
//
// Session 13 / Phase 5.C — Read-only role/permission matrix entry point in
// the Settings nav. Phase 5.D has already shipped the full RBAC editing UI
// at `/backoffice/users/permissions` (see D-W5-5C-03 / D-W5-5C-05). This
// page mirrors the read-only view here for discoverability — Settings is
// where admins look for the matrix even though the canonical editor lives
// under Users.

import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import { usePermissionsMatrix } from '@/features/settings/hooks/usePermissionsMatrix.js';

export default function SettingsPermissionsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead = hasPermission('settings.read');

  const matrix = usePermissionsMatrix();
  const [moduleFilter, setModuleFilter] = useState<string>('');

  const grants = useMemo(() => {
    const set = new Set<string>();
    for (const g of matrix.data?.grants ?? []) {
      if (g.is_granted) set.add(`${g.role_code}::${g.permission_code}`);
    }
    return set;
  }, [matrix.data?.grants]);

  const modules = useMemo(() => {
    const set = new Set<string>();
    for (const p of matrix.data?.permissions ?? []) {
      if (p.module) set.add(p.module);
    }
    return Array.from(set).sort();
  }, [matrix.data?.permissions]);

  const visiblePermissions = useMemo(() => {
    const rows = matrix.data?.permissions ?? [];
    if (moduleFilter === '') return rows;
    return rows.filter((p) => p.module === moduleFilter);
  }, [matrix.data?.permissions, moduleFilter]);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view settings.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Permissions</h1>
          <p className="text-text-secondary text-sm mt-1">
            Read-only role → permission matrix. Use{' '}
            <Link to="/backoffice/users/permissions" className="text-gold underline-offset-4 hover:underline">
              Users → Permissions
            </Link>
            {' '}for editing, user overrides, and last-admin protection.
          </p>
        </div>
      </div>

      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="perm-module" className="text-xs uppercase tracking-widest text-text-secondary">Module</label>
          <select id="perm-module" value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
            <option value="">All modules</option>
            {modules.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {matrix.isLoading && <div className="text-text-secondary">Loading…</div>}
      {matrix.error && <div className="text-red">Failed to load: {matrix.error.message}</div>}

      {!matrix.isLoading && !matrix.error && (
        <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary sticky top-0">
              <tr>
                <th className="text-left px-4 py-3 sticky left-0 bg-bg-overlay z-10">Permission</th>
                <th className="text-left px-4 py-3">Description</th>
                {matrix.data?.roles.map((r) => (
                  <th key={r.code} className="text-center px-3 py-3">{r.code}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiblePermissions.length === 0 && (
                <tr><td colSpan={(matrix.data?.roles.length ?? 0) + 2} className="px-4 py-6 text-text-secondary">No permissions match the current filter.</td></tr>
              )}
              {visiblePermissions.map((p) => (
                <tr key={p.code} className="border-t border-border-subtle">
                  <td className="px-4 py-2 font-mono text-xs sticky left-0 bg-bg-elevated">{p.code}</td>
                  <td className="px-4 py-2 text-xs text-text-secondary">{p.description ?? ''}</td>
                  {matrix.data?.roles.map((r) => (
                    <td key={r.code} className="px-3 py-2 text-center">
                      {grants.has(`${r.code}::${p.code}`)
                        ? <span aria-label="granted" className="inline-block w-4 h-4 rounded-full bg-success" />
                        : <span aria-label="not granted" className="inline-block w-4 h-4 rounded-full bg-bg-overlay border border-border-subtle" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
