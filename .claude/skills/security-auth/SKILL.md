---
name: security-auth
description: >-
  Authentification et droits Breakery : connexion, PIN-JWT, RLS, gates RPC/UI, PUBLIC/anon, lockout, rate limit, RBAC et sessions. Pour modifier ou diagnostiquer ces mécanismes. Audit transversal des abus : security-fraud-guard.
---

# Security & Auth — The Breakery ERP

Identifier la frontière de confiance réellement modifiée. Lire le modèle RBAC pour les droits, le modèle de session pour l’inactivité, et les checklists correspondantes avant tout changement.

## Lecture proportionnée

Les règles d’AGENTS.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par AGENTS.md. | [contrôles et sources](references/verification.md) |

## Mental model — Anon defense-in-depth (S20)

Supabase **auto-grants EXECUTE** on all `public` functions to `anon` AND `authenticated` via
`ALTER DEFAULT PRIVILEGES … TO anon`. This means:

> `REVOKE EXECUTE … FROM anon` alone is **insufficient** — anon still inherits EXECUTE through
> its PUBLIC membership (`=X/postgres` ACL entry).

The S20 sweep (`20260524000031`) established the canonical two-statement **REVOKE pair** that
every new SECURITY DEFINER RPC MUST include in its companion REVOKE migration:

```sql
REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

(Verified verbatim from `20260524231054_revoke_pair_get_payments_by_method_v1.sql`.)

The `ALTER DEFAULT PRIVILEGES` line future-proofs new postgres-owned functions so they don't
inherit PUBLIC EXECUTE. It is idempotent — safe to repeat in every migration, and is the
canonical template since S25 (`20260602000013`).

**Extension objects** (`supabase_admin`-owned): pgTAP helpers (`pg_all_foreign_keys`,
`tap_funky`, etc.) are platform-managed and not user-revocable. pgTAP test files exclude them.

---

## Mental model — PIN auth + JWT fetch wrapper

`auth-verify-pin` EF issues **HS256 JWTs**. GoTrue uses **ES256** and cannot validate them.

**Fetch wrapper pattern** (`packages/supabase`): `setSupabaseAccessToken` injects the PIN JWT
on every Supabase client request. **Never** bypass with a raw `Authorization` header or
`auth.setSession` — the GoTrue ES256 validation will reject it.

**Transport du PIN — le véhicule dépend de la cible** (arbitrage propriétaire 2026-08-31,
gravé dans CLAUDE.md ; deux skills se contredisaient) :

- **Vers une Edge Function → en-tête `x-manager-pin`**, jamais le body JSON : les bodies d'EF
  sont loggés (PostgREST, pgaudit, proxies). Règle de hard-cutover : on retire le champ de body
  DANS LE MÊME COMMIT que la lecture d'en-tête. Pas de dual-mode.
  Référence : `supabase/functions/refund-order/index.ts` (body `manager_pin` → header, S25).
- **Vers une RPC Postgres appelée par PostgREST → argument `p_manager_pin`.** Une RPC ne lit
  pas les en-têtes : l'argument est le seul véhicule qu'elle puisse réellement valider.
  `approve_expense` a précisément été déplacée du header vers l'argument le 2026-06-01 parce
  que la RPC ne lisait jamais l'en-tête — le PIN était transporté, jamais vérifié.
  **Ne pas « re-corriger » ces RPC vers l'en-tête.**
- **Le critère d'audit n'est donc pas le véhicule, mais : la cible vérifie-t-elle le PIN, avec
  verrouillage ?** (helper `_verify_pin_with_lockout` côté SQL, `_shared/manager-pin.ts` côté EF.)

**Balayage EF : SOLDÉ** (vérifié le 2026-08-31). `void-order` et `cancel-item` lisent bien
`req.headers.get('x-manager-pin')` ; `kiosk-issue-jwt` ne consomme aucun PIN (son body est
`kiosk_id` / `scope` / `device_label`). Ne pas rouvrir ce chantier — le relever par grep sur
`supabase/functions/` s'il faut s'en assurer, pas depuis cette fiche.

**auth-verify-pin** returns a `LoginResponse` including a `permissions` string[] array used by
`hasPermission()` client-side. The session is cached — no roundtrip per check.

---

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
