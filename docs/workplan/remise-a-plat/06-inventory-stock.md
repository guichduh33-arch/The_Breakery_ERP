# Module 06 — Stock & inventaire

> ⚠️ **Mise à jour S61 (2026-07-05, `swarm/session-61`)** : **D3.1 livré** — décommissionnement léger péremption exécuté : cron `mark_expired_lots_hourly` désactivé (`_109`, réversible), pages `/inventory/expiring` + rapport perishable-turnover purgés du BO (routes, sidebar, tuile, badge, hooks, panneaux dashboards), `stock_lots` + RPCs conservés **dormants** (aucun DROP). Également **F-2 soldé** : les gardes d'insuffisance de `_record_sale_stock_v1` lèvent P0002 (contrat `insufficient_stock`) et la garde vitrine est inconditionnelle (`_107`). Voir `docs/workplan/plans/2026-07-05-session-61-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 6. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel
> **Verdict global de l'analyse :** La doc est fidèle et même **sous-estime** le code : toutes les revendications « aujourd'hui » sont réelles et câblées, et une infrastructure complète de lots avec dates de péremption + cron horaire + page « Expiring stock » existe déjà alors que la doc la déclare inexistante. Seule nuance : l'alerte visuelle à deux niveaux (orange/rouge) n'existe telle quelle que côté POS vitrine, pas au back-office.

## A. Ce qui fonctionne réellement (code vérifié)

- **Consultation stock + alertes** [UI câblée] : page `/backoffice/inventory` gatée `inventory.read` (`apps/backoffice/src/routes/index.tsx:226-233`), `useStockLevels` + `LowStockBadge` (badge unique « Low stock », rendu si `current_stock < min_stock_threshold`, `apps/backoffice/src/features/inventory/components/LowStockBadge.tsx:14-21`). Seuil **par produit** `products.min_stock_threshold` (migration `20260516000005`), éditable dans `apps/backoffice/src/features/products/components/GeneralPanel.tsx`.
- **Page Alertes** [UI câblée] : `/inventory/alerts` (`routes/index.tsx:355-362`) — `LowStockTab` → RPC `get_low_stock_v1` (`20260517000094`), `ReorderTab` → `get_reorder_suggestions_v1` (`20260517000095`, vélocité de vente + jours de stock), `ProductionAlertsTab`, badge compteur dans la sidebar (`layouts/Sidebar.tsx:40`).
- **Arrivage sans commande formelle** [UI câblée] : `/inventory/incoming` gaté `inventory.receive` (`routes/index.tsx:242-249`), `IncomingStockForm` → RPC `record_incoming_stock_v1` (`20260516000021`) ; en plus, `DirectPurchaseForm` (achat dépannage) chaîne create→receive→pay PO (`features/inventory/hooks/useRecordDirectPurchase.ts:93-134`).
- **Transferts inter-zones avec confirmation** [UI câblée] : ils existent réellement. RPCs `create_internal_transfer_v1` (statut `pending`, ou `received` direct via `p_send_directly`) et `receive_internal_transfer_v1` (confirmation à la réception, garde `receive_not_allowed_in_status`) dans `20260516000023:182-546` ; annulation `useCancelTransfer` ; pages `/inventory/transfers[/new|/:id]` (`routes/index.tsx:258-281`). Stock par zone : table `section_stock` (`20260516000017`) + page Sections (`/inventory/sections`).
- **Pertes avec raison** [UI câblée] : `waste_stock_v1` (`20260516000009`), `WasteModal` avec presets `Expired / Damaged / Spoiled / Other` + texte libre (`features/inventory/components/WasteModal.tsx:26`).
- **Production** [UI câblée] : voir fiche module 15 — `record_production_v1` déduit les ingrédients (conversions d'unités `_resolve_recipe_consumption_v1`, `20260710000022`) et crédite les produits finis.
- **Inventaire physique (opname) par zone** [UI câblée] : cycle complet `create_opname_v1` (section obligatoire, `20260517000091:64-71`) → `add_opname_item_v1` → `set_opname_count_v1` → `validate_opname_v1` → `finalize_opname_v1` (émet les mouvements d'ajustement correctifs, gate `inventory.opname.finalize`) → `cancel_opname_v1` ; pages `/inventory/opname[/:id]` (`routes/index.tsx:323-338`).
- **Historique infalsifiable** [UI câblée] : `stock_movements` append-only (RLS `20260516000003`, REVOKE renforcé `20260626000016`), page `/inventory/movements` → `get_stock_movement_ledger_v1` (`20260703000010`) + rapport `/reports/stock-movements`.
- **Écritures comptables automatiques** : trigger `tr_stock_movement_je` (`20260517000022/23`) couvre `waste`, `adjustment_in/out`, `transfer`, `production_in/out` ; trigger JE achat à la réception (`20260517000113`, redesign `20260701000015`).
- **Vitrine POS** [UI câblée] : `POSStockView` route `/pos/stock` (`apps/pos/src/routes/index.tsx:64`) — réception fournée `add_display_stock_v1` (`20260530185222`) via `usePOSReceiveStock`, perte/ajustement vitrine (`waste_display_stock_v1`, `adjust_display_stock_v1`), **retour en cuisine** `return_display_to_kitchen_v1` (`20260530185330`) ; cartes avec 2 niveaux visuels : ambre « Low stock » / rouge « OUT OF STOCK » (`apps/pos/src/features/stock/components/POSStockCard.tsx:12-13,55-60`).
- **Déduction vente unifiée** : `_record_sale_stock_v1` (`20260710000073`, SECURITY DEFINER interne) — garde de suffisance flag-aware (`business_config.allow_negative_stock`), isolation `display_stock`/`display_movements`, appelée par les 3 RPCs de vente.
- **Flag stock négatif** [UI câblée] : toggle dans `SettingsInventoryPage` qui écrit `business_config.allow_negative_stock` via `set_setting_v1` (`apps/backoffice/src/pages/settings/SettingsInventoryPage.tsx:4,26`).
- **WAC** : `unit_cost` par unité de base (conversion à la réception, `20260706000012`) + trigger de recalcul `products.cost_price` à l'achat (`20260521000013`).
- **EN PLUS de la doc — lots avec péremption (infra complète)** : table `stock_lots` avec `expires_at NOT NULL` et statuts `active/expired/consumed` (`20260517000040`), `create_stock_lot_v1` (expiry dérivée de `products.default_shelf_life_hours`) + helper FIFO `_resolve_fifo_lot` (`20260517000043`), **cron horaire** `mark_expired_lots_hourly` (`20260517000045`), consommation FIFO des lots sur `waste`/`transfer_out`/`production_out` dans `record_stock_movement_v1` (`20260710000021:104-121`), lots créés automatiquement à la réception PO (`20260701000011:187`) et à la production (`20260710000024:311-318`), page **`/inventory/expiring`** câblée (`routes/index.tsx:250-257`, sidebar « Expiring stock ») + rapport perishable-turnover. **Limite réelle : le chemin de VENTE ne consomme pas les lots** (`_record_sale_stock_v1` insère sans `lot_id`).

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Consulter tous les produits avec niveau de stock et alertes visuelles (faible orange, critique rouge).
- B1.2 Enregistrer une marchandise qui arrive sans commande formelle.
- B1.3 Déplacer du stock entre zones avec confirmation à la réception.
- B1.4 Déclarer une perte avec raison (périmé, brûlé, cassé, offert).
- B1.5 Enregistrer une production (déduction ingrédients selon recette, ajout produits finis).
- B1.6 Inventaire physique par zone + correction des écarts.
- B1.7 Historique complet et infalsifiable des mouvements.
- B1.8 Lot en note libre sur chaque production ; péremption gérée par déclaration de perte (pas de suivi automatique des dates).
- B1.9 POS : stock en direct pendant le service ; barista valide l'arrivée d'une fournée en vitrine.

### B2. Annoncé « À venir »
- B2.1 Lots avec dates de péremption + consommation FIFO stricte (étude dédiée avant développement).
- B2.2 Alertes automatiques de stock bas sans ouvrir l'écran.
- B2.3 Décision officielle sur la vente à stock zéro.
- B2.4 Écran d'enquête « stock fantôme ».
- B2.5 Seuils d'alerte réglables produit par produit.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Niveaux + alertes orange (faible) / rouge (critique) | Page Inventory + `min_stock_threshold` par produit + page Alertes OK ; mais au BO le badge est **mono-niveau** (`LowStockBadge` destructive unique) ; le duo ambre/rouge n'existe que sur les cartes POS vitrine (`POSStockCard.tsx:12-13`) | 🟠 PARTIEL |
| B1.2 | Arrivage sans commande | `record_incoming_stock_v1` + page `/inventory/incoming` + Direct Purchase | ✅ CONFORME |
| B1.3 | Transferts inter-zones avec confirmation | `create_internal_transfer_v1`/`receive_internal_transfer_v1` (pending→received) + 3 pages câblées + `section_stock` | ✅ CONFORME |
| B1.4 | Perte avec raison (périmé, brûlé, cassé, offert) | `waste_stock_v1` + presets `Expired/Damaged/Spoiled/Other` (libellés ≠ doc, « offert » via Other libre) | ✅ CONFORME |
| B1.5 | Production déduit/ajoute automatiquement | `record_production_v1` + conversions + JE trigger | ✅ CONFORME |
| B1.6 | Opname par zone + corrections | 6 RPCs opname (section obligatoire), finalize émet les ajustements | ✅ CONFORME |
| B1.7 | Historique infalsifiable | ledger append-only (RLS) + `get_stock_movement_ledger_v1` + page | ✅ CONFORME |
| B1.8 | Lot = note ; pas de suivi auto de péremption | **La doc sous-estime** : vrais lots `stock_lots` avec `expires_at`, cron horaire d'expiration, page Expiring stock, FIFO sur waste/transfert/production. Manque uniquement la consommation FIFO **à la vente** | ✅ CONFORME (sous-revendiqué — voir Bonus et D4) |
| B1.9 | Stock vitrine en direct + réception fournée POS | `POSStockView` + `add_display_stock_v1` + retour cuisine | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :**
- 🔵 Infrastructure lots/péremption complète hors chemin de vente (table + cron + FIFO partiel + page `/inventory/expiring` + rapport perishable-turnover) — la doc la déclare inexistante. **Décision propriétaire 2026-07-04 : cette infrastructure ne sera PAS utilisée** (pas de dates de péremption, pas de FIFO stock) — à décommissionner légèrement, cf. D3.1.
- 🔵 Seuils d'alerte **déjà** réglables produit par produit (`min_stock_threshold`, annoncé « à venir » en B2.5).
- 🔵 Toggle `allow_negative_stock` déjà exposé dans Settings (B2.3 n'attend plus que la décision métier, pas le développement).
- 🔵 Suggestions de réappro par vélocité (`get_reorder_suggestions_v1` + ReorderTab).
- 🔵 Retour vitrine → cuisine (`return_display_to_kitchen_v1`).
- 🔵 Dashboard produit (`/products/:id/dashboard`, stock par section, vélocité) + page Sections.
- 🔵 Rapports stock : variance, wastage, mouvement history, perishable turnover.
- 🔵 Idempotence (`p_idempotency_key`) sur toutes les mutations stock.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Alerte deux niveaux au BO** : ajouter un seuil « critique » (ex. `< 50 %` du seuil ou stock ≤ 0) dans `LowStockBadge.tsx` + `StockLevelRow.tsx` (variant warning vs destructive). Done : badge orange sous seuil, rouge critique, testé dans `features/inventory/__tests__/`.
2. **Preset « Offert/Gift »** dans `WasteModal.tsx:26` (alignement doc + meilleure analytique de gâche). Done : preset présent + valeur `reason` distincte dans le ledger.
3. **Doc** : voir D4 (le plus gros écart de ce module est documentaire, pas code).

### D2. Chantiers moyens (1 session, plan requis)
1. **Alertes stock bas automatiques (B2.2)** : job pg_cron quotidien réutilisant `get_low_stock_v1` + EF `notification-dispatch` existante (même pattern que `mark_expired_lots_hourly` / `recompute_margins`). Fichiers : nouvelle migration + config destinataires dans `business_config`.
2. **Écran « stock fantôme » (B2.4)** : le rapport stock-variance (`/reports/stock-variance`) existe déjà — l'étendre en écran d'enquête (drill-down mouvements vs ventes vs opname par produit).

### D3. Chantiers lourds (spec dédiée avant code)
1. ~~FIFO/lots à la vente~~ — **ABANDONNÉ (décision propriétaire 2026-07-04 : pas de péremption/expiration ni de FIFO stock ; le suivi en quantité globale est le modèle retenu).** À la place, **décommissionnement léger** (chantier moyen, à placer en Vague 2) : désactiver le cron `mark_expired_lots_hourly`, retirer la page `/inventory/expiring` et le rapport perishable-turnover de la navigation, conserver `stock_lots` dormante en base (pas de DROP — historique et rollback possibles). Le snapshot COGS (module 15 D3.1) est **découplé** de ce sujet : il se basera sur le WAC au moment de la vente.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
1. B1.8 : affirmer le modèle **retenu** (décision 2026-07-04) — suivi en quantité globale par produit, péremption gérée par déclaration de perte — comme fonctionnement assumé, pas comme limite temporaire ; **retirer B2.1 (lots/FEFO) des « À venir »** et l'entrée FEFO du glossaire.
2. B2.5 : retirer « seuils réglables produit par produit » des « à venir » (déjà livré).
3. B2.3 : préciser que le réglage technique existe (toggle Settings) et qu'il ne reste que la décision d'exploitation.
4. B1.1 : soit corriger la doc (« alerte visuelle sous le seuil »), soit garder la promesse deux-niveaux et faire D1.1.

## E. Dépendances croisées
- **Module 7 (Achats)** : la réception PO crée lots + mouvements + WAC — tout changement lots/WAC se répercute ici.
- **Module 15 (Production)** : production = producteur de lots et consommateur de matières ; le chantier D3.1 doit être co-spécifié avec le « coût figé à la vente » du module 15.
- **Modules 2/3 (Caisse/Encaissement)** : `_record_sale_stock_v1` est appelé par la money-path (`complete_order_with_payment_v17`, `pay_existing_order_v11`, `create_b2b_order_v3`) — D3.1 touche la money-path.
- **Module 10 (Comptabilité)** : triggers JE sur mouvements ; toute nouvelle famille de mouvement doit être mappée.
- **Module 14 (Rapports)** : stock variance / wastage / perishable turnover consomment ce ledger.
