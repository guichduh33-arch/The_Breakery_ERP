// apps/backoffice/src/features/users/components/UsersTable.tsx
// Session 13 / Phase 5.D — Users list table.

import { Link } from 'react-router-dom';
import type { JSX } from 'react';
import type { UserRow } from '../hooks/useUsersList.js';

export interface UsersTableProps {
  rows:     UserRow[];
  loading?: boolean;
  error?:   Error | null;
}

const ROLE_BADGE_CLASS: Record<string, string> = {
  SUPER_ADMIN: 'bg-rose-100 text-rose-700',
  ADMIN:       'bg-amber-100 text-amber-700',
  MANAGER:     'bg-sky-100 text-sky-700',
  CASHIER:     'bg-emerald-100 text-emerald-700',
  waiter:      'bg-violet-100 text-violet-700',
};

export function UsersTable({ rows, loading, error }: UsersTableProps): JSX.Element {
  if (loading === true) {
    return <div className="text-sm text-text-secondary">Loading users…</div>;
  }
  if (error != null) {
    return <div className="text-sm text-rose-600">Failed to load users: {error.message}</div>;
  }
  if (rows.length === 0) {
    return <div className="text-sm text-text-secondary">No users yet.</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
        <tr>
          <th className="text-left py-2 px-3">Employee #</th>
          <th className="text-left py-2 px-3">Full name</th>
          <th className="text-left py-2 px-3">Role</th>
          <th className="text-left py-2 px-3">Status</th>
          <th className="text-left py-2 px-3">Last login</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((u) => (
          <tr key={u.id} className="border-b border-border-subtle">
            <td className="py-2 px-3 font-mono text-xs">{u.employee_code}</td>
            <td className="py-2 px-3">{u.full_name}</td>
            <td className="py-2 px-3">
              <span
                className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                  ROLE_BADGE_CLASS[u.role_code] ?? 'bg-bg-overlay text-text-secondary'
                }`}
              >
                {u.role_code}
              </span>
            </td>
            <td className="py-2 px-3 text-xs">
              {u.deleted_at !== null ? (
                <span className="text-rose-600">Deleted</span>
              ) : u.is_active ? (
                <span className="text-emerald-600">Active</span>
              ) : (
                <span className="text-text-secondary">Inactive</span>
              )}
            </td>
            <td className="py-2 px-3 text-xs text-text-secondary">
              {u.last_login_at !== null
                ? new Date(u.last_login_at).toLocaleString()
                : '—'}
            </td>
            <td className="py-2 px-3 text-right">
              <Link
                to={`/backoffice/users/${u.id}`}
                className="text-xs text-gold hover:underline"
              >
                Open
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
