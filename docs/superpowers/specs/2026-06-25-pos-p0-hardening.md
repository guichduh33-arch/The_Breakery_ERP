# Spec — POS P0 Hardening (vague 1)

> **Source** : audit POS transversal 6-axes du 2026-06-25 (orchestration SPARC, 6 agents read-only).
> **Périmètre validé par l'owner** : tous les P0 (LOT 0→7). LOT 0 = vérification live, **terminée** (résultats ci-dessous).
> **Branche** : `worktree-pos-p0-hardening`. **DB cible** : Supabase cloud V3 dev `ikcyvlovptebroadgtvd`.
> **Plan d'exécution** : `docs/superpowers/plans/2026-06-25-pos-p0-hardening.md`.

## 1. Objectif

Corriger les 7 lacunes P0 du module POS qui exposent à la **fraude / perte financière**, rendent le **KDS inutilisable**, fragilisent le **temps réel**, et dégradent l'**ergonomie tactile** (CAISSE + WAITER). Aucune régression sur le money-path. Tests verts + build + types regen avant chaque merge.

## 2. Résultats LOT 0 (vérification live — faits établis)

| Fait vérifié | Preuve live | Impact spec |
|---|---|---|
| `refund_order_rpc_v4` **EXECUTE par `authenticated`** | `has_function_privilege('authenticated',…)=true` ; acl `{…,authenticated=X/postgres,…}` | LOT 1 confirmé exploitable |
| `void_order_rpc_v3` **EXECUTE par `authenticated`**, **sans `p_idempotency_key`** | idem ; args = `(p_order_id,p_reason,p_authorized_by,p_acting_auth_user_id)` | LOT 1 : REVOKE + ajouter idempotency |
| Ni refund_v4 ni void_v3 n'ont `p_manager_pin` | signatures live | PIN validé seulement dans l'EF → contournable |
| `cancel_order_item_rpc_v2` **REVOKED** (`auth_exec=false`, `service_role` seul) | acl `{postgres=X,service_role=X}` | **pattern cible** à répliquer |
| Dernier bump = `20260620172527/172629_*_modifier_ingredients` ; **pas de `20260705000018`** | `list_migrations` | régression : bump a re-GRANT authenticated |
| `journal_entries`/`_lines` = `authenticated=arwdDxtm` (write GRANT) | acl ; `stock_movements`=`authenticated=rm` | LOT 2 : REVOKE write |
| `journal_entry_lines` colonnes = `debit`,`credit` (numeric) | information_schema | LOT 2 : fallback CR |
| **363/363 produits actifs** dans catégories `dispatch_station='none'` | join products×categories | LOT 3 : mapping catégorie→station |
| 7 catégories routées (3 kitchen, 3 bakery, 1 barista) = **0 produit actif** | group by categories | LOT 3 : décision métier de mapping |

## 3. Exigences par lot

### LOT 1 — Durcir le reversal money-path (P0, sécu/argent)
- **R1.1** Créer `refund_order_rpc_v5` et `void_order_rpc_v4` (signatures inchangées + `void` gagne `p_idempotency_key uuid DEFAULT NULL`), `DROP` des anciennes dans la **même** migration (versioning monotone).
- **R1.2** Sur les 2 nouvelles : `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role` (réplique exacte de `cancel_order_item_rpc_v2`). Les EFs `refund-order`/`void-order` appellent déjà via admin client (`service_role`) → pas de rupture.
- **R1.3** `void_order_rpc_v4` : idempotence par re-read sur `p_idempotency_key` (table `void_order_idempotency_keys` ou réutiliser le pattern existant) — replay retourne le résultat initial, pas une erreur.
- **R1.4** Fix double contre-passation : `void_order_rpc_v4` ne doit générer **qu'une** contre-passation JE. Choix retenu (cf. backlog `20260603000017`) : **ne pas créer la ligne miroir `refunds`** sur un full-void (le trigger `sale_void` sur `orders.status='voided'` suffit). Retirer la dépendance à la dédupe report-level.
- **R1.5** Repointer les EFs `refund-order/index.ts` (→ v5) et `void-order/index.ts` (→ v4) + propager `x-idempotency-key` (`getIdempotencyKey`) sur void.
- **R1.6** `DROP FUNCTION` des anciennes signatures ; types regen + commit.
- **Done** : pgTAP « refund/void REVOKED from authenticated » + « PIN/role enforced » verts ; retry void = idempotent (même résultat) ; un void ne produit qu'une contre-passation dans GL/TB ; build + types OK.

### LOT 2 — Intégrité du grand livre (P0, compta)
- **R2.1** `fn_create_je_for_refund` : ajouter un **fallback ligne CR** (miroir de `create_sale_journal_entry`) si `refund_payments` est vide, garantissant `Σdebit=Σcredit` même en données dégradées.
- **R2.2** `REVOKE INSERT, UPDATE, DELETE ON journal_entries, journal_entry_lines FROM authenticated` (+ `PUBLIC`), aligner sur `stock_movements`. Écriture conservée via triggers/RPC SECURITY DEFINER.
- **R2.3** Nettoyer/contre-passer les **8 JE `sale_refund` orphelines** (sans ligne CR) qui déséquilibrent le TB de 160 000 IDR — migration de data-fix idempotente.
- **Done** : `get_trial_balance_v1` rééquilibré (`Σdr=Σcr` global) ; pgTAP « ledger append-only au niveau GRANT » + « refund JE balanced même sans refund_payments » verts.

### LOT 3 — Rendre le KDS fonctionnel (P0, métier/data)
- **R3.1** Garde-fou au fire : si un produit firé appartient à une catégorie `dispatch_station='none'`, **alerter** (toast/badge) au lieu d'un silent-skip. Décision : non-bloquant mais visible.
- **R3.2** Exposer/mapper `dispatch_station` dans le CRUD catégorie BO (vérifier que `create_category_v1`/`update_category_v1` acceptent `dispatch_station`).
- **R3.3** **Décision owner requise** : mapping catégorie→station (quelles catégories vont en kitchen/bakery/barista). Backfill data **après** validation owner — **hors code, escaladé**.
- **Done** : fire d'un produit non routé alerte ; le CRUD catégorie permet d'assigner une station ; mapping data en attente owner (documenté).

### LOT 4 — Blind-count clôture caisse (P0, anti-fraude)
- **R4.1** `CloseShiftModal` : masquer `expectedCash` + variance temps réel pendant la saisie du comptage.
- **R4.2** Révéler l'écart **après** soumission du comptage ; si `|écart| > seuil` (business_config), exiger une raison (déjà présent) — pas de pré-affichage de l'attendu.
- **Done** : le caissier ne voit jamais l'attendu avant d'avoir saisi son comptage physique.

### LOT 5 — Filet reconnect realtime (P0, robustesse)
- **R5.1** Ajouter un filet (refetchInterval ou `online → invalidateQueries`) sur `useDisplayRealtime`, `useTableOccupancy`, `usePromotionsRealtime`, `useHeldOrdersRealtime`, `useTabletOrderStatusListener` (KDS+inbox l'ont déjà à 30s).
- **Done** : un event realtime perdu est rattrapé < 30s sur les 6 canaux.

### LOT 6 — Refonte tactile tablette WAITER (P0, design)
- **R6.1** Grille tablette dédiée iPad-first (2-3 colonnes portrait/paysage, tuiles agrandies, recherche `h-12`).
- **R6.2** Panier tablette : remplacer les boutons qty 24px par `QuantityStepper @breakery/ui` (cibles ≥48px).
- **R6.3** Header tablette enrichi : table active + pastille offline persistante + compteur commandes.
- **R6.4** `CategorySidebar` tablette alignée sur `CategoryNav` (tints, libellés `text-xs`, largeur ≥104px).
- **Done** : toutes cibles ≥44px (idéal 48px) ; grille confortable en portrait ; états offline/empty couverts.

### LOT 7 — Hiérarchie BottomActionBar + payment CAISSE (P0, design)
- **R7.1** `BottomActionBar` : Checkout dominant `≥h-12`/`size="lg"` (≥56px), Void/Send `h-12`, ghosts gauche `h-11`.
- **R7.2** Appliquer les tickets P0 de l'audit payment-caisse existant : pré-sélection Cash à l'ouverture du terminal + quick-cash visible pré-méthode.
- **Done** : Checkout visiblement dominant ; Cash pré-sélectionné ; fast-path cash en 1 tap.

## 4. Contraintes globales (verbatim CLAUDE.md)
- **Versioning RPC monotone** : jamais éditer une signature `_vN` publiée ; créer `_vN+1` + `DROP FUNCTION …vN(<args>)` dans la même migration.
- **REVOKE defense-in-depth** : sur fonction admin, `REVOKE EXECUTE FROM anon ET PUBLIC` (authenticated hérite via PUBLIC sinon).
- **`stock_movements`/ledgers append-only** : écriture via SECURITY DEFINER uniquement.
- **PIN en header** `x-manager-pin`, jamais en body ; idempotence via `x-idempotency-key` header → `getIdempotencyKey`.
- **Types regen obligatoire** après tout changement de schéma (`generate_typescript_types` → `packages/supabase/src/types.generated.ts` → commit).
- **DB = cloud dev `ikcyvlovptebroadgtvd`** via MCP ; **NE PAS** `pnpm db:reset`/`supabase start`/`run_pgtap.sh` (Docker retiré). pgTAP via `execute_sql` en `BEGIN…ROLLBACK`.
- **Fichiers < 500 lignes** ; tests co-localisés en `__tests__/`.
- **Conventional commits** + co-author Claude.

## 5. Hors périmètre / escalades
- **Décision owner** : mapping catégorie→station (LOT 3 data) ; arrondi PB1 centaine vs exact (LOT 8, vague ultérieure).
- **Angle mort hardware** (imprimante/tiroir/scanner Tauri/Capacitor) : non testable statiquement.
- **Lots P1+** (reçu TVA dynamique, split-bill, offline file, états UI, harvest UUID, dette) : vagues suivantes, hors cette spec.
