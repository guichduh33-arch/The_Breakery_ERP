// apps/backoffice/src/pages/users/PermissionsMatrixPage.tsx
// Session 13 / Phase 5.D — Permission matrix viewer.

import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { PermissionMatrix } from '@/features/users/components/PermissionMatrix.js';
import { PageHeader } from '@/components/PageHeader.js';

export default function PermissionsMatrixPage() {
  return (
    <div className="space-y-4">
      <Link to="/backoffice/users" className="text-xs text-text-secondary inline-flex items-center hover:text-gold">
        <ChevronLeft className="h-3.5 w-3.5 mr-0.5" aria-hidden />
        Back to users
      </Link>
      <PageHeader
        title="Permission matrix"
        subtitle={
          <>
            Read-only view of role × permission grants. Driven by the
            <code className="font-mono mx-1">role_permissions</code> table seeded in Phase 1.B.
            To grant or revoke, run a migration that INSERTs / UPDATEs the row directly — the
            <code className="font-mono mx-1">has_permission()</code> function is locked.
          </>
        }
      />
      <PermissionMatrix />
    </div>
  );
}
