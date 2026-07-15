# Audit intégral par module — The Breakery V3 ERP

> **Date** : 2026-06-27
> **Méthode** : 12 auditeurs spécialisés en parallèle (1 par domaine, agent + skill projet le plus pertinent), sortie structurée, vérifications SQL **live** sur le projet V3 dev `ikcyvlovptebroadgtvd`, puis synthèse.
> **Périmètre** : 23 features POS, 33 features BackOffice, 14 edge functions, 616 migrations, 25 modules domain.
> **Baseline de comparaison** : [audit intégral 2026-05-20](2026-05-20-audit-integral-V3/00-EXECUTIVE-SUMMARY.md) (~5 semaines, ~12 PRs mergées depuis : #114→#126).
> **Verdict** : 🟢 **socle production-ready** ; finition concentrée requise sur **5 chantiers critiques** + durcissement RBAC/fuites et intégrité B2B/compta.

---

## 1. TL;DR

Le système nerveux de V3 reste **solide et a progressé** : les **7 failles de sécurité de 2026-05-31 sont toutes corrigées** (vérifié en SQL live), la comptabilité double-entrée est équilibrée (67 JE, 0 déséquilibre), le PB1 lit désormais un taux dynamique (`current_pb1_rate()`), les reversals sont versionnés/REVOKE + PIN header avec non-répudiation (`actor = manager`), l'idempotency 2-saveurs et l'append-only au niveau GRANT tiennent. Le parcours commande→paiement, le catalogue, le stock-flow et les reports sont fonctionnellement larges et bien testés.

**Mais** l'audit révèle **5 problèmes critiques** non couverts par les sweeps précédents, et **trois angles morts transverses** :

1. **Fuites d'information par objets dérivés non-RLS** : la vue `audit_log` (SECURITY DEFINER) et 3 materialized views financières (`mv_pl_monthly`, `mv_sales_daily`, `mv_stock_variance`) sont **lisibles par tout rôle authentifié** (caissier/serveur) → le P&L, le CA et l'audit-trail complet fuient en contournant la RLS admin.
2. **Confiance client sur les montants** : le **reçu imprimé recalcule le total côté client en ignorant les promotions** (papier ≠ encaissé), et les **lignes-cadeau / surcharges combo / prix de modifiers** ne sont pas re-validés serveur → faille anti-fraude d'encaissement.
3. **Intégrité B2B/AR brisée** : un paiement B2B **ne solde jamais les factures** (`paid_at` jamais posé) et **deux définitions divergentes de la dette** (POS vs BackOffice) ne se réconcilient jamais → AR aging et panneau dettes POS structurellement faux dès le 1ᵉʳ encaissement.

À cela s'ajoutent : **les 62 tests d'intégration RPC ne tournent dans aucun CI** (money-path/stock/compta sans filet auto), le **bookkeeping `schema_migrations` cloud endommagé** (~80 migrations non trackées), et les **EF PDF inutilisables en POS** (`auth.getUser()` rejette les PIN-JWT HS256).

**Score de maturité global : ~6,8/10** — « avancé, livrable par pilier, mais avec des trous d'intégrité ciblés à fermer avant cutover prod ». Effort estimé pour la vague critique (P0+P1) : **~10-15 jours-homme**.

---

## 2. Tableau de bord par module

| # | Module | Score | Verdict court |
|---|--------|:-----:|---------------|
| 1 | POS — parcours commande→paiement | 7.5 | Mature ; cohérence reçu↔serveur à fermer |
| 2 | POS — design frontend & ergonomie | 7.0 | Soigné ; états d'erreur manquants (KDS/grilles), cibles tactiles caisse |
| 3 | BackOffice — surface admin | 7.5 | Très mûr ; gating RBAC incohérent (routes non gatées) |
| 4 | DB / migrations / RPC | 6.5 | Avancé ; `schema_migrations` cloud cassé, `search_path` mutable |
| 5 | Edge Functions | 6.5 | Critiques durcies ; secondaires (PDF, dispatch) à durcir |
| 6 | Stock / production / recettes | 6.5 | Riche ; FIFO/lots non câblé, déduction combo non flag-aware |
| 7 | Comptabilité / fiscal | 6.0 | Backbone sain ; TB non cumulative, PB1 dédup, GL/TB non gatés |
| 8 | Orders + B2B/AR | 6.0 | Retail mature ; **B2B/AR au stade fondation, trous d'intégrité** |
| 9 | Catalogue + promos + loyalty | 7.0 | Solide ; prix-confiance-client (cadeau/modifier/combo) |
| 10 | Reports / exports / Z-report | 7.0 | Large ; fuseau UTC vs business-tz, gating RPC incohérent |
| 11 | Sécurité & anti-fraude | 7.0 | **7 failles 2026-05-31 corrigées** ; 2 nouvelles fuites |
| 12 | Architecture / tests / CI | 7.0 | Sain ; **filet CI percé sur la couche RPC** |

**Moyenne ≈ 6,8/10.** Les modules « argent et identité » (compta, B2B, DB, EF, stock) sont sous la moyenne — c'est là que se concentre la dette d'intégrité.

---

## 3. Delta vs baseline 2026-05-20

**Corrigé depuis (gains confirmés en live)** :
- ✅ Les **5 fixes critiques** de la baseline sont traités : PB1 dynamique (`current_pb1_rate()`), split JE par `order_payments.method` (S44, enum réel cash|card|qris|edc|transfer|store_credit), `take_away→take_out`, `name_snapshot`.
- ✅ Les **7 failles sécurité 2026-05-31** (reversals contournables, `pin_hash` lisible, `customers.read` non gaté, MV→anon, vues sans `security_invoker`) : **toutes fermées**, vérifié en SQL live.
- ✅ Append-only **renforcé** (REVOKE INS/UPD/DEL sur `journal_entries`/lines, migration `20260709000011`).
- ✅ `track_inventory`/`deduct_stock` + `allow_negative_stock` câblés (#122) — partiellement (voir thème 2).

**Persistant ou nouveau** :
- ⚠️ PIN-in-body : encore présent sur `auth-verify-pin`, `auth-change-pin`, `create_manual_je_v1`, et PIN en arg RPC sur `process-payment` (la baseline avait migré void/cancel/refund seulement).
- 🔴 **Nouveau** : fuites via `audit_log` (vue definer) + MV financières → `authenticated` (le sweep anon S20 n'a pas couvert `authenticated` ni `relkind='m'`).
- 🔴 **Nouveau / aggravé** : intégrité B2B/AR (settlement par facture, 2 sources de vérité), TB non cumulative, dédup PB1 void+refund, déduction combo/modifier/B2B non flag-aware (#122 incomplet).

---

## 4. Top 10 findings critiques (transverses, à traiter en priorité)

| # | Sévérité | Module | Finding | Fichier(s) clés |
|---|----------|--------|---------|-----------------|
| C1 | 🔴 Critique | Sécurité | **Vue `audit_log` (DEFINER, owner postgres) expose tout l'audit-trail à tout employé authentifié** — bypass la RLS admin de `audit_logs` | `public.audit_log` (vue) |
| C2 | 🔴 Critique | Sécurité | **3 MV financières (`mv_pl_monthly`, `mv_sales_daily`, `mv_stock_variance`) SELECT-ables par `authenticated`** → P&L/CA/variances lisibles par caisse/serveur | `public.mv_*` |
| C3 | 🔴 Critique | Orders/B2B | **`paid_at` jamais posé sur commandes B2B payées** → AR aging + panneau dettes POS faux dès le 1ᵉʳ encaissement | `record_b2b_payment_v1`, `view_b2b_invoices`, `view_ar_aging` |
| C4 | 🔴 Critique | Orders/B2B | **Deux sources de vérité divergentes pour la dette B2B (POS vs BO)** jamais réconciliées | `get_pos_b2b_debts_v2`, `record_b2b_payment_v1` |
| C5 | 🔴 Critique | Edge Functions | **`generate-pdf`/`generate-zreport-pdf` renvoient 401 pour les PIN-JWT HS256** (`auth.getUser()` GoTrue ES256) → PDF inutilisables en POS | `generate-pdf:71`, `generate-zreport-pdf:59` |
| C6 | 🔴 Critique | Archi/Tests | **62 tests d'intégration live-RPC ne tournent dans aucun CI** (money-path/stock/compta sans vérif auto) | `supabase/tests/functions/*.test.ts`, `ci.yml:77-90` |
| C7 | 🔴 Critique | DB | **`schema_migrations` cloud endommagé** : ~80 migrations non trackées (max `20260629000012`) → drift-check KO, risque de re-application | cloud `supabase_migrations.schema_migrations` |
| C8 | 🟠 Majeur+ | Catalogue | **Ligne-cadeau : produit & quantité offerts non contrôlés au checkout** → produit cher encaissable gratuitement | `complete_order_with_payment_v14:260-266,580-607` |
| C9 | 🟠 Majeur+ | POS flow | **Reçu imprimé recalcule le total côté client en ignorant les promotions** → papier ≠ montant encaissé | `SuccessModal.tsx:46-67`, `calculateTotals.ts:51` |
| C10 | 🟠 Majeur+ | Comptabilité | **`calculate_pb1_payable_v1` sans dédup void+refund** → PB1 sous-évalué → sous-déclaration PEMDA Bali | `calculate_pb1_payable_v1` |

---

## 5. Neuf thèmes transverses (les patterns à corriger en lot)

### T1 — Confiance client sur les montants (anti-fraude encaissement)
Le money-path re-valide bien les **promotions** (comparaison stricte client vs `evaluate_promotions_v1`) et le **combo_base_price**, mais **pas** : les lignes-cadeau (produit/quantité libres), les **surcharges d'options combo** (`price_adjustment` client cru aveuglément), les **prix de modifiers**, ni le **reçu imprimé** (recalcul client ignorant les promos) ni le **tax_amount** (taux `0.10` hardcodé dans 5+ fichiers).
**→ Fix groupé** : un helper serveur `_resolve_line_price_v1` recalculant `unit_price + modifiers + surcharges combo + cadeaux` depuis les tables source ; le reçu/affichage client consomment les **valeurs renvoyées par le serveur** (total, tax, ventilation des tenders), jamais un recalcul.

### T2 — Câblage `#122` incomplet & INSERT directs dans `stock_movements`
La déduction flag-aware (`track_inventory`/`deduct_stock`) a été appliquée à la **ligne simple** mais oublie : **composants de combo** (l.607-635, toujours inconditionnel), **ingrédients de modifiers**, et **le chemin B2B** (`create_b2b_order_v1`). Pire, les 4 sorties de vente font des **`INSERT INTO stock_movements` bruts** (pas de `lot_id`, pas de maj `section_stock`, pas d'idempotency, bypass du gate `p_allow_negative`) — violation du pattern « jamais d'INSERT direct ».
**→ Fix groupé** : factoriser une procédure interne unique de déduction (flag-aware + `record_stock_movement_v1`) appelée par les 3 chemins (ligne, combo, modifier) **et** par le B2B.

### T3 — Fuites par objets dérivés non-RLS (vues DEFINER + MV)
La RLS posée sur les **tables base** est contournée par des **vues `SECURITY DEFINER`** (`audit_log`, `v_product_available_stock`, `view_product_allergens_resolved`) et des **materialized views** (aucune RLS). Le sweep anon S20 n'a couvert ni `authenticated` ni `relkind='m'`.
**→ Fix groupé** : `ALTER VIEW … SET (security_invoker=on)` + `REVOKE SELECT … FROM authenticated` sur les surfaces sensibles ; `REVOKE ALL ON mv_* FROM authenticated, PUBLIC` + GRANT ciblé/RPC gated ; **test pgTAP récurrent** asservant qu'aucune vue/MV PII-financière n'est SELECT-able sans gate.

### T4 — Gating de permission incohérent (RBAC à uniformiser)
- Routes BO **non gatées** : `products`, `products/:id`, `accounting` index (exposent prix/coûts/marges/index compta) ; `settings/security` gatée par le simple `settings.read` ; B2B Dashboard/Payments gatés par `customers.read`.
- RPC report **SECURITY INVOKER sans `has_permission` interne** (S13 : `get_sales_by_hour_v1`…, S26/S32 : `get_profit_loss_v1`, `get_balance_sheet_v1`) → appelables hors UI, contournant le `PermissionGate` de route.
- `get_general_ledger_v1`/`get_trial_balance_v1` : RLS `is_authenticated()` → **grand livre lisible par tout employé**.
**→ Fix groupé** : `has_permission('reports.<domaine>.read' / 'accounting.gl.read' / 'accounting.tb.read')` en tête des RPC ; gater les routes manquantes ; permission dédiée pour la posture sécurité.

### T5 — Intégrité B2B / AR (le pilier crédit reste « fondation »)
`paid_at` jamais posé, deux sources de vérité (cache `b2b_current_balance` vs `view_ar_aging` vs panneau POS `order_payments` vide), pas de void B2B, gate credit-limit en **TOCTOU**, ajustement AR sans JE de contrepartie, permission générique `customers.update` pour encaisser.
**→ Fix groupé** : table `b2b_payment_allocations` + pose de `paid_at` ; source unique dérivée du ledger (réconciliation + alerte de drift) ; `cancel_b2b_order_v1` ; re-check plafond **après** `FOR UPDATE` ; permissions dédiées `b2b.payment.record`/`b2b.balance.adjust`.

### T6 — Correctness comptable (clôture & fiscal)
TB **non cumulative** (soldes des comptes permanents faux), PB1 **sans dédup void+refund** (sous-déclaration), garde fiscale **fail-open**, **clôture annuelle absente** (pas de carry-forward vers 3200), audit **fragmenté sur 2 tables** (`audit_log` / `audit_logs`).
**→ Fix groupé** : TB as-of (réutiliser `opening_balance` du GL) ; aligner `calculate_pb1_payable_v1` sur la dédup ; garde fail-closed ; RPC de clôture annuelle ; consolider l'audit sur une table.

### T7 — Durcissement Edge Functions secondaires
PDF cassés sous PIN-JWT (C5) ; `auth-change-pin` **sans rate-limit** (brute-force) ; void-order/cancel-item **sans idempotency** ; `process-payment` PIN en **arg RPC** ; `notification-dispatch` secret en **query param** (loggé) ; `generate-pdf` idempotency **ignorée** ; PIN-in-body (`auth-verify-pin`/`auth-change-pin`).
**→ Fix groupé** : `getActingAuthUserId` pour les PDF ; rate-limit + idempotency + headers ; vérif discount-PIN via `verify-manager-pin` en amont (ne plus passer le PIN brut en SQL).

### T8 — FIFO / lots / péremption non câblés (fausse assurance stock)
Les lots existent et le cron de péremption tourne, mais **aucune sortie ne décrémente les lots** et **`production_in` n'en crée pas** → valorisation par lot, péremption et traçabilité lot→vente impossibles ; `allow_negative_stock` **DEFAULT true** (oversell out-of-the-box) ; **aucun cron d'alerte stock bas** ; **`unit_cost=NULL`** sur les sorties recette → WAC/COGS faux.
**→ Spec dédiée requise** (un fix partiel auto-wasterait du stock déjà vendu) avant tout code.

### T9 — Filet CI percé & bookkeeping cloud
Live-RPC jamais exécutés (C6), `pgtap-pr` smoke et `lint` **non-bloquants** (250+ erreurs, 88 `any`, 110 `eslint-disable` concentrés dans accounting/cash/b2b), `schema_migrations` cloud cassé (C7), scripts `db:types/db:reset` cassés (Docker retiré), 8 fichiers > 500 lignes.
**→ Fix groupé** : job nightly live-RPC avec service-role ; flip `continue-on-error:false` (pgtap puis lint-ratchet diff) ; repair `schema_migrations` ; gate de dérive `types.generated.ts`.

---

## 6. Détail par module

> Chaque finding ci-dessous est issu d'un auditeur spécialisé avec vérification du code/SQL réel. Sévérités : 🔴 critique · 🟠 majeur · 🟡 mineur.

### 6.1 POS — parcours commande→paiement (score 7.5)
**État** : mature, écritures 100 % via RPC, idempotency 2-saveurs correcte (`useRef` stable), PIN header, canaux realtime uniques/mount, close-shift blind-count + note variance, firing persisté avant impression.
- 🟠 **Reçu imprimé recalcule le total client en ignorant les promotions** (`SuccessModal.buildReceiptPayload` → `calculateTotals` avec `cart.promotionTotal` jamais renseigné). Papier > encaissé dès qu'une promo s'applique. → consommer total/tax serveur.
- 🟡 Reçu split-tender : seule la méthode du 1ᵉʳ tender enregistrée (`paymentMethod: tendersToShip[0].method`).
- 🟡 `DEFAULT_TAX_RATE=0.10` répliqué client dans 5+ fichiers (divergence latente si le taux serveur change).
- 🟡 Oublis : affichage client **devient blanc après paiement** (pas de message `payment_complete`) ; miroir panier limité à `BroadcastChannel` (même machine) ; KDS sans `useReconnectInvalidate` (rattrapé ≤30 s).
- 🟡 Manques : pas de kiosque self-order ; split-bill par convive non persisté (pas de sous-reçu/audit).

### 6.2 POS — design frontend & ergonomie (score 7.0)
**État** : tokens sémantiques systématiques, hiérarchie paiement soignée, WAITER durci (LOT 6).
- 🟠 **Aucun état d'erreur sur les grilles produits** (caisse + tablette) ni **KDS** : un fetch raté retombe sur l'**empty state** → la cuisine croit qu'il n'y a aucune commande (risque opérationnel, pas cosmétique).
- 🟠 Cibles tactiles sous le seuil dans le panier caisse (stepper/remove/discount à 32 px ; recherche 36 px) — la tablette a été corrigée, pas la caisse.
- 🟡 Toggle order-type tablette ~32 px + couleur en dur ; couleurs Tailwind brutes (`rose-*`, `red-400`) hors token.
- 💡 Améliorations fortes : badge quantité + appui-long sur la tuile (vitesse rush), most-sold/récents, grille caisse responsive, typo tuiles adaptée à la distance.

### 6.3 BackOffice — surface admin (score 7.5)
**État** : ~90 pages route-splittées, `PermissionGate` uniforme, sidebar 7-groupes permission-filtrée, `ExportButtons` sur 27 pages, infinite-query cursor.
- 🟠 **Routes `products` / `products/:id` / `accounting` index sans `PermissionGate`** → tout utilisateur BO voit catalogue + coûts/marges + index compta.
- 🟠 `settings/security` gatée par le simple `settings.read`.
- 🟡 Casts `as PermissionCode` morts dans la sidebar (désactivent le typage → faute de frappe future = item invisible silencieux).
- ⚠️ Risque : B2B Dashboard/Payments gatés par `customers.read` (AR aging + ledger exposés).
- 🟡 Manques : pas d'empty-state reports ; 3 reports + page sécurité absents de la sidebar (discoverability à deux vitesses).

### 6.4 DB / migrations / RPC (score 6.5)
**État** : 616 migrations, versioning monotone, REVOKE anon/PUBLIC sur la majorité, ledgers append-only, RPC S33 solides.
- 🔴 **`schema_migrations` cloud endommagé** (~80 migrations non trackées, max `20260629000012`) → `list_migrations` KO, risque de re-application DDL destructive.
- 🟠 **`search_path` sans `pg_temp`** sur 6+ fonctions SECURITY DEFINER (S33-36 : hold/reopen held order, dispatch stations, cash-wallet) — advisor « Function Search Path Mutable ».
- 🟠 **Pas d'index `orders(created_at DESC)`** pour `get_orders_list_v2` sans `session_id` (seq-scan croissant en prod).
- 🟠 `ALTER DEFAULT PRIVILEGES` sans `IN SCHEMA public` (3 migrations import) → portée globale non intentionnelle ; 2 RPC cost-analytics sans la 3ᵉ ligne canonique.
- ⚠️ Risques : **`reopen_held_order_v1` ne vérifie pas l'appartenance à la session** → vol de commande inter-terminal ; **`unit_cost=NULL`** sur les sorties recette → WAC/COGS faux ; `audit_logs.actor_id` NULL possible (profil soft-deleted).

### 6.5 Edge Functions (score 6.5)
**État** : EF manager-gated (refund/void/cancel/verify-pin) correctement durcies (PIN header, rate-limit, fail-bucket IP, `_shared`).
- 🔴 **`generate-pdf`/`generate-zreport-pdf` : `auth.getUser()` échoue pour PIN-JWT HS256** → 401 systématique en POS (bug browser-only). → `getActingAuthUserId`.
- 🟠 `auth-change-pin` **sans rate-limit** (brute-force 6 chiffres).
- 🟠 **void-order / cancel-item sans idempotency** (double annulation sur retry).
- 🟠 `process-payment` : **manager PIN en arg RPC** (`p_manager_pin`) → visible `pg_stat_activity`/pgaudit.
- 🟠 `notification-dispatch` : **secret cron en query param `?secret=`** (loggé par CDN/LB/dashboard).
- 🟠 `generate-pdf` : **idempotency parsée mais ignorée** (double PDF au double-clic).
- 🟠 PIN-in-body sur `auth-verify-pin`/`auth-change-pin`.
- 🟡 Comparaison secrets non constant-time ; `ref:'local'` hardcodé dans les JWT PIN ; `String(err)` renvoyé au client.

### 6.6 Stock / production / recettes (score 6.5)
**État** : opname à états complet + JE, transferts 2-temps, recettes versionnées immuables, WAC réel, flags #122 + negative-stock.
- 🟠 **FIFO sur `stock_lots` non câblée** (lots jamais décrémentés ; `lot_id` NULL sur les sorties) ; **`production_in` ne crée aucun lot** ; **aucun cron d'alerte stock bas**.
- 🟠 **Déduction des composants de combo NON flag-aware** (oubli #122) ; **INSERT directs dans `stock_movements`** depuis la vente (4 chemins) bypassant la primitive.
- 🟡 `_resolve_recipe_consumption_v1` : somme de quantités sur unités hétérogènes avant conversion ; modifiers inconditionnels.
- ⚠️ Risques : `allow_negative_stock` **DEFAULT true** (oversell out-of-the-box) ; opname `expected_qty` figé sans gel de section (variance absorbe les mouvements concurrents) ; pas de seuil/double-contrôle à la finalisation ; divergence `section_stock` ↔ `products.current_stock` non réconciliée.

### 6.7 Comptabilité / fiscal (score 6.0)
**État** : backbone JE sain (67 JE, 0 déséquilibre live), 1151 VAT Input désactivé (ADR-003), split par méthode, fold PPN fournisseur, append-only renforcé.
- 🟠 **Trial Balance non cumulative** → soldes des comptes permanents (caisse/banque/inventaire/PB1) faux (n'affiche que le mouvement de période).
- 🟠 **`calculate_pb1_payable_v1` sans dédup void+refund** → PB1 sous-évalué (sous-déclaration PEMDA).
- 🟠 **GL/TB non gatés par permission** (RLS `is_authenticated()`) → grand livre lisible par tout employé.
- 🟠 Garde fiscale **fail-open** (postings sur dates hors période acceptés).
- 🟠 **Clôture annuelle absente** (pas de carry-forward résultat → 3200) ; audit **fragmenté** sur `audit_log`/`audit_logs`.
- 🟡 `create_manual_je_v1` sans clé d'idempotence ; clôture sans contrôle d'équilibre/ordre ; mappings fantômes vers 1151 désactivé.

### 6.8 Orders + B2B/AR (score 6.0)
**État retail** : mature (money-path v14, list v2 cursor, edit-items idempotents, void/refund, realtime StrictMode-safe, pgTAP 10/10 + 12/12).
- 🔴 **`paid_at` jamais posé sur commandes B2B payées** ; le commentaire de `view_b2b_invoices` prétend le contraire (faux) → `is_unpaid` TRUE à vie.
- 🔴 **Deux sources de vérité divergentes** (panneau POS `total − order_payments` jamais alimenté vs `b2b_current_balance` BO) → facture payée BO reste 100 % impayée au POS.
- 🟠 **Aucun void/annulation B2B** (`void_order_rpc` exige `paid` + session) → facture erronée non corrigeable proprement.
- 🟠 Gate credit-limit en **TOCTOU** (check avant le `FOR UPDATE`, pas de re-check après).
- 🟠 `create_b2b_order_v1` **ignore les flags #122** + INSERT stock direct.
- ⚠️ Risques : `adjust_b2b_balance_v1` efface un AR sans JE, gaté `customers.update` ; pagination sans tie-breaker `id` ; acomptes B2B impossibles.

### 6.9 Catalogue + promos + loyalty (score 7.0)
**État** : CRUD via RPC allowlist + unicité SKU, variants « linked-products » (XOR/anti-nesting, pgTAP 20/20), combos S47 à groupes, **promotions re-validées serveur**, loyalty validée, isolation display-stock.
- 🟠 **Ligne-cadeau : produit & quantité offerts non contrôlés** au checkout → produit cher encaissable gratuitement (faille anti-fraude).
- 🟠 **Prix des modifiers / surcharges combo en confiance client** (`price_adjustment` cru aveuglément) → fuite de revenu.
- 🟠 **Règles de groupes de combo non validées au checkout** (min/max/required/appartenance — validation seulement côté client).
- 🟠 **Aucun plafond d'usage de promotion** (réutilisation illimitée, pas de budget/per-customer).
- 🟡 `update_product_v1` modifie le SKU sans pré-contrôle d'unicité ; marketing limité à l'analytique read-only.

### 6.10 Reports / exports / Z-report (score 7.0)
**État** : ~28 pages, hub catégorisé, pipeline export unifié (`buildCsv` IO-free + 17 templates PDF), drill-down (pgTAP 18/18), Z-report 2-temps + bucket 7 ans.
- 🟠 **Payment-by-Method bucketé en UTC** vs reste en `Asia/Makassar` → **ne réconcilie pas** entre rapports (paiements aux bornes de journée mal datés).
- 🟠 **Gating RPC report incohérent** (anciens INVOKER sans `has_permission`).
- 🟠 **Pas de rapport de marge brute réelle par produit** (prix vendu − WAC) — KPI de pilotage central absent.
- 🟡 AR aging non exportable dédié ; Audit Log sans filtre de période ; `by_day` Payment-by-Method calculé mais jeté ; PDF comparatif avec libellé de période identique.

### 6.11 Sécurité & anti-fraude (score 7.0)
**État** : **les 7 failles 2026-05-31 corrigées (vérifié live)** ; reversals versionnés/REVOKE + PIN header + non-répudiation ; append-only au GRANT ; moindre privilège CASHIER.
- 🔴 **Vue `audit_log` (DEFINER) expose tout l'audit-trail à tout authentifié** (bypass RLS admin). → `security_invoker=on` + REVOKE.
- 🔴 **3 MV financières SELECT-ables par `authenticated`** (P&L/CA/variances). → REVOKE + GRANT ciblé.
- 🟡 `create_manual_je_v1` PIN en body ; `void_zreport_v1` sans PIN manager (réouverture de clôture sur simple permission) ; `get_customer_product_price` sans `search_path` ; export PDF/CSV sans ligne d'audit.
- ⚠️ Angle mort structurel : la RLS des tables base est contournée par vues DEFINER + MV — vérifier `security_invoker`/GRANT à **chaque** création d'objet dérivé.

### 6.12 Architecture / tests / CI (score 7.0)
**État** : monorepo sain, `domain` IO-free, `strict` + `noUncheckedIndexedAccess`, large couverture (66 domain, 132 POS, 194 BO, 54 ui, 62 live-RPC, 110 pgTAP, 12 e2e), Sentry, types à jour.
- 🔴 **62 tests live-RPC ne tournent dans aucun CI** (`skipIf` sans service-role) → money-path/stock/compta sans vérif d'intégration auto.
- 🟠 **`pgtap-pr` smoke + `lint` non-bloquants** (`continue-on-error:true`) → 250+ erreurs, 88 `any`, 110 `eslint-disable` concentrés dans accounting/cash/b2b.
- 🟡 Scripts `db:types`/`db:reset` cassés (Docker retiré) ; 8 fichiers > 500 lignes (`routes/index.tsx` 953, `cartStore.ts` 581) ; pas de smoke EF post-deploy ; pas de gate de dérive `types.generated.ts`.

---

## 7. Roadmap priorisée pour la suite

> Découpage en vagues, prêt pour `swarm/session-N` (spec → plan → waves → closeout). Effort indicatif en jours-homme.

### 🔴 P0 — Vague critique « avant cutover » (~5-7 j·h)
Fixes de sécurité, intégrité et filet, faible blast-radius, fort impact.
1. **Fermer les fuites T3** : `audit_log` `security_invoker=on` + REVOKE ; `REVOKE ALL ON mv_* FROM authenticated, PUBLIC` ; aligner les 2 autres vues definer. **+ test pgTAP récurrent** (C1, C2). *(S, ~0,5 j)*
2. **Réparer `schema_migrations` cloud** (repair `--status applied` pour `20260629000013→20260710000050`) (C7). *(S, ~0,5 j)*
3. **EF PDF sous PIN-JWT** : remplacer `auth.getUser()` par `getActingAuthUserId` (C5). *(S, ~0,5 j)*
4. **Job CI nightly live-RPC** avec service-role (désactive le `skipIf`) + flip `pgtap-pr` bloquant (C6). *(M, ~1 j)*
5. **Gater GL/TB + routes BO non gatées + RPC report INVOKER** (T4). *(S-M, ~1 j)*
6. **`search_path = public, pg_temp`** sur les 6 fonctions + `IN SCHEMA public` sur les 3 ALTER (T3/DB). *(S, ~0,5 j)*
7. **Index `orders(created_at DESC)`** (CONCURRENTLY). *(S, ~0,25 j)*

### 🟠 P1 — Vague intégrité « argent & stock » (~6-9 j·h)
1. **Résolution canonique du prix de ligne serveur** (`_resolve_line_price_v1`) : ferme cadeau + modifiers + surcharges combo ; **reçu/affichage consomment les valeurs serveur** (T1, C8, C9). *(L)*
2. **Settlement B2B par facture** (`b2b_payment_allocations` + `paid_at`) + **source unique dérivée du ledger** + `cancel_b2b_order_v1` + re-check plafond post-lock (T5, C3, C4). *(L)*
3. **Correctness comptable** : TB cumulative as-of + dédup PB1 void+refund + garde fiscale fail-closed (T6, C10). *(M)*
4. **Unifier la déduction stock** flag-aware via `record_stock_movement_v1` (combo/modifier/B2B) (T2). *(M)*
5. **Durcissement EF restant** : rate-limit `auth-change-pin`, idempotency void/cancel, discount-PIN via `verify-manager-pin`, secret dispatch en header (T7). *(M)*

### 🟡 P2 — Vague gouvernance & UX (~5-7 j·h)
1. Plafonds d'usage de promotion + validation serveur des groupes de combo (T1/catalogue). *(M)*
2. Clôture annuelle (carry-forward → 3200) + consolidation audit 1 table + permissions B2B dédiées (SOD) (T5/T6). *(L)*
3. États d'erreur POS (grilles + KDS), cibles tactiles caisse, message `payment_complete` affichage client. *(M)*
4. Empty-states BO/reports + URL-state généralisé + parité sidebar/hub. *(S-M)*
5. Lint-ratchet (diff PR) + gate de dérive `types.generated.ts` + correction scripts `db:*` + refactor fichiers > 500 lignes. *(M)*
6. Rapport de **marge brute réelle par produit** + fuseau uniforme Payment-by-Method (T?/reports). *(M)*

### 🟢 P3 — Spec dédiée & stratégique
1. **FIFO / lots / péremption** (T8) — **spec dédiée requise avant code** (décrément lots + `production_in` crée un lot + `unit_cost` réel + réconciliation `section_stock`). *(XL)*
2. Décider `allow_negative_stock` par défaut (passer à `false` ? politique par produit ?). *(décision)*
3. Cron d'alerte stock bas + notification ; due_date/terms dans l'aging ; kiosque self-order (si besoin métier). *(M-L)*

---

## 8. Propositions de mises à jour skills / agents (optionnel, demandé)

L'audit fait émerger des **patterns récurrents** qu'il faut encoder dans les skills pour qu'ils soient détectés à la source lors des prochains développements :

| Skill / agent | Mise à jour proposée |
|---|---|
| **`security-fraud-guard`** | Ajouter un **check exécutable** « aucune VUE `SECURITY DEFINER` ni MATERIALIZED VIEW n'est `SELECT`-able par `authenticated`/`anon` sans gate explicite » (couvre `relkind='m'` + vues de compat, angle mort du sweep S20). Ajouter un check **price-integrity** (cadeau/modifier/combo/reçu = valeurs serveur). |
| **`stock-management`** | Encoder le pattern **« tout chemin de déduction (vente, combo, modifier, B2B) doit être flag-aware #122 ET passer par `record_stock_movement_v1` »** ; marquer FIFO/lots comme dette ouverte avec « spec dédiée avant code ». |
| **`accounting`** | Encoder : TB **cumulative as-of**, **dédup void+refund** sur tout rapport fiscal (pas seulement P&L/BS), garde fiscale **fail-closed**, clôture annuelle → 3200. |
| **`reports-exports` / `report-audit`** | Check **fuseau uniforme** (`business_config.timezone` partout, jamais UTC) + **gating RPC report** (DEFINER + `has_permission`). |
| **`pos-flow-audit` / `pos-specialist`** | Check « reçu/affichage client **consomment les valeurs serveur** (total, tax, tenders), jamais de recalcul client » + « taux de taxe jamais hardcodé client ». |
| **`db-engineer`** | Connaissance persistante : `schema_migrations` cloud endommagé (à réparer) + `search_path = public, pg_temp` **systématique** + `ALTER DEFAULT PRIVILEGES … IN SCHEMA public`. |
| **`test-engineer`** | Savoir que les **62 live-RPC ne tournent pas en CI** (à activer en nightly) — ne pas confondre « skippé » avec « vert ». |
| **`backoffice-specialist`** | Règle « sidebar entry **AND** route gate ensemble » + bannir les casts `as PermissionCode` (désactivent le typage). |

**Mémoire projet à mettre à jour** :
- `security-gaps-2026-05-31.md` → **marquer les 7 failles comme RÉSOLUES** (vérifié live 2026-06-27) pour ne plus induire en erreur.
- **Nouvelle mémoire** : « Fuites par objets dérivés non-RLS (vue `audit_log` DEFINER + MV financières lisibles par `authenticated`) — sweep S20 ne couvre ni `authenticated` ni `relkind='m'` ».

> **Nouvel agent/skill ?** Pas nécessaire — la couverture est bonne. La valeur est dans l'**enrichissement des checks exécutables** des skills existants (surtout `security-fraud-guard`, `stock-management`, `accounting`), pas dans de nouveaux agents.

---

## 9. Méthodologie & annexes

- **12 auditeurs** (`pos-specialist`, `backoffice-specialist`, `db-engineer`, `edge-functions-engineer`, `security-auditor`, `general-purpose` + skills `pos-flow-audit`/`pos-frontend-design-audit`/`stock-management`/`accounting`/`orders`/`b2b-credit`/`products-catalog`/`reports-exports`/`security-fraud-guard`).
- **1 106 174 tokens** subagents, **353 appels d'outils**, vérifications SQL live sur `ikcyvlovptebroadgtvd`, ~10 min wall-clock.
- Sortie structurée par module : `etat_actuel`, `score_maturite`, `manques`, `corrections`, `oublis`, `ameliorations`, `risques`.
- Baseline : [`2026-05-20-audit-integral-V3/`](2026-05-20-audit-integral-V3/00-EXECUTIVE-SUMMARY.md).

**Verdict final** : 🟢 **socle production-ready**, conditionné à la **vague P0 (~5-7 j·h)** pour fermer les fuites RBAC/intégrité + activer le filet CI, puis **P1 (~6-9 j·h)** pour la cohérence argent/stock/B2B. La dette est **ciblée et bien localisée**, pas structurelle.

---

*Audit intégral par module terminé — 2026-06-27.*
