# Travail — Auth & Permissions

> Last updated: 2026-05-03
> Référence : [`../04-modules/01-auth-permissions.md`](../04-modules/01-auth-permissions.md)
> Audits sources : `01-architecture-security-audit.md`, `08-operations-lan-audit.md`, `04-reports-testing-audit.md`

## Objectifs du module

1. **Réduire la surface anon-accessible** : 0 table PII (orders, customers, user_roles) lisible avec la clé anon publique. Critère : audit `/security-review` passe sans P1 RLS.
2. **Hardening Edge Functions auth** : rate limiting IP-level + élimination du fallback PIN client-side. Critère : `auth-verify-pin` rejette > 10 req/IP/min.
3. **Granularité permissions** : passer d'une seule permission `reports.sales` à un modèle 4-axes (`sales`/`inventory`/`financial`/`audit`). Critère : un user `staff` ne peut plus voir les reports financiers.
4. **Hygiène session** : timeout configurable par rôle (cashier 30min, admin 2h), last-admin protection, PIN strength warning. Critère : impossible de supprimer le dernier admin.

---

## Tâches

### TASK-01-001 — Auditer les 16 RLS `anon USING(true)` sur tables PII [P1] [TODO]
**Contexte** : `supabase/migrations/20260216230000_allow_anon_read_pos_tables.sql` accorde SELECT anon sur 16 tables (orders, customers, customer_categories, promotions, suppliers, settings, etc.). Avec la clé anon publiquement embarquée dans le bundle SPA, n'importe qui peut exfiltrer les noms/téléphones/historiques de commande clients. Source : `docs/audit/01-architecture-security-audit.md§P1-01`.
**Critère d'acceptation** :
- [ ] Audit complet des 16 tables : qui doit vraiment lire en anon (KDS/display) vs qui peut basculer sur `authenticated` ?
- [ ] Migration qui restreint les tables PII (orders, customers, user_roles) à `TO authenticated USING (is_authenticated())`.
- [ ] Vues anon-readable créées pour KDS/display avec colonnes PII exclues (ex : `view_kds_orders_safe`).
- [ ] Tests de régression : KDS, customer display, tablet ordering tournent toujours.
**Fichiers concernés** : `supabase/migrations/20260216230000_*.sql`, `supabase/migrations/20260216220000_allow_anon_read_roles.sql`, nouvelle migration `YYYYMMDD_restrict_anon_read_pii.sql`.
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : Casser KDS/display si une table devient inaccessible. Tester sur staging d'abord.
**Notes** : Coupler avec TASK-01-002 (rate limiting) — défense en profondeur.

### TASK-01-002 — Rate limiting IP-level sur `auth-verify-pin` [P1] [TODO]
**Contexte** : Le lockout actuel est par-user (5 essais / 15 min). Un attaquant peut énumérer des PINs à travers plusieurs comptes sans déclencher le lockout. T3 du backlog. Source : `docs/audit/01-architecture-security-audit.md§P1-02` + `docs/audit/08-operations-lan-audit.md§P2-4`.
**Critère d'acceptation** :
- [ ] Rate limit IP-level : max 10 essais PIN / IP / minute, glissant.
- [ ] Stockage du compteur : Supabase table `rate_limits` (ip, endpoint, window_start, count) ou Upstash Redis si dispo.
- [ ] HTTP 429 avec `Retry-After` quand dépassé.
- [ ] Audit log d'un événement `RATE_LIMIT_TRIGGERED` à chaque blocage.
- [ ] Documenter le mécanisme dans `docs/reference/07-security/`.
**Fichiers concernés** : `supabase/functions/auth-verify-pin/index.ts`, `supabase/functions/_shared/rate-limit.ts` (à créer), nouvelle migration pour `rate_limits` table.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Faux positifs sur réseaux NATés (ex : un café partagé). Paramétrer une whitelist IP entreprise dans `EXTRA_TRUSTED_IPS`.

### TASK-01-003 — Supprimer ou sécuriser le fallback PIN client-side [P1] [TODO]
**Contexte** : `authService._loginWithPinFallback` (lignes 184-312) appelle `verify_user_pin` directement depuis le navigateur si l'Edge Function est down. Bypasse rate limiting + audit logging server-side. Si la fonction est appelable en anon, brute-force possible. Source : `docs/audit/01-architecture-security-audit.md§P1-02`.
**Critère d'acceptation** :
- [ ] Décision : supprimer le fallback **ou** déplacer toute la logique de lockout (incluant `failed_login_attempts` increment) à l'intérieur de `verify_user_pin` SQL function.
- [ ] Si fallback supprimé : afficher message UX clair « Service temporairement indisponible, contactez l'admin ».
- [ ] Si fallback gardé : auditer la SQL function pour qu'elle gère elle-même le compteur et le verrouillage.
- [ ] Tests : simulation Edge Function down → comportement prévisible.
**Fichiers concernés** : `src/services/authService.ts` (488 lignes, à décomposer aussi).
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Suppression du fallback = POS inopérant si Edge Function tombe. Préférer durcir la SQL function.

### TASK-01-004 — Refactor Edge Functions auth-* (DRY) [P2] [TODO]
**Contexte** : `auth-get-session` ré-implémente le hashing/lookup session token au lieu d'utiliser `_shared/session-auth.ts` (lignes 20-26, 50-58). 4 Edge Functions auth-* dupliquent du code. Source : `docs/audit/08-operations-lan-audit.md§P2-3`.
**Critère d'acceptation** :
- [ ] `auth-get-session` utilise `validateSessionToken()` du shared.
- [ ] Les 4 fonctions (`get-session`, `verify-pin`, `change-pin`, `logout`) partagent un helper `_shared/auth-flow.ts` pour : extraction IP, audit log, response shaping.
- [ ] Aucune régression sur les tests existants.
- [ ] Lignes totales auth-* réduites d'au moins 20 %.
**Fichiers concernés** : `supabase/functions/auth-get-session/`, `supabase/functions/auth-verify-pin/`, `supabase/functions/auth-change-pin/`, `supabase/functions/auth-logout/`, `supabase/functions/_shared/`.
**Dépend de** : `TASK-01-002` (rate limiting helper sera dans `_shared/` aussi)
**Estimation** : `M`
**Risques** : Régression auth — couvrir avec tests d'intégration avant refactor.

### TASK-01-005 — Granulariser permissions reports [P1] [TODO]
**Contexte** : `src/routes/adminRoutes.tsx:67` ne checke que `reports.sales`. Un user avec sales-only voit tous les 53 rapports incluant audit/sécurité (void abuse, cash variance, ghost stock, permission changes). Source : `docs/audit/04-reports-testing-audit.md§P1-2`.
**Critère d'acceptation** :
- [ ] Migration : ajouter permissions `reports.audit` (+ vérifier que `reports.inventory`, `reports.financial` existent en DB).
- [ ] Mapping report → permission dans `ReportsConfig.tsx` (champ `requiredPermission`).
- [ ] Composant `ReportPermissionGuard` (ou check inline) qui filtre la liste selon les permissions de l'utilisateur.
- [ ] Si user n'a aucune permission report : afficher empty state plutôt que page blanche.
- [ ] Tests unitaires sur le filtrage.
**Fichiers concernés** : `src/routes/adminRoutes.tsx`, `src/pages/reports/ReportsConfig.tsx`, `src/pages/reports/ReportsPage.tsx`, nouvelle migration permissions.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Si un rôle existant (manager, supervisor) perdait l'accès à des reports critiques, casser le workflow opérationnel. Définir les 4 rôles types et leur matrice avant migration.

### TASK-01-006 — Session timeout configurable par rôle [P2] [TODO]
**Contexte** : `useSessionTimeout` utilise actuellement une seule valeur (30 min) via `pos_config`. Un cashier devrait timeout vite (sécurité) tandis qu'un admin ou un comptable peut tolérer 2h. Inferred from code review + Pitfall « last admin protection ».
**Critère d'acceptation** :
- [ ] Ajouter colonne `session_timeout_minutes` sur `roles` (default = 30).
- [ ] `useSessionTimeout` lit la valeur depuis le rôle de l'utilisateur courant.
- [ ] UI dans `/settings/security` pour configurer par rôle.
- [ ] Audit log à chaque changement de timeout.
- [ ] Test : bascule cashier ↔ admin déclenche le bon timer.
**Fichiers concernés** : `src/hooks/useSessionTimeout.ts`, `src/stores/authStore.ts`, `src/pages/settings/SecuritySettingsPage.tsx`, migration SQL pour `roles`.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Mauvaise valeur par défaut sur rôles existants → user déconnecté en plein checkout. Garder 30 min comme valeur de migration.

### TASK-01-007 — Last-admin protection (impossible de supprimer le dernier admin) [P1] [TODO]
**Contexte** : `auth-user-management` empêche le self-delete (`docs/audit/08-operations-lan-audit.md§Edge Function table`) mais rien n'empêche un admin A de supprimer/dégrader admin B alors qu'ils sont les deux derniers. Inferred from code review.
**Critère d'acceptation** :
- [ ] SQL trigger `BEFORE DELETE` sur `user_roles` : RAISE si supprime le dernier admin.
- [ ] Idem `BEFORE UPDATE` si on retire le rôle admin du dernier admin.
- [ ] UI : bouton « delete » désactivé sur le dernier admin avec tooltip explicatif.
- [ ] Test : tenter le scenario via API + via UI → erreur claire.
**Fichiers concernés** : nouvelle migration SQL, `supabase/functions/auth-user-management/index.ts`, `src/pages/admin/UsersPage.tsx`.
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : Empêcher la migration légitime (renommer le seul admin). Prévoir bypass via super-admin ou variable env.

### TASK-01-008 — PIN strength enforcement (warn weak PINs) [P3] [TODO]
**Contexte** : Aucun check de force PIN actuellement. Un user peut utiliser `1234`, `0000`, `1111`. Pour ~20 utilisateurs c'est tolérable, mais à durcir. Inferred from code review.
**Critère d'acceptation** :
- [ ] Liste des PINs « faibles » (séquences, répétitions, top-100 PINs leakés).
- [ ] À la création/changement PIN : warning UI si faible, exigence d'admin override pour forcer.
- [ ] Optionnel : settings `pos_config.enforce_strong_pin` (default false → warn only, true → block).
- [ ] Audit log si admin force un PIN faible.
**Fichiers concernés** : `supabase/functions/auth-change-pin/`, `supabase/functions/set-user-pin/`, `src/components/settings/PinChangeModal.tsx`, nouveau util `pinStrength.ts`.
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : Friction UX. Démarrer en mode warn-only.

### TASK-01-009 — Session replay PII review (Sentry) [P3] [TODO]
**Contexte** : Sentry replay 10% (100% on error) avec `maskAllText: true`. Vérifier qu'aucune valeur PIN, token, ni montant client ne fuit dans les sessions enregistrées. Inferred from `CLAUDE.md` Sentry section + `docs/audit/01-architecture-security-audit.md` PII concerns.
**Critère d'acceptation** :
- [ ] Audit manuel d'au moins 5 replays Sentry récents.
- [ ] Vérifier que les inputs PIN, search customers (téléphone), payment amounts sont masqués.
- [ ] Documenter dans `src/lib/sentry.ts` la liste des `blockSelector`/`maskTextSelector` à maintenir.
- [ ] Ajouter selectors si besoin (`[data-pii], input[type="tel"], .pin-input`).
**Fichiers concernés** : `src/lib/sentry.ts`, `src/components/auth/PinKeypad.tsx`, `src/components/customers/CustomerSearch.tsx`.
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : Trop bloquer = replays inutiles ; pas assez = fuite PII. Itérer.

### TASK-01-010 — 2FA admin (TOTP) [P3] [TODO]
**Contexte** : Hardening pour comptes admin uniquement. PIN seul est OK pour POS opérationnel mais l'accès BackOffice admin mérite 2FA. T6 backlog. Source : `docs/audit/07-product-backlog-audit.md§Nice-to-have-10`.
**Critère d'acceptation** :
- [ ] Génération QR code TOTP (otplib).
- [ ] Stockage `totp_secret` chiffré sur `user_profiles` (réservé admins).
- [ ] Step supplémentaire dans `/login` BackOffice si admin → demande code 6 chiffres.
- [ ] Recovery codes (5x usage unique) générés à l'enrôlement.
- [ ] Settings UI pour enrôler / révoquer 2FA.
**Fichiers concernés** : nouveau hook `use2FA.ts`, modal `TwoFactorSetupModal.tsx`, Edge Function `auth-verify-totp`, migration `user_profiles.totp_secret_encrypted`.
**Dépend de** : `TASK-01-002` (rate limiting), `TASK-01-004` (refactor auth)
**Estimation** : `L`
**Risques** : Lockout admin si perte device. Recovery codes obligatoires.

---

## Notes transverses

- **Permission codes existants** (cf. `CLAUDE.md`) : `users.view`, `users.create`, `users.roles`, `settings.view`, `settings.update`. Ne pas créer de doublons.
- **Helper RLS canonique** : `is_authenticated()` STABLE (cf. `CLAUDE.md`). Réutiliser pour toutes les nouvelles policies.
- **Audit logs** : table `audit_logs` existe déjà. Toute nouvelle action sensible (rate limit, 2FA enroll, last-admin block) doit y écrire.
