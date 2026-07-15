# Remise à plat totale — plan maître

> **Date :** 2026-07-04 · **Statut : PROPOSÉ — en attente de validation utilisateur**
> **Méthode :** deux analyses **indépendantes** menées en parallèle le 2026-07-03/04 —
> (A) **analyse documentaire** : 4 agents sur docs/reference, docs/workplan (audits + backlog 27 fichiers), historique specs/plans/archives, et recoupement du document produit `The_Breakery_ERP_Description_v1.2.docx` contre le code ;
> (B) **analyse code/état réel** (interdite de lecture de docs/) : 3 agents sur apps/pos, apps/backoffice, supabase+packages, complétée par l'interrogation **live** de la base cloud V3 (`ikcyvlovptebroadgtvd`).
> Ce document est la synthèse croisée et le plan d'exécution. Rien n'a été modifié (ni code, ni doc) en dehors de ce fichier.

---

## 1. Diagnostic — pourquoi « tout semble parti dans tous les sens »

Le sentiment de départ était : *modules métier devenus inexistants ou inutilisables, permissions disparues, plan zappé, contexte oublié*. Le croisement des deux analyses donne un diagnostic précis, et il est **plus rassurant que la perception** :

### 1.1 Le système central est sain, mature et à jour

Constaté indépendamment par l'analyse code ET par la base live :

- **RBAC intact et actif** : 147 permissions sur 35 domaines en base live ; 5 rôles cohérents (SUPER_ADMIN 147 droits, ADMIN 146, MANAGER 103, CASHIER 14, waiter 8) ; `has_permission` verrouillé par une garde CI ; **215 `PermissionGate`** dans l'UI. **Les permissions n'ont jamais disparu.**
- **Couche serveur mature** : ~87 tables actives, ~230 RPCs à jour (money-path `complete_order_with_payment_v17` confirmé live), 14 Edge Functions actives, 131 suites pgTAP, types générés alignés.
- **POS complet** : caisse, KDS, tablette serveur, écran client — les 4 surfaces sont fonctionnellement complètes et testées (états loading/error/empty/offline couverts).
- **BackOffice majoritairement mûr** : Rapports (29/29 pages branchées, 0 stub), Comptabilité, Dépenses, Achats, Catalogue, Commandes, B2B, Utilisateurs = complets.

### 1.2 Les 4 vraies sources de la confusion

| # | Source | Preuve | Effet ressenti |
|---|---|---|---|
| 1 | **La page d'accueil du BackOffice est un stub vide** : `Dashboard.tsx` rend des zéros hardcodés, la RPC `get_dashboard_overview_v1` n'a jamais été câblée (`TODO(session-15)`), et la route n'est pas gatée | `apps/backoffice/src/pages/Dashboard.tsx` | Première impression : « l'app est vide/cassée » |
| 2 | **L'édition RBAC est impossible depuis l'app** : les 2 écrans de matrice permissions sont en lecture seule, `rbac.update` n'est consommé nulle part, et les libellés mentent (tuile « RBAC Editor », commentaire « full RBAC editing UI ») | `PermissionsMatrixPage.tsx`, `SettingsPermissionsPage.tsx`, `Sidebar.tsx:231` | « Les permissions ont disparu » — en fait elles existent mais sont invisibles/inéditables |
| 3 | **La doc de référence décrit un autre logiciel** : 20 fiches modules figées à mi-mai (S13) avec des features V2 jamais portées (retours fournisseurs, price-lists B2B, mobile shell, rôles barista/kitchen/accountant fictifs) ; 84/108 fichiers reference datés du 03/05 ; chapitres carrément dangereux (database et deployment-ops pointent le projet Supabase **V2** et des commandes Docker interdites ; security décrit un RBAC fictif) | Audit `2026-07-03-modules-reference-divergence-audit.md` + rapport ref-mapper | « Des modules ont disparu » — ils n'ont jamais existé en V3 ; « le plan est zappé » — le plan lu était périmé |
| 4 | **Vitrines inachevées visibles** : hub Settings truffé de tuiles « (Soon) », page Security quasi vide, Customer Categories aux boutons disabled, LAN devices en lecture seule | Rapport code-bo §7 | « Modules inutilisables » |

**Conclusion : le mal est à ~80 % documentaire/pilotage et ~20 % code (angles morts UI visibles).** Repartir de zéro serait la pire option : 57 sessions de travail dont le socle (money-path, compta, sécurité, stock) est solide et couvert par des tests.

---

## 2. Le nouveau cahier des charges : le docx Description v1.2

`The_Breakery_ERP_Description_v1.2.docx` (2026-07-03, 25 modules, non technique) a été recoupé module par module contre le code : **fiable à ~85 %** — 21/25 modules confirmés, **aucun** « À venir » sous-estimé. Quatre embellissements à corriger avant adoption :

1. **Module 7 (Achats)** : le contrôle qualité article par article et les retours fournisseurs automatiques **n'existent pas** (aucune table return/QC dans les 664 migrations) → basculer en « À venir ».
2. **Module 9 (B2B)** : la « facture officielle en PDF » **n'existe pas** (17 templates generate-pdf = tous des rapports) → reformuler « liste/suivi des factures » ; PDF facture → « À venir ».
3. **Module 12 (Caisse physique)** : le comptage de clôture est **cash uniquement** (`close_shift_v2` ne prend que `p_counted_cash`), pas « en trois volets » → reformuler ; 3 volets → « À venir ».
4. **Module 8 (Clients)** : le QR code membre est un placeholder « coming soon » (pas de colonne `member_number`/`qr_code`) → « À venir ».

**Décision proposée :** après ces 4 corrections, le docx (converti en `docs/product/DESCRIPTION.md`, versionné) devient **LA référence produit** — le document que tout le monde (toi, les sessions futures, la doc technique) prend comme point de départ. Les fiches `04-modules` seront ensuite régénérées depuis le code, module par module, en cohérence avec lui.

---

## 3. Carte documentaire — garder / bannière / réécrire / archiver

Synthèse des rapports ref-mapper, backlog-consolidator et history-mapper :

### ✅ Garder tel quel (fiable)
- `docs/V2_V3_GLOSSARY.md` — le pont V2→V3, indispensable.
- `docs/adr/003-pkp-status-non-pkp.md` — décision valide ; modèle d'ADR à répliquer.
- `docs/README.md` (06-28) — carte d'entrée, à actualiser légèrement.
- `docs/reference/11-conventions/` (sauf `02-file-organization`) + `07-context7-library-ids`.
- `docs/design-audits/POS-payment-caisse-2026-06-25.md` et `docs/audit/*` (audits datés exacts).
- Historique specs/plans/INDEX (append-only, exact par construction).

### 🟠 Bannière + correction ciblée
- `docs/reference/02-design-system/` — tokens canoniques mais 35 liens morts vers un `/DESIGN.md` absent.
- `docs/reference/06-lan-architecture/` — **le LAN n'est PAS abandonné** (hub/client implémenté dans `apps/pos/src/features/lan/`, transport hybride BroadcastChannel+Realtime) ; seuls les chemins V2 sont à corriger.
- `docs/reference/00-overview/` — vision business OK, tech-stack périmé.
- `docs/reference/04-modules/` **Partie I** (~15 fiches utilisables) — bannière STALE en attendant régénération.
- `docs/runbooks/disaster-recovery.md` — utilisable (cible le bon projet), placeholders à combler.

### ❌ À réécrire depuis le code (dangereux en l'état)
- `docs/reference/03-database/` — cible le projet Supabase **V2** `abjabuniwkqpfsenxljp`, RPCs fictives.
- `docs/reference/10-deployment-ops/` — commandes Docker interdites + mauvais projet. **Risque n°1.**
- `docs/reference/07-security/` — RBAC fictif (`update_role_permissions` : 0 occurrence), template audit_logs faux, registre de risques périmé.
- `docs/reference/08-flows-end-to-end/` — money-path mal nommé partout, EF process-payment absente des diagrammes.
- `docs/reference/09-testing/` — prescrit `npm` (projet strictement pnpm/turbo), chemins V2.
- `docs/reference/01-architecture/` — layout monolithe V2.
- `docs/reference/04-modules/` **Partie II** (les 20) — l'audit du 07-03 fait foi.
- `docs/reference/12-appendices/02-permission-codes-matrix` — matrice fausse (mécanisme ET rôles).
- `docs/reference/05-integrations/08-claude-proxy.md` — composant introuvable dans le code (fantôme).

### 🗄️ À archiver
- ~9 traînards dans `docs/workplan/{plans,specs}/` actifs (S26/S31/S32/print-bridge, doublons exacts de l'archive).
- `docs/Design/{backoffice,caissapp}/` — screenshots pré-code (référence visuelle historique).
- `docs/workplan/backlog-by-module/21-lan-architecture.md` — obsolète (requalifier ce qui survit : print_queue, dedup).
- Audits de curation 06-04/06-12 (superseded).
- Fiche `18-mobile-shell.md` → bannière « module inexistant » (décision GO/NO-GO mobile à acter, cf. §5).

---

## 4. Backlog maître consolidé (matière première)

Source d'autorité : roadmap P0→P3 de `2026-06-27-audit-integral-par-module.md` §7 (**P0/P1/P2 soldés S50→S57**, P3 ouvert), croisée avec CLAUDE.md « Deferred » et les 25 fichiers backlog (figés S14→S30, à rebaseliner — leurs priorités ne font plus foi).

### (a) Chantiers lourds ouverts
1. ~~FIFO/lots/péremption~~ — **ABANDONNÉ (décision propriétaire 2026-07-04 : pas de péremption/expiration ni de FIFO stock).** L'infra `stock_lots` existante est à décommissionner légèrement — cf. `docs/workplan/remise-a-plat/06-inventory-stock.md` D3.1.
2. **Cron alertes stock bas** (P3).
3. **Snapshot COGS à la vente** (`order_items.unit_cost`) — marge historique exacte (aujourd'hui WAC courant, caveat assumé).
4. **Bulk import Phase 2b : Sales + Expenses historiques** — spec à écrire (annoncée, jamais rédigée).
5. **Offline write-queue POS + tablette** (02-020/17-001, XL — « chantier de résilience prioritaire » du docx).
6. **Production avancée** : yield variance, batch, planning (backlog 15-*, le plus aligné avec P3).
7. **Compta résiduelle** : bank reconciliation, immobilisations, budget vs réalisé.
8. **Combos hors-POS** : tablette/B2B ne pricent/valident pas les combos serveur (follow-up S57).

### (b) Dettes techniques différées
- Les 5 dettes « cutover sain » S50 : POS-view `security_invoker`, bucket `product-images`, `search_path` fn INVOKER, Leaked Password Protection, **secret CI `SUPABASE_SERVICE_ROLE_KEY`** (bloque la CI live-RPC — récurrent depuis S50).
- Anciennes versions RPC jamais droppées (complete_order v9-v12, pay_existing v6-v8, fire_counter v1-v2) — nettoyage.
- `get_balance_sheet_data` legacy coexiste avec v2 (constaté live).
- 2 RPCs jamais câblées UI : `reconcile_b2b_balance_v1`, `create_purchase_journal_entry`.
- 5 composants POS morts (CartItemRow, CartActionsBar, CartTotals, UserPicker, CategorySidebar).
- Écritures hors pattern RPC (RLS-only) : clients, promotions, suppliers, holidays, templates, sections, production_schedules — à normaliser ou à assumer explicitement.
- `schema_migrations` cloud endommagé (drift-check dégradé, non reconstruit).
- Refactors >500 lignes restants ; dette lint hors-diff.

### (c) Angles morts UI (le « visible » qui a nourri la perception)
1. **Dashboard BO** : câbler `get_dashboard_overview_v1` + gater la route. — *quick win à fort impact*
2. **Éditeur RBAC réel** : mutation `role_permissions` + `user_permission_overrides` (RPC gatée `rbac.update` à créer) ou, a minima, retirer les libellés mensongers. — *répond directement à « les permissions ont disparu »*
3. **Page Security** : soit la peupler (PIN policy, rate-limit…), soit retirer les promesses.
4. **Customer Categories** : RPC CRUD manquante (D-W6-CUSTCAT-01).
5. **Recover shift POS** (toast « not implemented »), filtre KDS par station (passthrough).
6. Hub Settings : statuer sur chaque tuile « (Soon) » (construire ou retirer).
7. Suppliers : Categories disabled, Payments/Price/Analytics read-only.

### (d) Décisions à prendre (bloquantes pour la suite)
1. **`allow_negative_stock`** (DEFAULT true = survente autorisée) — décision d'exploitation autonome (l'ex-dépendance à la spec FIFO tombe : chantier abandonné le 2026-07-04).
2. **Stop-rule BOM production vs vente** (F7 — seul vrai risque code identifié : double-comptage possible d'un semi-fini tracké).
3. **Taux fidélité** (F8) : 10 vs 100 IDR/point — money-facing.
4. **Mobile shell** : GO/NO-GO formel (ADR à écrire ; module fantôme depuis la refonte).
5. **PB1 sur ventes B2B** (`tax_amount=0`) : confirmer l'exemption avec le comptable.
6. **QRIS natif** : choix du provider (bloque 03-005 et 16-006).
7. **Kiosk self-order** : dans la cible produit ou pas ? (jamais construit).
8. **WONTFIX à formaliser** (ADR) : multi-site, multi-devise, portal B2B, etc.

---

## 5. Le plan de remise à plat — 4 phases

### Phase 0 — Arrêter l'hémorragie (1 session courte)
Objectif : plus aucune session ni personne ne peut se fier à une doc mensongère.
1. Bannières ⚠️ STALE sur les 20 fiches `04-modules` + les chapitres reference ❌ (renvoi vers les audits).
2. Annoter la ligne « Module reference (canonical) » de CLAUDE.md.
3. Archiver les ~9 traînards workplan + Design/ + audits superseded ; bannière « module inexistant » sur 18-mobile-shell.
4. Corriger les 4 embellissements du docx → l'adopter comme `docs/product/DESCRIPTION.md` (référence produit versionnée).
5. Retirer les libellés RBAC mensongers (« RBAC Editor » → « Matrice (lecture) » en attendant l'éditeur réel).

### Phase 1 — Reconstruire le pilotage (1 session)
Objectif : une seule source de vérité pour « quoi faire ensuite », validée par toi.
1. Créer **le backlog maître unique** (`docs/workplan/BACKLOG-MASTER.md`) à partir du §4, chaque item avec source, statut vérifié code, priorité **à valider par toi** ; les 25 fichiers backlog-by-module passent en archive (historique).
2. Séance de décisions : trancher les 8 décisions du §4(d) (chacune → ADR court quand structurante).
3. **Nouvelle règle de gouvernance** (inscrite dans CLAUDE.md) : chaque session se termine par (i) mise à jour du backlog maître, (ii) **validation fonctionnelle utilisateur** (tu utilises l'écran livré), pas seulement des tests verts.

### Phase 2 — Réconcilier le visible (1-2 sessions)
Objectif : que l'app reflète sa vraie maturité — traiter §4(c) par impact :
Dashboard câblé et gaté → éditeur RBAC réel (RPC `update_role_permission_v1` + overrides, pgTAP, UI) → Security page honnête → Customer Categories CRUD → recover-shift + filtre KDS → tri des tuiles « Soon ». Nettoyages faciles de (b) au passage (composants morts, RPC legacy).

### Phase 3 — Reprendre la feuille de route produit (sessions suivantes)
Dans l'ordre issu des décisions de Phase 1, typiquement : cron alertes stock, snapshot COGS (découplé des lots — chantier FIFO/péremption abandonné le 2026-07-04), bulk import 2b, offline… Chaque chantier suit le cycle spec → plan → exécution → **validation utilisateur** → régénération de la fiche module concernée depuis le code (la doc se reconstruit ainsi progressivement, adossée au réel).

---

## 6. Ce que ce plan ne fait PAS
- Pas de réécriture du code sain (money-path, compta, sécurité, stock : intacts).
- Pas de réécriture en bloc des ~15 000 lignes de fiches avant validation produit — régénération progressive, module par module, au fil des chantiers.
- Pas de nouveau système de pilotage parallèle : on garde specs/plans datés + INDEX, on ajoute seulement le backlog maître et la règle de validation utilisateur.

---

## 7. Sources (rapports du 2026-07-03/04)
- Analyse doc : rapports ref-mapper, backlog-consolidator, history-mapper, docx-verifier (dans la conversation de session ; principaux faits repris ci-dessus avec preuves chemin:ligne).
- Analyse code : rapports code-pos, code-bo, code-server + interrogation live base cloud (rôles/permissions/RPCs/EFs).
- Audits de référence : `2026-06-27-audit-integral-par-module.md` (roadmap), `2026-07-03-modules-reference-divergence-audit.md` (fiches), `2026-06-27-project-state-and-gaps.md` (121 findings).
