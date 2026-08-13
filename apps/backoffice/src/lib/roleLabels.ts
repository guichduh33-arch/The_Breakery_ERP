// apps/backoffice/src/lib/roleLabels.ts
//
// Libellés humains des rôles (audit UX/UI 2026-08-13, lot 8).
//
// L'authStore ne porte que le CODE de rôle (`role_code`) ; les vrais libellés
// vivent dans `roles.name` en base mais ne transitent pas jusqu'au client. Ce
// mapping front donne une casse et une graphie lisibles là où le code brut
// (SUPER_ADMIN, waiter) fuitait dans l'UI — le menu utilisateur et la table
// des utilisateurs. Un code inconnu retombe sur un titlecase de sa propre
// valeur plutôt que sur un vide ou le code cru.

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN:       'Admin',
  MANAGER:     'Manager',
  CASHIER:     'Cashier',
  waiter:      'Waiter',
};

/** Titlecase de repli : `foo_bar` → `Foo bar`, `WAITER` → `Waiter`. */
function titleCase(code: string): string {
  const spaced = code.replace(/[_-]+/g, ' ').trim();
  if (spaced === '') return code;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Libellé humain d'un code de rôle, avec repli titlecase pour l'inconnu. */
export function roleLabel(code: string): string {
  return ROLE_LABEL[code] ?? titleCase(code);
}
