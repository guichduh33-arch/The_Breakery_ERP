> **Audit projet — état & lacunes (The Breakery V3).** Méthode : croisement **doc↔code** par 13 agents de domaine spécialisés (Workflow multi-agents, 2026-06-27), synthèse + critique de complétude. **Périmètre : code sur disque vs documentation** sur la base `origin/master` (#125). ⚠️ **Non couvert** (voir §6) : schéma cloud réel (MCP non interrogé), exécution des tests/runtime, coques natives Tauri/Capacitor + offline. Les verdicts `works` sont **inférés par lecture de code, pas observés**. Socle de curation préalable : [`2026-06-27-docs-curation-audit.md`](2026-06-27-docs-curation-audit.md). 121 findings (9 🔴 / 41 🟠 / ~38 🟡 / ~33 ⚪) sur 13 domaines.

# Audit état projet & lacunes — The Breakery V3 (2026-06-27)

## 1. Résumé exécutif — verdict global

**Verdict : le code V3 est solide et plus avancé que sa documentation ; le risque dominant est la dérive documentaire, pas le runtime.** Sur les 13 domaines audités (croisement doc↔code), aucun bug fonctionnel bloquant n'a été trouvé dans le code vérifié. À l'inverse, presque chaque doc de référence (`docs/reference/04-modules/*`, `07-security/*`, `10-deployment-ops/*`) est datée « Last verified 2026-05-03/05-13 », antérieure au refactor monorepo feature-based, à l'ère des RPC et à l'EF money-path — et décrit une architecture V2 (LAN-hub, `src/hooks|services|components`, RPC/colonnes/permissions inexistants).

**Ce qui est solide (codé, actif, correct) :**
- **Money-path POS** : `POS → process-payment EF → complete_order_with_payment_v14` (flag-aware), parcours parallèle `fire_counter_order_v4 + pay_existing_order_v10`, idempotence (clé UUID EF + `p_client_uuid` RPC), split tender (max 5, garde-fous overpay), held-orders (draft S35 + fired/reopen Spec A #120/#121), gating manager-PIN par header avec lockout.
- **Inventaire** : primitive `record_stock_movement_v1` (ledger append-only, unit NOT NULL, idempotence replay, REVOKE defense-in-depth, FEFO lots, `section_stock`, `p_allow_negative` #122).
- **Production** : RPC atomique `record_production_v1` (cascade BOM récursive depth-5 + cycle guard, WAC, lot shelf-life, versioning recette), wiring flag `track_inventory`/`deduct_stock` correct.
- **Compta** : double-entrée enforced, garde fiscal sur chaque JE, PB1 NON-PKP correct (compte 2110, 1151 désactivé), `close_fiscal_period_v1`/`create_manual_je_v1` perm+PIN+REVOKE+audit.
- **Sécurité** : RBAC `role_code → role_permissions/user_permission_overrides`, sweep anon/PUBLIC (S20), rate-limit durable cross-instance, 6/7 failles 2026-05-31 corrigées.
- **Reports** : ~28 pages lazy + RPC `get_*_v1`, EF `generate-pdf` (17 templates, signed URL), flux Z-report 2-étapes PIN-gated.
- **Plateforme** : numérotation migrations monotone (dernière `20260710000050`), `types.generated.ts` à jour (#126).

**Ce qui est fragile / contradictoire :**
- Divergence sémantique réelle (seul vrai risque code) : **production déduit jusqu'aux feuilles BOM, la vente s'arrête aux nœuds `track_inventory`** → double-comptage possible d'un semi-fini stocké (🟠).
- **Taux de rédemption fidélité : 10 IDR/pt en code vs 100 IDR/pt en doc** (money-facing, à trancher).
- **PB1** : doc pointe vers le compte dormant 2143 (au lieu de 2110 actif) — un dev suivant la doc poste au mauvais compte.
- Réglages inertes : `b2b_settings.aging_buckets` et `section_stock` (cache non garanti).

**Ce qui est manquant (documenté mais non bâti) :** réconciliation 3-way shift (cash+QRIS+EDC), promo usage-limits + codes promo manuels, B2B order-lifecycle complet (tables `b2b_orders/deliveries/price_lists`, machine 8 états, generate-invoice EF), Bank Reconciliation / CALK / VAT UI / AR-aging (compta), supplier returns / QC / attachments (achats), carousel promo customer-display, jobs loyalty expire/birthday.

**Top risques :**
1. 🔴 **Doc deploy dangereuse** : `10-deployment-ops/05` prescrit `supabase db reset/push/start` (interdits, Docker retiré) et cible le projet V2 incompatible `abjabuniwkqpfsenxljp`.
2. 🔴 **Doc sécurité entière = V2** : chemins src/ faux, RBAC inexistant, template `audit_logs` avec colonnes qui n'existent pas (perte silencieuse d'audit), registre de risques listant des failles déjà corrigées.
3. 🔴 **`DESIGN.md` (source de vérité design, 35 liens) et `CURRENT_STATE.md` absents du repo.**
4. 🟠 **Doc money-path fausse** : nom RPC `complete_order_with_payments` (pluriel) inexistant, EF absent des diagrammes.
5. 🟠 **Divergence BOM production/vente** (double-comptage matières).
6. 🟠 **Résidu sécurité** : gate `customers.read` (PII) = migration hard-cutover dont l'état d'application cloud est non vérifié.

---

## 2. Matrice d'état consolidée

> Pour rester lisible, je conserve **les lignes les plus significatives** de chaque domaine (features avec écart doc↔code, ou capacités phares). Les lignes purement « ok/ok/ok » triviales sont condensées. Les domaines complets sont représentés ; rien n'est tronqué silencieusement.

### POS order→payment
| feature | doc | impl | actif | works | preuve |
|---|---|---|---|---|---|
| Money-path RPC `complete_order_with_payment_v14` | partial | done | yes | ok | process-payment/index.ts:201 ; doc nomme `..._payments` (pluriel) inexistant |
| Parcours EF (vs RPC direct) | no | done | yes | ok | useCheckout.ts:211 POST functions/v1/process-payment |
| Fired counter-order (fire→pay) | no | done | yes | ok | fire_counter_order_v4 + pay_existing_order_v10 |
| Split tender / split-by-item | partial | done | yes | ok | domain splitTender/splitModes ; EF MAX_TENDERS=5 |
| Held orders draft (S35) + fired/reopen (Spec A) | partial/no | done | yes | ok | hold_order_v1 + hold_fired_order_v1/reopen_held_order_v1 |
| Codes permission POS sale | no | done | yes | risk | gates `pos.sale.*` ; doc cite `sales.*` ; code lui-même incohérent (sales.discount 32x) |
| Page inspection orders (02b) | partial | unknown | unknown | unknown | stub auto-déclaré, surface Backoffice |

### KDS / Tablet / Display / Shift
| feature | doc | impl | actif | works | preuve |
|---|---|---|---|---|---|
| Channel-name uniqueness (D19) | partial | done | yes | ok | crypto.randomUUID() dans l'effet + cleanup |
| KDS realtime (order_items) | no | done | yes | ok | useKdsRealtime postgres_changes ; doc dit « pas de Realtime » |
| Stations KDS (kitchen/barista/display) | partial | partial | yes | risk | 3 stations ; doc en liste 4 dont « Waiter » (faux) |
| Z-report 2-step sign flow | no | done | yes | ok | close_shift_v2 draft + sign_zreport_v2 PIN |
| Close shift = cash-only + JE variance auto | no/partial | done | yes | ok | close_shift_v2:107-145 ; doc dit « pas de JE auto » |
| Cash in/out mid-session | no | done | yes | ok | record_cash_movement_v2 ; doc dit « non supporté » |
| Réconciliation 3-way (cash+QRIS+EDC) | yes | absent | no | — | non bâti (V2-only) |
| Kiosk JWT + pairing (display) | no | done | yes | ok | useKioskAuth + kiosk-issue-jwt EF |
| Carousel promo idle (display_promotions) | yes | absent | no | — | aucune table/migration |

### Inventaire & ledger
| feature | doc | impl | actif | works | preuve |
|---|---|---|---|---|---|
| `record_stock_movement_v1` primitive | partial | done | yes | ok | 20260516000019 (unit, REVOKE) |
| `p_allow_negative` + `allow_negative_stock` (#122) | no | done | yes | ok | 20260710000020/021 default true |
| Guard négatif (doc = plancher dur) | partial | done | yes | risk | permissif par défaut → contredit la doc |
| display_stock isolation POS | no | done | yes | ok | 20260530184459 + DisplayStockPage |
| FEFO lots (expires_at ASC) | no | partial | yes | ok | 20260710000021:102-123 ; doc dit « pas de FEFO » |
| `get_stock_movement_ledger_v1` | no | done | yes | ok | 20260703000010 + 20260710000050 |
| B2B stock reservations | yes | partial | no | untested | table phantom (types.generated only) |
| EF `intersection_stock_movements` | yes | absent | no | broken | n'existe pas |

### Production & recettes
| feature | doc | impl | actif | works | preuve |
|---|---|---|---|---|---|
| `record_production_v1` atomique | no | done | yes | ok | 20260710000024 |
| Cascade sous-recettes depth-5 + cycle guard | no | done | yes | risk | doc dit « pas de sous-recettes / non récursif » |
| Flag-aware deduction (sale v14) | no | done | yes | ok | track→1x finished / deduct→cascade / sinon rien |
| Stop-rule BOM prod (leaf) vs vente (tracked) | — | done | yes | risk | divergence → double-comptage matières |
| Recipe versioning + baker % | no | done | yes/unknown | ok | doc dit « non supportés » |
| Batch / lots / yield variance / schedules | no/partial | done | yes | ok | undocumented |

### Produits / promos
| feature | doc | impl | actif | works | preuve |
|---|---|---|---|---|---|
| Variantes (linked-products, XOR, anti-nesting) | no | done | yes | ok | doc dit « pas de variantes » |
| Combos configurables (S47) | partial | done | yes | ok | combo_groups/options ; doc nomme 3 tables inexistantes |
| Promo auto-eval (`evaluate_promotions_v1`) | partial | done | yes | ok | doc dit « engine 100% client » |
| Promo usage-limits (max_uses/current_uses) | yes | absent | no | broken | aucune colonne/compteur |
| Codes promo manuels | yes | absent | no | broken | pas de colonne `code`, slug seulement |
| Multi-UOM (unit_alternatives/contexts) | partial | done | yes | ok | doc décrit `product_uoms` (jamais bâti) |
| Allergènes / costing / audit-log produit | no | done | yes | ok | undocumented |

### Achats / fournisseurs
| feature | doc | impl | actif | works | preuve |
|---|---|---|---|---|---|
| Receive base-unit qty+cost conversion | no | done | yes | ok | receive_purchase_order_v2 (×factor / ÷factor) — **l'item central demandé est correct** |
| GRN (`goods_receipt_notes`) | no | done | yes | ok | JE trigger on GRN INSERT |
| JE achat NON-PKP (VAT folded dans inventory) | no | done | yes | ok | doc décrit ligne « Dr VAT Input » erronée |
| Import historique (`import_purchases_v1` #116) | no | done | yes | ok | reports-only flag |
| États PO sent/confirmed/partially_received | yes | absent | no | broken | CHECK = draft/pending/partial/received/cancelled |
| Returns / QC / history / attachments / supplier_pricing | yes | absent | no | broken | 5 features documentées inexistantes |

### Compta
| feature | doc | impl | actif | works | preuve |
|---|---|---|---|---|---|
| Balance double-entrée + garde fiscal | yes | done | yes | ok | create_manual_je_v1:107 |
| PB1 10% NON-PKP → compte 2110 | no | done | yes | ok | doc enseigne 2143 (dormant) ❌ |
| close_fiscal_period_v1 / GL / TB / manual JE | partial/no | done | yes | ok | RPC S26 perm+PIN+REVOKE |
| Cash Treasury (wallets) | no | done | yes | ok | undocumented |
| `accountingEngine.ts` (cœur doc) | yes | absent | no | broken | 0 hit |
| Bank Recon / CALK / VAT UI / AR-aging | yes | absent | no | broken | ~5 pages non bâties |

### Dépenses
| feature | doc | impl | actif | works | preuve |
|---|---|---|---|---|---|
| State machine draft→submitted→approved→paid | partial | done | yes | ok | doc dit pending/approved/rejected (faux) |
| Thresholds multi-step + snapshot + SOD | partial/no | done | yes | ok | S28, undocumented |
| Manager-PIN re-auth approbation + lockout | no | done | yes | ok | approve_expense_v3 |
| `approve_expense_with_journal` (RPC central doc) | yes | absent | no | — | n'existe pas |
| Sync cash-expense → shift drawer | no | absent | no | — | trigger DROPPED (cash-wallets) ; doc le dit actif |

### B2B / customers / loyalty
| feature | doc | impl | actif | works | preuve |
|---|---|---|---|---|---|
| Création order crédit (gate + JE + stock) | partial | done | yes | ok | create_b2b_order_v1 |
| Paiement B2B idempotent + ledger | partial | done | yes | ok | record_b2b_payment_v1 |
| FIFO allocation per-invoice | yes | partial | yes | risk | snapshot JSONB only, jamais settle |
| Tables b2b_orders/deliveries/price_lists + 8 états | yes | absent | no | broken | orders partagé, status `b2b_pending` |
| Loyalty earn/redeem (inline v14) | partial | done | yes | risk | redeem = 10 IDR/pt vs doc 100 |
| loyalty_tiers (table) | yes | absent | no | broken | fonctions SQL + domain constants |
| customer_audit_log / customer_addresses | yes | absent | no | broken | écrit dans audit_logs générique |

### Reports / exports
| feature | doc | impl | actif | works | preuve |
|---|---|---|---|---|---|
| Archi config-driven ReportsConfig/ReportsPage | yes | absent | no | — | n'existe pas (réel = hub + ~28 pages lazy) |
| RPC `get_*_v1` (24) | no | done | yes | ok | features/reports/hooks |
| EF `generate-pdf` (17 templates, signed URL) | partial | done | yes | ok | doc dit « jsPDF client » |
| Excel (xlsx) | yes | absent | no | — | jamais bâti (CSV only) |
| Catalogue 57 reports | yes | absent | no | — | majorité fictive ; réel ~28 |
| EF `calculate-daily-report` | yes | absent | no | — | n'existe pas |

### Sécurité / auth
| feature | doc | impl | actif | works | preuve |
|---|---|---|---|---|---|
| PIN-JWT custom fetch wrapper (HS256) | partial | done | yes | ok | client.ts:35-100 |
| RBAC role_code + has_permission() | no | done | yes | ok | doc décrit modèle V2 inexistant |
| Sweep anon/PUBLIC REVOKE (S20) | no | done | yes | ok | ~40 migrations ; doc liste anon SELECT « OPEN » |
| Rate-limit durable (record_rate_limit_v1) | no | done | yes | ok | doc décrit in-memory 20/min |
| audit_logs template doc | partial | done | yes | risk | colonnes user_id/module/ip inexistantes |
| Gate `customers.read` (PII) | — | partial | yes | risk | hard-cutover, état cloud non vérifié |
| create_manual_je_v1 PIN-as-arg | no | partial | yes | risk | arg body au lieu de header |

### Plateforme
| feature | doc | impl | actif | works | preuve |
|---|---|---|---|---|---|
| Numérotation migrations monotone | partial | done | yes | ok | dernière 20260710000050 |
| Versioning RPC monotone (v14) | yes | done | yes | ok | EF call-site:201 |
| types.generated fraîcheur | no | done | yes | ok | reflète #126 |
| Workflow cloud-MCP (Docker retiré) | partial | done | yes | ok | seulement dans CLAUDE.md |
| schema_migrations caveat (~400 rows) | partial | unknown | unknown | risk | CLAUDE.md only, non vérifiable disque |
| hook `protect-files.sh` | yes | absent | no | broken | aucun .claude/hooks |

### Docs (complétude)
| feature | doc | impl | actif | works | preuve |
|---|---|---|---|---|---|
| 12 chapitres reference écrits | yes | done | yes | ok | 110 pages substantielles, aucun stub |
| `DESIGN.md` racine (source de vérité) | yes | absent | no | broken | 35 liens morts |
| `CURRENT_STATE.md` racine | yes | absent | no | broken | 9+ liens morts |
| 08-flows cross-links | partial | partial | yes | risk | ~17 pages flow jamais écrites |
| Liens internes renommés | yes | done | yes | risk | ~10 cibles renommées |

---

## 3. Findings priorisés (dédupliqués inter-domaines)

### 🔴 Critical

**F1 — `DESIGN.md` (source de vérité design) absent du repo** · doc-missing · *Docs*
Preuve : `02-design-system/01-luxe-dark-overview.md:4` déclare `/DESIGN.md` source de vérité, lié 35× dans 19 fichiers ; seul `docs/DESIGN_POS_AND_BACKOFFICE.md` existe.
Reco : restaurer `DESIGN.md` racine ou repointer les 35 liens vers `docs/DESIGN_POS_AND_BACKOFFICE.md` (vérifier l'équivalence ~397 lignes).

**F2 — Doc de déploiement DB dangereuse (commandes interdites + projet V2 incompatible)** · contradiction · *Plateforme*
Preuve : `10-deployment-ops/05` prescrit `supabase db reset/start/push --linked` (Docker retiré 2026-05-14) et lie `abjabuniwkqpfsenxljp` (V2 monolithe incompatible). CLAUDE.md : cible réelle = `ikcyvlovptebroadgtvd` via MCP.
Reco : réécrire au workflow cloud-MCP (`apply_migration`/`execute_sql`/`generate_typescript_types`), supprimer les étapes Docker + lien V2.

**F3 — Tout le chapitre `07-security/` documente le monolithe V2 retiré** · doc-stale · *Sécurité*
Preuve : 5 fichiers « Last verified 2026-05-03 », chemins `src/...` inexistants, RBAC `user_roles/user_has_permission` inexistant, template `audit_logs` insérant des colonnes absentes (perte silencieuse d'audit), inventaire 16 EF ≠ 14 réels, registre listant anon-SELECT « OPEN » alors que corrigé.
Reco : re-baseliner le chapitre sur V3 ou le marquer « V2-historique » ; corriger en priorité le template audit_logs et le modèle RBAC.

**F4 — Schéma promotions de la doc 13 entièrement fictif** · doc-stale · *Produits/promos*
Preuve : doc décrit `code`/`promotion_products` XOR/`days_of_week`/`time_*`/`promotion_usage` ; réel = `slug`/scopes array/`day_of_week_mask`/hour SMALLINT/`promotion_applications` ; enum `bogo` (pas `buy_x_get_y`).
Reco : réécrire Partie II contre `init_promotions.sql` + `promotion_applications`.

**F5 — Reference reports/B2B/expenses/accounting/inventory/production : Partie II décrit une architecture défunte** · doc-stale · *6 domaines*
Preuve : `accountingEngine.ts`, `ReportsConfig/ReportsPage`, `services/reporting`, `approve_expense_with_journal`, hooks `src/hooks/*` — tous inexistants ; réel = RPC SECURITY DEFINER + features/ folder.
Reco : régénérer toutes les Parties II contre `apps/*/src/features` + migrations.

### 🟠 High

**F6 — Nom RPC money-path faux + EF absent des diagrammes** · doc-stale · *POS*
Preuve : docs nomment `complete_order_with_payments` (pluriel, 0 hit) ; réel = `complete_order_with_payment_v14` SECURITY DEFINER appelé par `process-payment` EF (non documenté).
Reco : renommer, ajouter l'EF (rate-limit, idempotence, x-manager-pin, mapping erreurs P0001..P0010).

**F7 — Divergence stop-rule BOM : production (feuilles) vs vente (tracked)** · bug-risk · *Production*
Preuve : `record_production_v1` déduit `is_intermediate=FALSE` ; `_resolve_recipe_consumption_v1` s'arrête aux nœuds `track_inventory`. Un semi-fini tracké stocké séparément → re-consommation des matières brutes = double-comptage.
Reco : réconcilier les deux walkers (production devrait aussi s'arrêter aux nœuds trackés) ou documenter explicitement l'asymétrie voulue.

**F8 — Taux rédemption fidélité : 10 IDR/pt (code) vs 100 IDR/pt (doc)** · contradiction · *Loyalty*
Preuve : `complete_order_with_payment_v14:193` `points * 10`. Doc 08 §30/§32 « 1pt = 100 IDR ».
Reco : décision métier explicite puis aligner code ou doc (money-facing).

**F9 — PB1 : doc enseigne le compte dormant 2143 au lieu de 2110 actif** · contradiction · *Compta*
Preuve : 2110 seedé+mappé `SALE_PB1_TAX`, utilisé par tous les JE vente ; doc §32 « utiliser 2143, PAS 2110 ». Doublon : `get_balance_sheet_v1` somme 2110 ET 2143.
Reco : inverser le pitfall ; désactiver/merger 2143.

**F10 — Codes permission doc↔code partout désalignés** · contradiction · *POS, Achats, Compta, Produits, Sécurité, Shift*
Preuve : `pos.sale.*` vs `sales.*` ; `purchasing.po.*` vs `inventory.*` ; perms reports sans suffixe `.read` ; `products.read` vs `products.view` ; `products.pricing/import/export` inexistants ; matrice appendix cite rôles V2 (Cook/Accountant) + RPC `update_role_permissions` inexistant.
Reco : régénérer la matrice des codes depuis les `role_permissions` seedés V3 ; signaler l'incohérence interne `sales.*`/`pos.sale.*` au domaine sécurité.

**F11 — Shift doc : 3-way recon / « pas de JE auto » / « pas de cash in-out » — tous faux** · contradiction · *Shift*
Preuve : close cash-only + JE variance auto (4910/5910) + cash in/out (`record_cash_movement_v2`) wirés.
Reco : réécrire doc 12 autour du close cash-only + Z-report ; déplacer QRIS/EDC en annexe V2.

**F12 — B2B doc 09 : architecture entière jamais bâtie** · doc-stale · *B2B*
Preuve : tables `b2b_orders/items/deliveries/history/price_lists`, machine 8 états, `generate-invoice` EF, `arService` — inexistants ; réel = MVP crédit-AR sur `orders` partagé + 2 RPC + 3 routes.
Reco : réécrire Partie II au MVP réel ; déplacer le design élaboré en section « planned/not-built ».

**F13 — Features documentées comme bâties mais absentes** · gap · *plusieurs*
Preuve : promo usage-limits + codes manuels ; Bank Recon/CALK/VAT-UI/AR-aging (compta, ~5 pages) ; supplier returns/QC/history/attachments/supplier_pricing (achats) ; carousel promo display ; réconciliation 3-way ; recounting/manager_validated shift ; jobs loyalty expire/birthday ; Excel export.
Reco : déplacer chacune en section backlog « non bâti » clairement labellisée (un manager croyant qu'une promo se plafonne automatiquement serait dans l'erreur).

**F14 — `CURRENT_STATE.md` absent (9+ liens)** · doc-missing · *Docs*
Reco : repointer vers `docs/workplan/backlog-by-module/00-README.md` ou restaurer.

**F15 — `08-flows` : ~17 pages flow cross-linkées jamais écrites** · doc-stale · *Docs*
Preuve : modules lient `06-held-orders.md`, `07-locked-item-cancel.md`, `13-expense-approval-je.md`, etc. (held-orders & locked-item-cancel sont des features réelles mergées).
Reco : choisir un schéma canonique (renommer vers les 12 flows existants ou écrire les pages manquantes).

**F16 — Registre de risques sécurité périmé** · doc-stale · *Sécurité*
Preuve : `07-known-risks.md` liste anon-SELECT « OPEN » ; omet sweep S20 + remédiation 2026-05-31 (migrations 20260619000020..043).
Reco : régénérer depuis le set migrations + MEMORY.

### 🟡 Medium

**F17 — Codé mais non documenté (capacités phares absentes des docs)** · code-undocumented · *plusieurs*
Display-stock isolation (inventaire) ; flux Z-report sign/void/snapshot (reports & shift) ; Cash Treasury wallets (compta & dépenses) ; thresholds/SOD/snapshot/PIN dépenses ; variantes & allergènes & costing (produits) ; fire→pay counter (POS) ; batch/yield/schedules (production) ; kiosk JWT pairing (display) ; import_purchases_v1 (achats) ; Cost & Spend Analytics #117 (reports) ; anon/PUBLIC REVOKE + verify-manager-pin (sécurité).
Reco : ajouter une section par capacité dans le module owner.

**F18 — Réglages inertes (no-op silencieux)** · bug-risk · *B2B, Inventaire*
Preuve : `b2b_settings.aging_buckets` ne pilote pas `view_ar_aging` (commentaire migration) ; `section_stock` cache non gardé (CHECK omis, reset-à-0 possible).
Reco : câbler ou masquer/labelliser « non appliqué ».

**F19 — FIFO B2B enregistre mais ne settle jamais par facture** · gap · *B2B*
Preuve : `record_b2b_payment_v1:131-151` build JSONB audit only ; pas d'update per-order. Orders `b2b_pending` ne passent jamais `paid`.
Reco : implémenter le settlement per-invoice ou documenter le tracking au seul niveau balance client.

**F20 — Contradictions doc production diverses** · contradiction · *Production*
Preuve : doc dit sous-recettes/versioning/baker% « non supportés » (tous bâtis) ; `quantity_waste` « ne déduit rien » (consomme produced+waste) ; permission `inventory.create` (réel `inventory.production.create`) ; JE via service (réel trigger stock-movement).
Reco : corriger Partie I §15 + pitfalls.

**F21 — Cibles hors-reference mortes** · doc-stale · *Docs*
Preuve : glossaire mal chemin (`docs/_archive/` vs `docs/`, 15×), `docs/ux/v2-token-inventory.md` (14×, jamais écrit), set `docs/audit/01..08` absent, `docs/workplan/reference/04-modules/*` (~60×, vrai = `docs/reference/`).
Reco : corriger chemins, écrire ou supprimer.

**F22 — Résidu PII : gate `customers.read` non vérifié appliqué** · gap/security · *Sécurité*
Preuve : `20260621000018` hard-cutover « appliquer EN DERNIER après rebuild POS » ; MEMORY marque PARTIAL. Tant que non appliqué, tout rôle authentifié lit la PII clients.
Reco : confirmer l'état cloud + usage `search_customers_v2/get_customer_v2` ; tracker au registre.

**F23 — Méthodes de paiement / colonnes / enums divergents** · doc-stale · *POS, Inventaire, Dépenses*
Preuve : doc 03 liste `split`/`credit` (EF = 6 tenders) ; movement_type enum doc (`sale_pos`/`sale_b2b`/`stock_in`) inexistant ; colonnes expenses (`tax_amount`/`total_amount`/`supplier_id`) ≠ schéma (`vat_amount`/`vendor_name`).
Reco : aligner tables/enums sur le schéma réel.

### ⚪ Low

**F24** — Tous les 12 chapitres reference sont écrits (aucun stub) → corriger toute note de planning prétendant le contraire · contradiction · *Docs*.
**F25** — Commentaire header `generate-pdf` dit 12 templates, registre = 17 · doc-stale · *Reports*.
**F26** — `package.json` garde `db:reset: supabase db reset` (interdit) → remplacer par echo cloud-MCP · bug-risk · *Plateforme*.
**F27** — `next_expense_number` format EXP-…-NNNN (4 chiffres) + signature `p_date` ≠ doc · doc-stale · *Dépenses*.
**F28** — ~340 liens reference→code morts (path-relativity) · doc-stale · *Docs*.
**F29** — B2B sans PB1 (`tax_amount=0`) — à confirmer avec finance si wholesale PB1-exempt · bug-risk · *Compta/B2B*.
**F30** — `create_manual_je_v1` PIN en arg body (vs header S25) — exception à router via EF ou documenter · security · *Sécurité*.
**F31** — `intersection_stock_movements` / `calculate-daily-report` EF documentés inexistants · doc-stale · *Inventaire/Reports*.
**F32** — schema_migrations caveat (~400 rows dropped, max 20260629000012) seulement dans CLAUDE.md → drift detection dégradé · gap · *Plateforme*.

---

## 4. Plan de correction proposé (phasé)

### Phase A — Quick-wins (corrections mécaniques / sécurité doc immédiate)
- **A1** [Plateforme, S] Réécrire `10-deployment-ops/05` + `02-supabase-environments` au workflow cloud-MCP, retirer commandes Docker + lien V2 (**F2**, dangereux). Corriger path types `packages/supabase/src/types.generated.ts`, retirer `protect-files.sh`.
- **A2** [Compta, S] Inverser le pitfall PB1 2110/2143 + désactiver 2143 (**F9**).
- **A3** [Sécurité, S] Corriger le template `audit_logs` (colonnes `actor_id/action/entity_type/entity_id/metadata`) et le format PIN (6 digits) (**F3** partiel).
- **A4** [Docs, S] Repointer les 35 liens `DESIGN.md` + 9 liens `CURRENT_STATE.md` + glossaire (15×) + `docs/workplan/reference→docs/reference` (~60×) (**F1, F14, F21**).
- **A5** [Docs, S] Search-replace des ~10 liens internes renommés (`10-accounting-finance`, `02-pos-cashier`, `02-permissions`, etc.) (**F15** partiel).
- **A6** [Plateforme, S] Neutraliser `db:reset` dans package.json ; corriger header `generate-pdf` (17) (**F26, F25**).
- **A7** [Sécurité, M] **Vérifier l'état d'application cloud du gate `customers.read`** (PII) et l'usage RPC v2 par le POS ; tracker au registre (**F22**) — *priorité sécurité réelle*.

### Phase B — Structurants (décisions code + réconciliations)
- **B1** [Production, M] Trancher la stop-rule BOM production/vente et aligner les deux walkers ou documenter l'asymétrie (**F7**) — *seul vrai risque code*.
- **B2** [Loyalty, S] Décision métier 10 vs 100 IDR/pt puis aligner (**F8**).
- **B3** [B2B, M] Implémenter settlement FIFO per-invoice OU documenter le tracking balance-only ; câbler ou masquer `aging_buckets` (**F19, F18**).
- **B4** [Inventaire, S] Documenter/garder `section_stock` comme cache non autoritatif ; seeding initial par section (**F18**).
- **B5** [Sécurité, M] Router `create_manual_je_v1` PIN via header/EF ou documenter l'exception (**F30**).
- **B6** [Compta/B2B, S] Confirmer avec finance le statut PB1 du wholesale ; ajouter la ligne PB1 si dû (**F29**).
- **B7** [Plateforme, S] Capturer le caveat schema_migrations dans un runbook deploy (survie à la churn CLAUDE.md) (**F32**).

### Phase C — Complétude documentaire (réécritures Partie II + résorption pages manquantes)
- **C1** [6 domaines, L] Réécrire les Parties II contre `features/` + RPC réels : POS (money-path+EF), KDS/shift (Z-report, cash-only, cash in/out), inventaire (display-stock, negative-stock, FEFO, ledger), production (RPC atomique, batch/lots/yield), produits/promos (variantes, combos S47, UOM contexts, eval RPC), achats (GRN, conversion base-unit, NON-PKP, import), compta (S26 cockpit, Cash Treasury), dépenses (thresholds/SOD/PIN/cash-wallet), B2B (MVP réel), reports (~28 reports + EF), sécurité (RBAC V3, anon REVOKE, rate-limit durable) (**F4, F5, F6, F11, F12, F16, F17, F20, F23**).
- **C2** [Docs, M] Marquer explicitement « non bâti / backlog » : usage-limits & codes promo, Bank Recon/CALK/VAT-UI/AR-aging, supplier returns/QC/attachments/supplier_pricing, carousel display, réconciliation 3-way, jobs loyalty, Excel export, B2B order-lifecycle (**F13**).
- **C3** [Docs, M] Écrire ou renommer les ~17 pages `08-flows` (prioriser held-orders Spec A + locked-item-cancel, features mergées) (**F15**).
- **C4** [Docs, S] Régénérer la matrice des codes de permission depuis les `role_permissions` seedés (**F10**) ; corriger enums/colonnes (**F23**).
- **C5** [Docs, S] Régénérer `03-database/07-migrations-history` (V3, 616 fichiers) ou la bannière « V2-only » ; corriger les ~340 liens code (**F24, F28, F31**).
- **C6** [Plateforme, S] **Régénération types : NON requise** — `types.generated.ts` est à jour (#126, reflète 20260710000020..050). À re-déclencher seulement après le prochain schema change.

**Effort agrégé estimé :** Phase A ≈ 8 items S (1 sprint léger), Phase B ≈ 7 items S/M (décisions + petits patchs code), Phase C ≈ rewrite L (chantier doc dédié, parallélisable par module).

---

## 5. Zones non vérifiées / incertitudes

- **`schema_migrations` cloud (caveat ~400 rows dropped, max `20260629000012`)** : documenté uniquement dans CLAUDE.md, **non vérifiable depuis le disque**. Conséquence : la détection de drift via `list_migrations` est dégradée sous ce watermark. Non reconstruit (works=risk).
- **B2B stock reservations** (`stock_reservations`, `get_available_stock`) : table présente mais référencée **uniquement dans `types.generated.ts`**, aucun wiring app → impossible de confirmer un comportement actif (active=no, untested).
- **PB1 monthly report** (`calculate_pb1_payable_v1`, `get_pb1_report_v1`) : RPC existent mais **aucune page BO ne les câble** → exécution réelle non observée (active=unknown, untested).
- **Opname finalize RPCs** : implémentés mais non exercés par cet audit (works=untested).
- **Production suggestions / schedules / baker %** : migrations présentes, wiring/usage non confirmé (active=unknown).
- **Page d'inspection orders (02b)** : stub auto-déclaré, surface **Backoffice** hors money-path → non vérifié (implémenté/actif/works = unknown).
- **Jobs loyalty expire/birthday, reservation-expiry cron** : aucune fonction/cron trouvée → présumés non bâtis, mais l'absence côté cloud (pg_cron) n'a pas été interrogée directement (untested).
- **État d'application cloud du gate `customers.read` (20260621000017/18)** : dépend du rebuild/redeploy POS ; **non confirmé appliqué** → la lecture PII pourrait rester ouverte (à trancher en B/Phase A7).
- **Set d'audit `docs/audit/01..08`** : référencé mais absent — **intention non clarifiée** (livrable planifié jamais produit vs supprimé).
- **Cohérence interne des codes permission** (`sales.create`/`sales.discount` coexistant avec `pos.sale.*`) : constatée mais la source canonique réelle **n'a pas été tranchée** par cet audit (renvoyée au domaine sécurité).
---

## 6. Critique de complétude & prochaines vérifications

### (a) Ce que l'audit a probablement manqué

- **Aucune vérification du schéma cloud réel.** Tout l'audit oppose *doc ↔ code-sur-disque* ; il n'a jamais interrogé le projet `ikcyvlovptebroadgtvd` (ni `list_migrations`, ni `get_advisors`, ni `execute_sql`). Or les MCP étaient disponibles. Conséquence : l'état d'application des migrations, les advisors RLS/perf, et les gates « hard-cutover » (F22 `customers.read`) restent des *unknown* alors qu'ils étaient vérifiables en quelques requêtes. C'est le trou méthodologique central.

- **« works=ok » est inféré, jamais exécuté.** Aucun test n'a été lancé (`pnpm test`, smoke, pgTAP), aucune transaction réelle observée. La colonne `works` reflète une lecture de code, pas un runtime. Particulièrement fragile pour le money-path, qualifié « solide » alors que **MEMORY documente deux bugs browser-only non résolus** ignorés par l'audit : `x-app` bloque les EFs via `functions.invoke` (CORS) et `getSession()` retourne null sous PIN-auth → casse le checkout EF — *invisibles en tests mockés*. Affirmer « EF money-path actif/ok » sans preuve runtime contredit la mémoire projet.

- **Sous-système entièrement non couvert : les coques natives & l'offline.** POS = Tauri (desktop), waiter = Capacitor (mobile). Aucun des 13 domaines n'audite le packaging natif, la file offline, la résolution de conflits de sync, ni le comportement réseau dégradé. C'est le cross-cut le plus absent.

- **Realtime traité en surface.** Seule l'unicité de canal (D19) est vue ; pas d'audit systémique des cleanup d'abonnement, RLS realtime, reconnexion, ou cohérence multi-device — pourtant le cœur de la coordination KDS/tablette/display.

- **Performance / scale / advisors absents.** `#124` (route-split) et `#125` (dispatch/print routing, dernier commit) à peine effleurés ; aucun N+1, couverture d'index, cadence de refresh des MV, ni `get_advisors`.

- **Claim douteux sur la fraîcheur des types.** L'audit affirme `types.generated.ts` à jour (#126), mais le git status montre ce fichier **modifié non commité** + la migration `20260710000050` *untracked* → les types pourraient ne PAS refléter le dernier schéma. Non vérifié.

- **Rounding / devise IDR (PB1, fidélité, splits)** et **secrets/env EF** : jamais audités.

### (b) Top vérifications pour fermer les écarts

1. **Live cloud sweep via MCP** — `list_migrations` + `get_advisors(security|performance)` + `execute_sql` ciblés pour trancher d'un coup, avec preuve DB réelle : gate `customers.read` appliqué ? (F22), 2143 réellement dormant ? (F9), taux fidélité effectif 10 vs 100 ? (F8), watermark `schema_migrations` (F32). *Le plus haut ROI, le moins coûteux.*

2. **Exécuter le parcours money-path réel** (test suite + un checkout dev de bout en bout) pour confirmer/infirmer les bugs CORS `x-app` et `getSession()=null` de MEMORY — convertir « works=ok » inféré en observé sur le seul chemin qui touche l'argent.

3. **Réconcilier `types.generated.ts` avec le cloud** — regénérer et diff contre la version commitée ; statuer sur la migration `…050` non trackée (F26 connexe). Un drift de types est la cause #1 de CI cassée sur ce repo.

4. **Auditer le cross-cut realtime + coques natives (Tauri/Capacitor/offline)** — le seul sous-système jamais couvert ; au minimum un passage sur cleanup de canaux, file offline et sync.

5. **Tracer une transaction de bout en bout pour le double-comptage BOM (F7)** — produire un semi-fini tracké puis le vendre sur données dev, et observer les mouvements stock réels : c'est le seul vrai risque code, et il se prouve par exécution, pas par lecture.