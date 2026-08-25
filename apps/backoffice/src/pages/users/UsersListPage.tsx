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
import { PageHeader } from '@/components/PageHeader.js';

export default function UsersListPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission('users.create');
  // ADR-031 — le raccourci mène à l'éditeur RBAC, gardé au seul SUPER_ADMIN.
  // `rbac.manage` n'est seedée que sur ce rôle : le lien n'apparaît donc qu'à
  // qui peut réellement ouvrir la page.
  const canEditRbac = hasPermission('rbac.manage');

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

  // ADR-032 — la liste des rôles est déjà chargée pour le KPI ; on en tire les
  // noms pour que la table sache nommer un rôle créé depuis l'écran, qu'aucune
  // table de libellés du front ne connaîtra jamais.
  const roleNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of roles.data ?? []) map[r.code] = r.name;
    return map;
  }, [roles.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        className="items-center"
        title="User Administration"
        subtitle="Staff profiles + role assignments. Sign-in is via PIN — there are no passwords."
        actions={
          <>
            {canEditRbac && (
              <Link to="/backoffice/settings/roles">
                <Button variant="ghost">
                  <ShieldCheck className="h-4 w-4 mr-1.5" aria-hidden />
                  Roles &amp; permissions
                </Button>
              </Link>
            )}
            {canCreate && (
              <Link to="/backoffice/users/new">
                <Button variant="ink">
                  <Plus className="h-4 w-4 mr-1.5" aria-hidden />
                  Add user
                </Button>
              </Link>
            )}
          </>
        }
      />

      {/* Bande de KPI — densité canonique du back-office : 1 / 2 / 4 colonnes.
          À `sm:grid-cols-2 lg:grid-cols-4`, les quatre tuiles restaient sur deux
          rangées jusqu'à 1024 px et un « 7 » s'étalait sur 460 px de carte. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Total users"    value={kpis.total}    icon={UsersRound} footer="All non-deleted profiles" />
        <KpiTile label="Active"         value={kpis.active}   icon={UserCheck}  footer="Currently allowed to sign in" />
        <KpiTile label="Inactive"       value={kpis.inactive} icon={UserX}      footer="Disabled accounts" />
        <KpiTile label="Defined roles"  value={definedRoles}  icon={ShieldHalf} footer="System + custom roles" />
      </div>

      <UsersTable
        rows={rows}
        loading={users.isLoading}
        error={users.error}
        roleNames={roleNames}
      />
    </div>
  );
}
