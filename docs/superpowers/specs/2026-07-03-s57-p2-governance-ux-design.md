# S57 — P2 restant : gouvernance promos/combos, UX POS/BO, outillage, marge brute (design)

- **Date** : 2026-07-03 · **Branche** : `swarm/session-57`
- **Source** : audit intégral [`2026-06-27-audit-integral-par-module.md`](../../workplan/audits/2026-06-27-audit-integral-par-module.md) §7 — lots **P2.1, P2.3, P2.4, P2.5, P2.6** (P2.2 soldé S56).
- **Triage** : 5 agents lecture-seule (2026-07-03) ont confronté audit + backlog + code réel ; leurs constats sont repris ci-dessous comme base factuelle.

## Objectif

Solder la vague P2 de l'audit en une session : fermer les deux failles serveur combo/promo (revenue leak + composition non validée + plafonds absents), livrer les correctifs UX POS et BO, réparer l'outillage (lint-ratchet, scripts `db:*`), et ajouter le rapport de marge brute par produit + le fix fuseau Payment-by-Method.

## Chantier A — P2.1 : plafonds promo + validation serveur combo (DB)

### Constats (triage)
- `_resolve_line_price_v1` (S51) ne lit **jamais** `combo_group_options.surcharge` → v16 facture `combo_base_price + product_modifiers` : les surcharges d'options combo choisies par le client sont affichées au client (prix client `configuredPrice`) mais **non facturées serveur** (revenue leak).
- v16 accepte n'importe quels `combo_components` fournis par le client (existence produit + stock seulement) : ni appartenance aux `combo_group_options`, ni min/max/required de `combo_groups`.
- Aucun plafond d'usage promo : pas de colonnes, `evaluate_promotions_v1` illimité. Source de comptage disponible : table append-only `promotion_applications` (1 ligne par (order, promo)).

### Décisions
| ID | Décision | Rationale |
|---|---|---|
| A-D1 | **Facturer réellement les surcharges combo** côté serveur | Le prix affiché au client inclut déjà la surcharge (calcul domain `configuredPrice`) ; le serveur sous-facturait — c'est un bug fix, pas un changement de prix. |
| A-D2 | Nouveau helper interne **`_resolve_combo_price_v1(p_combo_product_id uuid, p_components jsonb) → (price numeric)`** SECURITY DEFINER STABLE, `REVOKE PUBLIC+anon+authenticated` (pattern `_resolve_line_price_v1`), qui **valide ET price** en un seul passage : appartenance de chaque composant à un `combo_group_options` du combo, min_select/max_select/is_required par groupe, retour `combo_base_price + Σ surcharge`. Violations → `RAISE EXCEPTION` codes `combo_invalid_component` / `combo_group_violation`. | Mutualise A (pricing) et B (validation) ; une seule source de vérité. |
| A-D3 | **`complete_order_with_payment_v16 → v17`** (DROP v16 même migration, ⚠️ **GRANT EXECUTE TO authenticated** — caveat S51/S55) : lignes combo passent par `_resolve_combo_price_v1`. EF `process-payment` repointée v17 et redéployée. | Versioning monotone, convention projet. |
| A-D4 | Plafonds : colonnes **`promotions.max_uses INT NULL`** et **`promotions.max_uses_per_customer INT NULL`** (NULL = illimité). Pas de compteur dénormalisé : comptage sur `promotion_applications` JOIN `orders` **non-voided**. | Append-only déjà en place ; un void libère l'usage naturellement. |
| A-D5 | Enforcement **double** : advisory dans **`evaluate_promotions_v1 → v2`** (DROP v1, mêmes callers) + **gate dur atomique dans v17** au moment de l'INSERT `promotion_applications` : `pg_advisory_xact_lock(hashtext(promotion_id::text))` puis re-count → `RAISE` `promo_cap_exceeded` si dépassé. | evaluate est advisory (POS l'appelle en amont) ; seule la money-path peut garantir l'atomicité. |
| A-D6 | Cap per-customer : commande **sans `customer_id` → cap per-customer non applicable** (le global s'applique toujours). | Impossible d'attribuer un usage anonyme ; refuser la promo aux walk-ins serait pire que le risque. |
| A-D7 | Comptage sur commandes **non-voided uniquement** (tous statuts payés/complétés) ; refunds partiels n'affectent pas le compte. | Simple, cohérent avec la sémantique append-only de `promotion_applications`. |
| A-D8 | `pay_existing_order_v11` / `create_b2b_order_v3` : le dev **vérifie** s'ils acceptent des `combo_components` ; si oui, même helper (bump v12/v4), sinon note explicite dans l'INDEX. | Le triage n'a pas tranché ; à vérifier sur pièces. |
| A-D9 | UI BO : champs `max_uses` / `max_uses_per_customer` dans le form promotions (fusionné avec le refactor E-D4 de `PromotionForm.tsx` — même fichier, même agent). | Éviter deux agents sur le même fichier. |
| A-D10 | Le moteur domain offline (`bogoEngine.ts`) reste **sans connaissance des plafonds** (il n'a pas accès aux compteurs) ; la référence est `evaluate_promotions_v2` serveur. Documenté en commentaire. | IO-free domain ; parité impossible sans données. |

## Chantier B — P2.6 : marge brute par produit + fuseau Payment-by-Method (DB + BO)

### Constats (triage)
- Aucun RPC prix vendu − coût par produit (Cost Analytics #117 = dépenses agrégées). Aucun snapshot de coût à la vente (`order_items` sans colonne coût ; `_record_sale_stock_v1` n'écrit pas `unit_cost`).
- `get_payments_by_method_v1` bucketé **UTC en dur** (`T00:00:00Z` + `DATE(paid_at)`) ; pattern canonique = `business_config.timezone` (cf. `get_daily_sales_v1`).

### Décisions
| ID | Décision | Rationale |
|---|---|---|
| B-D1 | **`get_gross_margin_by_product_v1(p_start_date text, p_end_date text, p_category_id uuid DEFAULT NULL)`** — SECURITY DEFINER, `search_path` épinglé, clamp 366 j, gate **`reports.financial.read`**, REVOKE PUBLIC+anon, GRANT authenticated. Retour JSONB `{summary, by_product[], by_category[]}` (revenue, cogs, margin, margin_pct, qty). | Marge = donnée financière ; pattern reports S29-S33. |
| B-D2 | **Coût = `products.cost_price` courant (WAC)**, caveat « approximation WAC courante » documenté dans le COMMENT du RPC et l'UI. Snapshot COGS-à-la-vente → **backlog P3** (chantier schéma séparé). | Effort maîtrisé ; l'exactitude historique exige une colonne + write money-path (hors P2). |
| B-D3 | Périmètre : **POS + B2B** (statuts `paid`/`completed`, `voided_at IS NULL`), bornes en `business_config.timezone`. Revenu **HT (net PB1)** — cohérent NON-PKP (PB1 = taxe de sortie). Refunds partiels : non déduits du by_product (pas de granularité produit), caveat UI. | « Marge réelle globale » ; alignement modèle compta. |
| B-D4 | **`get_payments_by_method_v1 → v2`** (DROP v1 même migration) : bornes + buckets via `business_config.timezone` (défaut `Asia/Makassar`). Hook BO `usePaymentsByMethod` repointé. | Signature identique mais sémantique changée → bump, convention projet. |
| B-D5 | BO : page **Gross Margin** (pattern `ReportPage`), hook `useGrossMargin`, carte hub Reports, `ExportButtons` (CSV `buildCsv` ; PDF backlog si template manquant), drill-down ligne produit → détail produit. | Parcours reports standard. |

## Chantier C — P2.3 : UX POS (frontend pur, zéro DB)

### Décisions
| ID | Décision | Rationale |
|---|---|---|
| C-D1 | Composant partagé **`PosLoadError`** (ton erreur + CTA « Retry » → `refetch`) branché sur `isError` **avant** l'empty-state dans `ProductGrid`, `TabletProductGrid`, `KdsBoard` ; hooks `useProducts`/`useKdsOrders` exposent `isError`/`refetch`. Distinction visuelle nette : erreur = rouge + retry ; vide = neutre. | Risque opérationnel réel : une erreur KDS affiche aujourd'hui « No active tickets ». |
| C-D2 | **`useReconnectInvalidate`** (KDS) : invalidation de la query au retour online/reconnexion realtime. | TASK-04-006 ; état stale silencieux après coupure LAN. |
| C-D3 | Cibles tactiles caisse : remove/discount `h-8 w-8 → h-11 w-11` (44 px), recherche `h-9 → h-11`. `QuantityStepper` mesuré ; si < 44 px, **correction dans `packages/ui`** (profite au BO) avec vérif visuelle BO. | Minimum tactile 44 px ; tablette déjà 48 px. |
| C-D4 | Broadcast display : nouveau type **`payment_complete`** `{total, change, method}` émis au succès checkout ; `CDActiveCartView` affiche « Merci — monnaie à rendre Rp X » ~8 s puis welcome ; monnaie masquée si méthode ≠ cash (miroir `SuccessModal`). | Protocole actuel ne connaît que `cart_update` ; l'écran client retombe sur welcome sans confirmation. |
| C-D5 | POS : mapping copy des nouveaux codes d'erreur serveur v17 (`combo_group_violation`, `combo_invalid_component`, `promo_cap_exceeded`) dans le flux checkout. | Les erreurs A-D2/A-D5 doivent être lisibles caisse. |

## Chantier D — P2.4 : UX BO (frontend pur)

### Décisions
| ID | Décision | Rationale |
|---|---|---|
| D-D1 | Empty-states : prop **`emptyState` sur le wrapper `ReportPage`** (1 point unique) + passage des ~30 pages `pages/reports/*` (suppression des `<td>` muets). Dashboard/listes hors reports : backlog. | 1 édition + N appels au lieu de 30 divergentes. |
| D-D2 | Parité sidebar↔hub : + 4 reports en sidebar (`production-yield`, `margin-watch`, `cost-spend`, `operating-expenses`), + section **Marketing** au hub (gates `reports.read`, comme la sidebar), + entrée **Security** en sidebar groupe Settings (gate `settings.security.manage`). Tests sidebar/hub mis à jour. | Trous de découvrabilité, routes déjà gatées. |
| D-D3 | **`useUrlState`** hook partagé (`apps/backoffice/src/hooks/useUrlState.ts`) : sérialisation dates ISO + onglet actif ; conversion **pages reports uniquement** en S57 (orders/expenses/b2b → backlog). | Borner le périmètre ; le hook est l'actif durable. |
| D-D4 | **Micro-fix sécurité adjacent** : `PermissionGate` sur la route index `accounting` (`routes/index.tsx:522`, finding §6.3 L143 non soldé) — gate `accounting.read` aligné sur les enfants. Flagué en déviation. | 1 ligne, finding sécurité connu ; le laisser serait pire. |

## Chantier E — P2.5 : outillage

### Décisions
| ID | Décision | Rationale |
|---|---|---|
| E-D1 | `db:types` → `supabase gen types --db-url` pooler (pattern `pgtap-nightly.yml:137`) ; `db:start/stop/reset` → **stubs** `echo "Docker retiré 2026-05-14 — cf CLAUDE.md (DB = cloud V3)" && exit 1`. | Quick-win ; stub > suppression (message explicite). |
| E-D2 | **Lint-ratchet diff-PR** : step CI bash maison (`eslint` sur les fichiers `.ts/.tsx` modifiés du diff PR), **bloquant** ; le step lint full-repo reste non-bloquant (dette 110 disable + 88 any figée, résorption = chantier séparé). | Fige le niveau sans rouge perpétuel ; pas de dép tierce. |
| E-D3 | Règle `max-lines` 500 en **`warn`** dans `eslint.config.mjs` (visibilité du garde-fou CLAUDE.md, sans bloquer). | Les 5 fichiers > 500 existants passeraient le ratchet en warn. |
| E-D4 | Refactor > 500 lignes : **`PromotionForm.tsx` (804, packages/ui — fusionné avec A-D9)** et **`CustomerDetailPage.tsx` (590, BO)** seulement. `routes/index.tsx` (962), `cartStore.ts` (527), `PurchaseOrderDetailPage.tsx` (572) → backlog avec note (blast-radius routing/money-path). | Sélection à faible risque ; droppable si la session déborde. |

## Migrations (NAME-block réservés)

| # | Contenu |
|---|---|
| `20260710000089` | `promotions.max_uses` + `max_uses_per_customer` |
| `20260710000090` | `_resolve_combo_price_v1` + REVOKEs |
| `20260710000091` | `evaluate_promotions_v2` (DROP v1) |
| `20260710000092` | `complete_order_with_payment_v17` (DROP v16, GRANT authenticated, gate dur caps + combo) |
| `20260710000093` | `get_gross_margin_by_product_v1` |
| `20260710000094` | `get_payments_by_method_v2` (DROP v1) |
| `_095+` | réserve fixes |

Types regénérés **une fois** après la vague DB (contrôleur).

## Tests

- **pgTAP nouvelles suites** : `combo_server_pricing` (surcharge facturée, composant hors-groupe rejeté, min/max/required), `promotion_usage_caps` (global, per-customer, anonyme, void libère, race advisory-lock), `gross_margin_by_product` (calcul, bornes tz, gate), fuseau `payments_by_method_v2`.
- **Ancres re-passées** : money-path (`sale_flag_aware`, `combo_sale`, `combo_fire_pay`, `modifier_ingredient_deduction`, `sale_stock_unification`, `reversal_idempotency`, `discount_auth_nonce`), `security` 20/20.
- **App** : typecheck + build ; smokes POS (PosLoadError ×3, payment_complete) ; smokes BO (ReportPage emptyState, Sidebar/hub parité, useUrlState, GrossMarginPage) ; unit `PromotionForm` caps.

## Non-goals (backlog explicite)

Snapshot COGS-à-la-vente (P3) ; résorption dette lint (110/88) ; refactor `routes/index.tsx`/`cartStore.ts`/`PurchaseOrderDetailPage.tsx` ; URL-state hors reports ; Skeleton loading BO (22-003) ; PDF template gross-margin si absent ; `aria-live` POS.
