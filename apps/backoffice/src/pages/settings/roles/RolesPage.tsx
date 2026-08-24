// apps/backoffice/src/pages/settings/roles/RolesPage.tsx
//
// ADR-031 — l'unique porte d'entrée du RBAC. Elle remplace les deux vues
// lecture-seule qui coexistaient (Settings → Permissions et Users →
// Permissions) : une même matrice affichée à deux endroits, éditable à aucun.
//
// Deux façons de regarder la même chose : la liste des rôles pour partir d'un
// métier, la matrice complète pour partir d'une permission. L'accès à la route
// est gardé par RÔLE (SUPER_ADMIN), pas par permission : SUPER_ADMIN et ADMIN
// portent exactement les mêmes permissions, un garde par code ne les
// distinguerait pas.

import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from '@breakery/ui';
import { PageHeader } from '@/components/PageHeader.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { RoleMatrixGrid } from '@/features/settings/roles/components/RoleMatrixGrid.js';
import { useRbacMatrix, grantedCount } from '@/features/settings/roles/hooks/useRbacMatrix.js';

export default function RolesPage() {
  const matrix = useRbacMatrix();
  const roles = matrix.data?.roles ?? [];
  const total = matrix.data?.permissions.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles & permissions"
        subtitle="What each role can do, and the exceptions granted to individual people."
      />

      {/* Les permissions sont figées au login : le client les reçoit à
          l'ouverture de session et ne les relit pas. Le dire ici évite le
          faux bug « j'ai coché, il ne se passe rien ». */}
      <div
        className="flex items-start gap-2 rounded border border-border-subtle bg-surface-inert px-3 py-2 text-sm text-text-secondary"
        data-testid="rbac-banner"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
        <span>Changes take effect at each user&apos;s next sign-in.</span>
      </div>

      <Tabs defaultValue="roles" className="space-y-4">
        <TabsList>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="matrix">Full matrix</TabsTrigger>
        </TabsList>

        <TabsContent value="roles" className="space-y-3">
          {matrix.isLoading && <div className="text-sm text-text-secondary">Loading roles…</div>}
          {matrix.error !== null && (
            <div className="text-sm text-danger-as-text" data-testid="roles-error">
              Failed to load roles: {matrix.error.message}
            </div>
          )}

          {!matrix.isLoading && matrix.error === null && (
            <div className="overflow-x-auto rounded-lg border border-border-subtle">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  One row per role: name, code, description, idle timeout, and
                  how many permissions it grants.
                </caption>
                <thead className="bg-surface-inert text-left text-text-secondary">
                  <tr>
                    <th scope="col" className="px-4 py-2">Role</th>
                    <th scope="col" className="px-4 py-2">Code</th>
                    <th scope="col" className="px-4 py-2">Description</th>
                    <th scope="col" className="px-4 py-2">Timeout</th>
                    <th scope="col" className="px-4 py-2">Permissions</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.code} className="border-t border-border-subtle">
                      <th scope="row" className="px-4 py-2 text-left font-normal">
                        <Link
                          to={`/backoffice/settings/roles/${r.code}`}
                          className={`text-gold underline-offset-4 hover:underline ${FOCUS_RING}`}
                          data-testid={`role-link-${r.code}`}
                        >
                          {r.name}
                        </Link>
                        {r.is_system && (
                          <Badge variant="neutral" className="ml-2 inline-block align-middle">System</Badge>
                        )}
                      </th>
                      <td className="px-4 py-2 font-mono text-xs">{r.code}</td>
                      <td className="px-4 py-2 text-xs text-text-secondary">{r.description ?? '—'}</td>
                      <td className="px-4 py-2 font-data text-xs">{r.session_timeout_minutes} min</td>
                      <td className="px-4 py-2 font-data text-xs" data-testid={`role-granted-${r.code}`}>
                        {grantedCount(matrix.data, r.code)} / {total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="matrix">
          <RoleMatrixGrid />
        </TabsContent>
      </Tabs>
    </div>
  );
}
