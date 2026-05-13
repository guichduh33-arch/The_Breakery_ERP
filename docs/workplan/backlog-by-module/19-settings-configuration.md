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

### TASK-19-001 — Résoudre RPC fantôme `get_settings_by_category` [P1] [TODO]
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

### TASK-19-002 — Tables phantom settings : audit + cleanup [P1] [TODO]
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

### TASK-19-005 — Audit log changements settings critiques [P1] [TODO]
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

### TASK-19-006 — Schema validation `pos_config` au niveau DB [P2] [TODO]
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

### TASK-19-008 — Multi-tenancy settings (foundation) [P3] [TODO]
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

### TASK-19-010 — Migration settings dispersés vers schéma unique [P3] [TODO]
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

## Synthèse priorité

| Priorité | Tâches |
|----------|--------|
| P1 | 19-001, 19-002, 19-005 |
| P2 | 19-003, 19-004, 19-006 |
| P3 | 19-007, 19-008, 19-009, 19-010 |
