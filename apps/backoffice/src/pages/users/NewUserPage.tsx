// apps/backoffice/src/pages/users/NewUserPage.tsx
// Session 13 / Phase 5.D — Wraps UserFormDialog as a dedicated page.

import { useNavigate } from 'react-router-dom';
import { UserFormDialog } from '@/features/users/components/UserFormDialog.js';
import { useRolesList } from '@/features/users/hooks/useRolesList.js';

export default function NewUserPage() {
  const navigate = useNavigate();
  const roles = useRolesList();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-serif text-text-primary">New user</h1>
      <p className="text-sm text-text-secondary">
        Pick a unique employee code, assign a role, and set the initial PIN.
      </p>
      <UserFormDialog
        roles={(roles.data ?? []).map((r) => ({ code: r.code, name: r.name }))}
        onClose={() => { navigate('/backoffice/users'); }}
        onCreated={(id) => { navigate(`/backoffice/users/${id}`); }}
      />
    </div>
  );
}
