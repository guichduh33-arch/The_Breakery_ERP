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
//
// ADR-032 — les rôles se créent désormais depuis l'écran, et cette table ne
// les connaîtra JAMAIS : elle est écrite à la main, eux naissent en base. Le
// repli titlecase les sauve du code cru mais invente leur graphie
// (`CASHIER_SENIOR` → « Cashier senior », là où la base porte « Cashier
// Senior »). D'où le second argument : l'appelant qui A le `roles.name` sous
// la main le passe, et il gagne. Personne n'est obligé de l'avoir.

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

/**
 * Libellé humain d'un code de rôle.
 *
 * Ordre de préférence : la table de libellés ci-dessus > le `roles.name` de la
 * base quand l'appelant l'a > un titlecase du code.
 *
 * La table passe AVANT le nom de la base et non l'inverse : elle ne couvre que
 * les cinq rôles système, dont la graphie est un choix de produit (« Super
 * admin », pas « Super Admin »), et cet ordre garantit que l'ajout du second
 * argument ne déplace pas un seul libellé existant. Le nom de la base ne sert
 * donc qu'à ce pour quoi il est là : les rôles que la table ignore.
 *
 * @param code Code de rôle porté par le profil.
 * @param name `roles.name` si l'appelant l'a chargé — sinon rien.
 */
export function roleLabel(code: string, name?: string | null): string {
  const known = (ROLE_LABEL as Record<string, string>)[code];
  if (known !== undefined) return known;
  if (typeof name === 'string' && name.trim() !== '') return name.trim();
  return titleCase(code);
}
