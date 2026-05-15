// apps/backoffice/src/pages/users/UsersListPage.tsx
// Session 14 / Phase 6.A — User Administration page rebuild matching `user.jpg`.
// KPI strip (Total Users / Active / Inactive / Defined Roles) + the existing
// table. PIN auth — there are no passwords.

import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { Plus, ShieldCheck, UsersRound, UserCheck, UserX, ShieldHalf } from 'lucide-react';
import { Button, KpiTile } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useUsersList } from '@/features/users/hooks/useUsersList.js';
import { useRolesList } from '@/features/users/hooks/useRolesList.js';
import { UsersTable } from '@/features/users/components/UsersTable.js';

export default function UsersListPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission('users.create');
  const canViewMatrix = hasPermission('rbac.read');

  const users = useUsersList();
  const roles = useRolesList();

  const rows = users.data ?? [];
  const kpis = useMemo(() => {
    let active = 0;
    let inactive = 0;
    for (const u of rows) {
      if (u.deleted_at !== null) continue;
      if (u.is_active) active++;
      else inactive++;
    }
    return { total: rows.length, active, inactive };
  }, [rows]);

  const definedRoles = roles.data?.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif text-text-primary">User Administration</h1>
          <p className="text-sm text-text-secondary">
            Staff profiles + role assignments. Sign-in is via PIN — there are no passwords.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canViewMatrix && (
            <Link to="/backoffice/users/permissions">
              <Button variant="ghost">
                <ShieldCheck className="h-4 w-4 mr-1.5" aria-hidden />
                Permission matrix
              </Button>
            </Link>
          )}
          {canCreate && (
            <Link to="/backoffice/users/new">
              <Button>
                <Plus className="h-4 w-4 mr-1.5" aria-hidden />
                Add user
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* KPI strip — matches `user.jpg` */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile label="Total users"    value={kpis.total}    icon={UsersRound} footer="All non-deleted profiles" />
        <KpiTile label="Active"         value={kpis.active}   icon={UserCheck}  footer="Currently allowed to sign in" />
        <KpiTile label="Inactive"       value={kpis.inactive} icon={UserX}      footer="Disabled accounts" />
        <KpiTile label="Defined roles"  value={definedRoles}  icon={ShieldHalf} footer="System + custom roles" />
      </div>

      <UsersTable
        rows={rows}
        loading={users.isLoading}
        error={users.error}
      />
    </div>
  );
}
