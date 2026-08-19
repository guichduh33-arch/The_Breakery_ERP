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
      {/* Le sous-titre s'adressait au lecteur en SQL — « run a migration that
          INSERTs / UPDATEs the row directly » — et citait un jalon interne
          (« Phase 1.B »). Les quatre profils qui ouvrent cet écran, dont le
          comptable et le gérant, n'ont pas de quoi exécuter cette consigne. Le
          « yet » est délibéré : PRODUCT.md note que l'impossibilité d'éditer un
          rôle depuis l'application est une contrainte d'exploitation, jamais une
          décision prise comme telle. */}
      <PageHeader
        title="Permission matrix"
        subtitle="Read-only view of what each role can do. Granting or revoking a permission cannot be done from the back office yet — it requires a change to the database."
      />
      <PermissionMatrix />
    </div>
  );
}
