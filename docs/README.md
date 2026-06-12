# 📚 The Breakery ERP — Documentation

> **Last updated** : 2026-06-12
> **Périmètre** : `docs/reference/` est **la référence canonique du monorepo V3** (apps/pos + apps/backoffice + packages/*) — source de vérité évergreen, maintenue à jour. L'état d'avancement par session vit dans `docs/workplan/`. Le dossier legacy `docs/_archive/objectif-travail-v2/` capture l'ancienne **vision business V2** (AppGrav monolithe, jamais déployée) et n'est conservé que comme référence métier historique — en cas de divergence, `reference/` fait foi.
>
> **Pont V2 ↔ V3** : pour les renommages de symboles (`complete_order_with_payments` → `complete_order`, hooks renommés, pages déplacées, améliorations V3 sans équivalent V2), voir **[`V2_V3_GLOSSARY.md`](V2_V3_GLOSSARY.md)** — c'est le mapping de référence à consulter quand un nom V2 ne se retrouve pas dans le code V3.

---

## 🗂️ Structure de cette doc

```
docs/
├── README.md                              ← Tu es ici
├── DESIGN_POS_AND_BACKOFFICE.md           ← Design détaillé des deux apps (~600 lignes)
├── reference/                             ← LA RÉFÉRENCE — 12 chapitres + 19 modules fusionnés
│   ├── README.md                          ← Index complet de la référence
│   ├── 00-overview/                       ← Contexte produit, business overview, tech stack, glossaire
│   ├── 01-architecture/                   ← Frontend, state, routing, data flow, bundling
│   ├── 02-design-system/                  ← Luxe Dark, tokens, shadcn, layouts, responsive
│   ├── 03-database/                       ← Schéma, tables, RPC, triggers, RLS, migrations
│   ├── 04-modules/                        ← LES 19 MODULES MÉTIER (4 parties chacun)
│   ├── 05-integrations/                   ← Supabase, Edge Functions, Sentry, Capacitor, PWA…
│   ├── 06-lan-architecture/               ← Hub/client, discovery, heartbeat, print routing
│   ├── 07-security/                       ← PIN auth, RLS, RBAC, Edge Function security
│   ├── 08-flows-end-to-end/               ← 12 flows : POS sale, void/refund, B2B, KDS lifecycle…
│   ├── 09-testing/                        ← Stratégie, unit, component, running tests
│   ├── 10-deployment-ops/                 ← Vercel, Supabase env, Android/iOS build, monitoring
│   ├── 11-conventions/                    ← Coding, file org, React patterns, Supabase patterns
│   └── 12-appendices/                     ← Business rules, permission codes, env vars, V2↔V3
└── workplan/                              ← LE TRAVAIL — plans, specs, backlog
    ├── plans/                             ← Plans de session datés (sessions 1-42+, archive/ pour les sessions mergées)
    ├── specs/                             ← Specs de session datées
    └── backlog-by-module/                 ← Backlog opérationnel par module (TASK-XX-NNN)
```

---

## 🚀 Par où commencer ?

| Tu es… | Lis dans cet ordre |
|---|---|
| **Nouveau dev** | [reference/00-overview/01-product-context.md](reference/00-overview/01-product-context.md) → [02-business-overview.md](reference/00-overview/02-business-overview.md) → [04-modules/02-pos-cart-orders.md](reference/04-modules/02-pos-cart-orders.md) → [04-modules/06-inventory-stock.md](reference/04-modules/06-inventory-stock.md) → [04-modules/10-accounting-double-entry.md](reference/04-modules/10-accounting-double-entry.md) (couvre 80% du système) |
| **Designer / UX** | [DESIGN_POS_AND_BACKOFFICE.md](DESIGN_POS_AND_BACKOFFICE.md) → [reference/02-design-system/](reference/02-design-system/) → Partie IV de chaque module dans [04-modules/](reference/04-modules/) |
| **Architecte solution** | [reference/01-architecture/01-system-architecture.md](reference/01-architecture/01-system-architecture.md) → [reference/04-modules/00-modules-index.md](reference/04-modules/00-modules-index.md) → [reference/06-lan-architecture/](reference/06-lan-architecture/) |
| **Onboarding cashier** | [reference/04-modules/02-pos-cart-orders.md](reference/04-modules/02-pos-cart-orders.md) → [04-modules/12-cash-register-shift.md](reference/04-modules/12-cash-register-shift.md) (le reste tu n'y as pas accès) |
| **Onboarding manager** | [reference/00-overview/02-business-overview.md](reference/00-overview/02-business-overview.md) → modules POS + ORDERS + CUSTOMERS + INVENTORY + REPORTS |
| **Onboarding comptable** | [reference/00-overview/02-business-overview.md](reference/00-overview/02-business-overview.md) → [04-modules/10-accounting-double-entry.md](reference/04-modules/10-accounting-double-entry.md) → [04-modules/11-expenses.md](reference/04-modules/11-expenses.md) → [04-modules/09-b2b-wholesale.md](reference/04-modules/09-b2b-wholesale.md) → [04-modules/14-reports-analytics.md](reference/04-modules/14-reports-analytics.md) |
| **Auditeur métier** | [reference/00-overview/02-business-overview.md](reference/00-overview/02-business-overview.md) → [04-modules/10-accounting-double-entry.md](reference/04-modules/10-accounting-double-entry.md) → [04-modules/14-reports-analytics.md](reference/04-modules/14-reports-analytics.md) → [04-modules/19-settings-configuration.md](reference/04-modules/19-settings-configuration.md) |
| **Sécurité** | [reference/07-security/](reference/07-security/) → [04-modules/01-auth-permissions.md](reference/04-modules/01-auth-permissions.md) → [03-database/06-rls-policies.md](reference/03-database/06-rls-policies.md) |
| **Migration V2 → V3** | [reference/12-appendices/06-cross-reference-with-v3.md](reference/12-appendices/06-cross-reference-with-v3.md) |

---

## 📐 Le pattern des 19 modules

Chaque fichier dans [`reference/04-modules/`](reference/04-modules/) suit la **même structure en 4 parties** :

| Partie | Contient | Pour qui |
|---|---|---|
| **I — Vue fonctionnelle** | Raison d'être, jobs-to-be-done, écrans, invariants, utilisateurs, backlog métier | Product owner, onboarding, audit métier |
| **II — Référence technique** | Tables DB, hooks, services, composants, RPC, RLS, routes, workflows, pitfalls | Dev qui implémente |
| **III — Backlog opérationnel** | Lien vers `workplan/backlog-by-module/XX-...md` (tâches P0-P3 avec critères d'acceptation) | Suivi de sprint |
| **IV — Design & UX** | Thèmes, écrans, layout patterns, composants signature, états visuels, microcopy, backlog UX | Dev frontend, designer |

---

## 🗺️ Carte des 19 modules métier (+ annexe 02b)

| # | Module | App | Fichier |
|---|---|---|---|
| 01 | Auth & Permissions (Users, Roles, RBAC, Audit) | Cross-cutting | [01-auth-permissions.md](reference/04-modules/01-auth-permissions.md) |
| 02 | POS — Cart, Orders, Modifiers, Promotions | **POS** | [02-pos-cart-orders.md](reference/04-modules/02-pos-cart-orders.md) |
| 02b | Orders — Dashboard de suivi (Backoffice view) | Backoffice | [02b-orders.md](reference/04-modules/02b-orders.md) |
| 03 | Payments & Split | POS | [03-payments-split.md](reference/04-modules/03-payments-split.md) |
| 04 | KDS Kitchen — 4 stations | **POS** | [04-kds-kitchen.md](reference/04-modules/04-kds-kitchen.md) |
| 05 | Products & Categories (Combos, Modifiers, Pricing) | Backoffice | [05-products-categories.md](reference/04-modules/05-products-categories.md) |
| 06 | Inventory & Stock (7 outils + 3 satellites POS) | Backoffice + POS | [06-inventory-stock.md](reference/04-modules/06-inventory-stock.md) |
| 07 | Purchasing & Suppliers (PO cycle, GRN) | Backoffice | [07-purchasing-suppliers.md](reference/04-modules/07-purchasing-suppliers.md) |
| 08 | Customers & Loyalty (Retail + B2B base partagée) | Backoffice + POS | [08-customers-loyalty.md](reference/04-modules/08-customers-loyalty.md) |
| 09 | B2B Wholesale (commandes, livraisons, FIFO) | Backoffice | [09-b2b-wholesale.md](reference/04-modules/09-b2b-wholesale.md) |
| 10 | Accounting (Double-entry SAK EMKM, PB1) | Backoffice | [10-accounting-double-entry.md](reference/04-modules/10-accounting-double-entry.md) |
| 11 | Expenses (Draft→Approved→Paid) | Backoffice | [11-expenses.md](reference/04-modules/11-expenses.md) |
| 12 | Cash Register & Shift (5 modales du cycle) | **POS** | [12-cash-register-shift.md](reference/04-modules/12-cash-register-shift.md) |
| 13 | Promotions & Combos (engine auto-eval) | Backoffice + POS | [13-promotions-discounts.md](reference/04-modules/13-promotions-discounts.md) |
| 14 | Reports & Analytics (7 catégories, ~61 reports) | Backoffice | [14-reports-analytics.md](reference/04-modules/14-reports-analytics.md) |
| 15 | Production & Recipes (lots, conversion d'unités) | Backoffice | [15-production-recipes.md](reference/04-modules/15-production-recipes.md) |
| 16 | Customer Display (`/display`, Active / Idle) | **POS** | [16-display-customer.md](reference/04-modules/16-display-customer.md) |
| 17 | Tablet Ordering (`/tablet`, LAN client) | **POS** | [17-tablet-ordering.md](reference/04-modules/17-tablet-ordering.md) |
| 18 | Mobile Shell (Capacitor, PWA) | Cross-cutting | [18-mobile-shell.md](reference/04-modules/18-mobile-shell.md) |
| 19 | Settings (6 groupes, ~23 pages) | Backoffice | [19-settings-configuration.md](reference/04-modules/19-settings-configuration.md) |

Voir [00-modules-index.md](reference/04-modules/00-modules-index.md) pour la carte des dépendances inter-modules (diagramme Mermaid).

---

## 📋 Conventions de cette doc

- **Liens internes** : chemins relatifs au fichier courant (`../04-modules/...`, `./XX-...md`)
- **Références au code** : format `chemin/du/fichier.ts:42` quand une ligne précise est citée
- **Diagrammes** : Mermaid (rendu natif sur GitHub, GitLab, et la plupart des éditeurs Markdown)
- **Statuts** : ✅ implémenté · 🚧 partiel · ⏳ planifié · 🐛 bug connu · ⚠️ pitfall
- **Langue** : français pour la doc, **anglais pour les noms de code/UI/types/microcopy**
- **Last verified** : chaque page de référence porte une date `Last verified: AAAA-MM-JJ`. Si tu modifies une page, mets à jour la date.

---

## 🔧 Documents externes

| Document | Usage |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | Instructions agents IA, conventions condensées, **Active Workplan** (état courant + historique par session) |
| [`reference/02-design-system/`](reference/02-design-system/) | Tokens techniques canoniques (Luxe Dark, variables CSS, scales, classes Tailwind) |
| [`DESIGN_POS_AND_BACKOFFICE.md`](DESIGN_POS_AND_BACKOFFICE.md) | Design détaillé des deux apps (~600 lignes) — référence Partie IV des modules |
| [`README.md`](../README.md) | Vue d'ensemble du repo + setup |
