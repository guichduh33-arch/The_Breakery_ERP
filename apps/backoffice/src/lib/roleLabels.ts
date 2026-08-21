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

const ROLE_LABEL = {
  SUPER_ADMIN: 'Super admin',
  ADMIN:       'Admin',
  MANAGER:     'Manager',
  CASHIER:     'Cashier',
  waiter:      'Waiter',
} as const satisfies Record<string, string>;

/**
 * Les codes de rôle que le produit connaît. Il n'existe PAS d'union `RoleCode`
 * côté `@breakery/supabase` : les rôles vivent dans une TABLE (`roles`), pas
 * dans un enum Postgres, et `authStore` ne porte qu'un `role_code: string`.
 * Cette union est donc dérivée de la table de libellés ci-dessus — une seule
 * liste dans l'app, plutôt qu'une seconde recopiée ailleurs. Un code absent
 * d'ici reste accepté par `roleLabel()`, qui retombe sur un titlecase.
 */
export type RoleCode = keyof typeof ROLE_LABEL;

/** Titlecase de repli : `foo_bar` → `Foo bar`, `WAITER` → `Waiter`. */
function titleCase(code: string): string {
  const spaced = code.replace(/[_-]+/g, ' ').trim();
  if (spaced === '') return code;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Libellé humain d'un code de rôle, avec repli titlecase pour l'inconnu. */
export function roleLabel(code: string): string {
  return (ROLE_LABEL as Record<string, string>)[code] ?? titleCase(code);
}
