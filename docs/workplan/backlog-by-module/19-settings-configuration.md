# Travail — Settings & Configuration

> Last updated: 2026-05-03
> Référence : modules `04-modules/` (settings transverse, pas de fichier dédié) + `02-pos-cart-orders.md` pour `pos_config`
> Sources audit : `docs/audit/03-code-quality-schema-audit.md` §A2 (RPC fantôme `get_settings_by_category`), `docs/audit/05-uiux-design-audit.md` §Composants, `docs/audit/ux-gap-analysis-2026-05-01.md` §Module Settings, `docs/audit/01-architecture-security-audit.md` §P2-04, `CLAUDE.md` Pitfalls

## Objectifs du module

1. Éliminer la dérive entre code et schéma sur la couche settings (RPC fantôme `get_settings_by_category`, tables phantom `email_templates`, `receipt_templates`, `business_holidays`, `notification_events`, `notification_preferences`) — cible : 0 référence à une table/RPC absente du schéma.
2. Harmoniser la validation des forms settings (zod ou validation manuelle uniforme) — cible : 100 % des pages `/settings/*` valident inputs avant envoi DB.
3. Sécuriser le scope des settings (per-user vs global) et auditer les changements sensibles (PB1 rate, COA mappings, session timeout) — cible : audit log déclenché sur 100 % des modifications de settings critiques.
4. Permettre l'export/import config pour duplication terminal et backup — cible : 1 commande qui exporte tout `pos_config` + `settings` JSON et la réimporte sans rupture.
5. Faciliter la découvrabilité (recherche dans Settings hub) — cible : 1 search bar Cmd+K interne `/settings`.

---

## Tâches

### TASK-19-001 — Résoudre RPC fantôme `get_settings_by_category` [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 5.C. V3 evidence: `supabase/migrations/20260517000190_create_get_settings_by_category_rpc.sql` ships `get_settings_by_category_v1(p_category)` reading the `business_config` singleton ; consumed by `apps/backoffice/src/features/settings/hooks/useSettings.ts`. Commit `bdf21aa` (squashed PR #13).
**Contexte** : `docs/audit/03-code-quality-schema-audit.md` §A2 — *"`get_settings_by_category` called by `stores/settings/coreSettingsStore.ts` but does not exist in generated types. Settings loading may fail."*
**Critère d'acceptation** :
- [ ] Décision documentée : créer la migration RPC OU remplacer par requête typée directe `supabase.from('settings').select(...).eq('category', ...)`
- [ ] Plus aucune référence à `get_settings_by_category` dans le code
- [ ] `npx vitest run src/stores/settings` vert
**Fichiers concernés** : `src/stores/settings/coreSettingsStore.ts`, éventuelle nouvelle migration `supabase/migrations/<date>_create_get_settings_by_category.sql`
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : si l'app marche déjà, c'est que la table est lisible directement — préférer suppression du RPC fantôme à création d'un wrapper inutile
**Notes** : vérifier si d'autres consommateurs (ailleurs dans app ou dans Edge Functions) appellent ce RPC

### TASK-19-002 — Tables phantom settings : audit + cleanup [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 5.C. V3 evidence: migrations `20260517000191_init_holidays.sql` (business_holidays) and `20260517000192_init_email_receipt_templates.sql` (email_templates + receipt_templates) ship the tables with RLS ; UI lives in `apps/backoffice/src/features/settings/components/{HolidayFormModal,EmailTemplateEditor,ReceiptTemplateEditor}.tsx`. Notification tables landed via Phase 5.B (`20260517000180`). Commit `bdf21aa`.
**Contexte** : `docs/audit/03-code-quality-schema-audit.md` §A1 — 5 tables fantômes liées aux settings : `email_templates` (2 refs `useBusinessSettings`), `receipt_templates` (2 refs même hook), `business_holidays` (3 refs `useBusinessHolidays`), `notification_events` (1 ref), `notification_preferences` (2 refs).
**Critère d'acceptation** :
- [ ] Pour chaque table : décision soit (a) créer la migration + RLS + types, soit (b) supprimer le hook et UI orphelins
- [ ] Si suppression : pages `/settings/notifications`, `/settings/business-holidays` retirées des routes ou marquées "coming soon"
- [ ] Si création : 5 migrations atomiques avec RLS standard `is_authenticated()` + permission `settings.update`
- [ ] `/gen-types` lancé après chaque migration
**Fichiers concernés** : `src/hooks/settings/useBusinessSettings.ts`, `src/hooks/settings/useBusinessHolidays.ts`, `src/hooks/settings/useNotificationEvents.ts`, éventuelles nouvelles migrations
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : suppression d'un hook utilisé par UI partial → s'assurer que les pages associées ne crashent pas
**Notes** : prioriser `business_holidays` (3 refs, vraisemblablement utilisé pour fermetures) ; `notification_*` peuvent être marqués MVP différé

### TASK-19-003 — Validation zod harmonisée pour pages settings [P2] [TODO]
**Status note (2026-05-14)** : Phase 5.C shipped the singleton-driven Settings UI (`apps/backoffice/src/features/settings/`) with whitelist DB-side validation in `set_setting_v1` (per migration 000190 + D-W5-5C-02), but no client-side zod schemas were introduced. The audit-targeted `POSConfigSettingsPage`/`InventoryConfigSettingsPage` V2 pages do not exist in V3. Uncertain — manual review needed for the V3-equivalent scope.
**Contexte** : `docs/audit/05-uiux-design-audit.md` ne signale pas de bug spécifique sur la validation, mais `pages/settings/POSConfigSettingsPage.tsx` (509 L) et `pages/settings/InventoryConfigSettingsPage.tsx` (470 L) utilisent des `as any` (audit §B3) pour bypass typing form — signe d'absence de validation typée.
**Critère d'acceptation** :
- [ ] Schéma zod par page settings (`posConfigSchema`, `inventoryConfigSchema`, `printingConfigSchema`, etc.)
- [ ] Submit handler : `schema.safeParse(input)` avant write DB ; toast erreur si invalid
- [ ] `as any` casts éliminés des pages settings
- [ ] Tests unitaires des schémas (cas limites : valeurs négatives, strings vides, énums invalides)
**Fichiers concernés** : `src/pages/settings/POSConfigSettingsPage.tsx`, `src/pages/settings/InventoryConfigSettingsPage.tsx`, `src/pages/settings/PrintingSettingsPage.tsx`, nouveau `src/schemas/settings/`
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : zod déjà dans `package.json` ? sinon ajouter (~10 KB gzip)
**Notes** : commencer par `pos_config` qui est le plus critique métier (timeout, tax, etc.)

### TASK-19-004 — Export/import settings JSON [P2] [TODO]
**Status note (2026-05-14)** : Not delivered in Session 13 — Phase 5.C scope stopped at the singleton settings RPCs + holidays + templates. DR runbook (`docs/runbooks/disaster-recovery.md`, Phase 6.C) documents Supabase PITR restore but no app-level export/import. Genuine TODO for a future wave.
**Contexte** : Pas de DR runbook documenté (`docs/audit/08-operations-lan-audit.md` §5.3 P2 FINDING). Backup config = aujourd'hui dump SQL Supabase complet. Use case : dupliquer config sur 2e instance / restore après mauvaise modif.
**Critère d'acceptation** :
- [ ] Bouton "Export config" dans `/settings/sync` qui télécharge un JSON contenant : `settings.*`, `pos_config.*`, `printer_configurations`, `kds_stations` (sans secrets)
- [ ] Bouton "Import config" qui upload un JSON et applique via RPC atomique avec dry-run (preview des changements)
- [ ] Audit log déclenché sur import (avec hash du fichier)
- [ ] Doc utilisateur : `docs/reference/10-deployment-ops/config-backup-restore.md`
**Fichiers concernés** : `src/pages/settings/SyncSettingsPage.tsx`, nouveau `src/services/settings/exportImport.ts`, RPC `import_settings_atomic`, doc
**Dépend de** : TASK-19-005 (audit log)
**Estimation** : `L`
**Risques** : import malformé peut corrompre config — d'où le dry-run obligatoire ; vérifier qu'aucun PII n'est exporté
**Notes** : exclure les tokens FCM, secrets API, hash PIN

### TASK-19-005 — Audit log changements settings critiques [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 5.C. V3 evidence: migration `20260517000190_create_get_settings_by_category_rpc.sql` ships `set_setting_v1` which `INSERT INTO audit_logs (action='setting.update', entity_type='setting', metadata={key, category, old, new})` per call (D-W5-5C-01). Commit `bdf21aa`.
**Contexte** : `docs/audit/01-architecture-security-audit.md` §Audit logging note "Login, logout, PIN change, and failed attempts are logged" — **mais pas les modifications settings**. Modifier `pos_config.session_timeout_minutes` ou la mapping `SALE_CASH_IN` doit laisser une trace.
**Critère d'acceptation** :
- [ ] Trigger Postgres `audit_settings_changes` sur `settings`, `accounting_mappings`, `pos_config` (si table existe), `tax_rates`, `loyalty_tiers`
- [ ] Insère row dans `audit_logs` avec `action='settings.update'`, `severity='info'` ou `warn` selon table, `metadata={old, new, table, column}`
- [ ] UI `/settings/audit` (ou réutilise audit reports) filtrée par action `settings.*`
- [ ] Tests : modifier un setting → vérifier audit_logs contient row attendue
**Fichiers concernés** : `supabase/migrations/<date>_audit_settings_changes_trigger.sql`, `src/pages/settings/AuditSettingsPage.tsx` (nouveau ou existant)
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : volume audit_logs peut exploser si setting bruyant (ex. last_seen_at) — exclure colonnes timestamp techniques
**Notes** : compléments à l'audit du `useShift` qui logge déjà ouverture/fermeture caisse

### TASK-19-006 — Schema validation `pos_config` au niveau DB [P2] [OBSOLETE]
**Status note (2026-05-14)** : V3 settings live on the `business_config` singleton (per D-W5-5C-02), not on V2's `pos_config` table — `set_setting_v1` already whitelists keys + JSONB-validates types at write time. A `pos_config` CHECK-constraint task no longer maps to V3 schema. Reframe in a fresh ticket if validation gaps remain on `business_config` columns.
**Contexte** : `pos_config` est la table racine de la config terminal. Aujourd'hui aucun CHECK constraint sur les valeurs (audit §B3 montre `as any` côté form). Une valeur `session_timeout_minutes = -1` ou `tax_rate = 200` passerait.
**Critère d'acceptation** :
- [ ] Migration ajoute `CHECK` constraints : `session_timeout_minutes BETWEEN 1 AND 720`, `tax_rate BETWEEN 0 AND 50`, `loyalty_points_per_idr >= 0`, etc.
- [ ] Plages documentées dans `docs/reference/04-modules/` (créer `19-settings.md` si absent)
- [ ] Hook `usePosConfig` retourne erreur claire si DB rejette (pas juste 400)
**Fichiers concernés** : `supabase/migrations/<date>_pos_config_check_constraints.sql`, `src/hooks/settings/usePosConfig.ts`
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : valeurs existantes hors-limites bloquent la migration — script de cleanup pré-migration nécessaire
**Notes** : dépend du nom réel de la table (vérifier — peut être `settings` avec `category='pos'`)

### TASK-19-007 — Search bar dans /settings hub [P3] [TODO]
**Status note (2026-05-14)** : Phase 5.C shipped only the routes `/backoffice/settings/{general,holidays,email-templates,receipt-templates,permissions}` (per `apps/backoffice/src/features/settings/`) — no Settings hub search bar / Cmd-K dedicated palette. Genuinely undone.
**Contexte** : `docs/audit/ux-gap-analysis-2026-05-01.md` §Module Settings — *"setting page (Hub, sidebar 6 sections : GENERAL, SALES & POS, OPERATIONS, COMMERCE, SYSTEM)"*. 6 sections × ~10 sous-pages = 60+ settings. Trouver "tip percentage" ou "session timeout" est aujourd'hui pénible.
**Critère d'acceptation** :
- [ ] Input search en haut du hub `/settings` (`SettingsHubPage.tsx`)
- [ ] Filtre dynamique sur la sidebar selon le query (case-insensitive, fuzzy basique)
- [ ] Index statique des settings indexés (label + page de destination)
- [ ] Cmd+K dédié au sein de /settings (réutilise `CommandPalette` shadcn)
**Fichiers concernés** : `src/pages/settings/SettingsHubPage.tsx`, nouveau `src/data/settingsSearchIndex.ts`, `src/components/settings/SettingsSearchBar.tsx`
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : index à maintenir manuellement si nouveau setting ajouté → dette ; envisager génération automatique depuis schemas zod (TASK-19-003)
**Notes** : reuse pattern `CommandPalette` du BackOfficeLayout

### TASK-19-008 — Multi-tenancy settings (foundation) [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred to Wave 7 (Session 15) per INDEX line 1083 : "19-008 multi-tenancy infra (Session 15)". Out of scope for Session 13.
**Contexte** : `CLAUDE.md` projet "single bakery". Si V3 multi-store envisagé (`docs/audit/07-product-backlog-audit.md` §15 multi-currency), les settings doivent être scopables par `store_id`.
**Critère d'acceptation** :
- [ ] Investigation : ajouter colonne `store_id NULL` à `settings`, `pos_config`, `accounting_mappings`, `tax_rates` ; NULL = global
- [ ] RLS policies adaptées : utilisateur lit settings de son `store_id` ou globaux
- [ ] Pas d'implémentation UI dans cette tâche — juste foundation DB + ADR
- [ ] ADR rédigé : `docs/reference/architecture/adr-001-multi-store-settings.md`
**Fichiers concernés** : migrations DB, ADR
**Dépend de** : aucune (mais bloque toute initiative multi-store future)
**Estimation** : `L`
**Risques** : sur-ingénierie si jamais multi-store n'arrive ; vérifier roadmap V3
**Notes** : aligner avec direction produit avant de démarrer

---

### TASK-19-009 — Settings change history & rollback [P3] [TODO]
**Status note (2026-05-14)** : Audit log foundation now exists (TASK-19-005 DONE — `audit_logs` rows on `set_setting_v1`), but no `/settings/history` page nor rollback button shipped in Session 13. The V2 `audit_settings_history` table referenced in the original context does not exist in V3 (everything funnels through `audit_logs`). Genuinely undone.
**Contexte** : `audit_settings_history` (table existante listée dans audit `03-code-quality-schema-audit.md` Appendix `settings_history`) suggère qu'un journal historique existe mais n'est pas exposé UI. Use case : "qui a changé le tax rate il y a 3 semaines ?"
**Critère d'acceptation** :
- [ ] Page `/settings/history` : liste les N dernières modifications settings (qui, quoi, quand, ancienne→nouvelle valeur)
- [ ] Bouton "Rollback to this version" sur chaque row (avec confirmation)
- [ ] Filtres : par catégorie, par utilisateur, par date
- [ ] Pagination 50 rows
**Fichiers concernés** : `src/pages/settings/SettingsHistoryPage.tsx`, hook `useSettingsHistory`
**Dépend de** : TASK-19-005
**Estimation** : `M`
**Risques** : rollback peut casser si setting dépend d'autres (ex tax_rate change déclenche recalcul) — exclure rollback sur catégories sensibles
**Notes** : —

### TASK-19-010 — Migration settings dispersés vers schéma unique [P3] [OBSOLETE]
**Status note (2026-05-14)** : V3 chose the singleton `business_config` model (D-W5-5C-02 explicit decision NOT to introduce an `app_settings` key-value table). The Phase 5.C deviation pack documents the rationale ; an ADR-style re-investigation no longer applies. Reframe only if multi-tenant adds a wrinkle.
**Contexte** : `docs/audit/03-code-quality-schema-audit.md` Appendix liste à la fois `settings`, `settings_categories`, `settings_history` ET `pos_terminals` / `printer_configurations` / `kds_stations` qui sont aussi des "settings". Hétérogénéité côté UI rend difficile un audit complet (TASK-19-005) ou un export (TASK-19-004).
**Critère d'acceptation** :
- [ ] Investigation : recenser TOUTES les tables qui stockent de la config (au sens large)
- [ ] ADR `adr-004-settings-architecture.md` : recommander unification (clé/valeur) ou maintien spécialisé
- [ ] Si unification : plan de migration par étapes (ne pas casser)
- [ ] Critère de décision documenté pour futures tables config
**Fichiers concernés** : ADR
**Dépend de** : aucune
**Estimation** : `M` (recherche)
**Risques** : sur-ingénierie ; si UI déjà fluide, ne rien casser
**Notes** : —

---

## Backlog métier (objectif fonctionnel)

> Items issus de `docs/objectif travail/SETTINGS.md` §12 — vision produit du module.
> Ajoutés 2026-05-13 lors de la cascade docs (session 13). Approval workflows sont couverts par TASK-09-009 (B2B), TASK-07-014 (Purchasing), TASK-11-001 (Expense). Pricing horaire par TASK-13-004. Multi-tenancy par TASK-19-008. Export/Import par TASK-19-004.

### TASK-19-011 — Notification scheduler (alertes programmées) [P3] [TODO]
**Status note (2026-05-14)** : Phase 5.B shipped the notifications pipeline (templates + outbox + `enqueue_notification_v1`) but the cron scheduler was deferred (per D-W5-5B-02 — "scheduler choice deferred to Phase 7"). `scheduled_notifications` table not created ; `dispatch-scheduled-notifications` EF not implemented. Genuinely undone.
**Contexte** : aujourd'hui les notifications sont temps réel (stock bas à l'instant T). Pour les alertes récurrentes (récap matinal, hebdomadaire), pas de scheduling.
**Bénéfice attendu** : programmer une notification (ex: "stock bas envoyé chaque matin à 7h" ou "récap hebdo lundi 8h") plutôt qu'instantanément.
**Critère d'acceptation** :
- [ ] Table `scheduled_notifications` (type, cron_expression, recipients, last_sent_at, active).
- [ ] Edge Function `dispatch-scheduled-notifications` (cron Supabase) qui scanne et envoie.
- [ ] Page `/settings/notifications/schedule` : CRUD scheduled notifications.
- [ ] Templates par type avec placeholders ({{stock_low_count}}, {{daily_revenue}}, etc.).
**Dépend de** : `TASK-08-006` (notifications pipeline) pour le canal.
**Estimation** : M
**Risques** : timing perçu mal calibré → cron Supabase + retry.
**Notes** : utile pour les routines manager du matin.

### TASK-19-012 — Templates de tickets éditables [P3] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 5.C. V3 evidence: migration `20260517000192_init_email_receipt_templates.sql` ships `receipt_templates(code, header_html, body_template, footer_html, is_default, ...)` with the partial-unique `is_default` index (D-W5-5C-05). UI: `apps/backoffice/src/features/settings/components/ReceiptTemplateEditor.tsx` with live preview substitution (D-W5-5C-04). Commit `bdf21aa`.
**Contexte** : aujourd'hui les tickets (reçu client, ticket cuisine, étiquette prix) ont un format figé en code. Personnalisation impossible sans dev.
**Bénéfice attendu** : personnaliser l'en-tête, le pied, les mentions du reçu (slogan, QR Instagram, conditions de retour) sans intervention dev.
**Critère d'acceptation** :
- [ ] Table `receipt_templates` (template_type, header_html, body_template, footer_html, active).
- [ ] Page `/settings/printing/templates` : éditeur WYSIWYG simple + preview imprimable.
- [ ] Placeholders supportés : {{company_name}}, {{order_number}}, {{items}}, {{total}}, {{customer_name}}, etc.
- [ ] Toggle "Template par défaut" pour cas où no override.
- [ ] Validation : template invalide rejeté avant save.
**Dépend de** : aucune.
**Estimation** : L
**Risques** : sécurité XSS sur templates → sanitization stricte server-side.
**Notes** : V1 limité aux zones header/footer ; V2 layout complet libre.

### TASK-19-013 — Wizard d'installation guidé [P3] [TODO]
**Status note (2026-05-14)** : No `/settings/onboarding` route exists in V3 ; Phase 5.C scope did not include an installation wizard. Genuinely undone.
**Contexte** : chaque page Settings est autonome. Un nouveau gérant qui ouvre une boutique doit deviner l'ordre. Pas de checklist guidée.
**Bénéfice attendu** : onboarding pas-à-pas qui guide à travers les 23 pages dans l'ordre logique (company → tax → COA → categories → users → printers…).
**Critère d'acceptation** :
- [ ] Page `/settings/onboarding` : wizard 10-12 étapes avec progress bar.
- [ ] Chaque étape : présentation + lien vers la page settings concernée + checkbox "complété".
- [ ] Détection auto du complétage (si valeur cohérente saisie).
- [ ] Bouton "Skip for now" pour avancer même incomplet (avec warning).
- [ ] Bouton "Re-lancer le wizard" depuis Settings hub.
**Dépend de** : aucune.
**Estimation** : L
**Risques** : maintenance — chaque nouvelle page settings doit potentiellement entrer dans le wizard.
**Notes** : valeur surtout pour les déploiements multi-sites futurs.

### TASK-19-014 — Multi-devise toggle (foundation) [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred to Wave 7 (Session 14) per INDEX line 1082 : "10-019 multi-currency end-to-end (Session 14)". Setting toggle blocked until accounting/POS/purchasing multi-currency pieces land.
**Contexte** : tout en IDR. Pour les expatriés / touristes, prévoir le toggle multi-devise est utile (couplage avec TASK-10-019 Accounting et TASK-02-027 POS).
**Bénéfice attendu** : interrupteur global "Activer multi-devise" qui débloque les fonctionnalités correspondantes dans les autres modules.
**Critère d'acceptation** :
- [ ] Setting `general.multi_currency_enabled` (booléen, défaut false).
- [ ] Setting `general.supported_currencies` (array : ['IDR', 'USD', 'EUR']).
- [ ] Setting `general.default_currency` (défaut 'IDR').
- [ ] Validation cohérence avec settings Accounting et POS.
- [ ] UI Settings → General → Currency.
**Dépend de** : `TASK-10-019` (Accounting multi-devise), `TASK-02-027` (POS multi-devise), `TASK-07-011` (Purchasing multi-devise), `TASK-11-009` (Expenses multi-devise).
**Estimation** : S
**Risques** : aucune (juste le toggle).
**Notes** : ne pas activer sans avoir les autres modules prêts.

---

## Synthèse priorité

| Priorité | Tâches |
|----------|--------|
| P1 | 19-001, 19-002, 19-005 |
| P2 | 19-003, 19-004, 19-006 |
| P3 | 19-007, 19-008, 19-009, 19-010 |
