// apps/backoffice/src/pages/settings/roles/RoleDetailPage.tsx
//
// ADR-031 — la fiche d'un rôle : ce qu'il peut faire, combien de temps sa
// session tient, et qui, parmi les gens qui le portent, sort du cadre.
//
// Le délai d'inactivité vit ici et plus dans la page Security : c'est un
// attribut du rôle. Security garde la politique de verrouillage du PIN, qui
// est, elle, globale.

import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Info } from 'lucide-react';
import { Badge } from '@breakery/ui';
import { PageHeader } from '@/components/PageHeader.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { DeleteRoleAction } from '@/features/settings/roles/components/DeleteRoleAction.js';
import { RolePermissionsPanel } from '@/features/settings/roles/components/RolePermissionsPanel.js';
import { RoleTimeoutCard } from '@/features/settings/roles/components/RoleTimeoutCard.js';
import { UserOverridesPanel } from '@/features/settings/roles/components/UserOverridesPanel.js';
import { useRbacMatrix } from '@/features/settings/roles/hooks/useRbacMatrix.js';

export default function RoleDetailPage() {
  const { roleCode } = useParams<{ roleCode: string }>();
  const matrix = useRbacMatrix();

  const role = (matrix.data?.roles ?? []).find((r) => r.code === roleCode);

  const backLink = (
    <Link
      to="/backoffice/settings/roles"
      className={`inline-flex items-center text-xs text-text-secondary hover:text-gold ${FOCUS_RING}`}
    >
      <ChevronLeft className="mr-0.5 h-3.5 w-3.5" aria-hidden />
      Back to roles
    </Link>
  );

  if (matrix.isLoading) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="text-sm text-text-secondary">Loading role…</div>
      </div>
    );
  }

  if (matrix.error !== null) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="text-sm text-danger-as-text" data-testid="role-detail-error">
          Failed to load the role: {matrix.error.message}
        </div>
      </div>
    );
  }

  // Un code inconnu n'est pas une erreur serveur : c'est une adresse tapée à la
  // main ou un rôle supprimé. On le dit, et on laisse une sortie.
  if (role === undefined) {
    return (
      <div className="space-y-4">
        {backLink}
        <PageHeader title="Role not found" subtitle="No role carries this code." />
        <p className="rounded border border-border-subtle px-3 py-6 text-sm text-text-secondary"
           data-testid="role-detail-unknown">
          <span className="font-mono">{roleCode ?? '—'}</span> does not match any
          role. Pick one from the list.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {backLink}

      <PageHeader
        title={role.name}
        subtitle={role.description ?? `Role ${role.code}.`}
        actions={role.is_system ? <Badge variant="neutral">System role</Badge> : undefined}
      />

      <div
        className="flex items-start gap-2 rounded border border-border-subtle bg-surface-inert px-3 py-2 text-sm text-text-secondary"
        data-testid="rbac-banner"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
        <span>Changes take effect at each user&apos;s next sign-in.</span>
      </div>

      <RolePermissionsPanel roleCode={role.code} roleName={role.name} />
      <RoleTimeoutCard role={role} />
      <UserOverridesPanel roleCode={role.code} />

      {/* ADR-032 — dernier de la page : la suppression se lit après tout le
          reste, et jamais sur le chemin d'un autre geste. */}
      <DeleteRoleAction role={role} />
    </div>
  );
}
