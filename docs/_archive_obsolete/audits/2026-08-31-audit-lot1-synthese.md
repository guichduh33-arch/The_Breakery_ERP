# Audit lot 1 par les skills fraîches — synthèse — 2026-08-31

> **Statut** : relevé d'audit. Les six rapports détaillés n'ont modifié aucun fichier ;
> les correctifs qui ont suivi vivent dans un commit séparé de la même PR.
> **Base interrogée** : Supabase cloud V3 dev `ikcyvlovptebroadgtvd`.
> **Branche** : `fix/audit-lot1-p0-securite`, partie de `master` à `640f7526`, arbre propre.
> **Méthode** : six sous-agents lecture seule, un par skill, chacun exécutant le protocole
> d'audit de SA skill. Chaque P0 a ensuite été **re-vérifié par l'orchestrateur** sur le
> corps live (`pg_get_functiondef`, `pg_policies`, `pg_class`, `has_*_privilege`) avant
> d'être retenu ici.

---

## Pourquoi cet audit

La PR #480 (`ff79cd90`, 2026-08-31) a rafraîchi **15 des 22 skills** du projet, qui étaient
périmées. Ces skills décrivent chacune un périmètre de code et portent, pour la plupart, une
checklist d'audit. Elles n'avaient jamais été **exécutées** depuis leur correction : on ne
savait donc pas si le code respectait ce qu'elles affirment — ni si elles disaient vrai.

Le lot 1 couvre les cinq skills argent/sécurité, plus `breakery-ui-kit` en conformité.

Sur les 15 skills rafraîchies, **11 portent un protocole d'audit**. Quatre n'en ont pas :
`pos-design-craft` et `pos-frontend-design-implement` le refusent explicitement,
`reports-exports` défère à `report-audit`, et `breakery-ui-kit` n'en a pas — ses
anti-patterns sont en revanche vérifiables par relevé.

## Les six rapports

| Skill | Rapport | P0 | P1 |
|---|---|---:|---:|
| `security-fraud-guard` | [détail](2026-08-31-audit-security-fraud-guard.md) | 2 | 4 |
| `expense-governance` | [détail](2026-08-31-audit-expense-governance.md) | 3 | 2 |
| `pos-flow-audit` | [détail](2026-08-31-audit-pos-flow.md) | 2 | 1 |
| `b2b-credit` | [détail](2026-08-31-audit-b2b-credit.md) | 1 | 4 |
| `stock-management` | [détail](2026-08-31-audit-stock-management.md) | 0 | 5 |
| `breakery-ui-kit` | [détail](2026-08-31-audit-breakery-ui-kit.md) | 0 | 2 |

## Les huit P0

Chacun a été reproduit par l'orchestrateur avant d'entrer dans ce tableau.

| # | Domaine | Défaut | État |
|---|---|---|---|
| 1 | Sécurité | `verify_user_pin` reste `GRANT EXECUTE TO authenticated` : un oracle bcrypt sans verrouillage, sans rate-limit et sans audit, sur un secret de 6 chiffres, avec l'uuid de la cible lisible dans `orders`. Le grant est **résiduel** — aucun appelant SQL live. | **fermé** |
| 2 | Sécurité | `view_b2b_invoices` a perdu `security_invoker` : la vue s'exécute hors RLS et tout compte `authenticated` lit le carnet B2B. Régression d'un `CREATE OR REPLACE VIEW` du 2026-08-08, masquée par un `COMMENT` qui affirmait l'inverse. | **fermé** |
| 3 | Dépenses | La policy `expenses_update_owner_or_manager` laissait un MANAGER approuver une dépense par UPDATE direct — sans SOD, sans PIN, sans écriture comptable — et réécrire le snapshot figé. | **fermé** |
| 4 | Argent B2B | `record_b2b_payment` **jette le reliquat non alloué** sans exception ni trace : le solde et l'écriture comptable prennent le montant plein, l'allocation prend moins, la différence disparaît. Aucune contrainte n'impose `Σ allocations = amount`, et la modale promet à l'écran une réallocation FIFO. | ouvert |
| 5 | Argent POS | `pay_existing_order` somme `line_total` **sans filtrer `is_cancelled`**, alors que `cancel_order_item_rpc` ne remet jamais `line_total` à zéro. Selon l'ordre des gestes : surfacturation silencieuse, ou encaissement bloqué devant le client. Même angle mort dans `reopen_held_order`. | ouvert |
| 6 | Stock POS | `create_tablet_order` n'**écrit** ni `combo_components` ni `modifier_ingredients_deducted` (elle les *lit*), là où son jumeau `fire_counter_order` écrit les deux. Un combo commandé en salle ne déduit **aucun** stock. | ouvert |
| 7 | Dépenses | Les huit RPC dépenses posent `auth.uid()` en `actor_id`, dont la FK cible `user_profiles(id)`. Le module est **mort (23503)** pour tout compte créé par le back-office. | ouvert |
| 8 | Dépenses | Même racine sur `journal_entries.created_by` : corriger le n°7 seul laisserait le money-path mort. | ouvert |

Les trois premiers ont été corrigés le jour même parce qu'ils **ne demandaient aucun bump de
RPC**. Les cinq autres en exigent (`record_b2b_payment`, `pay_existing_order`,
`create_tablet_order`, et le lot `actor_id` des huit RPC dépenses) : ils relèvent d'un plan
distinct.

## Ce qui est sain, et prouvé

Un audit qui ne dit que ce qui va mal ne se relit pas. Ont été vérifiés et tiennent :

- **Ledger de stock append-only** côté RLS ; `authenticated` n'a que `SELECT` sur les quatre
  tables du ledger ; la primitive et ses cinq helpers internes lui sont fermés.
- **Dérive WAC nulle** : aucun produit hors tolérance de 0,01 IDR.
- **Règle de descente ADR-016 respectée des deux côtés** (vente et production) — c'est le
  point que l'auditeur stock s'attendait le plus à trouver cassé.
- **Intégrité AR B2B parfaite** : zéro dérive, zéro solde négatif, zéro sur-allocation,
  exactement **quatre** écrivains de `b2b_current_balance`, aucune facture `voided` dans la vue.
- **`search_path` épinglé** sur toutes les `SECURITY DEFINER` ; les douze ledgers testés
  refusent INSERT/UPDATE/DELETE à `authenticated`.
- **Les dix gardes CI rendent vert**, et la garde `tailwind-dead-classes` tient réellement son
  invariant : les 146 modificateurs alpha du dépôt portent tous sur la famille `cat-*`.
- **Le pattern « la RPC est la frontière, pas l'EF » n'a pas régressé** cette fois : les
  familles refund / void / cancel-item sont toutes fermées à `authenticated`.

## Ce que les skills fraîches ont eu faux

C'est le second livrable de cette campagne, et il appelle un chantier documentaire à part.

- **`security-fraud-guard` déclare closes les failles n°1 et n°2 ci-dessus.** Son tableau
  « ne pas rouvrir » couvre exactement la régression de la vue B2B. C'est son propre pattern 9
  — « ne jamais croire le commentaire de migration, vérifier `pg_class.reloptions` » — qui a
  trouvé la faille, pas le tableau.
- **Son contrôle `actor_id` rend un faux négatif sur cette base** : la requête retourne vide
  parce que six profils dev sur huit ont `id = auth_user_id`, pas parce que le code est
  correct. Le contrôle doit porter sur le **code**, pas sur la donnée.
- **Son pattern 4 est périmé** : il traite le PIN-en-argument de `create_manual_je` comme le
  seul item non soldé, alors que l'arbitrage du 2026-08-31 gravé dans `CLAUDE.md` pose que
  vers une RPC l'argument **est** le bon véhicule. Les huit RPC PIN-in-arg live câblent
  toutes `_verify_pin_with_lockout`.
- **`stock-management`** affirme que `_record_sale_stock` est le seul écrivain du ledger hors
  primitive : **ils sont sept**. Elle présente aussi l'append-only comme acquis — vrai côté
  RLS, faux côté `SECURITY DEFINER`.
- **`b2b-credit`** ignore `get_ar_aging_v1` (livré le 2026-08-18) et ne teste les gates que
  sur les **écritures** : c'est par là que passait la lecture non gardée du carnet AR.
- **`expense-governance`** ne porte pas la règle `actor_id` : sa checklist se contente de
  « chaque mutation produit une ligne », ce que le code satisfait. C'est `CLAUDE.md` qui porte
  le fait décisif.
- **`breakery-ui-kit`** dit que `useIdleTimeout` déclenche `signOut()` — vrai pour le
  back-office, faux pour le POS, qui appelle `lock()`. Elle propose aussi un repli Radix pour
  `Popover` dont aucun `package.json` du dépôt ne déclare la dépendance.

## Deux pièges de méthode, à ne pas refaire

1. **Un `ILIKE` sur un corps de fonction dit que le mot est là, pas s'il est lu ou écrit.**
   `create_tablet_order` *lit* `combo_components` sans l'*écrire* : le relevé grossier rend un
   faux négatif. Il faut regarder les lignes de l'INSERT.
2. **Un test « l'attaque touche 0 ligne » ne vaut rien sans contrôle positif** prouvant qu'il
   existait des lignes à toucher. Le contrôle qui a réellement tranché la policy des dépenses
   est le passage de *1 ligne modifiée* à *rejet `42501`*.

Et un troisième, transverse : **un comptage borné au périmètre d'un agent est un minorant.**
Le `TRUNCATE` résiduel de `authenticated` a été relevé sur 13 tables par l'auditeur stock ;
recompté sur tout le schéma, il en touche **71**. C'est un chantier systémique, ouvert.

## Ce que le lot 1 ne couvre pas

Six skills n'ont pas été exécutées : `orders`, `products-catalog`, `security-auth`,
`report-audit`, `pos-frontend-design-audit`, `breakery-design`.

Ne sont pas non plus couverts : l'ampleur de ces défauts **en production** (base V2, lignée
incompatible, non interrogée), et tout ce qui exige deux surfaces physiques réelles — le
parcours multi-appareil du POS a été lu, jamais joué.
