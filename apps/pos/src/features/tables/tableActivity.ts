// apps/pos/src/features/tables/tableActivity.ts
//
// Audit POS Waiter du 2026-08-22, lot B — quand une table redevient libre.
//
// Le prédicat vivait en double, recopié à l'identique dans `useTableOccupancy`
// et `useTableOrders`. Les deux excluaient `completed` et `voided` — mais le
// paiement pose `paid` (voir le corps de `pay_existing_order`, `status =
// 'paid'` depuis la v1). `paid` et `completed` sont deux valeurs DISTINCTES de
// l'énumération `order_status` : une table payée restait donc marquée occupée,
// indéfiniment, puisque rien ne repasse ensuite en `completed`.
//
// Mesuré sur la base V3 dev le 2026-08-22 : 3 tables sur 11 comptées occupées,
// zéro commande réellement ouverte.
//
// La base portait déjà la bonne définition — `idx_orders_active_table` est
// déclaré `WHERE table_number IS NOT NULL AND status <> ALL (ARRAY['paid',
// 'voided'])`. C'est le code qui divergeait du schéma, pas l'inverse.
//
// Une seule déclaration désormais : deux copies d'une règle métier finissent
// toujours par ne plus dire la même chose.
//
// `b2b_pending` reste volontairement OCCUPANT : une commande B2B non réglée
// n'est pas un couvert terminé, et l'arbitrage n'a pas été demandé au
// propriétaire. Le sujet est signalé dans le rapport d'audit, pas tranché ici.

/** Statuts qui LIBÈRENT la table. Tout le reste l'occupe. */
export const TABLE_RELEASING_STATUSES = ['completed', 'voided', 'paid'] as const;

/** Le même ensemble, au format de liste attendu par le filtre `in` de PostgREST. */
export const TABLE_RELEASING_STATUSES_FILTER = `(${TABLE_RELEASING_STATUSES.join(',')})`;
