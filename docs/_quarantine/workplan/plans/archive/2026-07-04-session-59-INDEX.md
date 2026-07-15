# Session 59 — INDEX — Remise à plat Vague 1, lot 1 : réparer les 2 findings S58 + quick wins de câblage « UI pures »

> **Date :** 2026-07-04 · **Branche :** `swarm/session-59` (base master `6778aef`, post-#145 / S58)
> **Plan source :** `docs/workplan/plans/2026-07-04-session-59-vague1-lot1-plan.md` (9 tâches). Périmètre = `docs/workplan/remise-a-plat/00-INDEX.md` §3 « Vague 1 — UI pures » + les 2 findings S58 (F-1 P0, F-4 P1).
> **Exclus (lot 2, S60) :** les 6 items « sous règle money-path » (paiement ardoise, `reason_code`/écart shift, lignes promo ticket, bump masse KDS, `x-idempotency-key` void BO).
> **Exécution :** subagent-driven development, 1 implémenteur + revue par tâche ; revue finale de branche (fable) : **READY TO MERGE**.

## Livré

### T1 — F-1 (P0) : garde dernier-admin ignore les admins inactifs — `d945a43`, `3f7c51d`
`delete_user_v1` **et** `update_user_role_v1` (downgrade) : le sous-compte des admins restants filtre désormais `is_active = true AND deleted_at IS NULL` (migration `_101`, in-place depuis les corps live). Le seed `SYS-CRON` (SUPER_ADMIN inactif) ne sauve plus la garde → le dernier admin réel ne peut plus être supprimé/rétrogradé. Périmètre élargi vs fiche 20 (qui ne citait que `delete_user_v1`) : le même bug existait sur le downgrade de rôle, corrigé dans la même migration. Suite `users.test.sql` **29/29** (`num_failed=0`), + assertion `T_USR_11` (downgrade last-admin) ajoutée en suivi de revue. Regen types : diff nul.

### T2 — F-4 (P1) : `_emit_expense_je` conforme ADR-003 / NON-PKP — `673e6a7`
Le helper d'écriture comptable des dépenses **fold `vat_amount` dans le débit du compte de charge** et **supprime la ligne DR `EXPENSE_VAT_INPUT` / compte 1151** (désactivé NON-PKP). Miroir du pattern achats `20260603000012`. Migration `_102` (in-place depuis le corps live). Une dépense avec PPN saisie s'approuve sans crash, JE équilibrée. Suite `expenses.test.sql` **19/19** (`num_failed=0`) : le tripwire `T_EXP_08` était structurellement cassé (attendait la ligne 1151) → réécrit conforme ADR-003, `T_EXP_11` ajoute la couverture réelle (déviation adjugée légitime par le reviewer).

### T3 — POS : `visible_on_pos` respecté + ticker écran client « ready » réel — `11c4140`, `3158f37`
`visible_on_pos` filtré dans `useProducts` **et** `useProductVariants` (un produit masqué en BO disparaît de la grille caisse + du sélecteur de variantes). Écran client : nouvelle source « Prêt à retirer » (`useReadyOrders` / `OrderQueueTicker`) branchée sur `order_items.kitchen_status = 'ready'`, plafonnée `READY_ORDERS_LIMIT = 5`, tri par urgence — un bump KDS fait apparaître la commande côté client sans paiement préalable. 20 fichiers / 70 tests verts.

### T4 — KDS : undo-bump / recall / prep-timer câblés + alarme sonore — `94e7ecd`, `221c7e2`
Les 3 composants présents-mais-débranchés sont montés via les RPCs live `kds_bump_item_v1` / `kds_undo_bump_v1` / `kds_recall_order_v1` / `kds_start_prep_timer_v1` (undo 60 s, recall avec raison, prep-timer sur les items démarrés). Alarme **WebAudio** (sans asset) à l'arrivée d'une nouvelle commande, dédupliquée, toggle mute persisté dans `kdsStore`. `RecentlyServedStrip` (15 min) ajoutée pour ancrer le Recall (adjugée nécessaire). `useBumpItem` orphelin supprimé. **NE contient PAS** le bump en masse « Tout prêt » (lot 2). 15 fichiers / 55 tests verts.

### T5 — Tablette : note par commande — `fe5ae4d`, `ded6050`, `98656aa`
`create_tablet_order_v3(+ p_notes text)` (**DROP v2** même migration, migrations `_103`/`_104`, trio S20 REVOKE, idempotence `p_client_uuid` préservée bit-à-bit vs `_042`). Textarea dans `TabletCartPanel` → `orders.notes` → affichée sur `KdsOrderCard` (cuisine) et au pickup caisse (`TabletInboxRow`). Types regénérés. pgTAP `idempotency_hardening` **10/10** (dont `hasnt_function` sur v2). Call-sites Vitest live-RPC + e2e spec `s43` repointés v3 (grep final : zéro hit exécutable sur v2). Résout le checkpoint typecheck `order_notes` de T4.

### T6 — BO : drill-down JE→origine + Dupliquer dépense + filtres/avant-après audit — `5420910`, `64dac14`, `d19e9ae`
- **6a** `resolveJeSourceEntity` (26 `reference_type` couverts, fallback null) : `reference_type`/`reference_id` deviennent des liens vers l'opération d'origine dans le drawer JE et le grand livre.
- **6b** Bouton « Dupliquer » sur `ExpenseDetailPage` → `NewExpensePage` pré-remplie (montant/catégorie/fournisseur/mode, date du jour, sans receipt, pas d'auto-submit, gate `expenses.create`).
- **6c** Filtres actor/action/entity branchés sur `useAuditLogs` + rendu déplié du `metadata`. Debounce 300 ms (round 1) puis fix stale-closure via updater fonctionnel (round 2). 7/7 audit + build verts.
- Implémenteur initial mort en vol → working tree repris par salvage. Revue Approved après 3 rounds.

### T7 — Nettoyage : doublon suggestions purgé + purge hex — `54a259a`, `b898bc0`
UI orpheline `ProductionSuggestions.tsx` + `useProductionSuggestions.ts` supprimée. **RPC `get_production_suggestions_v1` GARDÉ** : 2ᵉ consommateur actif découvert (`ProductionAlertsTab`) — pas de DROP. Purge des hex codés en dur sur **9 fichiers** → tokens existants ; `CHART_AXIS_STROKE` conservé comme token (8 sites, décision lead). 23 fichiers / 91 tests + suppliers 8/8 verts.

### T8 — EF : `auth-change-pin` PINs en headers — `ccd05f2`
Hard cutover S25 : `current_pin`/`new_pin` lus depuis `x-current-pin`/`x-new-pin` (plus aucun PIN en body JSON), CORS étendu, **EF redéployée v8 ACTIVE** (vérifiée live, sans drift). Le vrai call-site (`useChangePin.ts`) corrigé ; `pinAuth.ts::changePin` s'est révélé **code mort** (dette de suppression séparée). Tests 2/2 + 7/7.

### T9 — LAN : heartbeats appareils câblés — `50c608d`
`useLanHeartbeat` monté sur `Pos` / `Kds` / `TabletLayout` (tick 10 s, no-op sans `deviceCode`, cleanup + StrictMode OK) → la page BO « LAN Devices » affiche du vrai online/stale. Mesh LAN mort **non monté** (décision 2 gelée). Ajouts hors-brief adjugés nécessaires : `posSettingsStore.deviceCode` + champ Settings→Devices, seed DML dev `KDS-CUISINE-1`/`TABLETTE-1` (codes d'exemple à adapter). POS full 592 tests verts.

## Migrations appliquées

| Fichier (NAME-block) | Cloud version (clock-stamped) | Objet |
|---|---|---|
| `20260710000101_fix_last_admin_guard_ignore_inactive` | `20260704094646` | F-1 : `delete_user_v1` + `update_user_role_v1` garde `is_active` (in-place) |
| `20260710000102_emit_expense_je_fold_vat_non_pkp` | `20260704095522` | F-4 : `_emit_expense_je` fold VAT dans la charge, retire 1151 (in-place) |
| `20260710000103_create_tablet_order_v3_notes` | `20260704102951` | Note par commande : `create_tablet_order_v3(+p_notes)` + DROP v2 |
| `20260710000104_revoke_anon_create_tablet_order_v3` | `20260704102959` | Trio S20 REVOKE PUBLIC+anon sur v3 |

Repo == cloud vérifié 1:1 en live. **EF `auth-change-pin` v8 ACTIVE** (redéployée T8, vérifiée live, sans drift). Types regénérés (`packages/supabase/src/types.generated.ts`).

## RPCs ajoutés / bumpés

| Action | RPC | Notes |
|---|---|---|
| Fix in-place | `delete_user_v1`, `update_user_role_v1` | Garde dernier-admin `is_active` (F-1) |
| Fix in-place | `_emit_expense_je` | Fold VAT NON-PKP, retire ligne 1151 (F-4) |
| Bump v3 (+DROP v2) | `create_tablet_order_v3` | `+ p_notes text`, trio S20 REVOKE |

## Dettes documentées (triées par la revue finale)

| # | Sév. | Dette | Origine |
|---|---|---|---|
| M-1 | Medium | `_104` : `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` manquant (le REVOKE ponctuel suffit ici, mais l'idiome complet S20 n'est pas posé) | T5 |
| M-2 | Medium | Flicker cross-champ transitoire sur `AuditLogFilters` avant le fix stale-closure — fixé (`d19e9ae`), à surveiller | T6 |
| M-3 | Minor | `get_audit_logs_v1/v2` ne **SELECT pas `payload`** → l'UI 6c affiche `metadata` mais pas le vrai diff before/after ; exposer `payload` dans `get_audit_logs_vN+1` | T6 |
| O-1 | Info | `pinAuth.ts::changePin` reste code mort après cutover T8 — suppression = ticket dette séparé | T8 |
| — | Suivi | `useLanHeartbeat` avale les erreurs RPC en silence (mauvais `deviceCode` = échec muet en boucle) **et** aucun flux d'enregistrement d'appareil (`LanDevicesPage` read-only) | T9 |
| — | Suivi | Cache offline tablette 24 h peut servir des produits `visible_on_pos:false` (dette préexistante, hors périmètre T3) | T3 |
| — | Suivi | `is_locked` absent de `useKdsServedOrders` ; `AudioContext` neuf recréé par bip (micro-inefficacité) | T4 |
| — | Suivi | Note tablette sans borne de longueur (cohérent projet) ; chemin d'envoi tablette dupliqué (préexistant) | T5 |
| — | Suivi | 6 littéraux hex sans token équivalent restent commentés dans 2 fichiers | T7 |
| — | Cosmétique | Tests resync T3 cosmétiques ; test `useProducts.visible-on-pos` redondant | T3 |

## Actions utilisateur
- **T9 — obligatoire pour des heartbeats réels** : sur **chaque terminal**, renseigner `deviceCode` dans Settings → Devices (sinon le heartbeat est un no-op silencieux). Adapter les codes d'exemple seedés en dev (`KDS-CUISINE-1`, `TABLETTE-1`) aux appareils réels du magasin.
- **Preuve nightly attendue post-merge** : suites tripwire **`users` 29/29** et **`expenses` 19/19** re-vertes (F-1/F-4 soldés) ; **`idempotency_hardening`** verte sur `create_tablet_order_v3`.

## État attendu du prochain nightly post-merge
Tripwires `users`/`expenses` redevenus verts (fin des 2 rouges assumés du S58). live-RPC : baseline env-gated inchangée (staleness Vitest documentée, pas réseau). Drift : vert (à re-confirmer avec le fix `--schema public` du S58).

## Leçons durables
- **Sémantique de `journal_entries.reference_id` variable selon `reference_type`** : pour `sale_refund`/`refund`, `reference_id` pointe une ligne `refunds.id`, PAS un `orders.id` — un drill-down naïf « refund → commande » ouvre la mauvaise entité (finding I-1, fixé `3b3a254` en retirant `sale_refund`/`refund` du mapping order + fallback texte). **À documenter dans la fiche 10** (table de correspondance `reference_type` → entité + colonne cible).
- **Adjuger les déviations en revue par-tâche** rend la revue finale de branche rapide (tous les minors du ledger étaient déjà triés → 0 Critical, 1 Important fixé, dette consignée).
- **Agents parallèles sur un checkout partagé** : staging nominatif + couverture des flakes + récupération d'un implémenteur mort en vol par salvage (T6) — le working tree repris a permis de finir sans repartir de zéro.

## Tests / validation
- pgTAP : `users` 29/29, `expenses` 19/19, `idempotency_hardening` 10/10 — preuve MCP `num_failed()=0`.
- Vitest / smoke : par tâche (T3 70, T4 55, T7 91+8, T6 7/7 audit…) ; **suite complète monorepo verte à la pointe** (typecheck 6/6, build 2/2, `pnpm test` exit 0).
- Revues : 9 revues de tâche toutes Approved ; revue finale de branche (fable) **Ready to merge** — 0 Critical, I-1 fixé `3b3a254`, M-1/M-2/M-3 + O-1 consignés dette, patterns CLAUDE.md 10/10, migrations `_101..104` repo==cloud 1:1, EF v8 ACTIVE.
