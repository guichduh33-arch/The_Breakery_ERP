---
name: pos-flow-audit
description: >-
  Diagnostiquer ou améliorer le parcours POS Breakery : panier, promotions, cuisine/KDS, tablette, paiement, hors-ligne, ticket et clôture. Un symptôme isolé reste ciblé. Aspect visuel : pos-frontend-design-audit ; contrats d’ordres : orders.
---

# POS Flow Audit — The Breakery (bakery-café, multi-device)

Pour un symptôme, suivre uniquement l’action et ses effets attendus. Pour un audit global demandé, parcourir les étapes du service et les échecs silencieux. Vérifier la persistance derrière chaque confirmation UI.

## Lecture proportionnée

Les règles d’AGENTS.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Pour conduire la conception, le diagnostic ou le conseil demandé ; lire seulement le cas correspondant. | [méthode ciblée](references/workflow.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par AGENTS.md. | [contrôles et sources](references/verification.md) |

## Technical-correctness checklist (secondary — gate every shippable proposal)

A feature proposal that touches a write path MUST respect these or it's not shippable. Cross-reference AGENTS.md "Critical patterns".

- [ ] **Order writes go through RPCs, never raw inserts.** Les familles `complete_order_with_payment` (via l'EF `process-payment` — le POS ne l'appelle jamais en direct), `pay_existing_order`, `fire_counter_order`, `create_tablet_order`, `pickup_tablet_order`, `hold_fired_order` / `reopen_held_order` / `discard_held_order` gèrent atomiquement les triggers JE, la fidélité, les promotions, l'état des tables et la déduction de stock (via l'unique helper de stock de vente (famille `_record_sale_stock`)). A new write path must reuse or extend these, not bypass them.
- [ ] **Idempotency, 2 flavors (S25).** Retry-safe HTTP via `x-idempotency-key` header (client `useRef(crypto.randomUUID())`), propagated to the RPC; OR business-semantic via a required RPC arg (`p_client_uuid`) keyed in a dedicated idempotency table (`tablet_order_idempotency_keys`). Any new "tap = money/order" action needs one. A double-tap that creates two orders is a P0 bug, not a polish item.
- [ ] **PIN / secrets — le véhicule dépend de la cible (arbitrage 2026-08-31).** Vers une **Edge Function**, le PIN voyage en **en-tête** (`x-manager-pin`) et jamais dans le body : les bodies d'EF sont loggés. Refund, void et les overrides de remise suivent cette voie. Vers une **RPC Postgres** appelée par PostgREST, le PIN est un **argument** (`p_manager_pin`) : c'est le seul véhicule que la fonction peut réellement valider côté serveur, et c'est ce que font `close_shift` et `approve_expense`. La question à poser en audit n'est donc pas « header ou argument ? » mais **« la cible vérifie-t-elle vraiment le PIN, et avec verrouillage ? »** — un PIN transporté proprement mais jamais vérifié est le vrai défaut. Précédent : le PIN d'approbation de dépense a été déplacé du header vers l'argument le 2026-06-01 précisément parce que la RPC ne lisait jamais l'en-tête. (`auth-verify-pin` prend le PIN dans le body d'une EF — candidate finding, celui-là reste valable.)
- [ ] **RPC versioning monotonic.** Never edit a published `_vN`. Create `_vN+1` + `DROP FUNCTION ... vN(<old args>)` in the same migration, then bump every caller (Grep the name across `apps/pos`). Regen types.
- [ ] **REVOKE pair S25 on every new RPC** (FROM PUBLIC + FROM anon + ALTER DEFAULT PRIVILEGES). `REVOKE FROM anon` alone is insufficient — anon inherits via PUBLIC.
- [ ] **Realtime channel uniqueness per mount.** New realtime feature → unique channel name per mount or StrictMode double-mount collides silently. Reproduce across two devices.
- [ ] **PIN-auth fetch wrapper.** POS uses a custom fetch wrapper injecting the PIN JWT (`setSupabaseAccessToken`). Never bypass with raw `Authorization` headers or `auth.setSession`.
- [ ] **Tax/price snapshot at order time.** La famille `complete_order_with_payment` fige le taux de taxe à la commande (NON-PKP : PB1 10 % en sortie). Don't recompute historical orders at current rate.
- [ ] **audit_logs row per mutation** (canonical cols `actor_id / action / entity_type / entity_id / metadata`). Silent writes = no traceability.

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
