// apps/backoffice/src/pages/users/NewUserPage.tsx
// Session 13 / Phase 5.D — Wraps UserFormDialog as a dedicated page.

import { useNavigate } from 'react-router-dom';
import { UserFormDialog } from '@/features/users/components/UserFormDialog.js';
import { useRolesList } from '@/features/users/hooks/useRolesList.js';
import { PageHeader } from '@/components/PageHeader.js';
import { useAuthStore } from '@/stores/authStore.js';

export default function NewUserPage() {
  const navigate = useNavigate();
  const roles = useRolesList();
  const isSuperAdmin = useAuthStore((s) => s.user?.role_code) === 'SUPER_ADMIN';

  return (
    <div className="space-y-4">
      <PageHeader
        title="New user"
        subtitle="Pick a unique employee code, assign a role, and set the initial PIN."
      />
      <UserFormDialog
        roles={(roles.data ?? []).filter((r) => isSuperAdmin || r.code !== 'SUPER_ADMIN').map((r) => ({ code: r.code, name: r.name }))}
        onClose={() => { void navigate('/backoffice/users'); }}
        onCreated={(id) => { void navigate(`/backoffice/users/${id}`); }}
      />
    </div>
  );
}
