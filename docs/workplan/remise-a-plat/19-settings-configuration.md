# Module 19 — Réglages & configuration

> ⚠️ **Mise à jour S58 (2026-07-04, `swarm/session-58`)** : **D1.1 livré** — les 5 tuiles « Soon » contredisant des pages existantes (Inventory Config, Loyalty, Audit Log, Sections, Financial/Accounting) sont désormais des liens actifs dans `SettingsHubPage`. Les 11 autres tuiles « Soon » restent (pages inexistantes). Le reste de la fiche reste daté `5b0fa92`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 19. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel pour l'essentiel
> **Verdict global de l'analyse :** La doc surclame nettement. Le socle existe (business_config via `set_setting_v1` audité, jours fériés, templates avec aperçu, timeouts de session), mais : les **moyens de paiement ne sont pas activables/désactivables** (le scénario phare « désactiver la carte en un clic » est impossible — méthodes codées en dur dans le POS), l'**historique des réglages n'a pas d'UI** (tuile « Settings History (Soon) ») et la traçabilité avant/après ne couvre que `business_config` + timeouts — pas les fériés ni les templates, dont **aucun n'est d'ailleurs consommé** par le reste du système. 16 tuiles « Soon » sur le hub, dont certaines contredisent des pages qui existent.

## A. Ce qui fonctionne réellement (code vérifié)

- **Hub Settings** `/backoffice/settings` (gate `settings.read`) : 6 sections, tuiles cliquables vers General, Holidays, B2B Settings, Security, Permissions (lecture seule), Email/Receipt Templates, LAN Network — et **16 tuiles désactivées « (Soon) »** : POS Configuration, Payment Methods, Loyalty Program, Inventory Config, Product Categories, Product Types, KDS Configuration, Customer Display, Printing, Notifications, Financial/Accounting, Audit Log, Network Devices, Settings History, Floor Plan, Sections — `apps/backoffice/src/pages/settings/SettingsHubPage.tsx:32-94` [UI câblée].
  - Incohérences internes du hub : « Inventory Config (Soon) » alors que `SettingsInventoryPage` est routée (`routes/index.tsx:899-906`) et dans la sidebar (`Sidebar.tsx:213`) ; « Loyalty Program (Soon) » alors que `/backoffice/loyalty` existe ; « Audit Log (Soon) » alors que `/backoffice/reports/audit` existe ; « Sections (Soon) » alors que `/backoffice/inventory/sections` existe.
- **Réglages généraux** `settings/general` : 8 champs de `business_config` (name, fiscal_address, currency, timezone, tax_rate, tax_inclusive, shift_variance_threshold_pct/abs) en 4 catégories symboliques, sauvegarde explicite **une écriture `set_setting_v1` par champ modifié** — `apps/backoffice/src/pages/settings/SettingsGeneralPage.tsx:25-34,106-147` [UI câblée].
- **RPCs settings** : `get_settings_by_category_v1` + `set_setting_v1` (migration `20260517000190`, étendue `20260518000003` pos_presets, `20260710000020` inventory/allow_negative_stock). `set_setting_v1` est **whitelist-driven** (clé inconnue → exception), valide le type JSONB par clé (ex. `tax_rate` string→numeric borné 0..1, ligne 156) et **écrit une ligne `audit_logs` par changement avec `metadata={key, category, old, new}`** (ligne 200 + COMMENT ligne 220) [RPC + UI câblée].
- **Réglages inventaire** `settings/inventory` : toggle global `allow_negative_stock` (vente + production), via `set_setting_v1` — `apps/backoffice/src/pages/settings/SettingsInventoryPage.tsx` [UI câblée].
- **Jours fériés** `settings/holidays` : CRUD complet (national/religieux/entreprise, récurrent ou daté, notes), table `holidays` (migration `20260517000191`) avec RLS écriture gatée `settings.holidays.manage` — `apps/backoffice/src/pages/settings/SettingsHolidaysPage.tsx` [UI câblée]. **Aucun consommateur** : ni le POS ni le planning de production ne lisent `holidays` (grep : seuls `permissions.ts` et `types.generated.ts` la référencent hors BO).
- **Modèles d'e-mails** `settings/templates/email` : 4 templates (welcome, order_complete, payment_received, password_reset) avec éditeur + **aperçu live** substituant les variables, table `email_templates` (RLS écriture `settings.update`) — `SettingsEmailTemplatesPage.tsx` + `EmailTemplateEditor.tsx` [UI câblée]. **Aucune EF n'envoie ces e-mails** (les EFs `notification-dispatch`/`customer-birthday-notify` utilisent `notification_templates`, table distincte).
- **Modèles de tickets** `settings/templates/receipt` : éditeur + **aperçu ASCII live**, formats 58mm/80mm/A4, « exactement un défaut » (index unique partiel + auto-démotion) — `SettingsReceiptTemplatesPage.tsx` [UI câblée]. **Non consommé par l'impression POS** (aucune référence à `receipt_templates` dans `apps/pos` ni `supabase/functions`).
- **Sécurité** `settings/security` (gate route `settings.security.manage`) : éditeur du **timeout de session par rôle** (5–480 min, validation client + CHECK serveur), RPC `update_role_session_timeout_v1` (migrations `20260523000021/22`), chaque changement audité — `apps/backoffice/src/pages/settings/security/SecuritySettingsPage.tsx` [UI câblée]. Page réelle mais étroite : pas de politique PIN ni 2FA (la tuile hub dit « 2FA placeholder »).
- **Matrice des permissions (lecture seule)** `settings/permissions` : lit `roles`/`permissions`/`role_permissions` en direct — `usePermissionsMatrix.ts` [UI câblée].
- **Fiscal Periods + clôture annuelle** `settings/accounting` (gate route `accounting.period.close`) : gestion des périodes fiscales + bouton gaté `accounting.year.close` ouvrant **`AnnualCloseModal`** (2 étapes : année + préconditions, puis PIN + avertissement irréversible ; 8 codes d'erreur classifiés) → `close_fiscal_year_v1` — `features/accounting/pages/SettingsAccountingPage.tsx:10,22,133` + `components/AnnualCloseModal.tsx` [UI câblée].
- **Autres réglages routés rattachés** : `settings/expense-thresholds` (gate `expenses.thresholds.read`), `b2b/settings` (plafonds de crédit B2B, gate `settings.read`) [UI câblées].
- **En plus de la doc** : catégorie `pos_presets` dans les RPCs settings (montants rapides d'encaissement, fonds de caisse, presets de remise — clés validées serveur, migration `20260518000003`) — mais **sans UI** (tuile « POS Configuration (Soon) ») ; timeouts de session par rôle (non mentionnés par la doc).

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Identité boutique (nom, logo, identifiant fiscal), taxe 10 % incluse, moyens de paiement acceptés, comportement caisse, fidélité, imprimantes — réglages centralisés avec sauvegarde explicite.
- B1.2 Chaque modification tracée (qui, quoi, quand, ancienne et nouvelle valeur) et consultable (« il retrouve dans l'historique qui a modifié le délai de déconnexion »).
- B1.3 Gestion des jours fériés.
- B1.4 Modèles d'e-mails et de tickets personnalisables (en-tête, pied, slogan) avec aperçu.
- B1.5 Droits d'accès par rôle.
- B1.6 Valeurs saisies contrôlées avant enregistrement.
- B1.7 (Scénario) Désactiver la carte bancaire en un clic, effet immédiat sur toutes les caisses.

### B2. Annoncé « À venir »
- B2.1 Export/import de la configuration.
- B2.2 Recherche dans les réglages.
- B2.3 Assistant d'installation guidé.
- B2.4 Alertes programmées (récap stock 7 h).
- B2.5 Paramétrage d'un « service charge ».
- B2.6 Validation renforcée de certains formulaires.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1a | Identité : nom, logo, identifiant fiscal | Nom ✓, adresse fiscale ✓ (`business_config`). **Logo : aucun champ** (logo statique `/brand-logo.png`). **Identifiant fiscal (NPWP) : aucun champ** dédié | 🟠 PARTIEL |
| B1.1b | Taxe (10 % incluse) | `tax_rate` (borné 0..1 serveur) + `tax_inclusive` éditables ✓ ; le POS lit `business_config.tax_rate` (`useTaxRate`, S51) | ✅ CONFORME |
| B1.1c | Moyens de paiement acceptés | **Inexistant** : aucune colonne/table de configuration ; les 6 méthodes sont codées en dur dans `apps/pos/src/features/payment/components/paymentMethods.ts:13-20` ; tuile hub « Payment Methods (Soon) » | 🔴 MANQUANT |
| B1.1d | Comportement caisse | Seuils d'écart de shift ✓ (2 champs) ; les presets POS (`pos_presets`) existent côté RPC mais **sans UI** (« POS Configuration (Soon) ») | 🟠 PARTIEL |
| B1.1e | Fidélité configurable ici | Tuile « Loyalty Program (Soon) » — la config fidélité vit dans le module Loyalty (`/backoffice/loyalty`), pas dans Settings | 🟠 PARTIEL |
| B1.1f | Imprimantes (quelles imprimantes servent à quoi) | Rien dans Settings (« Printing (Soon) ») ; le routage d'impression vit dans LAN Devices / dispatch Spec B-1 | 🟠 PARTIEL |
| B1.2 | Toute modification tracée (qui/quoi/quand/avant/après) + historique consultable | Tracé DB réel pour `business_config` (`set_setting_v1` → `audit_logs.metadata={key,old,new}`) et timeouts de rôle. **Non tracé** : fériés, templates e-mail/ticket (écritures directes RLS, aucun trigger d'audit). **Aucune UI d'historique** : tuile « Settings History (Soon) » ; l'Audit Log générique liste les actions mais n'affiche pas old/new (colonnes Timestamp/Action/Entity/Actor seulement, `AuditPage.tsx:59-67`) | 🟠 PARTIEL |
| B1.3 | Jours fériés | CRUD complet ✓ (`SettingsHolidaysPage` + table `holidays` RLS). Réserve : donnée morte, aucun module ne la consomme | ✅ CONFORME |
| B1.4 | Modèles e-mails/tickets avec aperçu | Éditeurs + aperçus live ✓. Réserve majeure : **jamais consommés** (aucun envoi d'e-mail client, l'impression POS n'utilise pas `receipt_templates`) — personnalisation sans effet | 🟠 PARTIEL |
| B1.5 | Droits d'accès par rôle | Matrice **lecture seule** (`settings/permissions`) ; l'éditeur RBAC (`users/permissions`) est lui aussi en lecture seule (fait établi session précédente) | 🟠 PARTIEL |
| B1.6 | Valeurs contrôlées avant enregistrement | Double validation ✓ : coercition/erreurs client (`SettingsGeneralPage.tsx:106-147`) + whitelist/typage/bornes serveur (`set_setting_v1`) ; timeouts bornés 5–480 des deux côtés | ✅ CONFORME |
| B1.7 | Désactiver la CB en un clic, effet immédiat sur les caisses | Impossible — cf. B1.1c 🔴 ; aucun mécanisme de propagation temps-réel des réglages vers le POS non plus | 🔴 MANQUANT |

**Bonus code (le code fait plus que la doc) :**
- 🔵 Timeout de session par rôle avec audit (`SecuritySettingsPage` + `update_role_session_timeout_v1`).
- 🔵 Toggle global `allow_negative_stock` (vente + production) — `SettingsInventoryPage`.
- 🔵 Clôture d'exercice complète depuis Settings (`AnnualCloseModal` → `close_fiscal_year_v1`, PIN + préconditions).
- 🔵 Catégorie `pos_presets` prête côté serveur (montants rapides, fonds de caisse, presets remise).
- 🔵 Seuils d'approbation des dépenses (`settings/expense-thresholds`) et réglages crédit B2B rattachés au namespace settings.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Corriger les tuiles « Soon » mensongères du hub** : lier Inventory Config → `/backoffice/settings/inventory`, Loyalty → `/backoffice/loyalty`, Audit Log → `/backoffice/reports/audit`, Sections → `/backoffice/inventory/sections`, Financial/Accounting → `/backoffice/settings/accounting` (+ mappings). Fichier : `SettingsHubPage.tsx`. Done : plus aucune tuile « Soon » pointant vers une page qui existe.
2. **Ajouter les champs identité manquants** : `logo_url` (ou upload storage) et `tax_id` (NPWP) dans `business_config` + whitelist `set_setting_v1` + `SettingsGeneralPage`. Migration + regen types. Done : champs éditables et audités.
3. **UI « Settings History »** : page filtrant `audit_logs` sur `entity_type='setting'` et affichant `metadata.key/old/new` (le RPC `get_audit_logs_v2` filtré existe déjà). Fichiers : nouvelle page + route + tuile hub. Done : le scénario « qui a modifié le délai de déconnexion » est jouable.

### D2. Chantiers moyens (1 session, plan requis)
1. **Moyens de paiement activables** : clé `enabled_payment_methods` (JSONB) dans `business_config` + branche `set_setting_v1` + UI Settings (tuile « Payment Methods ») + le POS filtre `METHODS` sur cette clé (lecture React-Query avec invalidation — l'« effet immédiat » exige au minimum un refetch on-focus, sinon un canal realtime). Ferme B1.1c/B1.7. Done : méthode décochée absente de `PaymentMethodGrid`.
2. **UI POS Configuration** : exposer les `pos_presets` déjà servis par les RPCs (quick amounts, opening cash, discount presets). Done : tuile active, presets consommés par le POS.
3. **Audit des fériés et templates** : trigger d'audit (ou passage par RPCs SECURITY DEFINER écrivant `audit_logs`) sur `holidays`, `email_templates`, `receipt_templates` pour honorer « chaque modification est tracée ». Done : une ligne `audit_logs` avant/après par mutation.

### D3. Chantiers lourds (spec dédiée avant code)
1. **Brancher les templates sur de vrais consommateurs** : impression des tickets POS depuis `receipt_templates` (header/footer/logo) et infra d'envoi d'e-mails clients depuis `email_templates` — sinon dépublier ces éditeurs. Dépend de l'architecture d'impression LAN (module 21) et d'un provider e-mail.
2. **Consommer `holidays`** : suggestions de production, horaires POS, rapports (jours fermés) — à spécifier avec le module 15.
3. **B2.1–B2.5** (export/import config, recherche, assistant d'installation, alertes programmées, service charge) : rien n'existe, specs à écrire — le service charge touche la money-path (v17) et exige une spec dédiée.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
1. B1.1 : retirer « logo », « identifiant fiscal », « quels moyens de paiement sont acceptés », « comment marche la fidélité » et « quelles imprimantes servent à quoi » du présent (les passer en « À venir »), tant que D1.2/D2.1 ne sont pas livrés.
2. B1.2 : préciser « les réglages généraux et les délais de session sont tracés avec avant/après ; l'historique se consulte via le journal d'audit ; un écran dédié est à venir » — et retirer le scénario « retrouve dans l'historique » tant que D1.3 n'est pas livré.
3. B1.7 : supprimer le scénario « désactive la carte bancaire » (aujourd'hui impossible).
4. B1.4 : mentionner que les modèles ne sont pas encore appliqués aux tickets imprimés ni à des envois d'e-mails.
5. Statut suggéré : « Partiel » plutôt qu'« Opérationnel pour l'essentiel ».

## E. Dépendances croisées
- **Module 3 (Encaissement)** : D2.1 (moyens de paiement activables) modifie le POS (`PaymentMethodGrid`) et, si validation serveur du moyen, la money-path `complete_order_with_payment_v17`.
- **Module 21 (Réseau local/imprimantes)** : consommation de `receipt_templates` par l'impression ; tuiles Printing/Network Devices.
- **Module 20 (Employés & droits)** : matrice de permissions (lecture seule des deux côtés), timeouts par rôle.
- **Module 10 (Comptabilité)** : `settings/accounting` (périodes fiscales, clôture annuelle) est la porte d'entrée UI de `close_fiscal_year_v1`.
- **Module 6 (Stock)** : `allow_negative_stock` pilote les gardes de vente/production (S53 `_record_sale_stock_v1`).
- **Module 14 (Rapports)** : `business_config.timezone` alimente `get_payments_by_method_v2` ; l'UI Settings History réutilise `get_audit_logs_v2`.
