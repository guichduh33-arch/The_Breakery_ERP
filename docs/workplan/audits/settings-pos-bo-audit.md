# Audit des modules Settings — POS + Backoffice (Phase 0)

> **Date** : 2026-07-11 · **Statut** : ✅ **VALIDÉ + EXÉCUTÉ S73 (branche swarm/session-73-settings)** (décisions ci-dessous, exécutées lots 1→3 ; voir aussi [`docs/reference/settings-authority-model.md`](../../reference/settings-authority-model.md)).
> **Méthode** : audit-first / validate-before-code. Code vérifié sur `master` (29eb284d) ; DB vérifiée
> live sur le projet cloud V3 dev `ikcyvlovptebroadgtvd` via MCP `execute_sql`.
> **Sources** : lecture directe des fichiers pivots + 2 agents d'exploration (POS / BO), constats
> critiques re-vérifiés de première main (PrintingSettingsTab, SettingsHubPage, routes, RPC live).

---

## 0. Couche DB (faits établis, base de tous les verdicts)

| Fait | Preuve |
|---|---|
| La « table settings » est **`business_config`**, singleton `id=1`, **colonnes typées** (pas de clé-valeur) : name, currency, tax_rate, tax_inclusive, fiscal_address, timezone, 5×shift_*, 3×pos_*_presets, allow_negative_stock, enabled_payment_methods, production_yield_variance_threshold_pct | MCP `information_schema.columns` (20 colonnes) |
| `get_settings_by_category_v1(p_category)` — SECURITY DEFINER, gate `has_permission('settings.read')`, 7 catégories : `business`, `localization`, `tax`, `pos`, `pos_presets`, `inventory`, `payments` | `pg_get_functiondef` live ; fichier `supabase/migrations/20260710000128_settings_rpcs_denomination_flag.sql:11-74` |
| `set_setting_v1(p_key, p_value, p_category)` — gate `has_permission('settings.update')`, **whitelist de 16 clés** avec validation de type/bornes par clé (`tax_rate` ∈ [0,1], currency/timezone « non vide » seulement) | `pg_get_functiondef` live ; `_128:76-324` |
| **`set_setting_v1` écrit déjà chaque changement dans `audit_logs`** : `action='setting.update'`, `entity_type='setting'`, `metadata={key, category, old, new}` | `_128:310-322` (vérifié identique en live) |
| `audit_logs` : **0 ligne** `action='setting.update'` à ce jour (mécanisme jamais déclenché en dev) | MCP `SELECT count(*)` |
| RLS `business_config` : `auth_read` (SELECT tout authentifié) + `super_admin_write` (ALL, SUPER_ADMIN) → **lecture directe de la table possible par tout rôle authentifié** (c'est ce que fait le POS), écriture réelle uniquement via le RPC gaté | MCP `pg_policy` |
| Permissions seedées : `settings.read` → ADMIN, MANAGER, SUPER_ADMIN · `settings.update` → ADMIN, SUPER_ADMIN · + `settings.holidays.manage`, `settings.kiosk.manage`, `settings.security.manage` (ADMIN, SUPER_ADMIN) | MCP `role_permissions` |
| Valeurs live : currency=`IDR`, timezone=`Asia/Makassar`, tax_rate=`0.1000`, tax_inclusive=`true`, presets remplis, 6 moyens de paiement actifs | MCP `SELECT * FROM business_config` |
| Tables annexes toutes présentes : `receipt_templates`, `email_templates`, `holidays`, `lan_devices`, `pos_devices`, `notification_templates` | MCP `information_schema.tables` |

---

## 1. POS — `apps/pos/src/features/settings/`

### 1.1.1 Double persistance non signalée

- **Constat** : il y a bien deux couches de persistance jamais distinguées dans l'UI, mais la ligne de partage réelle n'est pas celle du pré-audit. `GeneralTab` ne persiste **que les 3 groupes de presets** (DB) ; **`tax_rate` et les moyens de paiement ne sont PAS éditables depuis le POS** (hooks lecture seule). Tout le reste est du localStorage par terminal.
- **Preuve** — tableau réglage → couche → portée :

| Réglage | Lecture | Écriture | Couche | Portée |
|---|---|---|---|---|
| Quick payment amounts | `POSSettingsPage.tsx:215` ; conso `usePaymentFlowLogic.ts:81` | `usePOSPresets.ts:119-131` → `set_setting_v1` | **DB** (`pos_presets`) | Org |
| Opening cash presets | `POSSettingsPage.tsx:228` ; conso `OpenShiftModal.tsx:94` | `usePOSPresets.ts:133-145` | **DB** | Org |
| Discount presets | `POSSettingsPage.tsx:239` | `usePOSPresets.ts:147-159` | **DB** | Org — ⚠️ jamais consommés (voir 1.1.8) |
| Printer URL | `PrintingSettingsTab.tsx:71`, `DevicesSettingsTab.tsx:93`, `AdvancedSettingsTab.tsx:23` | `posSettingsStore.ts:58` | **localStorage** (`pos:settings`, zustand persist `posSettingsStore.ts:54-80`) | Terminal |
| autoPrint / autoOpenDrawer | `PrintingSettingsTab.tsx:79-84`, `AutomationSettingsTab.tsx:14-15` | `posSettingsStore.ts:59-60` | **localStorage** | Terminal |
| deviceCode (LAN) | `DevicesSettingsTab.tsx:40` | `posSettingsStore.ts:61` | **localStorage** | Terminal |
| defaultOrderType | `BehaviorSettingsTab.tsx:18` | `posSettingsStore.ts:62` | **localStorage** | Terminal |
| displayFooterMessage / displaySlogan | `DisplaySettingsTab.tsx:15,17` ; conso `CustomerDisplayPage.tsx:49`, `CDBrandPanel.tsx:23` | `posSettingsStore.ts:63-64` | **localStorage** | Terminal |
| tax_rate | `useTaxRate.ts:33-37` (SELECT direct `business_config`) | **jamais côté POS** | DB lecture seule | Org |
| enabled_payment_methods | `useEnabledPaymentMethods.ts:27-32` (SELECT direct) | **jamais côté POS** | DB lecture seule | Org |

- **Statut** : **NUANCÉ** (double persistance confirmée ; périmètre DB du pré-audit erroné pour tax_rate/paiements).
- **Sévérité** : P1 (lisibilité/confusion opérateur, pas de perte de données).
- **Action recommandée** : fix UI — badge « Établissement » vs « Ce terminal » + libellé d'aide par section. Aucun backend.
- **Coût** : S (½ j).

### 1.1.2 `PrintingSettingsTab` sans verrou de permission

- **Constat** : la page calcule `canEdit = hasPermission('settings.update')` et passe `readOnly={!canEdit}` à **tous les onglets sauf Printing**. `PrintingSettingsTab` n'accepte **aucune prop**, utilise un `Toggle` local **sans prop `disabled`** et un `Input` sans `disabled`. Un opérateur sans `settings.update` voit le badge « Read only » mais peut modifier l'URL du serveur d'impression et les 2 toggles.
- **Preuve** : `POSSettingsPage.tsx:48` (canEdit), `:84` (`<PrintingSettingsTab />` seul sans prop, vs `:83,85,86,144-147`) ; `PrintingSettingsTab.tsx:48` (signature sans props), `:16-46` (Toggle local sans `disabled`), `:67-73` (Input sans `disabled`). Contraste : les mêmes toggles sont correctement gelés dans `AutomationSettingsTab.tsx:33,40`.
- **Nuance d'impact** : cet onglet n'écrit que du **localStorage terminal** — le gate serveur `set_setting_v1` reste intact. C'est un contournement du verrou **UI** (incohérence flagrante + vecteur de détournement d'impression des reçus), pas une faille serveur.
- **Statut** : **CONFIRMÉ**. · **Sévérité** : **P0** (verrou de permission inopérant sur un onglet entier).
- **Action** : fix — ajouter `readOnly` à `PrintingSettingsTab`, migrer son Toggle local vers le `SettingToggle` partagé (`SettingToggle.tsx`, qui supporte `disabled` et a justement été extrait de cet onglet sans que l'original soit migré), `disabled` sur l'Input. + test permission gate.
- **Coût** : S (½ j, test inclus).

### 1.1.3 Top-tab « KDS » mal nommé

- **Constat** : le top-tab s'appelle en réalité **« KDS & Display »** (pas « KDS ») et rend `DisplaySettingsTab` = customer display uniquement (idle footer + slogan). **Aucun réglage KDS cuisine** (stations, routing, temps de prépa) n'existe nulle part dans les settings POS. Le libellé promet du KDS inexistant.
- **Preuve** : `POSSettingsPage.tsx:78` (libellé), `:85` (rend DisplaySettingsTab), `DisplaySettingsTab.tsx:33-64` (contenu 100 % customer display).
- **Statut** : **NUANCÉ** (libellé réel différent du pré-audit, fond du problème confirmé).
- **Sévérité** : P1. · **Action** : fix — renommer le top-tab **« Customer Display »** (moindre risque, conforme au défaut proposé). Pas de bloc KDS inventé sans consommateur réel.
- **Coût** : XS (< 1 h).

### 1.1.4 Doublon autoPrint / autoOpenDrawer

- **Constat** : les 2 toggles sont éditables depuis **Automation** ET **Printing** (même store, donc synchro — redondance UX, pas bug de données). Le commentaire d'`AutomationSettingsTab.tsx:4-7` assume le miroir. Aggrave 1.1.2 : la copie Automation respecte `readOnly`, la copie Printing non.
- **Preuve** : `AutomationSettingsTab.tsx:28-41` vs `PrintingSettingsTab.tsx:79-84`.
- **Statut** : **CONFIRMÉ**. · **Sévérité** : P2.
- **Action** : dédupliquer — garder la surface canonique dans **Printing** (contexte métier) ; l'onglet **Automation ne contenant QUE ces 2 toggles, le supprimer** plutôt que de le laisser vide. À valider.
- **Coût** : XS-S.

### 1.1.5 `BehaviorSettingsTab` mono-réglage

- **Constat** : exactement **un** réglage — `defaultOrderType` (radiogroup dine_in/take_out/delivery, appliqué au panier vif si vide).
- **Preuve** : `BehaviorSettingsTab.tsx:15` (ORDER_TYPES), `:42-67` (rendu), `:21-28` (application panier).
- **Statut** : **CONFIRMÉ**. · **Sévérité** : P2.
- **Action** : **no-op** — aucun besoin réel avec point de consommation identifié en Phase 0 ; ne pas inventer de réglages (garde-fou §5). Si 1.1.4 supprime Automation, envisager de fusionner Behavior dans General.
- **Coût** : 0.

### 1.1.6 Source de vérité `tax_rate`

- **Constat** : **pas de divergence possible** — source unique = colonne `business_config.tax_rate` (singleton). Le POS **lit** en SELECT direct (fallback `DEFAULT_TAX_RATE=0.10`, staleTime 5 min) et **n'écrit jamais** ; le BO écrit via `set_setting_v1` clé `tax_rate` cat. `tax` (validée [0,1] serveur). Même colonne des deux côtés.
- **Preuve** : `useTaxRate.ts:20` (queryKey), `:33-37` (SELECT direct), `:40,43` (fallback 0.10) ; consommateurs `usePrintBill.ts:26`, `BottomActionBar.tsx:130`, `ActiveOrderPanel.tsx:75`, `usePaymentFlowLogic.ts:69`, `TabletCartPanel.tsx:20`, `SuccessModal.tsx:151` ; BO `SettingsGeneralPage.tsx:30` + RPC `_128:142-151` ; grep exhaustif `set_setting_v1` dans `apps/pos/src` → seulement les 3 clés presets.
- **Statut** : **INFIRMÉ** (en tant que risque de divergence). · **Sévérité** : P2 (deux remarques résiduelles : fallback silencieux 0.10 en cas d'erreur réseau ; staleTime 5 min de propagation).
- **Action** : **no-op** sur la clé. Optionnel (à valider) : logguer/toaster quand le POS retombe sur le défaut 0.10.
- **Coût** : 0 (option : XS).

### 1.1.7 (hors pré-audit) Discount presets = réglage mort

- **Constat** : les presets de remise sont éditables et persistés en DB mais **consommés nulle part** — le code l'assume : « Currently displayed in this Settings page only — discount modal consumers wiring lands in a follow-up ».
- **Preuve** : `POSSettingsPage.tsx:464-466` (aveu), grep `discountPresets` → uniquement la page settings + le hook.
- **Statut** : CONFIRMÉ. · **Sévérité** : P1 (on édite un réglage sans effet — confusion manager).
- **Action** : câbler le modal discount POS sur `pos_discount_presets` (le point de consommation existe : modal discount), OU afficher clairement « non câblé » en attendant. À valider.
- **Coût** : S-M selon option.

### 1.1.8 (hors pré-audit) Printer URL sur 3 surfaces

- **Constat** : champ éditable dans Printing ET Devices, affiché dans Advanced. Même store → synchro, mais 3 surfaces pour 1 champ.
- **Preuve** : `PrintingSettingsTab.tsx:67`, `DevicesSettingsTab.tsx:89`, `AdvancedSettingsTab.tsx:47`.
- **Statut** : CONFIRMÉ. · **Sévérité** : P2. · **Action** : une seule surface d'édition (Printing), lecture ailleurs. · **Coût** : XS.

---

## 2. Backoffice — `apps/backoffice/src/pages/settings/` + `features/settings/`

### 1.2.1 Tuiles « (Soon) » du Hub

- **Constat** : mécanisme = **absence de `to:`** (`SettingsHubPage.tsx:21`, rendu désactivé `:112,124-140`). **Liste des 10 Soon exactement conforme au pré-audit** : POS Configuration (l.47), Product Categories (l.57), Product Types (l.58), KDS Configuration (l.59), Customer Display (l.60), Printing (l.74), Notifications (l.75), Network Devices (l.83), Settings History (l.84), Floor Plan (l.91).
- **Statut** : **CONFIRMÉ**. · **Sévérité** : P0 (10 culs-de-sac dans le hub). · **Action** : voir 1.2.2. · **Coût** : —

### 1.2.2 Soon qui doublonnent l'existant — décision tuile par tuile

- **Constat** : **6/10 existent déjà** (souvent côté POS), 2 sont « backend prêt / UI BO manquante », seules 2 sont de vrais trous. Le hub donne une image trompeuse de l'avancement.
- **Preuves & recommandations** :

| Tuile Soon | Existe ? (preuve) | Recommandation |
|---|---|---|
| **Product Categories** | OUI, BO livré : `pages/categories/CategoriesPage.tsx`, route `/backoffice/categories` gate `categories.read` (`routes/index.tsx:202-208`), sidebar `Sidebar.tsx:93` | **LIER** (`to: '/backoffice/categories'`) |
| **Network Devices** | Doublonne la tuile active « LAN Network » → `/backoffice/lan-devices` (`SettingsHubPage.tsx:82`, `LanDevicesPage.tsx` + ScanPanel S65) | **SUPPRIMER** |
| **Settings History** | Données déjà là : `set_setting_v1` → `audit_logs` (`_128:310-322`) ; tuile active « Audit Log » existe déjà | **LIER** vers l'audit log filtré `action='setting.update'` (ou supprimer si le filtre n'existe pas encore — voir 1.2.7) |
| **Customer Display** | OUI, POS : `apps/pos/features/display/**` + `DisplaySettingsTab` (localStorage par terminal) | **SUPPRIMER** côté BO (réglage par terminal) — sauf décision de le remonter org (hors périmètre actuel) |
| **Printing** | Partiel : `apps/print-bridge/**` (S65) + onglet Printing POS (par terminal) ; pas de config org BO | **SUPPRIMER** (config = par terminal POS + LAN Devices déjà lié) |
| **Floor Plan** | OUI, POS : `features/floor-plan/FloorPlanModal.tsx`, `tablet/FloorPlanView.tsx` (dine-in S67) ; pas d'éditeur BO | **SUPPRIMER** (pas d'éditeur BO prévu) |
| **KDS Configuration** | KDS livré (`apps/pos/features/kds/**`) mais zéro réglage stations/routing/prep nulle part | **SUPPRIMER** (pas de backend ; recréer si un chantier KDS-config est validé un jour, tracé workplan) |
| **Product Types** | NON — mais « Raw/Semi-finished/Finished » est un attribut géré au niveau produit (products CRUD) | **SUPPRIMER** (pas une page settings) |
| **Notifications** | NON — `notification_templates` existe en DB, aucune surface | **SUPPRIMER** du hub, tracer au workplan si voulu |
| **POS Configuration** | Backend 100 % prêt : colonnes + cat `pos_presets` (`_128:55-59`) + `set_setting_v1` ; **aucune page BO** ; `SettingsCategory` BO n'inclut même pas `pos_presets` (`useSettings.ts:10`) | **IMPLÉMENTER** (P1, seul vrai chantier — voir 1.2.4) |

- **Statut** : **CONFIRMÉ (aggravé)**. · **Sévérité** : P0. · **Coût** : liaisons/suppressions XS ; POS Config M.

### 1.2.3 Pages orphelines

- **Constat** : **INFIRMÉ pour les 3 pages du pré-audit** — `SettingsPermissionsPage`, `SettingsReceiptTemplatesPage`, `SettingsEmailTemplatesPage` sont routées **et** présentes au hub (`SettingsHubPage.tsx:78-80`) **et** dans la sidebar (`Sidebar.tsx:213-215`). En revanche l'audit révèle 4 incohérences réelles :
  1. `SettingsPaymentMethodsPage` : au hub (l.48) mais **absente de la sidebar** — semi-orpheline.
  2. `ExpenseThresholdsPage` : route `/settings/expense-thresholds` (`routes/index.tsx:955-958`) mais **aucune tuile hub**.
  3. **Mismatch de gate Security** : route gatée `settings.security.manage` (`routes/index.tsx:941`) mais tuile visible avec `settings.read` → un MANAGER (qui a `settings.read`, pas `settings.security.manage`) clique et reçoit un rejet « Accès refusé ».
  4. **Mismatch Accounting** : idem, route `accounting.period.close` (`routes/index.tsx:949`) vs tuile visible `settings.read`.
- **Statut** : **INFIRMÉ** (constat principal) / 4 findings annexes **CONFIRMÉS**. · **Sévérité** : P1.
- **Action** : ajouter PaymentMethods à la sidebar (ou assumer hub-only, à valider) ; ajouter une tuile hub Expense Thresholds ; masquer/griser les tuiles Security et Accounting selon la permission réelle de la route.
- **Coût** : S.

### 1.2.4 Autorité manager vs terminal (« POS Configuration » BO)

- **Constat** : les presets POS (quick payments, opening cash, discounts) vivent en DB org (`business_config`), éditables via `set_setting_v1` par tout porteur de `settings.update` (ADMIN/SUPER_ADMIN) — mais la **seule UI d'édition est le terminal POS** ; le BO n'a rien (tuile Soon). Le modèle d'autorité implicite actuel : réglages org **éditables uniquement depuis le POS**, par un profil qui a `settings.update`. Cible recommandée : le BO devient l'éditeur org de référence (mêmes RPC/clés), le POS garde l'édition (il honore déjà `readOnly`).
- **Preuve** : backend `_128:55-59, 217-271` ; POS `usePOSPresets.ts` ; absence BO : grep `pos_presets` dans `apps/backoffice/src` → 0 hit hors type manquant `useSettings.ts:10`.
- **Statut** : **CONFIRMÉ**. · **Sévérité** : P1. · **Action** : créer la page BO « POS Configuration » réutilisant `get_settings_by_category_v1('pos_presets')` + `set_setting_v1` (zéro schéma parallèle) + ajouter `pos_presets` au type `SettingsCategory`. · **Coût** : M (1-1,5 j).

### 1.2.5 `SettingsGeneralPage`

- **Constat** : **CONFIRMÉ intégralement** — formulaire plat `FIELDS[]` (`SettingsGeneralPage.tsx:25-41`, rendu en boucle `:171-201`). 11 champs : name, fiscal_address, **currency (texte libre**, helper ISO-4217 sans liste, l.28**)**, **timezone (texte libre**, l.29**)**, **tax_rate (number décimal brut 0..1**, l.30, saisie « 0.10 »**)**, tax_inclusive, + 5 champs shift_* (S66/S67) mêlés à l'identité. **Aucun champ NPWP / n° d'enregistrement / logo** ; seule identité fiscale = `fiscal_address` texte libre. Un `Asia/Makkasar` mal orthographié passe (seul « non vide » validé serveur).
- **Statut** : **CONFIRMÉ**. · **Sévérité** : P1.
- **Action** : durcir — select ISO-4217, select IANA, saisie tax_rate en % (conversion ÷100 vers la DB), regrouper les shift_* dans une section « Caisse » distincte. **NPWP/identité fiscale : à valider avec toi** — nécessite migration (nouvelles colonnes + clés `set_setting_v1`) et n'a de valeur que si consommé par les templates reçu/facture (le template `b2b_invoice` S68 existe — vérifier son besoin réel avant migration).
- **Coût** : S (durcissement front) + M si champs fiscaux (migration + types + templates).

### 1.2.6 tax_rate BO = même clé que le POS

- **Constat** : confirmé — BO écrit `set_setting_v1('tax_rate', …, 'tax')` → colonne unique `business_config.tax_rate` que lit le POS. Cf. 1.1.6. · **Statut** : **CONFIRMÉ (pas de divergence)**. · **Action** : no-op.

### 1.2.7 Settings History

- **Constat** : **le journal existe déjà** — chaque `set_setting_v1` insère dans `audit_logs` avec old/new (`_128:310-322`, vérifié live). Il ne manque **qu'une vue filtrée** (`action='setting.update'`) ; la tuile active « Audit Log » (`/backoffice/reports/audit`) affiche déjà le flux global. Aucun trigger sur `business_config` : l'audit passe exclusivement par le RPC (les writes directs SUPER_ADMIN via RLS y échapperaient — marginal). 0 entrée à ce jour en dev.
- **Statut** : **CONFIRMÉ (câblable sur l'existant, quasi gratuit)**. · **Sévérité** : P2.
- **Action** : lier la tuile vers l'audit log pré-filtré (query param) ou supprimer la tuile. **Pas** de nouveau mécanisme, pas d'`emitPosEvent` (le journal S72 est un flux POS opérationnel ; les settings BO sont déjà couverts par `audit_logs`).
- **Coût** : XS-S.

### 1.2.8 Sécurité / 2FA

- **Constat** : le pré-audit est **en-dessous de la réalité** : il n'y a même **pas de placeholder 2FA dans la page** — le mot « 2FA » n'apparaît que dans le blurb de la tuile (`SettingsHubPage.tsx:76`). La page (`security/SecuritySettingsPage.tsx`) ne contient **que** le timeout de session par rôle (lecture `roles.session_timeout_minutes` l.36-42, écriture `update_role_session_timeout_v1` l.47-50, bornes 5-480 min) — réel et branché. **Pas de PIN policies** non plus, malgré le titre « Security & PIN ».
- **Statut** : **NUANCÉ** (2/3 promesses du blurb inexistantes). · **Sévérité** : P2.
- **Action** : corriger le blurb (« Session timeout per role ») — pas de faux contrôle à retirer puisque rien n'est rendu ; ne pas implémenter la 2FA (non prévue).
- **Coût** : XS.

### 1.2.9 (hors pré-audit) Doublon de route au hub

- **Constat** : « Company » et « Tax » pointent tous deux sur `/backoffice/settings/general` (`SettingsHubPage.tsx:38,40`). · **Sévérité** : P2. · **Action** : fusionner ou ancrer (`#tax`). · **Coût** : XS.

---

## 3. Synthèse des actions proposées (pour validation)

**Phase 1 — POS**
| # | Action | Sév. | Coût |
|---|---|---|---|
| A1 | `PrintingSettingsTab` : prop `readOnly` + `SettingToggle` partagé + `disabled` Input + test gate (1.1.2) | P0 | S |
| A2 | Badges « Établissement » / « Ce terminal » + aides (1.1.1) | P1 | S |
| A3 | Renommer top-tab « KDS & Display » → « Customer Display » (1.1.3) | P1 | XS |
| A4 | Dédup autoPrint/autoOpenDrawer : canonique dans Printing, **supprimer l'onglet Automation** (1.1.4) — à valider | P2 | XS-S |
| A5 | Discount presets : câbler le modal discount OU marquer « non câblé » (1.1.7) — à valider | P1 | S-M |
| A6 | Printer URL : édition Printing seul, lecture ailleurs (1.1.8) | P2 | XS |
| — | Behavior : no-op (1.1.5) · tax_rate : no-op (1.1.6) | — | 0 |

**Phase 2 — BO**
| # | Action | Sév. | Coût |
|---|---|---|---|
| B1 | Hub : lier Product Categories + Settings History ; supprimer Network Devices, Customer Display, Printing, Floor Plan, KDS Config, Product Types, Notifications (1.2.1/1.2.2) | P0 | XS-S |
| B2 | Page BO « POS Configuration » sur `pos_presets` (mêmes RPC/clés) + type `SettingsCategory` (1.2.4) | P1 | M |
| B3 | PaymentMethods → sidebar ; Expense Thresholds → tuile hub ; gates tuiles Security/Accounting alignés sur la route (1.2.3) | P1 | S |
| B4 | Durcir SettingsGeneralPage : selects ISO-4217/IANA, tax_rate en %, section Caisse séparée (1.2.5) | P1 | S |
| B5 | Champs fiscaux NPWP/raison sociale — **décision requise** (migration + consommation templates) (1.2.5) | P1 | M |
| B6 | Settings History : lien audit-log filtré (1.2.7) | P2 | XS-S |
| B7 | Blurb Security corrigé (1.2.8) + doublon Company/Tax (1.2.9) | P2 | XS |

**Phase 3 — cross-app** : dictionnaire de clés typé partagé (les 16 clés `set_setting_v1` + 7 catégories, probablement dans `packages/domain` ou `packages/supabase`) ; doc du modèle d'autorité (org = DB éditée BO+POS gatée `settings.update` ; terminal = localStorage). Coût S.

## 4. Décisions de validation (propriétaire, 2026-07-11)

1. **A4 — VALIDÉ** : dédup autoPrint/autoOpenDrawer, surface canonique dans Printing, **onglet Automation supprimé**.
2. **A5 — CÂBLER** : brancher le modal discount POS sur `pos_discount_presets` (le réglage cesse d'être mort).
3. **B5 — REPORTÉ** : champs fiscaux NPWP/identité indonésienne — pas de migration dans cette session.
4. **B1 — révisé « implémenter, pas supprimer »**, affiné ainsi :
   - **Product Categories** → lier `/backoffice/categories` (existant).
   - **Settings History** → lier l'audit log filtré `action='setting.update'`.
   - **Network Devices** → **fusionner** avec la tuile « LAN Network » existante (pas de 2e page).
   - **Product Types** → **lier** la page produits (attribut produit, pas un setting).
   - **À implémenter cette session** : **Notifications** (UI sur `notification_templates`), **Customer Display org**, **Printing org** (promotion de réglages vers la DB, design en phase plan).
   - **Session dédiée ultérieure** (tracée workplan, tuiles marquées explicitement) : **Floor Plan BO** + **KDS Configuration** (zéro backend aujourd'hui).

---

*Rapport Phase 0 (audit-first) validé le 2026-07-11. Exécution : plan daté `docs/workplan/plans/` + branche de session.*
