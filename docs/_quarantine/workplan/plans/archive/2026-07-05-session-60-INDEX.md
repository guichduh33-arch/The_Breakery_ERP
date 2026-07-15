# Session 60 — INDEX — Remise à plat Vague 1, lot 2 : les 6 quick wins « sous règle money-path »

> **Date :** 2026-07-05 · **Branche :** `swarm/session-60` (base master `e8bcd28`, post-#147 / S59)
> **Plan source :** `docs/workplan/plans/2026-07-05-session-60-vague1-lot2-plan.md` (7 tâches T1-T7). Périmètre = `docs/workplan/remise-a-plat/00-INDEX.md` §3 « Vague 1 — lot 2 » (verrou money-path levé depuis S58 ; décision de cadrage : lot 2 seul, F-2/F-5 et P3 restant non inclus).
> **Exécution :** subagent-driven development, 1 implémenteur + 1 revue par tâche (opus sur les 2 tâches DB) ; revue finale de branche : **READY TO MERGE** (0 Critical, 0 Important bloquant).

## Livré

### T1 — POS : payer l'ardoise directement depuis `/pos/debts` (02 D1.1) — `aa52c8c`
Nouveau hook `useLoadDebtOrder` (mirror exact du pattern pickup tablette : SELECT `order_items` avec `name_snapshot`, ids DB = ids de ligne, `restoreCart` → `markLocked` → `markPrinted` → `setPickedUpOrderId`, attach client best-effort `get_customer_v3`, confirm avant écrasement du panier, `navigate('/pos')`). Le CTA « Pay » de `CustomerDebtsPanel` (jusqu'ici un simple toast — le commentaire d'en-tête mentait) charge la créance dans le panier ; l'encaissement suivant route automatiquement vers `pay_existing_order_v11` (garde serveur `pending_payment`+`created_via='pos'` compatible, vérifiée en préparation). **Lignes B2B : pas de bouton Pay** — hint « B2B invoice — settle in Backoffice » (leur `b2b_pending` ne passe pas la garde v11 ; le règlement B2B vit dans les allocations S52). Aucun RPC modifié. Suite `load-debt-order` 3/3 + `pay-existing` 3/3.

### T2 — POS : `reason_code` + montage du `CashInOutModal` orphelin (12 D1.1) — `7912724`
Découverte d'exploration : le modal n'était **monté nulle part**. Select natif `reason_code` (misc défaut / apport_owner / bank_transfer / replenishment, hints JE), clé d'idempotence `useRef` stable-sur-retry/rotée-après-succès, montage via 2 entrées `SideMenuDrawer` (`side-menu-cash-in`/`-out`, disabled sans session) — `sessionId` prop-drillé depuis `Pos.tsx` (le drawer est data-fetch-free by design), modal en fragment sibling du Sheet (anti double `Dialog.Root` Radix). Un apport owner produit désormais sa JE 1110/3100 depuis l'UI (`record_cash_movement_v2` inchangé — il savait déjà). 17/17 tests.

### T3 — DB+POS : `close_shift_v2 → v3`, note d'écart enforced serveur (12 D1.4) — `1b55151`
Migration **`_105`** : corps repris du **live** (DEV-S57-02 — le fichier `20260606000015` est drifté `audit_log`→`audit_logs`), garde insérée **après le replay idempotent** et avant toute écriture/JE : au-delà du seuil (`ABS(v)>=abs OR (expected>0 AND ABS(v)/expected>=pct)`, seuils `business_config`, COALESCE 50000/0.005) et note vide → `variance_note_required` P0001. **DROP v2 même migration**, trio S20, GRANT authenticated (appel JWT direct). Le prédicat est le miroir exact de `shouldShowWarning` (vérifié par la revue T3 **et** la revue finale — le « suivi » de la revue finale sur le drift client↔serveur est donc déjà réglé). Repoints : `useCloseShift` (v3 + toast dédié), `cash-register-close.test.ts`, mock smoke. **pgTAP `close_shift_note_enforced` 7/7** + réparation de la suite STALE `cash_register.test.sql` (T_SHIFT_03 assertait encore les v1 droppées + miscount plan(8)→plan(9) préexistant) → **9/9**. Types regénérés. Grep `close_shift_v2` : zéro call-site exécutable.

### T4 — POS : lignes promo nommées sur le ticket (13 D1.1) — `1716e56`
`ReceiptPayload.promotions?: {name, amount}[]` + `totals.promotion_total`. Source = `cartStore.appliedPromotions` **snapshoté dans `PaymentSuccessState` au `setSuccess`** (l'enveloppe v17 ne renvoie que l'agrégat), threadé `PaymentTerminal → SuccessModal → buildReceiptPayload`. Filtre `amount<=0` sauf `free_product` (rendu « (free item) », montant 0). Nouvelle suite `receipt-promotions` via harnais `VITE_PRINT_MOCK` — 8/8 receipt tests.

### T5 — BO : détail des promos dans l'historique (13 D1.2) — `85e0d46` + fix `76b7e96`
Embed `promotion_applications(amount, description, promotions(name))` dans `useOrderDetail` (partagé) → rendu dans `OrderDetailPage` **et** `OrderDetailDrawer` entre Discount et PB1. Libellé primaire = `description` (snapshot NOT NULL, survit au soft-delete — RLS `promotions` filtre `deleted_at`), `promotions?.name` fallback. **Aucune migration** (RLS + embed FK préexistants). Revue round 1 : 1 Important cosmétique (classe muted incohérente avec les sœurs de la Page) — fixé `76b7e96`, Approved round 2. 9/9.

### T6 — DB+POS : KDS « All ready » bump en masse atomique (04 D1.2) — `682625d`
Migration **`_106`** : nouveau **`kds_bump_order_v1(p_order_id, p_idempotency_key) RETURNS integer`** — UN update atomique `pending|preparing → ready` (non-cancelled, scoped order), `ready_at`+`bumped_at` posés (l'undo 60 s per-item reste valable), replay idempotent via `audit_logs` `kds.bump_order` (shape mirroré du corps **live** de `kds_bump_item_v1` — audit ssi clé non-NULL, convention sibling), gate `kds.operate`, trio S20 complet. Choix « RPC dédié vs boucle client » : la boucle `kds_bump_item_v1` ne couvre pas les `pending` (P0011) et serait non-atomique. Ajout adjugé : garde P0002 order inexistant (parité `kds_recall_order_v1`). UI : bouton « All ready » (gold) dans le header `KdsOrderCard`, visible ssi items actionnables, hook `useKdsBumpOrder`, toast « N item(s) ready », **pas d'undo groupé** (choix assumé — l'undo per-item couvre). **pgTAP `kds_bump_order` 11/11**, KDS 16 fichiers/60 tests verts, types regénérés.

### T7 — BO : `x-idempotency-key` sur le void (02b D1.1) — `fca49d5`
`VoidArgs.idempotencyKey?` + header conditionnel (miroir byte-identique du POS S55), `VoidOrderModal` transmet `idem.current` (stable sur retry, roté succès + close), commentaire stale l.4 corrigé (« PIN sent in body » faux depuis S34). Body reste `{order_id, reason}` seul. L'EF `void-order` lisait déjà le header — aucun changement EF/DB. Nouvelle suite `void-idempotency-header` (BO, niveau hook — le C2 POS n'est pas copiable, API modal différente) 7/7.

## Migrations appliquées

| Fichier (NAME-block) | Cloud version (clock-stamped) | Objet |
|---|---|---|
| `20260710000105_close_shift_v3_enforce_variance_note` | `20260705110253` | `close_shift_v3` (+DROP v2) : note d'écart > seuil obligatoire côté serveur |
| `20260710000106_create_kds_bump_order_v1` | `20260705114439` | Nouveau `kds_bump_order_v1` : bump en masse atomique + replay idempotent |

Repo == cloud vérifié (`list_migrations`). Types regénérés et commités (v3 + kds_bump_order_v1). Money-path : **v17 / v11 / fire_v4 non modifiés** (revue finale + ancre `s44_money_gates` 12/12 `num_failed=0` re-passée live en closeout).

## RPCs ajoutés / bumpés

| Action | RPC | Notes |
|---|---|---|
| Bump v3 (+DROP v2) | `close_shift_v3` | Garde note d'écart serveur, même signature/enveloppe, corps live |
| Création v1 | `kds_bump_order_v1` | Order-scope, atomique, gate `kds.operate`, trio S20 |

## Dettes documentées (triées par la revue finale — AUCUNE bloquante)

| # | Sév. | Dette | Origine |
|---|---|---|---|
| D-1 | Suivi | **Template du print-bridge externe** (hors repo) à mettre à jour pour rendre `promotions[]` — sinon le champ est transporté puis ignoré (JSDoc posé dans `printService.ts`) | T4 |
| D-2 | Minor | Commentaires historiques `close_shift_v2` encore présents (`useCloseShift.ts:3-4`, `SideMenuDrawer.tsx:83`, `useShiftCloseSummary.ts:4`, 2 tests) + « audit_log table » hérité dans le corps `_105` — cosmétique, le code appelle v3/écrit `audit_logs` ; patch cosmétique groupé ultérieur | T3 |
| D-3 | Minor | `useLoadDebtOrder` : cast `order_type as OrderType` sans garde b2b interne (UI filtre + garde v11 en backstop) ; branche « confirm decline » non testée | T1 |
| D-4 | Minor | Tests promo : ordre DOM non asserté, cas empty-promotions non testé, `key={i}` (BO + reçu) ; test « zero/negative » ne couvre que 0 | T4/T5 |
| D-5 | Minor | `kds_bump_order_v1` sans clé = pas de ligne d'audit (convention héritée de `kds_bump_item_v1` ; le hook POS mint toujours une clé) ; race théorique même-clé (replay `LIMIT 1`) | T6 |
| D-6 | Info | Rotation d'idempotency-key on-close inerte aux call-sites réels (`VoidOrderModal`/`CashInOutModal` démontent — `useRef` frais au remount) ; les tests T3b/c void couvrent un scénario keep-mounted hypothétique | T2/T7 |
| D-7 | Info | Tension d'archi plan-mandatée : état du `CashInOutModal` local au `SideMenuDrawer` vs modals sœurs liftées dans `Pos.tsx` — choix conscient, à ne pas « corriger » accidentellement | T2 |
| D-8 | Info | 2 lint errors préexistants `VoidOrderModal.tsx` (raw-modal-overlay, misused-promises) hors diff ; bug cosmétique préexistant « Rp Rp » dans `fmtIdr` d'`OrderDetailPage` | T7/T5 |

## Actions utilisateur
- **T4 — print-bridge** : mettre à jour le template du print-bridge externe (serveur d'impression local, hors repo) pour rendre le nouveau champ `promotions[]` du payload `/print/receipt` (sinon les promos n'apparaissent pas sur le ticket papier alors que le POS les envoie).
- **T2 — exploitation** : les mouvements de caisse depuis le POS (menu latéral → Cash In / Cash Out) ne génèrent une écriture comptable QUE si le motif structuré est « Owner cash injection » ou « Bank transfer » — former les caissiers à choisir le bon motif.

## Tests / validation
- pgTAP : `close_shift_note_enforced` 7/7, `cash_register` (réparée) 9/9, `kds_bump_order` 11/11 — preuve MCP `num_failed=0` ; ancre money-path `s44_money_gates` **12/12 re-passée live en closeout**.
- Vitest/smoke par tâche : T1 3+3, T2 17, T3 12, T4 8, T5 9, T6 60 (KDS complet), T7 7 — tous verts.
- Suite complète monorepo à la pointe : typecheck + build + test (voir note de merge).
- Revues : 7 revues de tâche Approved (T5 après 1 round de fix) ; revue finale de branche **Ready to merge** — 0 Critical, 0 Important bloquant, ledger Minors intégralement trié en dette documentée.

## Leçons durables
- **Un « quick win UI » peut cacher un composant orphelin** : `CashInOutModal` existait, testé nulle part, monté nulle part — l'exploration pré-plan (grep call-sites) l'a attrapé avant le chiffrage, pas pendant.
- **La sémantique de statut d'une créance** : une ardoise caisse (`pending_payment`+`created_via='pos'`) passe la garde `pay_existing_order_v11`, un `b2b_pending` non — le CTA de paiement doit discriminer par `order_type` côté UI, le serveur backstoppe.
- **Un bump masse ≠ une boucle de bumps unitaires** : le RPC per-item exigeait `preparing` (P0011) — les états intermédiaires font qu'un « Tout prêt » correct est un nouvel RPC atomique order-scope, pas un map() client.
