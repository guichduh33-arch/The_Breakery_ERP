// apps/backoffice/src/pages/users/UsersListPage.tsx
// Session 13 / Phase 5.D — Users list page.

import { Link } from 'react-router-dom';
import { Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useUsersList } from '@/features/users/hooks/useUsersList.js';
import { UsersTable } from '@/features/users/components/UsersTable.js';

export default function UsersListPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission('users.create');
  const canViewMatrix = hasPermission('rbac.read');

  const users = useUsersList();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif text-text-primary">Users</h1>
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
                New user
              </Button>
            </Link>
          )}
        </div>
      </div>

      <UsersTable
        rows={users.data ?? []}
        loading={users.isLoading}
        error={users.error}
      />
    </div>
  );
}
