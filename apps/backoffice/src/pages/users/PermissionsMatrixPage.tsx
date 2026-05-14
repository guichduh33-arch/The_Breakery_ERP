// apps/backoffice/src/pages/users/PermissionsMatrixPage.tsx
// Session 13 / Phase 5.D — Permission matrix viewer.

import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { PermissionMatrix } from '@/features/users/components/PermissionMatrix.js';

export default function PermissionsMatrixPage() {
  return (
    <div className="space-y-4">
      <Link to="/backoffice/users" className="text-xs text-text-secondary inline-flex items-center hover:text-gold">
        <ChevronLeft className="h-3.5 w-3.5 mr-0.5" aria-hidden />
        Back to users
      </Link>
      <h1 className="text-2xl font-serif text-text-primary">Permission matrix</h1>
      <p className="text-sm text-text-secondary">
        Read-only view of role × permission grants. Driven by the
        <code className="font-mono mx-1">role_permissions</code> table seeded in Phase 1.B.
        To grant or revoke, run a migration that INSERTs / UPDATEs the row directly — the
        <code className="font-mono mx-1">has_permission()</code> function is locked.
      </p>
      <PermissionMatrix />
    </div>
  );
}
