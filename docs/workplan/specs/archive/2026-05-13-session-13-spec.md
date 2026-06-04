# The Breakery — Session 13 Spec : Foundation Hardening + Module-Wide Backlog Burn-Down

> **Date** : 2026-05-13
> **Auteur** : planner (Claude, supervised by guichduh33@gmail.com)
> **Statut** : Approuvé pour décomposition en sous-phases (`superpowers:executing-plans` / `superpowers:subagent-driven-development`).
> **Source d'audit upstream** : [`./2026-05-13-session-13-architecture-audit.md`](./2026-05-13-session-13-architecture-audit.md) (architect-auditor, 560 lignes).
> **Source docs cascade upstream** : [`./2026-05-13-session-13-docs-cascade-spec.md`](./2026-05-13-session-13-docs-cascade-spec.md) (commit `1f88e33` — +108 tâches objectif).
> **Reference shape** : [`./2026-05-12-session-12-inventory-complete-spec.md`](./2026-05-12-session-12-inventory-complete-spec.md).
> **Backlogs opérationnels** : `docs/workplan/backlog-by-module/01-…25-…md` (25 modules, ≈ 280 tâches dont les +108 cascade).
> **Plan d'exécution** : [`../plans/2026-05-13-session-13-INDEX.md`](../../plans/archive/2026-05-13-session-13-INDEX.md).
> **Migration block réservé** : `20260517000001..20260517999999` (continu sur le suffixe ; le dernier appliqué est `20260516000024`).

---

## 0. Contexte global

Le repo The_Breakery_ERP est un monorepo V3 (`apps/{pos,backoffice}`, `packages/{domain,supabase,ui,utils}`, `supabase/{functions,migrations,tests}`). Les 25 backlogs et l'audit ont mis en évidence trois faits structurants pour la Session 13 :

1. **Les backlogs sont V2-rédigés** (chemins `src/services/*`, `src/components/*`) — un mapping V2→V3 canonique manque et chaque sous-agent ré-inventerait le sien.
2. **L'accounting V3 est embryonnaire** : 3 comptes seedés (1110/4100/2110), 1 trigger sale hardcodé, **aucune** `accounting_mappings`, **aucune** `fiscal_periods`, **aucune** `resolve_mapping_account()`. Les "P0 hotfix" du backlog 10 (rédigés contre V2 régressé) deviennent en V3 un **build from-scratch** de la fondation comptable, sur lequel reposent Production, Purchasing, Expenses, Cash-Register.
3. **L'inventaire est solide** : Session 12 phases 1-3 livrées (sections, units, stock_movements RPC-only, transfers). Reste F1 expiry tracking (XL P0) + opname/production/movements/alerts/JE-couplage (phases 4-8 session 12 jamais livrées).

Session 13 n'essaie **pas** de livrer les 280 tâches. Elle livre :

- **La fondation** qui débloque le reste (Phase 0 + Phase 1).
- **Les modules à forte densité P0/P1** ayant des dépendances internes propres (Phase 2-3).
- **Les surfaces UX critiques** déjà partiellement câblées (Phase 4).
- **Les services transversaux** (LAN, notifications, settings, RBAC UI) (Phase 5).
- **L'analytics et le polish** (Phase 6).
- **Le différé Q3+** est isolé (Phase 7, ne fait pas partie de la session).

---

## 1. Goals (3-5 high-level)

| # | Goal | Mesure |
|---|---|---|
| **G1** | **Établir la fondation accounting V3** : mapping table, COA SAK EMKM complet, `resolve_mapping_account()`, `fiscal_periods` + guard, `reference_type` CHECK étendu, sale/purchase/refund JE refactorés sur mapping. | Phase 1 verte ; `complete_order_with_payment_v9` published ; 16 `reference_type` types acceptés ; 0 trigger hardcode `1110/4100/2110` ; tous JE équilibrés via mapping resolution. |
| **G2** | **Sécuriser la surface PII et l'auth** : RLS `anon → authenticated` sur orders/order_items/customers/customer_categories/user_roles ; rate-limit Edge Functions partagé ; drop fallback PIN client ; erreur EF redacted ; CSP/HSTS Vercel. | Pen-test green sur 5 surfaces ; `25-001..006` shipped ; staging déployé d'abord ; KDS/Display/Tablet en mode kiosk-JWT fonctionnent. |
| **G3** | **Compléter l'inventaire et la production** : F1 expiry tracking (`stock_lots` + FIFO trigger via `record_stock_movement_v1`) ; phases 4-8 Session 12 (Production+Recipes, Opname, Movements ledger view, Alerts+Dashboard, JE coupling). | F1 actif sur ≥ 5 produits bakery ; 1 production_record consommant 4 ingrédients → JE COGS posté ; 1 opname session finalisée → variance JE ; AlertsBadge live. |
| **G4** | **Ouvrir les modules tier-2** : Purchasing PO workflow complet, B2B core, Expenses, Cash-Register shift-close JE, Promotions BOGO. | 1 PO créé → reçu → JE INVENTORY/PURCHASE_PAYABLE ; 1 expense créée → approved → JE ; 1 shift fermé → JE cash variance ; 1 BOGO promo appliquée à un panier. |
| **G5** | **Outiller le delivery** : staging Supabase isolé, CI workflow sur PR (pgTAP + Vitest + typecheck + types-regen-check), Sentry POS/BO, Playwright E2E sur 3 flows critiques. | CI vert sur la PR de Phase 1 ; 1 régression types-regen attrapée par CI ; Sentry capture 1 erreur volontaire ; 3 E2E Playwright passants. |

---

## 2. Scope

### 2.1 In-scope (Session 13)

- **Phase 0** (décisions, pas de code) : V2→V3 translation table, phantom-tables decisions, F6 ownership, LAN architecture, notification provider, QRIS provider, capacitor-vs-PWA, staging confirmé, `packages/ui` steward, `has_permission()` refactor design, CI design.
- **Phase 1** (foundations) :
  - Stream A (Accounting build-from-scratch) — modules 10 ; tasks 10-001..007.
  - Stream B (Security P1) — modules 25, 01, 24 ; tasks 25-001..006 + 24-008 (staging) + 23-001/008 (CI).
  - Stream C (Inventory F1 + completion session 12) — module 06 ; tasks 06-001/002/005/006 + session-12 phases 4-8.
  - Stream D (Design tokens P1) — module 22 ; tasks 22-001/002/004/005/006-batch1/007.
- **Phase 2** (mid-layer enabling) : Reports infra (module 14 P0/P1 : 14-001/002/003/006) ; Production + Recipes (module 15) ; Promotions BOGO+segments (module 13) ; Inventory ghost-stock + opname tightening.
- **Phase 3** (mid-layer features parallèles) : Purchasing PO complet (module 07) ; B2B core (module 09 sans portal) ; Expenses (module 11).
- **Phase 4** (surface UX) : POS UX hardening (02) ; KDS extensions (04) ; Customer Display (16, build-from-scratch) ; Tablet polish (17). Gated par 21 + 22.
- **Phase 5** (infra transverse) : LAN (21, per Phase 0 architectural decision) ; Notifications pipeline (08-006) ; Settings UI + holidays/templates (19) ; RBAC UI + audit pairing (20).
- **Phase 6** (analytics + polish) : Reports cascade (14) ; Cohort + birthday (08) ; Promo ROI + segments (13) ; POS/KDS polish residuel.
- **Phase 7** (déferré Q3+, mentionné mais pas exécuté Session 13) : multi-currency (10-019), multi-tenancy (19-008), multi-entity (10-020), B2B portal (09 cascade), mobile shell (18), e-Faktur (10-014), advanced ML reports.

### 2.2 Non-goals (Session 13)

- ❌ Multi-currency / multi-entity / multi-tenancy — Phase 7.
- ❌ Mobile shell native (Capacitor) — Phase 7 ; PWA-first si décidé Phase 0.
- ❌ B2B portail client (auto-service) — Phase 7.
- ❌ e-Faktur / DJP integration — Phase 7.
- ❌ Voice ordering / advanced AI / forecasting ML — Phase 7.
- ❌ Refonte complète du `packages/ui` (au-delà de tokens + 22-006 batch 1) — étalement multi-sessions.
- ❌ Migration mass-data prod (les fixes accounting JE ne rétroaffectent pas les JE déjà créés ; documenter un retrofix séparé hors session).
- ❌ Module 18 mobile shell (au-delà de la décision Phase 0).
- ❌ Réseau VPN site-to-site / multi-LAN (21-011).
- ❌ Module 05 sub-recipes UI complet (F6 — schéma canonique posé en module 15, l'UI 05 étant lecture seule en Phase 4 ou différée Phase 7).

### 2.3 Hors-périmètre fonctionnel (différé sessions futures)

| Feature | Session prévue |
|---|---|
| Multi-currency end-to-end (orders, PO, expenses, reports) | 14 (Q3 2026) |
| Multi-tenancy infra (`tenants` table + scope guard) | 15 (Q3 2026) |
| Mobile shell (Capacitor + push) | 16 (Q4 2026) |
| B2B customer portal (self-service login, order tracking) | 17 (Q4 2026) |
| e-Faktur DJP integration | 18 (Q1 2027) |
| Voice ordering POS | 19 (Q1 2027) |
| Forecasting ML (ARIMA / lissage) | 20 (Q2 2027) |
| Advanced cohort + segmentation auto | 18 |
| LAN multi-site mesh | 17 |

---

## 3. Décisions actées (verrouillées Phase 0)

| # | Décision | Choix |
|---|---|---|
| **D1** | **V2→V3 path translation** | Une table de correspondance unique, vivante, `docs/workplan/refs/2026-05-13-v2-v3-path-translation.md`, autorée par le sous-agent `system-architect` en Phase 0 et référencée par CHAQUE plan de phase. Pattern : `src/services/X.ts → packages/domain/src/X/index.ts` (logique pure) OU `packages/supabase/src/rpc/X.ts` (IO) ; `src/hooks/X.ts → apps/{pos,backoffice}/src/features/Y/hooks/X.ts` ; `src/components/X.tsx → apps/{pos,backoffice}/src/features/Y/components/X.tsx` OU `packages/ui/src/components/X.tsx` (primitive) ; `src/pages/X.tsx → apps/{pos,backoffice}/src/pages/X.tsx`. |
| **D2** | **Phantom tables decisions** | (a) `stock_reservations` → **CREATE** (utile pour tablet + B2B) ; tâche 06-003 = create+RLS, plus 06-009 reservation_hold/release RPCs ; B2B 09-004 consomme. (b) `stock_balances` → **DROP usage** (remplacer par `section_stock` table + nouvelle vue `view_section_stock_details` à créer en Phase 2.D — agrège `section_stock × products × sections` avec valeur stock × cost_price). Vérifié : aucune vue `view_section_stock_details` n'existe en V3 (`grep -R view_section_stock_details supabase/migrations/` → 0 hit) ; doit être créée. (c) `customer_invoices` → **DROP usage** (à découpler ; B2B 09 utilise `orders.invoice_number` + `view_b2b_invoices`, vue à créer Phase 3.C). (d) `get_settings_by_category` → **CREATE** RPC (utile pour module Settings 19) ; tâche 19-001. (e) `print_queue` (21-004) → **CREATE** en Phase 5 selon décision LAN. |
| **D3** | **F6 sub-recipes ownership** | Le module 15 (Production) **détient** `recipes` (`recipes(product_id, material_id, quantity, unit, is_active)` modèle flat). Le module 05 (Products) lit en read-only via `view_product_recipes` (vue jointe). Sub-recipes récursifs (semi-finis cascade) restent **out-of-scope Session 13** (déferré Q3+). |
| **D4** | **LAN architecture** | **Hybride conservé** : Supabase Realtime comme transport principal (déjà en place sur KDS) + BroadcastChannel pour le hub local (latence < 10 ms intra-store). Le module 21 porte le hub-side V2 (`lanHub.ts`, `lanClient.ts`, `lanHubMessageHandler.ts`) vers `packages/domain/src/lan/` (logique pure) + `apps/pos/src/features/lan/` (transport). Dedup via UUID message + TTL local. **WebRTC mesh = différé Phase 7** (multi-store). |
| **D5** | **Notification provider** | **Supabase Edge Functions HTTP fanout** comme façade unique ; intégrations downstream via env vars (`SENDGRID_API_KEY`, `TWILIO_*`, `WHATSAPP_*`) côté EF. Channel layer dans `packages/domain/src/notifications/` (pure : compose Message + decide channels) ; transport dans `supabase/functions/notification-dispatch/` (HTTP-callable, signed via PIN JWT). MVP Session 13 : **email-only** (Sendgrid OU on-prem SMTP-relay via Resend). SMS/WhatsApp = Phase 5+ ou Phase 7. |
| **D6** | **QRIS provider** | **Xendit** (Indonesia, devanture API publique, sandbox dispo) pour Session 13 si module 03 touché — sinon différé. RPC EF `process-payment` reste mais l'adaptateur Xendit est ajouté en Phase 4 si capacité. Si pas de capacité Session 13 → 03-002 défère Phase 7. |
| **D7** | **Capacitor vs PWA (module 18)** | **PWA-first** (Vite PWA plugin + service-worker). Capacitor évalué Phase 7 si feature push native nécessaire. Hors-périmètre Session 13. |
| **D8** | **Staging environment** | Projet Supabase `ikcyvlovptebroadgtvd` (V3 dev sandbox, confirmé MEMORY.md) **devient le staging officiel** pour Session 13. Toutes les migrations Phase 1 testées d'abord là-bas avant prod (`abjabuniwkqpfsenxljp` reste prod V2 ; **NE PAS pousser Session 13 sur prod V2** — incompatible). Si guichduh33 confirme une nouvelle prod V3, la cible prod sera ajoutée comme variable. |
| **D9** | **`packages/ui` steward** | Désigné : **subagent unique nommé `ui-steward`** maintenu sur toute la session. Tout PR touchant `packages/ui/src/` doit être routé via `ui-steward` (sérialisation). Le batching 22-006 (72+ modals) découpé en 3 fenêtres : batch 1 (Phase 1, ~24 modals POS), batch 2 (Phase 4, ~24 modals BO), batch 3 (Phase 6, ~24 modals tablet+display). |
| **D10** | **`has_permission()` refactor** | Refactorée Phase 1 (Stream B, première migration) en **lookup pur** : `has_permission(role, perm_key) RETURNS BOOLEAN` lit `SELECT EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role=$1 AND p.key=$2 AND rp.is_granted=true)`. Plus aucune migration ultérieure ne `CREATE OR REPLACE` cette fonction ; toute nouvelle perm = `INSERT INTO permissions/role_permissions`. |
| **D11** | **`accounting_mappings` table** | V3 absente. Phase 1 (Stream A, tâche 10-A0) crée la table + seed les 24 mapping_keys initiaux (SALE_PAYMENT_*, SALE_POS_REVENUE, SALE_PB1_TAX, SALE_DISCOUNT, PURCHASE_*, INVENTORY_*, PRODUCTION_COGS, WASTE_*, ADJUSTMENT_*, etc.) + `resolve_mapping_account(p_mapping_key TEXT) RETURNS UUID` helper SECURITY DEFINER. |
| **D12** | **`fiscal_periods` table** | V3 absente. Phase 1 (Stream A, tâche 10-A0bis) crée la table avec colonnes (`id`, `period_start`, `period_end`, `status` IN draft/open/closed/locked, `closed_by`, `closed_at`, `locked_by`, `locked_at`) + RLS + helper `check_fiscal_period_open(p_date DATE) RETURNS VOID` qui RAISE `period_locked` P0004 si fermée/verrouillée. |
| **D13** | **`reference_type` CHECK** | Phase 1 (Stream A, migration `20260517000003`) `ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_reference_type_check; ADD CONSTRAINT … CHECK (reference_type IN ('sale','sale_void','sale_refund','purchase','purchase_return','purchase_payment','expense','expense_payment','shift_close','adjustment','waste','opname','production','transfer','manual','pos_outstanding','pos_outstanding_payment'))`. **17 types** (cf. audit §3.2 — 16 + `sale_refund` séparé de `sale_void`). |
| **D14** | **RPC versioning Session 13** | Bumps actés : `complete_order_with_payment_v8 → v9` (Phase 1, après refactor sale JE via mapping) ; `pay_existing_order_v5 → v6` (Phase 1, idempotency 03-001) ; `refund_order_rpc → refund_order_rpc_v2` (Phase 1, mapping JE). **Build-from-scratch** : `evaluate_promotions_v1` créée Phase 2.C (BOGO+threshold+bundle) — vérifié, aucune fonction SQL `evaluate_promotions` n'existe en V3 (`grep -R evaluate_promotions supabase/migrations/` → 0 hit ; logique matching actuelle vit en TS dans `packages/domain/src/promotions/`). Le numéro `_v1` (pas `_v2`) reflète l'absence de prédécesseur SQL ; les hooks TS consumers seront mis à jour pour appeler la nouvelle RPC. Les triggers (`create_sale_journal_entry`, `create_purchase_journal_entry`) DROP+CREATE OR REPLACE inline — exempts. Aucun trigger `create_stock_movement_journal_entry` à dropper (n'existe pas en V3 — cf. D20). Tous autres `_v1` Session 12 inventaire restent stables. |
| **D15** | **F1 expiry ledger invariant — pattern (a) chosen** | `stock_movements` reste **strictement append-only** : aucun trigger ne fait UPDATE post-INSERT sur ses colonnes (lot_id inclus). Pattern retenu : **lot résolu UPFRONT avant INSERT**. (1) `record_stock_movement_v1` signature **étendue de manière additive** (pas un v2 — paramètre `p_lot_id UUID DEFAULT NULL` ajouté en queue, anciens appelants restent compatibles). (2) Pour les types consommateurs (`sale`, `sale_void`, `waste`, `transfer_out`, `production_out`), si `p_lot_id IS NULL`, le RPC résout lui-même le FIFO via `SELECT id FROM stock_lots WHERE product_id=$1 AND status='active' AND quantity > 0 ORDER BY expires_at ASC LIMIT 1 FOR UPDATE` puis décrémente `stock_lots.quantity` dans la même transaction. (3) Le décrément `stock_lots.quantity` (UPDATE sur `stock_lots`, pas `stock_movements`) reste licite — `stock_lots` n'est PAS append-only. (4) `stock_movements.lot_id` est rempli à l'INSERT, jamais après. **AUCUN trigger AFTER INSERT** sur `stock_movements` ne touche `lot_id`. Tests pgTAP obligatoires : `T_F1_LOT_INVARIANT` (RLS authenticated INSERT direct → denied) + `T_F1_NO_UPDATE_INVARIANT` (vérifie qu'AUCUN trigger AFTER INSERT/UPDATE n'existe sur `stock_movements` modifiant ses colonnes — `SELECT count(*) FROM pg_trigger WHERE tgrelid='stock_movements'::regclass AND tgenabled='O' AND tgname LIKE '%fifo%' = 0`). |
| **D16** | **Refund JE pattern — audit unconditional + unconditional refactor** | Phase 0.1 audit **unconditionnel** : examiner `fn_create_je_for_refund` (`20260512000005`) + tout chemin JE refund dans `apps/{pos,backoffice}`, `packages/domain/src/refunds/`, `supabase/functions/refund-order*` ; documenter finding (codes hardcodés OUI/NON, idempotency présente OUI/NON, fiscal guard OUI/NON) dans `docs/workplan/refs/2026-05-13-decision-pack.md` section "Refund JE". Migration `20260517000013_refactor_refund_je.sql` exécutée **sans condition** car le trigger V3 prédate la `accounting_mappings` table créée Phase 1.A — il faut au minimum le porter sur `resolve_mapping_account()` + ajouter idempotency UNIQUE + fiscal guard. Bump `refund_order_rpc_v2` également inconditionnel. |
| **D17** | **Edge Function rate-limit** | Helper partagé `supabase/functions/_shared/rate-limit.ts` (Token-bucket + Postgres `edge_function_rate_limits` table). Phase 1 Stream B tâche 25-002. Pas de re-implémentation par EF. |
| **D18** | **Kiosk-mode auth** | Pour 25-001 (RLS authenticated), KDS/Display/Tablet sans staff PIN auront un **kiosk service-account JWT** signé via une EF dédiée `kiosk-issue-jwt` (rate-limited, IP-allowlist staging). Phase 0 décide design ; Phase 1 implémente avant 25-001. |
| **D19** | **Realtime channel naming** | Toute hook realtime doit suivre `apps/pos/src/features/kds/hooks/useKdsRealtime.ts` pattern : `const channelName = useMemo(() => \`X-${id}-${Math.random().toString(36).slice(2, 9)}\`, [id])`. Audit en fin de chaque phase via `grep -RE "supabase.channel\(" apps/`. |
| **D20** | **Production trigger philosophy** (Mary P0-2 V2 revisited) | **Aucun trigger DB `create_stock_movement_journal_entry`** en V3 (n'existe pas — pas à dropper). Le JE pour stock movements (waste, adjustment, opname, production) est porté par le trigger nommé **`tr_20_je_emit`** créé Phase 1 Stream A (préfixe numérique `_20_` pour encoder l'ordre de tir AFTER INSERT vs autres triggers `_10_*`/`_30_*` — cf. M1), unique source de vérité — pas de wrapper TS dupliquant. |

---

## 4. Per-module acceptance criteria

Format : module → critères testables, livré-en-phase, dépendances.

### Module 01 — Auth & Permissions
- ✅ `has_permission(role, perm_key)` refactorée en lookup pur ; plus aucun re-CREATE OR REPLACE de la fonction Session 13. **Phase 1 Stream B.**
- ✅ Rate-limit Edge Function helper partagé `_shared/rate-limit.ts` ; appliqué sur `auth-verify-pin` (3 tentatives/15 min/IP). **Phase 1 Stream B.**
- ✅ Fallback PIN client supprimé ; PIN verify exclusivement EF. **Phase 1 Stream B.**
- ❌ 2FA / TOTP → différé Phase 7.
- ❌ Audit log session_changes → Phase 5 (couplé 20-007).
- **Dépend** : 25 (RLS), 24 (staging), 23 (CI).

### Module 02 — POS / Cart / Orders
- ✅ `complete_order_with_payment_v9` published (sale JE via mapping). **Phase 1.**
- ✅ Cart store : pas de régression cart-locked-items après v9 ; tests Vitest co-localisés `apps/pos/src/features/cart/__tests__/`. **Phase 1.**
- ✅ POS UX hardening (02-001/002/006/020) : networkSplit re-mount + offline graceful + service speed indicator. **Phase 4.**
- ✅ Order page `/orders` enhanced (02-011..019 cascade) : status filter, search by phone, pagination, export CSV. **Phase 6.**
- ❌ Multi-currency (02-027) → Phase 7.
- **Dépend** : 10 (sale JE), 13 (promotions integration), 08 (loyalty), 06 (stock reservations 06-003).

### Module 03 — Payments (Split)
- ✅ `pay_existing_order_v6` published (idempotency 03-001 + retry 03-002). **Phase 1.**
- ✅ `refund_order_rpc_v2` published (refund JE via mapping). **Phase 1.**
- ✅ QRIS Xendit adapter (03-006) — **conditionnel** (selon capacity Phase 4). Sinon différé Phase 7.
- **Dépend** : 10 (JE refund).

### Module 04 — KDS / Kitchen
- ✅ Realtime channel naming audit clean (D19). **Phase 1 audit.**
- ✅ Station routing (04-001) : item → station selon `categories.kds_station`. **Phase 4.**
- ✅ Recall + bumping (04-003/004) : modal "Rappeler" + bouton "Bump" → realtime update. **Phase 4.**
- ✅ Prep timer (04-006) : compteur visible sur chaque ticket. **Phase 4.**
- ✅ KDS handlers LAN (04-009 / 21-002) — dépend de la décision LAN D4. **Phase 5.**
- ✅ Kiosk-mode JWT actif pour stations KDS sans staff (D18). **Phase 1.**
- ❌ Voice alerts (04-cascade-objectif) → Phase 6 ou Phase 7.
- **Dépend** : 21 (LAN), 25 (RLS), 22 (design).

### Module 05 — Products & Categories
- ✅ Vue `view_product_recipes` créée pour read-only sub-recipes display (D3). **Phase 2.**
- ❌ Variants UI / image upload bulk → Phase 6 (polish) ou différé.
- **Dépend** : 15 (recipes canonical).

### Module 06 — Inventory & Stock
- ✅ F1 expiry tracking (06-001 XL) : `stock_lots` table + FIFO trigger via `record_stock_movement_v1` + `stock_movements.lot_id` colonne (D15). **Phase 1 Stream C.**
- ✅ F1 alerts UI (06-002) : page `/backoffice/inventory/expiring` + AlertsBadge intégrant. **Phase 1 Stream C.**
- ✅ Phantom decision `stock_reservations` (06-003) : **CREATE** + RLS + RPCs `reservation_hold_v1`/`reservation_release_v1`. **Phase 3.**
- ✅ Phantom decision `stock_balances` (06-004) : usage remplacé par `view_section_stock_details` ; doc update. **Phase 0/1.**
- ✅ Phantom RPC `finalize_inventory_count` (06-005) : créé via Session 12 phase 5 (finalize_opname_v1). **Phase 2.**
- ✅ Opname workflow tightening + Ghost stock report (06-006) → Session 12 phase 5+6. **Phase 2.**
- ✅ Production + Recipes (Session 12 phase 4) — délégué au module 15. **Phase 2.**
- ✅ Movements ledger view (Session 12 phase 6) : `get_stock_movements_v1` + page `/backoffice/inventory/movements`. **Phase 2.**
- ✅ Alerts + Dashboard produit (Session 12 phase 7). **Phase 2.**
- ✅ JE coupling trigger central `tr_20_je_emit` (Session 12 phase 8). **Phase 1 Stream A (tâche 10-007 ABS).**
- **Dépend** : 10-004 (reference_type CHECK), 10-007 (PRODUCTION_COGS postable), 10-011 (`tr_20_je_emit` trigger), 22 (UI).

### Module 07 — Purchasing / Suppliers / PO
- ✅ Tables `purchase_orders`, `purchase_order_items`, `goods_receipt_notes` créées + RLS. **Phase 3.**
- ✅ RPCs `create_purchase_order_v1`, `update_purchase_order_v1`, `receive_purchase_order_v1` (consume `record_stock_movement_v1` purchase), `cancel_purchase_order_v1`. **Phase 3.**
- ✅ `create_purchase_journal_entry` trigger refactoré via `resolve_mapping_account` (PURCHASE_PAYABLE, PURCHASE_VAT_INPUT, INVENTORY_GENERAL). **Phase 1 Stream A (tâche 10-006).**
- ✅ Page `/backoffice/purchasing/purchase-orders/{list,new,:id}` (Phase 3).
- ❌ Self-approval anti-pattern (07-014) → Phase 5 (couplé 20-010).
- **Dépend** : 10-006 (purchase JE), 06 (stock_movements purchase), 25 (RLS supplier PII).

### Module 08 — Customers / Loyalty
- ✅ Schema + soft-delete + audit déjà OK V3 (Session 11). Pas de modif schema Session 13.
- ✅ Notifications pipeline socle (08-006 XL split en 3) : (a) provider EF `notification-dispatch` (D5), (b) channel layer `packages/domain/src/notifications/`, (c) opt-in compliance customer-side. **Phase 5.**
- ✅ Customer segments (08-009) cohort analyzer RPC. **Phase 6.**
- ✅ Birthday triggers (08-010) cron EF + notification. **Phase 6.**
- ❌ Multi-site customers (08-011) → Phase 7 (couplé multi-tenancy).
- **Dépend** : 13 (segments consume notifications), 25 (RLS customers).

### Module 09 — B2B / Wholesale
- ✅ B2B customer fields ajoutés via colonnes (`customers.b2b_company_name`, `b2b_tax_id`, `b2b_payment_terms_days`, `b2b_credit_limit`). **Phase 3.**
- ✅ Credit limit enforcement (09-002) : `validate_b2b_credit_limit_v1` RPC appelé sur création order B2B. **Phase 3.**
- ✅ AR aging report PDF (09-001) cron mensuel via EF. **Phase 6.**
- ✅ B2B JE flow (09 cascade) : utilise mapping `B2B_AR` + `B2B_INVOICE_REVENUE` (seeded D11). **Phase 3.**
- ❌ B2B portail (09-007..017) → Phase 7.
- **Dépend** : 06-003 (stock_reservations), 08 (customers), 07 (invoice template), 10 (B2B JE via mapping).

### Module 10 — Accounting (Double-Entry) — CRITICAL PATH
- ✅ **10-A0** : `accounting_mappings` table créée + 24 mapping_keys seedés + `resolve_mapping_account()` helper. **Phase 1 Stream A migration `20260517000001`.**
- ✅ **10-A0bis** : `fiscal_periods` table + `check_fiscal_period_open()` helper + seed 24 mois 2026. **Phase 1 Stream A migration `20260517000002`.**
- ✅ **10-004** : `reference_type` CHECK étendu (17 types — D13). **Phase 1 Stream A migration `20260517000003`.**
- ✅ **10-008** : compte `3300 Current Year Earnings` ajouté + RPC `get_balance_sheet_data` calcule CYE. **Phase 1 Stream A migration `20260517000004`.**
- ✅ COA seedé pleinement SAK EMKM (≈ 40 comptes : Cash 111X, Bank 112X, AR 1131, Inventory 1141, AP 2141, PB1 2143, Equity 3100/3300, Revenue 411X, COGS 511X, Expense 6XXX). **Phase 1 migration `20260517000005`.**
- ✅ **10-001** : `create_sale_journal_entry` trigger refactoré → utilise `resolve_mapping_account` (SALE_PAYMENT_CASH, SALE_PAYMENT_QRIS, SALE_PAYMENT_DEBIT, SALE_POS_REVENUE, SALE_PB1_TAX, SALE_DISCOUNT), idempotence via SELECT préalable, fiscal_period guard, `next_journal_entry_number` (créée si absente). **Phase 1 Stream A migration `20260517000010`.**
- ✅ **10-002** : NO-OP en V3 (le trigger DB `create_stock_movement_journal_entry` n'existe pas — D20). Documenté.
- ✅ **10-003** : `SALE_REVENUE` mapping seedé OU refactor `accountingEngine.ts` (n'existe pas en V3 — moteur sera créé en `packages/domain/src/accounting/`). Phase 1 résout via mapping seed.
- ✅ **10-005** : `calculate_vat_payable` RPC créée correctement (V3 absente — build from scratch) avec `resolve_mapping_account('SALE_PB1_TAX')` + `('PURCHASE_VAT_INPUT')`. **Phase 1 migration `20260517000012`.**
- ✅ **10-006** : `create_purchase_journal_entry` trigger refactoré (build from scratch en V3) via mapping. **Phase 1 migration `20260517000011`.**
- ✅ **10-007** : Compte `5110 Production COGS - Direct` ajouté (5100 reste GROUP non-postable) + mapping `PRODUCTION_COGS → 5110`. **Phase 1 migration `20260517000005` (intégrée au COA seed).**
- ✅ **10-008** (renommé) : refund JE pattern audité Phase 0 ; si hardcoded → migration `20260517000013_refactor_refund_je.sql` + bump `refund_order_rpc_v2`. **Phase 1 Stream A.**
- ✅ **10-011** : `tr_20_je_emit` trigger central (Session 12 spec §C10) — émet JE pour waste/adjustment/opname/production. **Phase 1 Stream A migration `20260517000023` (split [m4] : `000021` = lot_id column add, `000022` = function `tr_stock_movement_je()`, `000023` = trigger attach + JE idempotency UNIQUE).**
- ✅ **10-012** : UI Admin `accounting_mappings` (page CRUD `/backoffice/accounting/mappings`). **Phase 6.**
- ✅ Bank reconciliation (10-009) — UI matching semi-auto. **Phase 6.**
- ✅ Fiscal period lock UI (10-011 V2 → renommé 10-013 V3) : workflow mensuel `/backoffice/accounting/fiscal-periods`. **Phase 5.**
- ❌ Multi-currency (10-019) → Phase 7.
- ❌ Consolidation multi-entité (10-020) → Phase 7.
- ❌ e-Faktur (10-014) → Phase 7.
- ❌ IA classification (10-021) → Phase 7.
- **Dépend** : aucune (foundation). Downstream : 06, 07, 11, 12, 15.

### Module 11 — Expenses
- ✅ Tables `expenses` (`id`, `expense_number TEXT UNIQUE`, `category_id`, `supplier_id NULL`, `amount`, `vat_amount`, `expense_date`, `status` IN draft/pending/approved/paid/rejected, `paid_at`, `je_id NULL FK journal_entries`), `expense_categories` (seed 12 catégories : utilities, rent, salary, marketing, supplies, etc.). **Phase 3.**
- ✅ RPCs `create_expense_v1`, `submit_expense_v1`, `approve_expense_v1` (consume `reference_type='expense'`, émet JE Dr Expense / Cr AP-or-Cash via mapping), `pay_expense_v1`, `reject_expense_v1`. **Phase 3.**
- ✅ Pages `/backoffice/expenses/{list,new,:id}`. **Phase 3.**
- ✅ Receipt upload (11-004) : Supabase Storage bucket `expense-receipts` + RLS. **Phase 3.**
- ❌ Workflow approbation multi-niveau (11-001) → Phase 5 (couplé 09-009/07-014/20-011).
- ❌ Récurrence expense (11-003) → Phase 6.
- ❌ OCR receipts (11-004 cascade) → Phase 7.
- ❌ Note de frais staff (11-006) → Phase 7.
- **Dépend** : 10-004 (CHECK accepte `expense`), 10-006 pattern (mapping), 25 (RLS).

### Module 12 — Cash Register / Shift
- ✅ Shift close JE auto (12-007) : RPC `close_shift_v1` émet JE Dr Cash-Drawer / Cr Cash-On-Hand selon variance via mapping `SHIFT_CASH_VARIANCE_*`. **Phase 3.**
- ✅ Variance threshold alert (12-001) : `business_config.shift_variance_threshold_idr` ; UI alert si abs(variance) > threshold. **Phase 3.**
- ✅ Mid-shift cash in/out (12-004) : RPC `record_cash_movement_v1` + colonne `pos_sessions.cash_in`/`cash_out` totals. **Phase 3.**
- ✅ Z-Report PDF signable (12-002) — Phase 6.
- ❌ Auto-close shift (12-006) → Phase 5 (cron).
- ❌ Multi-drawer (12-cascade) → Phase 7 (multi-store).
- **Dépend** : 10-004 (CHECK), 10-006 (mapping), 25 (audit_log).

### Module 13 — Promotions / Discounts
- ✅ `evaluate_promotions_v1` published — **build-from-scratch SQL RPC** (BOGO multi-produit + threshold cart) — 13-001. **Phase 2.C.**
- ✅ Bundle engine (13-cascade) — Phase 2.
- ✅ Stacking rules UI (13-002) — Phase 4.
- ✅ Customer segments coupling (13-005) — Phase 6 (couplé 08-009 + notifications).
- ✅ Promotion ROI report (13-006) — Phase 6 (couplé 14).
- ❌ A/B testing (13-007) → Phase 7.
- **Dépend** : 02 (cart), 08-006 (notifications pour segments).

### Module 14 — Reports & Analytics
- ✅ Materialised views (`mv_sales_daily`, `mv_stock_variance`, `mv_pl_monthly`) + refresh policy (pg_cron — 14-001 du backlog). **Phase 2.**
- ✅ Page `/backoffice/reports/sales-by-hour` + RPC `get_sales_by_hour_v1`. **Phase 2.**
- ✅ Page `/backoffice/reports/sales-by-category`. **Phase 2.**
- ✅ Limit clauses sur Audit/ProductPerf/DiscountsVoids (14-002) — RPC paginé via cursor. **Phase 2.**
- ✅ `toLocalDateStr()` timezone fix (14-003) — Phase 2 (domain utility).
- ✅ Smoke tests 87 report tabs (14-006) — Phase 2 (Playwright).
- ✅ P&L + Balance Sheet + Cash Flow (14-cascade) — Phase 6.
- ✅ Basket analysis (14-014) — Phase 6 (couplé 02-026 upsell).
- ❌ Advanced ML cohort (14-cascade ML) → Phase 7.
- **Dépend** : 04 (KDS data — Phase 4), 09-010 (B2B orders), 08-009 (cohort), 13-006 (promo ROI), 06-001 (stock).

### Module 15 — Production / Recipes (Session 12 Phase 4 reprise)
- ✅ Tables `recipes` (flat, D3) + `production_records` créées. **Phase 2.**
- ✅ RPCs `upsert_recipe_v1`, `list_recipes_v1`, `deactivate_recipe_v1`, `record_production_v1` (atomique : production_record + production_in + N production_out + JE COGS via mapping `PRODUCTION_COGS`), `revert_production_v1` (ADMIN+), `get_production_suggestions_v1`. **Phase 2.**
- ✅ Pages `/backoffice/inventory/production` + `RecipeEditor` modal. **Phase 2.**
- ✅ `view_product_recipes` (vue jointe pour module 05). **Phase 2.**
- ❌ Sub-recipes récursifs (15-001 XL) → Phase 7.
- ❌ Yield tracking (15-002) → Phase 6.
- **Dépend** : 10-007 (PRODUCTION_COGS postable — `5110`), 06 (stock_movements types `production_in/out`), 05 (products integration).

### Module 16 — Customer Display
- ✅ App route POS `/display` (build-from-scratch) — composant `CustomerDisplayPage` qui subscribe realtime order updates. **Phase 4.**
- ✅ Kiosk-mode JWT actif (D18). **Phase 1.**
- ✅ Queue ticker (16-cascade) — Phase 4.
- ✅ Branded layout via tokens (16-cascade) — Phase 4.
- ❌ Vidéo idle / dual-screen sync (16-cascade) → Phase 7.
- ❌ Payment QR display (16-006) → Phase 5 (couplé Xendit ou différé).
- **Dépend** : 21 (LAN), 25 (RLS kiosk), 22 (design).

### Module 17 — Tablet Ordering
- ✅ Tablet polish (17-001/002/003/006) : offline graceful degrade + sync resilience + push refactor + UX. **Phase 4.**
- ❌ Offline mode complet (17-001 XL IndexedDB) → Phase 7.
- ❌ Push notifications tablet (17-010) → Phase 5 (couplé 08-006).
- **Dépend** : 22 (design tokens + 22-006 batch 1), 21 (LAN sync), 02 (cart shared).

### Module 18 — Mobile Shell
- ❌ Hors-scope Session 13 (D7 → PWA, Phase 7).
- Phase 0 documente la décision PWA-first ; rien d'autre.

### Module 19 — Settings / Configuration
- ✅ RPC `get_settings_by_category` créée (D2 — phantom create). **Phase 5.**
- ✅ Audit `audit_logs` vs `audit_log` arbitré Phase 0.1 → **canonical = `audit_logs` plural** (cohérent avec conventions `journal_entries`, `stock_movements`, `user_sessions`). V3 actuel a les deux tables (`audit_logs` créée Session 1 `20260503000005`, `audit_log` créée Session 11 `20260515000002`). Migration Phase 1.B `20260517000034_drop_legacy_audit_log_singular.sql` DROP la version singulière + migrate les rows existantes vers `audit_logs`. **Phase 1.B.**
- ✅ Tables `holidays`, `email_templates`, `receipt_templates`, `notification_templates` créées. **Phase 5.**
- ✅ Page `/backoffice/settings/{general,holidays,templates,permissions}`. **Phase 5.**
- ✅ Settings audit log (19-005) — Phase 5 (réutilise `audit_logs` plural).
- ❌ Multi-tenancy infra (19-008) → Phase 7.
- ❌ Approval workflows (19-cascade) → Phase 5 ou différé.
- **Dépend** : 22 (UI), 25 (audit), 08-006 (templates feed notifications).

### Module 20 — Users / RBAC
- ✅ Page `/backoffice/users/{list,new,:id}` (CRUD basique). **Phase 5.**
- ✅ Page `/backoffice/users/permissions` matrice (20-001) — affichage role × perm avec toggle dépendant de `has_permission()` refactorée. **Phase 5.**
- ✅ Audit on role change (20-002) — réutilise `audit_logs` plural (`event_type='user.role_changed'`). **Phase 5.**
- ✅ Revoke sessions on role change (20-007) — Phase 5.
- ✅ Last-admin protection (20-cascade 01-007) — RPC `delete_user_v1` refuse si dernier admin. **Phase 5.**
- ❌ 2FA pairing (20-008) → Phase 7.
- ❌ Bulk import users (20-003) → Phase 7.
- **Dépend** : 01 (auth), 25 (audit + RLS).

### Module 21 — LAN Architecture
- ✅ Décision LAN actée (D4 — hybrid Realtime+BroadcastChannel V2 port).
- ✅ Package `packages/domain/src/lan/` (message dedup pur via UUID+TTL, protocol parsing). **Phase 5.**
- ✅ `apps/pos/src/features/lan/` (hub + client transport). **Phase 5.**
- ✅ `print_queue` table + RLS (21-004). **Phase 5.**
- ✅ KDS handlers LAN (21-002) intégrés à module 04. **Phase 5.**
- ✅ Print result targeting (21-003) — Phase 5.
- ❌ Hub failover (21-005) → Phase 6 (resilience).
- ❌ Multi-LAN (21-011) → Phase 7.
- **Dépend** : 04 (KDS), 17 (Tablet), 16 (Display) consumers.

### Module 22 — Design System
- ✅ Tokens JSON (`packages/ui/src/tokens/{colors,spacing,typography,motion}.ts`) (22-001) avec mapping `tailwind.config`. **Phase 1 Stream D.**
- ✅ `EmptyState` primitive (22-002). **Phase 1.**
- ✅ A11y `<button>` au lieu de `<div onClick>` (22-004). **Phase 1 sweep.**
- ✅ Skip-to-content POS (22-005). **Phase 1.**
- ✅ 22-006 modal migration (Radix Dialog) — batch 1 (24 modals POS Phase 1) + batch 2 (BO Phase 4) + batch 3 (tablet/display Phase 6).
- ✅ Contrast `--text-muted` fix (22-007). **Phase 1.**
- ❌ Dark mode complet → Phase 6 ou Phase 7.
- **Dépend** : aucune. Foundation.

### Module 23 — Tests
- ✅ CI workflow `.github/workflows/ci.yml` : pgTAP + Vitest + typecheck + types-regen-check + lint + build. **Phase 0 enabler.**
- ✅ Playwright E2E 3 flows critiques (complete_order, opname finalize, PO receive) — 23-003. **Phase 6.**
- ✅ Smoke tests reports tabs (23-002) — Phase 6 (couplé 14-006).
- ❌ Coverage thresholds (23-cascade) → Phase 6+.
- **Dépend** : 24 (CI infra).

### Module 24 — Deployment / Ops
- ✅ Staging Supabase environment confirmé `ikcyvlovptebroadgtvd` (D8). **Phase 0.**
- ✅ CI/CD pipeline (24-001) — Phase 0 + 1.
- ✅ Sentry POS + BO (24-006) — Phase 5.
- ✅ DR runbook (24-002) — Phase 6 docs.
- ❌ Multi-env beyond staging → Phase 7.
- ❌ Backup verification cron (24-005) → Phase 6.
- **Dépend** : aucune. Foundation.

### Module 25 — Security
- ✅ RLS PII anon→authenticated (25-001) — orders, order_items, customers, customer_categories, user_roles ; kiosk-mode JWT (D18) absorbe le drift KDS/Display/Tablet. **Phase 1 Stream B après staging.**
- ✅ Rate-limit EF helper (25-002) — `_shared/rate-limit.ts`. **Phase 1 Stream B.**
- ✅ Drop client PIN fallback (25-003). **Phase 1 Stream B.**
- ✅ Error redaction `auth-verify-pin` (25-004). **Phase 1 Stream B.**
- ✅ CSP + HSTS headers (25-005) — `vercel.json` config + meta tags. **Phase 1 Stream B.**
- ✅ Audit EF perm checks (25-006) — sweep + tests. **Phase 1 Stream B.**
- ❌ SRI / dep audit auto / secrets rotation → Phase 6 ou Phase 7.
- **Dépend** : 24 (staging), 01 (auth pairing).

---

## 5. Dépendances inter-sessions

### 5.1 Sessions précédentes consommées

| Session | Livrable consommé Session 13 |
|---|---|
| **1-2** | `accounts`, `journal_entries`, `journal_entry_lines`, `complete_order_with_payment` v1, sale JE trigger initial. Session 13 refactore (10-001). |
| **3-4** | Loyalty + KDS, `served` lifecycle, customer schema. Pas de modif Session 13. |
| **5** | Tablet RPCs, restaurant_tables. Session 13 polish (Phase 4). |
| **6-9** | Discounts + promotions schema. Session 13 crée la RPC `evaluate_promotions_v1` from-scratch (Phase 2.C — pas de prédécesseur SQL en V3, la logique matching actuelle vit en TS dans `packages/domain/src/promotions/`). |
| **10** | Split payment + void + refund. Session 13 refactore `refund_order_rpc_v2` (Phase 1). |
| **11** | Backoffice CRUD (products, suppliers, categories, customers etc.) + sidebar grouping. Session 13 étend (modules 07/19/20). |
| **12 phases 1-3** | Inventory MVP (sections, units, stock_movements RPC-only, transfers). Session 13 livre phases 4-8 sous le module 06+15 (Phase 1 Stream C + Phase 2). |

### 5.2 Composabilité avec Session 12

Session 12 a réservé `20260516xxxxxx`, dernière migration `20260516000024`. Session 13 réserve `20260517xxxxxx` (séquentiel après). Pas de chevauchement.

Migrations Session 12 phases 4-8 **non livrées** (5+ migrations restantes) sont **renumérotées dans la séquence Session 13** sous `20260517xxxxxx` pour respecter la monotonicité. Le plan-INDEX précisera lesquelles.

### 5.3 Sessions ultérieures pré-réservées

- Session 14 (Q3 2026) : multi-currency + multi-tenancy + B2B portal kick-off.
- Session 15 (Q3 2026) : mobile shell PWA full + advanced analytics.
- Session 16-18 (Q4 2026 → Q1 2027) : e-Faktur, advanced ML, voice ordering.

---

## 6. Risk Register (cross-référencé audit §4)

| ID | Description | Impact | Likelihood | Mitigation Session 13 |
|---|---|---|---|---|
| **R1** | V2→V3 path translation absente → sous-agents divergent | L | L | **D1** : translation table Phase 0 (`docs/workplan/refs/2026-05-13-v2-v3-path-translation.md`) référencée dans chaque sub-plan de phase. |
| **R2** | Accounting P0 stream bloque Phases 2-5 | L | M | **Strictly sequential** ; un seul subagent `backend-dev` ou `system-architect` ; staging-validated chaque étape ; reviewer obligatoire après chaque migration. |
| **R3** | `reference_type` CHECK étendu casse JE déjà créés en prod | L | M | (a) V3 prod n'est pas en service (incompat avec V2 — MEMORY.md) ; (b) sur staging, suppression de la CHECK existante = élargissement (jamais restrictif) ; (c) retrofix data prod V2 reste séparé. |
| **R4** | RLS anon→authenticated casse KDS/Display/Tablet | L | H | **D18** : kiosk-mode JWT designed Phase 0, implémenté en Phase 1 AVANT 25-001 ; staging déployé pour test ; rollback documenté. |
| **R5** | F1 FIFO trigger viole ledger invariant | L | M | **D15** : trigger appelle `record_stock_movement_v1` (pas INSERT direct) ; pgTAP `T_F1_LOT_INVARIANT` ; review obligatoire. |
| **R6** | F6 sub-recipes dual-claim (05 vs 15) | M | H | **D3** résolu : 15 own ; 05 read-only via view. |
| **R7** | `types.generated.ts` régression CI silencieuse | M | H | CI workflow Phase 0 (23-001 + types-regen-check). `pnpm db:reset && pnpm db:types && git diff --exit-code packages/supabase/src/types.generated.ts` dans CI. |
| **R8** | Phantom-tables decisions bloquent 4+ tâches | M | M | **D2** : decision pack actée. |
| **R9** | Notifications pipeline gate 6+ tâches | L | M | **D5** : Email-only MVP Phase 5 ; pipeline isolé `packages/domain/src/notifications/` ; mocks pour tests. |
| **R10** | `packages/ui` contention multi-modules | M | H | **D9** : `ui-steward` subagent unique ; batching 22-006 en 3 fenêtres. |
| **R11** | LAN architecture decision cascades 4 modules | M | M | **D4** : hybrid acté Phase 0 ; impl Phase 5. |
| **R12** | Multi-currency cascade | M | L | Différé Phase 7. Aucune feature Session 13 ne dépend. |
| **R13** | Sentry + EF cold-start double-change | M | M | Séparation : Sentry Phase 5, cold-start si nécessaire Phase 6. |
| **R14** | `has_permission()` re-publish fragility | M | H | **D10** : refactor en lookup unique Phase 1 ; aucune migration ultérieure Session 13 ne CREATE OR REPLACE. |
| **R15** | Migration block 20260517xxxxxx épuisé si plan > 50 | L | L | Block 1000 contigu (`000001..999999`), no risk. |
| **R16** | Subagents parallèles écrivent même fichier (e.g. `BackofficeLayout.tsx` routes additions) | M | M | Plan d'INDEX assigne chaque fichier à 1 phase au plus ; sinon échange via lead+SendMessage. |
| **R17** | Tests pgTAP > 30 min sur full suite | L | M | Targeted pgTAP `bash supabase/tests/run_pgtap.sh inventory_phase1_complete` style ; CI parallelisé. |
| **R18** | EF `kiosk-issue-jwt` exposée → abus | L | M | IP-allowlist staging + rate-limit aggressive (10/min/IP) ; review sécu obligatoire. |
| **R19** | `evaluate_promotions_v1` (build-from-scratch) casse cart layer existant TS | M | M | RPC ajoutée sans toucher l'engine TS — le cart hook teste la RPC d'abord, fallback TS si erreur ; rollback plan = unset feature flag. Tests Vitest live + domain unit (engine TS pure restant). |
| **R20** | Sub-plan génération oubliée par subagent | L | M | Lead vérifie présence sub-plan avant accept ; INDEX cite tous noms attendus. |

---

## 7. Definition of Done — Session-wide

À la clôture de Session 13, les invariants suivants doivent être vrais :

### 7.1 Build & Test

- ✅ `pnpm build` succès POS + BO + packages.
- ✅ `pnpm typecheck` 0 erreur.
- ✅ `pnpm lint` 0 warning bloquant.
- ✅ `pnpm test --concurrency=1` ≥ **+450 tests passants** (cible ≥ 1370 total, baseline Session 12 ≈ 920).
- ✅ `bash supabase/tests/run_pgtap.sh` full suite green (estimé +120 tests Session 13).
- ✅ Playwright E2E 3 flows green sur staging.
- ✅ CI workflow PR vert sur tous les commits Phase 1+.

### 7.2 Schema & Migrations

- ✅ Migrations Session 13 toutes appliquées (estimé 40-60).
- ✅ `packages/supabase/src/types.generated.ts` à jour + commité.
- ✅ Block `20260517000001..20260517xxxxxx` monotonique.
- ✅ Aucune migration interactive bloquante (`db:reset` complet ≤ 90 sec).
- ✅ `accounting_mappings`, `fiscal_periods`, `stock_lots`, `purchase_orders`, `expenses`, `recipes`, `production_records`, `print_queue`, `holidays`, `email_templates` créées + RLS.

### 7.3 RPC & Triggers

- ✅ `complete_order_with_payment_v9` published ; v8 droppée.
- ✅ `pay_existing_order_v6` published ; v5 droppée.
- ✅ `evaluate_promotions_v1` published.
- ✅ `refund_order_rpc_v2` published.
- ✅ `record_stock_movement_v1` stable signature (déjà v4 interne — pas touchée).
- ✅ `tr_20_je_emit` trigger émet JE corrects pour waste/adjustment/opname/production.
- ✅ `create_sale_journal_entry` + `create_purchase_journal_entry` refactorés via `resolve_mapping_account`.
- ✅ `has_permission` lookup pur, plus jamais re-CREATE'd.

### 7.4 RBAC & Sécurité

- ✅ 25-40 nouvelles permissions seedées (accounting/expenses/cash-register/production/reports/settings/users).
- ✅ RLS PII orders/order_items/customers/customer_categories/user_roles = `authenticated` (+ kiosk-JWT path).
- ✅ EF rate-limit appliqué sur `auth-verify-pin` + autres EFs sensibles.
- ✅ `auth-verify-pin` error response redacted.
- ✅ Pas de fallback PIN client.
- ✅ CSP + HSTS headers actifs (Vercel).

### 7.5 Accounting

- ✅ COA SAK EMKM seedé pleinement (≥ 40 comptes).
- ✅ `accounting_mappings` seedé (≥ 24 mapping_keys).
- ✅ `fiscal_periods` seedé pour 24 mois (Jan 2026 - Dec 2027 ou ajuster).
- ✅ Sale JE équilibré, fiscal_period guarded, idempotent.
- ✅ Purchase JE équilibré idem.
- ✅ Stock movement JE central (`tr_20_je_emit`) émet pour waste/adjustment/opname/production ; aucun pour transfers ; idempotent via UNIQUE.
- ✅ Refund JE via mapping.
- ✅ Shift-close JE via mapping.
- ✅ Expense JE via mapping.
- ✅ Production JE via mapping (`PRODUCTION_COGS` → `5110`).

### 7.6 UX surface

- ✅ Pages BO créées Session 13 :
  - `/backoffice/accounting/{mappings,fiscal-periods,balance-sheet,profit-loss,vat-management}`
  - `/backoffice/purchasing/purchase-orders/{list,new,:id}`
  - `/backoffice/expenses/{list,new,:id}`
  - `/backoffice/inventory/{expiring,production,opname,opname/:id,movements,alerts,products/:id/dashboard,sections}`
  - `/backoffice/reports/{sales-by-hour,sales-by-category,sales-by-staff,stock-variance,promo-roi}`
  - `/backoffice/settings/{general,holidays,templates,permissions}`
  - `/backoffice/users/{list,new,:id,permissions}`
- ✅ Pages POS créées Session 13 :
  - `/display` (Customer Display).
- ✅ Sidebar BO regroupements actifs (Inventory, Accounting, Purchasing, Reports, Settings, Users, etc.).
- ✅ AlertsBadge topbar live (low-stock + expiry + reorder).
- ✅ Tablet polish 17-001/002/003/006 livré.
- ✅ Design tokens actifs + 22-006 batch 1 (24 modals POS migrés Radix Dialog).

### 7.7 Ops & Delivery

- ✅ Staging Supabase confirmed `ikcyvlovptebroadgtvd` ; toutes migrations Session 13 testées d'abord.
- ✅ CI workflow `.github/workflows/ci.yml` actif sur PR.
- ✅ Sentry POS + BO captures runtime errors (Phase 5 livré).
- ✅ DR runbook docs/runbooks/disaster-recovery.md créé (Phase 6).
- ✅ V2→V3 translation table commitée (Phase 0).
- ✅ Phase-by-phase sub-plans existent dans `docs/workplan/plans/2026-05-13-session-13-phase-NN-{slug}.md`.

### 7.8 Documentation

- ✅ Audit doc commité (déjà fait par architect-auditor).
- ✅ Spec doc (ce fichier) commité.
- ✅ INDEX plan commité.
- ✅ Sub-plans par phase commités au fil de l'exécution.
- ✅ `docs/reference/04-modules/` mis à jour pour modules touchés (Part II technique sync) — au moins 10, 11, 12, 14, 15.
- ✅ Backlog files updated : tâches passées à `DONE` ; sources de vérité.

---

## 8. Métriques de succès quantitatives

| Métrique | Baseline (post-Session 12 Phase 3) | Cible Session 13 |
|---|---|---|
| Migrations appliquées total | 106 | ≈ 150-165 |
| Tests passants (Vitest+pgTAP+domain+E2E) | ≈ 920 | ≥ 1370 (+450) |
| Couverture pgTAP RPC critiques | Inventory complete | + Accounting + Purchasing + Expenses + Shift-close + Production + Promotions |
| RPCs publiés `_vN` | 12 nommés | + 4 bumps (v9/v6/v2/v2) + ≈ 20 nouveaux `_v1` |
| Permissions seedées | 12 (Session 12) | + 25-40 (cible 50+ total) |
| Pages BO | 5 livrées V3 | + ≈ 25 nouvelles |
| RLS PII tables fully locked | Inventory only | + orders/order_items/customers/cust_categories/user_roles |
| CI workflow on PR | absent | actif |
| E2E Playwright flows | 0 | 3 critiques |
| `types.generated.ts` regen audited in CI | non | oui |

---

## 9. Hors-périmètre (rappel exhaustif)

| Item | Raison du déférement | Session cible |
|---|---|---|
| Multi-currency end-to-end | Cascade 7+ tâches ; pas un MVP business | 14 (Q3 2026) |
| Multi-tenancy infra | Refonte architecturale ; nécessite Session 13 closed first | 15 (Q3 2026) |
| Mobile shell native (Capacitor) | PWA-first décidé D7 ; native après push provider chosen | 16 (Q4 2026) |
| B2B portail client | Surface UX externe, auth séparée | 17 (Q4 2026) |
| e-Faktur DJP integration | Regulatory complex, hors-MVP | 18 (Q1 2027) |
| Voice ordering | R&D, hors-périmètre opérationnel | 19 |
| Forecasting ML | Stack ML séparé | 20 |
| Sub-recipes récursifs (F6 complet) | Risque casse trigger production | 14+ |
| Multi-LAN site-to-site | Multi-store dépendance | 17+ |
| Bulk operations (users import, products bulk) | Polish, non-bloquant | 14+ |
| 2FA / TOTP | Optionnel, dépend stratégie auth | 15+ |
| OCR receipts (expenses) | Provider OCR à choisir | 16+ |
| Dark mode | Polish DS | 14+ |

---

## 10. Comms entre subagents

Voir CLAUDE.md "Agent Comms" pattern :

- Phase 0 = `system-architect` (steward) → produit translation table + decision pack → SendMessage `lead`.
- Phase 1 Streams = 4 subagents parallèles nommés `acct-stream`, `sec-stream`, `inv-stream`, `ui-steward`. Chacun SendMessage `lead` à la fin ; lead route au `reviewer`.
- Phase 2+ = subagents nommés par module (e.g. `prod-recipes`, `reports-infra`). Chacun lit la translation table avant de toucher du code.
- Tout PR touchant `packages/ui/src/` traverse `ui-steward`.
- Tout merge en `swarm/session-13` est validé par `reviewer` (sur l'ID dormant `a3ad24f9b7bf6e565` mentionné par le lead).

---

## 11. Convention de nommage Session 13

- **Branche git** : `swarm/session-13-phase-N` (par phase) puis squash-merge sur `swarm/session-13` puis PR vers `master`.
- **Commits** : conventional, `feat(scope): session 13 — phase N — <topic>` ou `fix(scope): session 13 — <topic>`. Co-author Claude.
- **Sub-plans** : `docs/workplan/plans/2026-05-13-session-13-phase-NN-<slug>.md` (création à l'exécution de chaque phase).
- **Migrations** : `20260517000001`..`20260517999999` (toutes datées 17 mai 2026 logical, suffixe ordinal monotonique).
- **Tests pgTAP** : `supabase/tests/<module>.test.sql` (étend existant) + `<module>_session13.test.sql` pour acceptance nouvelle.
- **Tests Vitest live** : `supabase/tests/functions/<module>-<rpc>.test.ts`.
- **Tests domain** : `packages/domain/src/<module>/__tests__/<feature>.test.ts`.
- **Tests BO smoke** : `apps/backoffice/src/features/<module>/__tests__/<page>.smoke.test.ts`.

---

## 12. En une phrase

Session 13 construit la fondation accounting V3 manquante, sécurise la surface PII, complète l'inventaire (F1 + opname + production + alerts + JE coupling), livre Purchasing/Expenses/Cash-Register/Reports/Promotions BOGO/LAN/Notifications/Settings/RBAC, le tout en 8 vagues (Phase 0 décisions, Phases 1-6 exécution, Phase 7 différée), avec contrats explicites entre subagents, en respectant l'append-only ledger invariant et la RPC versioning monotonique.

---

*Fin du spec. Pour exécuter : `superpowers:executing-plans` puis pointer le plan-INDEX [`../plans/2026-05-13-session-13-INDEX.md`](../../plans/archive/2026-05-13-session-13-INDEX.md). Chaque phase délègue à un subagent dédié via `superpowers:subagent-driven-development`.*
