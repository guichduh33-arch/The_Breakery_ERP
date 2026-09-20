# security-fraud-guard — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Audit checklist (5 dimensions : argent / identité / traçabilité / exposition / intégrité)
- Checklists préventives (5 interventions concrètes)
- Sources de vérité (points d'entrée — résoudre la version live avant de citer)
- Vérification avant d'annoncer un audit ou un correctif complet
- Quand escalader (signaler, ne pas continuer en silence)

## Audit checklist (5 dimensions : argent / identité / traçabilité / exposition / intégrité)

Lancer une section quand un trou est suspecté. Chaque ligne est un SQL ou un grep exécutable.
**Résoudre la version live de chaque famille citée avant de lancer le contrôle.**

### A. Argent & anti-fraude (reversals, remises, caisse, JE)

- [ ] **Tout reversal exige un PIN manager.** Pour les familles `refund_order_rpc`,
  `void_order_rpc`, `cancel_order_item_rpc` : confirmer qu'un contrôle de PIN manager existe
  ET que l'`actor_id` d'audit est le *manager*, pas le caissier (un reversal avec le caissier
  pour seul acteur = vecteur de fraude). *Résoudre la version live sur le call-site de l'EF ;
  au 2026-08-31 c'était v10 / v10 / v6, chiffre daté qui ne se recopie pas.*
- [ ] **PIN vérifié sur le bon chemin.** Dans les EF, contrôler le header dédié et l’absence du secret dans le JSON/logs. Dans les RPC à PIN, contrôler l’argument et sa validation avec verrouillage ; ne pas classer `p_manager_pin` comme une fuite par sa seule présence (Pattern 4).
- [ ] **Remise / surcharge de prix gatée et loggée** (`sales.discount` ou équivalent) avec
  montant et motif dans l'audit : les remises non loggées sont le canal de fraude caissier n°1.
- [ ] **Les mouvements de caisse se réconcilient.** La famille `record_cash_movement`
  (apport/retrait/banque) écrit un audit et, le cas échéant, un JE ; la clôture (famille
  `close_shift` → snapshot `z_reports`) réconcilie `cash_in - cash_out` contre le comptage.
  Un retrait avec `reason` NULL/vide = à signaler.
- [ ] **Le JE manuel est sous double contrôle** : la famille `create_manual_je` exige des
  lignes équilibrées (débit XOR crédit, somme nulle), un PIN manager, écrit l'audit
  `accounting.je.create_manual`, et l'antidatage hors période fiscale ouverte est bloqué
  (verrou de la famille `close_fiscal_period`).
- [ ] **Auto-approbation : seul SUPER_ADMIN y a droit.** La famille `approve_expense` bloque
  `created_by = approbateur` pour tous les rôles SAUF SUPER_ADMIN, `UNIQUE(expense_id,
  approver_user_id)` tient, et la dérogation écrit `expense.self_approved` (Pattern 8). Test :
  approuver sa propre dépense en MANAGER → refus ; en SUPER_ADMIN → succès **plus** la ligne
  dédiée. `SELECT actor_id, metadata FROM audit_logs WHERE action = 'expense.self_approved'` :
  toute ligne dont l'acteur n'est pas SUPER_ADMIN est un finding.

### B. Identité & accès (intégrité RBAC, auth, session)

- [ ] **Aucune RPC definer sans gate.** `SELECT proname FROM pg_proc WHERE prosecdef AND
  proname NOT LIKE '\_%'` puis greper chacune pour `has_permission`. Les helpers internes
  (préfixe `_`, REVOKEd de `authenticated`) sont exemptés ; les RPC appelables non.
- [ ] **Les overrides ne sont pas une porte dérobée.** `SELECT * FROM
  user_permission_overrides WHERE is_granted` — tout GRANT permanent doit porter une raison
  documentée et, si pertinent, une `expires_at`. Un caissier avec un override
  `expenses.approve` défait la SOD. Poses/retraits tracés par
  `user.permission_override_set` / `user.permission_override_removed`.
- [ ] **Les grants de rôle correspondent à l'intention — mais la matrice est ÉDITABLE.**
  Croiser `role_permissions` pour un rôle bas portant un code sensible (CASHIER avec
  `pos.sale.refund`, `accounting.*`, `users.*`, `rbac.manage`). **Un écart n'est plus
  forcément une régression de migration : depuis l'ADR-031 c'est peut-être une décision prise
  à l'écran** — chercher la ligne d'audit (trigger de matrice, rapport Permission changes)
  avant de conclure à une fraude.
- [ ] **Les rôles créés à l'écran sont sains.** Depuis l'ADR-032, `roles` peut contenir des
  rôles hors seed : `SELECT code, is_system FROM roles`, puis pour chaque `is_system = false`
  vérifier ses grants (le clone ne copie jamais `rbac.manage`) et l'audit `role.created`.
- [ ] **Lockout & rate-limit couvrent tous les chemins d'auth** : `auth-verify-pin` les
  applique, aucun chemin alternatif (kiosk, RPC PIN-in-arg) ne les contourne. Rappel
  Pattern 11 : le chemin RPC code un 5/15 en dur, désynchronisé du réglage.
- [ ] **La durée de session est bornée par rôle** : `roles.session_timeout_minutes` renseigné
  (bornes 5..480, CASHIER court) et `useIdleTimeout` monté dans POS et BO. L'édition vit dans
  la fiche rôle (ADR-031), plus dans la page Security des réglages.

### C. Traçabilité (complétude du journal d'audit)

- [ ] **Toute RPC mutante écrit une ligne d'audit.** Pour chaque `SECURITY DEFINER` qui mute
  l'état, confirmer un `INSERT INTO audit_logs`. Trous connus et tolérés : quelques RPC
  status-only (`mark_item_served`, `send_items_to_kitchen`) — à documenter. Une mutation
  d'**argent, d'identité ou de schéma** sans audit n'est jamais acceptable.
- [ ] **`actor_id` est un `user_profiles.id`, pas `auth.uid()`.** Contrôle transverse à
  passer sur tout écrivain d'audit : `SELECT a.action, count(*) FROM audit_logs a
  LEFT JOIN user_profiles p ON p.id = a.actor_id WHERE a.actor_id IS NOT NULL AND p.id IS NULL
  GROUP BY 1` — toute ligne remontée a été écrite avec un `auth.uid()` et affichera « system »
  dans les rapports.
- [ ] **`entity_id` renseigné (ou NULL documenté).** `SELECT action, count(*) FROM audit_logs
  WHERE entity_id IS NULL GROUP BY action`. Connu : `role.session_timeout_changed` porte
  `role_code` dans le payload. Tout autre NULL casse le drill-down → à signaler.
- [ ] **Le replay est distinguable.** Les retries idempotents loggent une action `*.replay`
  (p. ex. `refund.replay`) : la même opération apparaissant N fois sans `.replay` signale une
  couche d'idempotence contournée.
- [ ] **La table d'audit est gatée en lecture — mais par la RLS seule.** La lecture repose
  sur la policy `admin_read` (`get_current_role() IN ('SUPER_ADMIN','ADMIN')`).
  ⚠️ **La famille `get_audit_logs` est SECURITY INVOKER, GRANT EXECUTE à `authenticated`, et
  ne porte AUCUN gate `has_permission`** — constat assumé et écrit dans la migration, pas un
  oubli ; son durcissement est un arbitrage ouvert. Corollaire : `reports.audit.read` et
  `users.view_audit` existent dans l'union `PermissionCode` mais ne gardent pas cette lecture.
  Consommateurs : `AuditPage.tsx`, `useSettingsHistory`, `useProductAuditLog`.
- [ ] **Complétude de la LECTURE : le journal affiché est-il le journal réel ?** Un contrôle
  d'audit-completeness ne s'arrête pas à « la ligne est écrite », il vérifie qu'elle
  **ressort** : comparer `SELECT count(*) FROM audit_logs WHERE <filtre>` à ce que rend la
  famille `get_audit_logs` sur le même filtre. Écart connu **non expliqué** : le 2026-08-08,
  l'onglet History d'un produit rendait 5 lignes sur 7, les 2 manquantes étant exactement
  celles à `actor_id IS NULL` (deux `product.cost_recomputed` — la réponse à « pourquoi ma
  marge a bougé »). **Re-vérifié le 2026-08-31 : ni le corps live de la RPC ni la policy
  `admin_read` ne filtrent sur `actor_id`, et la base dev portait 763 lignes sans acteur sur
  8 220.** Symptôme réel et daté, cause ailleurs qu'on ne le croyait — à re-prouver avant
  d'agir, jamais à citer comme un comportement documenté. Noter aussi que `payload` (le diff)
  n'est servi par aucun membre de la famille : seul `metadata` est affichable.
- [ ] **Les lectures sensibles sont loggées là où ça compte** : les exports en masse de
  PII/financiers (CSV/PDF) devraient émettre une ligne d'audit — un manager qui aspire la
  liste clients doit être visible.

### D. Exposition de données (PII & fuite d'information)

- [ ] **anon ne voit rien** sur `customers`, `orders`, `payments`, `expenses`,
  `journal_entries`, `audit_logs` : `has_table_privilege('anon','customers','SELECT')` = false,
  et `has_table_privilege('anon','mv_sales_daily','SELECT')` = false en contrôle de
  non-régression (le trou MV est corrigé, `20260619000020`).
- [ ] **La lecture PII client est gatée** : la policy SELECT sur `customers` ne doit pas se
  contenter de `is_authenticated()` ; le BO passe par `customers.read`, le POS par une RPC
  definer étroite. Et **`pin_hash` reste illisible** — `REVOKE SELECT (pin_hash) … FROM
  authenticated` (niveau colonne) ne doit pas réapparaître dans un grant.
- [ ] **Les colonnes PII client sont protégées en écriture** : `customers` n'autorise
  INSERT/UPDATE `authenticated` que sur `(name, phone, email, customer_type, category_id,
  birth_date, marketing_consent, b2b_*)` ; fidélité/dépense/visites ne mutent que par RPC
  definer. Vérifier qu'aucun élargissement n'a été introduit.
- [ ] **Les vues ne contournent pas la RLS** (Pattern 9) ; les MV ne sont grantées ni aux
  rôles bas ni à anon.
- [ ] **Pas de PII dans les logs/metadata.** Greper `metadata`/`payload` et les logs d'EF pour
  téléphones/emails/PIN bruts : une PII dans `metadata` fuit même si la table est gatée.
- [ ] **Les messages d'erreur n'énumèrent pas** (pas de « utilisateur inconnu » vs
  « mauvais PIN »).

### E. Append-only & intégrité de schéma

- [ ] **Les ledgers refusent UPDATE/DELETE.** Pour chaque table append-only (Pattern 10),
  `has_table_privilege('authenticated','<t>','UPDATE')` = false. Si vrai, le REVOKE a régressé.
- [ ] **`search_path` épinglé sur toutes les definer.** `SELECT proname FROM pg_proc WHERE
  prosecdef AND proconfig IS NULL` → chaque résultat est un risque de détournement.
- [ ] **Paire REVOKE sur chaque RPC neuve** (Pattern 6) : ALTER DEFAULT PRIVILEGES manquant
  = anon hérite via PUBLIC.
- [ ] **La suite pgTAP de sécurité passe**, via MCP `execute_sql` en BEGIN/ROLLBACK, sur
  `supabase/tests/` : `security.test.sql`, `security_{anon_grants, append_only_ledgers,
  authenticated_policies, leak_guard, partition_grants, refund_sequences}.test.sql`,
  `expense_governance.test.sql`, `s26_db_hardening.test.sql`, `pin_policy.test.sql`.
  Rappel Pattern 2 : un test qui suppose la matrice RBAC seedée est fragile.

## Checklists préventives (5 interventions concrètes)

### 5.A — Avant d'ajouter une RPC sensible (mutation d'argent / identité / données)
- [ ] `SECURITY DEFINER` + `SET search_path = public` + `has_permission(auth.uid(),
  'module.action')` explicite levant `P0003` ; paire REVOKE (Pattern 6).
- [ ] Si elle déplace de l'argent ou inverse une transaction → PIN manager en second facteur
  transporté selon la cible (header EF ou argument RPC), vérifié serveur avec verrouillage ; `actor_id` d’audit
  = le manager approbateur ; `p_idempotency_key UUID` si retry-safe, le replay renvoyant le
  résultat initial et loggant `*.replay`.
- [ ] `INSERT INTO audit_logs` avec les colonnes canoniques et une `metadata` utile (montants,
  motif) mais **sans secret ni PII** ; `actor_id` résolu en `user_profiles.id`.
- [ ] pgTAP : nominal + permission refusée + (si argent) PIN requis + replay + assertion
  REVOKE-from-anon ; types régénérés via MCP `generate_typescript_types`.

### 5.B — Avant d'ajouter un code de permission
- [ ] Ajouter à `permissions` (seed, `ON CONFLICT DO NOTHING`) ET à l'union `PermissionCode`
  de `packages/supabase/src/rls/permissions.ts` (137 entrées au 2026-08-31 — compteur daté,
  à recompter, pas à recopier).
- [ ] Moindre privilège : accorder au rôle le **plus haut** qui en a besoin, pas « MANAGER+
  par défaut » ; re-justifier tout grant CASHIER. **Un grant de seed n'est plus définitif** :
  depuis l'ADR-031 un SUPER_ADMIN peut le modifier à l'écran — l'audit lit la base.
- [ ] Câbler le gate : `PermissionGate` / `authStore.hasPermission` côté UI, `has_permission`
  dans la RPC (un gate purement UI est cosmétique) ; pgTAP prouvant que le code refuse un rôle
  qui ne l'a pas, en posant l'état de matrice **dans la transaction de test**.

### 5.C — Avant d'exposer des données par une vue / un rapport / une RPC
- [ ] Vue : `WITH (security_invoker = on)` ; jamais de vue definer sur de la PII sans raison
  forte. Si elle agrège (MV/rapport) : l'agrégat lui-même n'est pas sensible et le SELECT est
  gaté. Pas de PII brute dans la projection si la permission du consommateur ne la justifie
  pas ; masquer téléphone/email quand un nom suffit. Auditer les exports en masse.

### 5.D — Avant de toucher au code d'auth, de PIN ou de session
- [ ] Lockout + rate-limit préservés ; toute voie d'auth (kiosk, RPC PIN-in-arg) passe par le
  même comptage. Si un seuil de lockout bouge, le modifier **des deux côtés** (politique
  configurable côté EF **et** helper `_verify_pin_with_lockout`), sinon la divergence du
  Pattern 11 s'aggrave.
- [ ] PIN jamais loggé, jamais renvoyé, jamais dans un corps qui se logge ; bcrypt ≥10 ; jeton
  de session haché au repos. Robustesse PIN avertissement → blocage : étaler, motiver.
- [ ] pgTAP / test d'EF : compte verrouillé rejeté, session expirée rejetée.

### 5.E — Avant de modifier un REVOKE / une RLS / une contrainte append-only
- [ ] Relâcher un REVOKE append-only ou une RLS couvre presque toujours un bug latent —
  trouver la cause réelle d'abord. Si une table doit accepter une correction : RPC
  compensatoire ou famille `_void`, jamais rouvrir UPDATE/DELETE à `authenticated`.
- [ ] Rejouer toute la suite pgTAP de sécurité + celle du module concerné ; objets neufs :
  re-confirmer que la ligne ALTER DEFAULT PRIVILEGES FROM PUBLIC tient.

## Sources de vérité (points d'entrée — résoudre la version live avant de citer)

```
RBAC / permissions
  20260517000030_refactor_has_permission.sql       # has_permission 4 étages (dernière définition)
  *seed*permission*.sql                            # pattern de seed (DO, ON CONFLICT)
  20260825000001..000009_*.sql                     # éditeur RBAC ADR-031/032 : rbac.manage,
      # correctif actor_id du trigger de matrice, familles set_role_permission,
      # set_user_permission_override, delete_user_permission_override, create_role, delete_role
  docs/adr/031-rbac-editable-super-admin.md   docs/adr/032-cycle-de-vie-des-roles.md
  packages/supabase/src/rls/permissions.ts         # union PermissionCode + helpers
  apps/backoffice/src/stores/authStore.ts          # gate client (Zustand)
  apps/backoffice/src/pages/settings/roles/  + features/settings/roles/components/

Audit
  20260503000005_init_settings.sql   # audit_logs (canonique, SEULE surface)
  20260523000019 (+payload)   20260619000022 (append-only GRANT)   20260710000087/000088 (vue droppée)
  *get_audit_logs*.sql               # famille de lecture (bornes de dates métier)
  apps/backoffice/src/pages/reports/AuditPage.tsx  + features/reports/hooks/useAuditLogs.ts

Auth / PIN / rate-limit / session
  supabase/functions/auth-verify-pin/index.ts   # bcrypt, lockout configurable, JWT
  supabase/functions/_shared/{idempotency.ts,rate-limit.ts,cors.ts}
  20260622000010_create_verify_pin_with_lockout_helper.sql   # chemin RPC (5/15 EN DUR)
  *pin_policy*.sql   20260523000010..012_*rate_limit*.sql   20260523000020 (session timeout)
  packages/utils/src/pin-strength.ts   packages/ui/src/hooks/useIdleTimeout.ts

Flux d'argent (vérifier gate + emplacement du PIN + audit pour chacun)
  supabase/functions/{refund-order,void-order,cancel-item,process-payment,verify-manager-pin}/
  *refund* *void* *cancel* *cash_movement* *manual_je* *expense*approve*.sql
  20260706000023_allow_super_admin_self_approve_expense_v3.sql   # exception SOD

Durcissement anon / RLS / append-only
  20260524000020..031_*.sql   # balayage anon+PUBLIC (+ _031 correctif FROM PUBLIC)
  20260619000020/000021_*.sql # security_invoker + REVOKE MV
  *b2b_payments* *expense_approvals* *internal_transfers*.sql

Tests (vérité comportementale, liste complète en checklist E) + AGENTS.md "Critical patterns"
```
(chemins nus = `supabase/migrations/` ou `supabase/tests/`.)

## Vérification avant d'annoncer un audit ou un correctif complet

```bash
pnpm typecheck
# pgTAP de sécurité via MCP execute_sql, enveloppe BEGIN/ROLLBACK (liste en checklist E)
pnpm --filter @breakery/app-backoffice test roles     # éditeur RBAC / matrice
pnpm --filter @breakery/app-backoffice test audit     # visualiseur du journal
```

Les filtres vitest matchent le **nom de fichier**, pas le `describe`, et beaucoup de tests du
BO sont en kebab-case : localiser par glob avant de conclure « ça passe ». Auditer toujours
contre le cloud V3 dev `ikcyvlovptebroadgtvd` via le MCP Supabase — jamais la prod
(`abjabuniwkqpfsenxljp`, lignée incompatible), en `BEGIN … ROLLBACK`.

## Quand escalader (signaler, ne pas continuer en silence)

- Une `SECURITY DEFINER` sans gate `has_permission` ou sans `SET search_path` ; une RPC
  mutante d'argent/identité/schéma sans ligne d'audit ; un `actor_id` écrit avec `auth.uid()`.
- Une RPC d'argent/reversal sans second facteur manager, avec le caissier pour seul `actor_id`,
  OU `GRANT EXECUTE TO authenticated` la rendant appelable via PostgREST en contournant le PIN
  de l'EF (Pattern 5 — **régresse à chaque bump**) ; un PIN lu depuis le corps ; tout nouveau
  chemin d'auth qui saute lockout, rate-limit ou audit.
- `pin_hash` (ou toute colonne de secret) lisible par `authenticated`, PII `customers` lisible
  sans gate, NOUVELLE vue PII/financiers sans `security_invoker`, MV lisible par `anon`.
- Un GRANT permanent d'override sans raison documentée, un rôle bas portant une permission
  sensible, un rôle non-système (ADR-032) trop doté, un clone ayant hérité `rbac.manage` —
  **après avoir vérifié que ce n'est pas une décision prise à l'écran** (ADR-031) : chercher
  la ligne d'audit avant de crier à la fraude.
- Sur le point de relâcher un REVOKE append-only ou une policy RLS (couvre presque toujours un
  bug latent) ; ou un écart entre ce que `audit_logs` contient et ce que la famille
  `get_audit_logs` rend — un journal incomplet est un défaut de contrôle, pas d'affichage.
