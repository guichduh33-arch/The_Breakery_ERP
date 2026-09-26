# security-auth — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- Mental model — Permission gates
- Mental model — RBAC éditable : codes seedés, grants en DONNÉE (ADR-031 / ADR-032)
- Mental model — Durable rate-limit (S19)
- Mental model — Per-role session timeout (S19)
- Mental model — PIN strength (S19)

Sélection : ce skill mène la mécanique d’authentification et des autorisations dans les apps, RPC et EF. Le charger avant un nouveau gate, un changement de GRANT ou un assouplissement de RLS. [security-fraud-guard](../../security-fraud-guard/SKILL.md) mène l’audit transversal des possibilités d’abus et de fuite ; une correction technique isolée n’exige pas cet audit global.

# Security & Auth — The Breakery ERP

Expert on the security and auth surface: RLS, REVOKE/anon defense-in-depth, permission gates,
PIN JWT fetch wrapper, durable Postgres rate-limit, per-role session timeout. Two use cases:

1. **Audit** the existing auth/security posture for gaps, regressions, and missing REVOKE pairs.
2. **Guide** future changes (new RPC, new perm, new EF, RLS relaxation, auth mechanism change).

**`CLAUDE.md` est la source de vérité** for project-wide critical patterns. This skill adds
security-specific mental models, exact SQL blocks (verified from migrations), audit checklists,
and preventive guidance that CLAUDE.md doesn't carry at this level of detail.

> **Contenu re-vérifié contre le code le 2026-08-31.** Ce qui suit décrit l'état constaté
> à cette date. Les RPC bumpent : une famille est citée sans numéro de version — vérifier
> la version vivante dans `supabase/migrations/` (numéro NAME-block le plus haut) **et** au
> call-site avant de te fier à un `_vN` lu ailleurs. Les comptages sont datés ou renvoyés
> à leur source ; recompter plutôt que citer.

---

## Mental model — Permission gates

`packages/supabase/src/rls/permissions.ts` is the **canonical client-side closed set** of
`PermissionCode`. Every permission **code** must have a matching entry here **and** a seed
migration — the *catalogue* of codes is still closed and migration-owned (ADR-031, «ce que
cette décision ne tranche pas»). What is **no longer** migration-owned is who *holds* them:
see «RBAC éditable» below. The pattern in every SECURITY DEFINER RPC:

```sql
IF NOT has_permission(auth.uid(), 'scope.action') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0003';
END IF;
```

- **Server-side**: `has_permission(auth.uid(), 'scope.action')` in SECURITY DEFINER functions.
- **Client-side**: `hasPermission(userPermissions, 'scope.action')` (`packages/supabase/src/rls/permissions.ts`) consumed via `authStore` in BO + POS.
- **UI gate (BO)**: `<PermissionGate required="scope.action">` wraps routes + sidebar entries.

Key permission families (relevé du 2026-08-31 sur `permissions.ts` — recompter à la source
plutôt que citer ce relevé) :
- `accounting.{coa.read, coa.write, gl.read, tb.read, je.create_manual, period.close, …}`
- `zreports.{read, sign, void}`
- `orders.{read, edit_open, void, refund, reprint_receipt}` — `refund` / `reprint_receipt`
  seedés par `20260813000004_seed_orders_refund_reprint_perms.sql`
- `expenses.{thresholds.read, thresholds.write, …}`
- `display.{read, manage}` — display-stock isolation
- `rbac.{read, manage}` — `rbac.manage` seedé pour le seul SUPER_ADMIN (ADR-031)
- `inventory.*` — famille granulaire (opname, production, réservation, coût…) : la liste
  vivante se lit dans `permissions.ts`, section `inventory.*`.

---

## Mental model — RBAC éditable : codes seedés, grants en DONNÉE (ADR-031 / ADR-032)

Depuis le 2026-08-25, le RBAC n'est plus « un seed figé ». La distinction qui compte :

| Objet | Statut | Comment ça change |
|---|---|---|
| **Codes** de permission (`permissions`) | catalogue **fermé**, seedé | migration + entrée `PermissionCode` |
| **Grants** rôle × permission (`role_permissions`) | **DONNÉE éditable à chaud** | écran BO, RPC `set_role_permission` |
| **Overrides** par utilisateur (`user_permission_overrides`) | **DONNÉE**, GRANT ou DENY, raison + expiration | RPC `set_user_permission_override` / `delete_user_permission_override` |
| **Rôles** eux-mêmes (`roles`) | **cycle de vie** : créer / cloner / supprimer | RPC `create_role` / `delete_role` (ADR-032) |
| **Timeout** de session d'un rôle | éditable dans la fiche rôle | RPC `update_role_session_timeout` |

Lire **ADR-031** (`docs/adr/031-rbac-editable-super-admin.md`) et **ADR-032**
(`docs/adr/032-cycle-de-vie-des-roles.md`) avant de toucher à cette surface.

**Gate des RPC de mutation RBAC = triple**, dans cet ordre : `auth.uid()` non NULL →
`has_permission(uid, 'rbac.manage')` → **test de rôle** `role_code = 'SUPER_ADMIN'`. Le test de
rôle est le vrai verrou : ADMIN et SUPER_ADMIN portent aujourd'hui les mêmes permissions, donc
une permission seule ne peut pas exprimer « super admin uniquement ».

**Garde-fous gravés** (ne pas les affaiblir sans nouvel ADR) :
- ligne SUPER_ADMIN de la matrice **immuable** (`super_admin_row_locked`) — anti-lockout ;
- **aucun override ne cible un profil SUPER_ADMIN** (`super_admin_target_locked`) ;
- mutations de matrice en **INSERT/DELETE strict**, jamais `UPDATE is_granted` : le trigger
  d'audit ne couvre que INSERT/DELETE ;
- rôles `is_system` (SUPER_ADMIN, ADMIN, MANAGER, CASHIER) ni supprimables ni renommables ;
  suppression bloquée tant que le rôle est porté ; le clone ne copie jamais `rbac.manage` ;
- `has_permission` est un pur lookup à cascade (DENY user → grant de rôle → GRANT user → refus
  par défaut) : **un rôle neuf ou un grant neuf prend effet sans migration ni redéploiement**.
- Les permissions d'une session sont **figées au login** (`auth-get-session`) : un changement
  de matrice ne s'applique qu'à la prochaine connexion. C'est assumé, pas un bug.

**Conséquence pour les tests pgTAP** : `role_permissions` est de la DONNÉE, la matrice peut
avoir été éditée en production. Un test ne doit **plus supposer la matrice seedée**. Trois
parades, au choix selon le test : épingler **SUPER_ADMIN** (dont la ligne est verrouillée),
poser les grants/**overrides in-transaction** dans l'enveloppe `BEGIN … ROLLBACK`, ou
s'appuyer sur le **catalogue** `permissions` (toujours seedé) plutôt que sur les grants.

---

## Mental model — Durable rate-limit (S19)

Famille `record_rate_limit`, signature
`(p_function_name, p_bucket_key, p_ip_address, p_max_per_window, p_window_sec)`
(créée par `20260523000010`, race corrigée par `20260523000012` ; la version vivante est celle
épinglée au call-site dans `_shared/rate-limit.ts`) — SECURITY DEFINER, `service_role` only. Atomic upsert against
`edge_function_rate_limits` table. Uses `FOR UPDATE` row-lock on the live bucket; under sustained
attack ≥100 req/s this serializes on the same bucket (DEV-S19-1.A-01 informational, acceptable
at Breakery traffic). **Fail-open on DB error** — deliberate trade-off (logged; don't flip to
fail-closed without pool-sizing analysis, DEV-S19-1.A-02).

`checkRateLimitDurable` in `supabase/functions/_shared/rate-limit.ts` is the EF-side helper.

Le câblage s'est étendu bien au-delà des 5 EF du premier lot S19 : au 2026-08-31, une dizaine
d'EF appellent `checkRateLimitDurable` (dont `auth-verify-pin`, `auth-change-pin`,
`kiosk-issue-jwt` ×2 buckets, `process-payment`, `refund-order`, `void-order`, `cancel-item`,
`verify-manager-pin`, `generate-pdf`, `generate-zreport-pdf`). **Relever la liste par
`grep -rl checkRateLimitDurable supabase/functions/`, pas depuis cette fiche.**

**`Retry-After` : gap DEV-S19-2.A-02 SOLDÉ** (vérifié le 2026-08-31). Toutes les réponses 429
passent par `rateLimitedResponse` (`_shared/responses.ts`), qui pose l'en-tête `Retry-After` et
l'expose au fetch navigateur via `Access-Control-Expose-Headers`. Les **deux** buckets de
`kiosk-issue-jwt` (IP et `kiosk_id`) le surfacent, comme `auth-verify-pin`. Ne pas re-signaler.

Cron purge: `pg_cron` job `rl-purge` runs daily to clean expired buckets.

---

## Mental model — Per-role session timeout (S19)

`roles.session_timeout_minutes INT NOT NULL DEFAULT 30 CHECK (5..480)` (migration `20260523000020`).
Seeded defaults:
- CASHIER / waiter → 30 min
- MANAGER → 60 min
- ADMIN → 120 min
- SUPER_ADMIN → 240 min

Famille `update_role_session_timeout(p_role_code TEXT, p_minutes INT)` — RPC gatée
(`settings.update` + test de rôle) et audit-loggée. **Attention : la v1 a été DROPPÉE** par le
bump ADR-031 ; ne pas citer un numéro lu ailleurs, vérifier la migration au numéro NAME-block
le plus haut portant ce nom **et** le call-site du hook BO. Depuis l'ADR-031, l'édition du
timeout vit dans la **fiche rôle** (SUPER_ADMIN uniquement) et non plus dans la page Security
des réglages, qui ne garde que la politique PIN.

`useIdleTimeout` hook in `packages/ui` is mounted in both POS and BO. Émet `idle:warning` avant expiration ; `IdleWarningToast`, monté dans les deux apps, affiche cet avertissement. Le délai vient de `IDLE_WARNING_LEAD_MS`. À expiration, le callback de déconnexion est appelé.

`auth-get-session` EF returns `session_timeout_minutes` so the client can configure its timeout.

---

## Mental model — PIN strength (S19)

`evaluatePinStrength` in `packages/utils` (+ Deno mirror `supabase/functions/_shared/pin-strength.ts`).
A cross-package sync test catches drift between the two copies. Warn-only (no blocking).
`auth-change-pin` EF returns `{ ok, weak, weak_reason? }`.
`COMMON_PINS` array : 101 entrées au 2026-08-31 — la liste vivante se compte dans
`packages/utils/src/pin-strength.ts`, pas ici (note : entrée morte `'232425'` —
DEV-S19-2.B-03, informationnel).

---
