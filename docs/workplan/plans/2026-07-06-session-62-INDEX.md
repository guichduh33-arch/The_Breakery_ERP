# Session 62 — INDEX (2026-07-06)

> **Branche :** `swarm/session-62` (base `0176af66` = master post-#150, décisions actées) · **Plan :** [`../../superpowers/plans/2026-07-06-session-62-purges-actees-plafond-ardoise.md`](../../superpowers/plans/2026-07-06-session-62-purges-actees-plafond-ardoise.md)
> **Scope acté avec le propriétaire :** lot « purges actées 2026-07-06 » (décisions 1/2/3/5) + **plafond de crédit ardoise retail serveur** (décision 4).
> **Méthode :** subagent-driven-development — 1 implémenteur + 1 reviewer par tâche, revue finale de branche (fable). Ledger : `.superpowers/sdd/progress.md` §Session 62.

## Tâches livrées

| # | Tâche | Commit | Migration | Tests | Revue |
|---|---|---|---|---|---|
| T1 | **Purge mesh LAN mort** (décision 2 internet-first) : `lanHub`/`lanClient`/`lanHubMessageHandler`/`useLanHub`/`useLanClient` + 4 tests (POS), `domain/src/lan/` entier (protocol, MessageDedup, barrel) + 2 tests ; branche morte `send`/broadcast retirée de `useLanHeartbeat` (les heartbeats S59 restent, RPC seul). 16 fichiers, −1510 lignes, 0 dep npm à retirer (mesh = BroadcastChannel+Realtime) | `e3082722` | — | domain 724/724, POS 599 ✔ (1 skip pré-existant), typecheck 6/6 | Approved, 2 Minors (D-1/D-2) |
| T2 | **Purge `print_queue`** (décision 2, statuée : **DROP complet**) : migration `_110` (garde table-vide `DO $$` → DROP 5 RPCs `*_print_job_v1` + DROP TABLE + DELETE permissions `print_queue.read/manage`, cascade FK) ; purge BO (feature+page print-queue, route, sidebar, 2 codes `PermissionCode`) ; suites dédiées supprimées + 2 assertions collatérales retirées (`security_authenticated_policies` A4 5→4, `lan_devices` T_LD_07 14→13). Justification : table VIDE live, unique écrivain = mesh mort (T1), le vrai print POST directement au bridge externe (`printService.ts`, non touché) | `a4bb9d14` | `20260710000110` | BO 717 ✔/1 skip, typecheck, post-drop vérifié live (to_regclass NULL, 0 RPC, 0 permission) | Approved, 0 C/I (extras = cascades légitimes) |
| T3 | **Purges légères** : champ `discount` retiré des 4 `TIERS` (décision 3 — `points_multiplier` et tout le reste intacts) ; `vite-plugin-pwa` évacué (décision 5, dep inerte + arbre workbox ~86 lignes de lockfile, 0 ajout) ; permission `rbac.update` supprimée (décision 1, migration `_111` un DELETE, cascade grants vérifiée live, `rbac.read` intact) + retrait de `PermissionCode` | `66e6f1a0` | `20260710000111` | domain 723/723, POS 599 ✔, build POS, typecheck | Approved, 0 findings |
| T4 | **Plafond ardoise serveur** (décision 4) : colonne `customers.retail_credit_limit NUMERIC(14,2)` (NULL = illimité, CHECK ≥ 0) + RPC **`attach_tab_customer_v1(p_order_id, p_customer_id)`** — attache un client à une commande comptoir `pending_payment` (« ardoise nommée »), pose le total provisoire (miroir verbatim v11 : `SUM(line_total)`, `subtotal` TTC, taxe extraite `round_idr`), gate d'encours live (miroir debts v3 restreint `created_via='pos'`, **sans lookback**, self-exclusion `o.id <> p_order_id`) sous locks anti-TOCTOU (order puis customer `FOR UPDATE`), erreur **P0011 `credit_limit_exceeded`** DETAIL jsonb (miroir B2B S52) ; gate `payments.process` ; audit_logs S56 ; trio REVOKE S20 ; **money-path v17/v11/fire_v4 non touchée** (gate à l'attache, v11 recalcule le vrai total au paiement) | `97e54fa2` | `20260710000112` | pgTAP **`retail_tab_credit_gate` 8/8 live** (1 itération fixture `session_id`) ; ancre `pay_existing_flag_aware` 3/3 | Approved (opus), 2 Minors (D-5/D-6) + 2 design assumés (D-7/D-8) |
| T5 | **POS — ardoise nommée** : bouton « Ardoise » (h-11) sur les lignes `pending_payment` de `HeldOrdersModal` → picker `CustomerAttachModal` (sans quick-create) → hook `useAttachTabCustomer` (invalide `['held-orders']` + `['pos-outstanding-debts']`) ; P0011 → message français avec encours/commande/plafond parsés du DETAIL ; case `credit_limit_exceeded` ajouté au `retryClassifier` domain ; cast `LooseSupabase` (types regen différés) | `d752bd33` | — | POS heldOrders 14 ✔, domain payment 58 ✔ (classifieur 27/27), typecheck | Approved, 1 Minor (D-9) |
| T6 | **BO — plafond éditable** : `RetailCreditLimitSection` monté dans la vraie chaîne `CustomerDetailPage → InfoTab` (retail uniquement, gate `customers.update`), input vide ↔ NULL (jamais 0), hook `useUpdateRetailCreditLimit` (update direct, narrow-cast documenté). Déviation confirmée : `B2BFieldsSection` du brief = code mort jamais monté | `b5d37f3b` | — | BO customers 17/17, typecheck, lint 0/0 | Approved, 2 Minors (D-10) |
| T7 | **Closeout** : types regénérés (`print_queue` disparu, `retail_credit_limit` ×3, `attach_tab_customer_v1`) ; restauration des éditions #150 écrasées par accident (voir Incident) ; ancres + suite monorepo ; docs | `459565e5` + closeout | — | voir Vérification | — |

## Vérification closeout

- Ancre money-path **`s44_money_gates` 12/12** re-passée live (v17/v11/fire_v4/`_record_sale_stock_v1` **non modifiés** par la branche).
- Ancre **`pay_existing_flag_aware` 3/3** live post-`_112`.
- **Types regénérés et commités** (drift attendu seul : −191/+7).
- Suite monorepo complète + revue finale de branche (fable) : voir PR.

## Incident de branche (résolu)

Le commit du plan (`d821bf41`) a embarqué par accident des versions **périmées** de `CLAUDE.md` et `00-INDEX.md`, écrasant les éditions « décisions actées » de la PR #150 (index git laissé sale par deux watchers de merge concurrents au moment de la création de branche). **Restauré au closeout** depuis `0176af66` avant les éditions S62. Leçon : après un merge automatisé, vérifier `git status`/index propre avant le premier commit d'une branche fraîche.

## Dettes documentées (aucune bloquante)

| # | Sév. | Dette | Origine |
|---|---|---|---|
| D-1 | Minor | Commentaire mort `useKdsRealtime.ts:19` référence `useLanClient.send` (API supprimée T1) | Revue T1 |
| D-2 | Minor | `deviceType` champ mort dans `UseLanHeartbeatOptions` + 3 call-sites (plus consommé depuis le retrait du broadcast) | Revue T1 |
| D-3 | Info | Rapport implémenteur T2 jamais écrit (reviewer a reconstitué la preuve, tout vert) — vigilance nommage des rapports inter-sessions | Revue T2 |
| D-4 | Cosmétique | `supabase/functions/_shared/permissions.ts:9` mentionne encore `print_queue` dans un commentaire d'exemple | Revue T2 |
| D-5 | Minor | Suite pgTAP : `t1_outstanding` inséré dans `_r` mais jamais consommé dans `_cap` (ligne de test morte — la propriété outstanding_before=0 n'est pas gatée) | Revue T4 |
| D-6 | Minor | `outstanding_before: 0` renvoyé pour un client à plafond NULL même s'il a une dette réelle (bloc encours court-circuité) — champ informatif, trompeur si affiché | Revue T4 |
| D-7 | Design assumé | Le plafond n'est gaté qu'à l'**attache** : `pay_existing_order_v11` (money-path, intouchée) ne re-vérifie pas au paiement ; OK tant que les items d'une ardoise sont figés au fire | Revue T4 |
| D-8 | Design assumé | Modèle live-recompute non rétroactif : baisser un plafond ne re-signale pas la dette existante (miroir du comportement B2B) | Revue T4 |
| D-9 | Minor | Case `credit_limit_exceeded` du `retryClassifier` sans call-site réel — le flux ardoise a son propre message FR local plus riche → 2 messages pour la même erreur, risque de drift | Revue T5 |
| D-10 | Minor | Pas de test bout-en-bout clic-Save sur `CustomerDetailPage` complet (couverture split composant/page) ; `B2BFieldsSection` découvert **code mort** (importé par son seul smoke test) — à purger dans un futur lot | Revue T6 |

## Actions utilisateur

- Aucune nouvelle. (Rappel S60 toujours ouvert : template du print-bridge externe à mettre à jour pour `promotions[]` ; le chantier Vague 3 « print-bridge versionné » reste à faire.)

## Impact docs

- `00-INDEX.md` : lot « Purges actées » ✅ SOLDÉ S62 ; « Plafond ardoise » ✅ SOLDÉ S62 ; §2.3 #7/#9/#19/#20 purgés ; `print_jobs`/`print_queue` **statuée : DROPPÉE** (décision 2 close) ; Vague 3 « print-bridge versionné » réduit au seul versionnage du bridge.
- Fiches 02/03/08/21 : notes de mise à jour S62 en tête.
- `CLAUDE.md` : Active Workplan bumpé (S62 merged, next S63).
