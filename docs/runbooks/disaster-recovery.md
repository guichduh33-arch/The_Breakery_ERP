# Reprise après incident — The Breakery ERP

Révision ciblée : 8 octobre 2026 — connexion, cibles et limites des procédures.

## Portée et autorisation

Les scénarios suivants proviennent du relevé du 14 mai 2026, partiellement
révisé en juillet. Leurs délais, réglages, fonctions et effets ne sont pas
des garanties actuelles. Confronter les procédures au code, au schéma live
et aux accès avant toute action ; aucune commande ne vaut autorisation.

Identifier la cible et le bundle réellement chargé avant une intervention.
Consulter l'[état des environnements](etat-environnements.md) et le
[runbook V3](production-v3-cutover.md) pour les preuves et limites du retour
arrière. Ne pas assimiler dev à staging ou prod.

## Scénario 1 — Perte de connexion au cloud

La conduite de caisse est décrite dans le
[guide de coupure Internet](pos-internet-outage.md). Distinguer panne WAN,
panne LAN et panne du hub ou du PC boutique.

- Le mode hors ligne exige l'application chargée, une session ouverte,
  un catalogue disponible et le hub joignable. Les paiements exigent leur
  activation explicite, désactivée par défaut.
- Les moyens autorisés excluent l'avoir client ; un règlement externe doit
  réellement aboutir avant son enregistrement dans la caisse.
- Ne pas effacer les données, désinstaller ou recharger aveuglément le POS.
  Les assets Android ne prouvent pas une restauration de session.
- Au retour du cloud, laisser le rejeu se faire et vérifier les opérations
  restantes. Une réponse perdue n'autorise pas une ressaisie sous un nouvel
  identifiant. Conserver les files et les constats de rejet.
- Ne pas créer une vente fictive en production pour vérifier la reprise.
  La recette métier exige une cible et une autorisation explicites.

Le code prévoit ces capacités ; la recette physique et l'état courant des
terminaux se vérifient séparément. Les décisions de paiement et de rejeu
restent dans les ADR correspondants, dont le texte n'est pas modifié ici.

## Procédures historiques restant à vérifier

La présence des scénarios ci-dessous ne prouve pas que les réglages, RPC
ou outils cités existent encore. Résoudre les familles et corps live avant
toute opération autorisée.

## Scenario 2 — DB restore from Supabase Point-In-Time Restore (PITR)

### Symptoms

- Bad migration applied that wiped a column or corrupted JE balance.
- Discovery via `verify_journal_entry_balance` triggering errors or
  Sentry alerting on `je_unbalanced`.
- Backoffice "Audit" report shows null `actor_id` rows where there
  shouldn't be.

### Impact

- All writes from t₀ (corruption) to t₁ (now) are at risk.
- Order completion is partially or wholly broken (depending on which
  RPC was hit).
- Realtime listeners may emit stale rows.

### Mitigation (immediate)

1. **Put the system in read-only mode** — flip the
   `business_config.pos_read_only_mode` flag to `true` via SQL:
   ```sql
   SELECT set_setting_v1('pos_read_only_mode', 'true'::jsonb, 'pos');
   ```
   This makes the POS show a banner and reject new orders.
2. **Snapshot current state** — `pg_dump` the current DB to S3 (even if
   corrupted, it may contain forensic data). Use the dashboard's
   `Backups → Snapshot` button.
3. **Stop EFs** — disable `auth-verify-pin` and `complete_order` via
   the dashboard so no further writes hit corrupted tables.

### Recovery (PITR)

1. Dashboard → Database → Backups → **Restore to point in time**.
2. Pick the timestamp **just before** the bad migration / event
   (Supabase keeps PITR for 7 days on Pro, 14 days on Team).
3. Confirm the restore. Supabase creates a **new project** with the
   restored state ; **the original project is NOT modified** — this is
   important.
4. Update DNS / `.env.local` / Vercel project secrets to point at the
   new project ref. Re-deploy POS and BO.
5. Re-run any **out-of-band writes** (orders made on paper during the
   outage) manually via the BO "Manual order entry" tool.
6. Generate types via MCP `generate_typescript_types` on the new
   project, commit `packages/supabase/src/types.generated.ts`, redeploy.

### Recovery (single-table rollback, no PITR)

If only one table is affected and PITR is too coarse:
1. Use the prior daily logical backup (S3 export).
2. `pg_restore --table=<corrupted_table> --data-only` into a temp
   schema, then a SQL `MERGE` back into `public.<table>`.
3. Re-run any constraint validators
   (e.g. `verify_journal_entry_balance`).

### Post-mortem template

```
Incident date / start / end :
Trigger (migration / human error / bug) :
Detection latency (minutes from t₀ to alarm) :
Rows affected (per table) :
Restore method (PITR / logical / manual) :
Restore time (start → green) :
Customer-facing impact :
Action items :
  - [ ] (e.g. add invariant test to CI to catch this earlier)
  - [ ] (e.g. require migration peer review for trigger-touching changes)
```

---

## Scenario 3 — EF `auth-verify-pin` outage

### Symptoms

- POS login screen shows `Login failed (500)`.
- Sentry: `Function auth-verify-pin returned 5xx`.
- Dashboard → Functions → `auth-verify-pin` → Logs shows panic /
  rate-limit / dependency error.
- Existing logged-in sessions continue to work (until the JWT expires
  — typically 1h with our cookie+localStorage strategy).

### Impact

- New POS / BO sign-ins fail.
- KDS / Display / Tablet kiosks may still be running on long-lived
  JWTs (kiosk-issue-jwt EF, 7-day default).
- Staff cannot rotate devices.

### Mitigation (immediate)

1. **Verify EF status** — dashboard → Functions → `auth-verify-pin` →
   Health.
2. **Check rate-limit** — `_shared/rate-limit.ts` (Phase 1.B) caps
   logins per IP. If a stuck loop blew the budget, the EF returns 429.
3. **Fallback path** — temporarily enable email/password auth for
   admin recovery:
   ```sql
   -- Set the feature flag to allow email/password login on /login
   SELECT set_setting_v1(
     'auth_email_password_fallback',
     'true'::jsonb,
     'pos'
   );
   ```
   POS `/login` then shows the email/password form (already coded
   behind the flag). ADMIN users can log in this way using their
   `auth.users.email` + their account-set password (or one set via
   `auth.admin.updateUserById` from a service-role console).
4. **Notify staff** — "if you can't log in, ask a manager to seat
   you on a logged-in device".

### Recovery

1. Once the EF is healthy (logs clean for 5 min), revert the
   fallback flag:
   ```sql
   SELECT set_setting_v1(
     'auth_email_password_fallback',
     'false'::jsonb,
     'pos'
   );
   ```
2. Verify a PIN login round-trip with a test user.
3. Rotate the EF secret if the outage was due to a compromised
   credential.

### Post-mortem template

```
Incident date / start / end :
EF deploy SHA at time of outage :
Root cause (code / dependency / config) :
Number of failed logins :
Action items :
  - [ ] (e.g. add canary check to ping auth-verify-pin every 60s)
```

---

## Scenario 4 — Migration corruption / rollback strategy

### Symptoms

- New migration applied via MCP `apply_migration` failed mid-way.
- `list_migrations` shows the migration as **partially** present in
  `supabase_migrations.schema_migrations`.
- Foreign keys broken / triggers missing / data half-updated.

### Impact

- Worst case: subsequent migrations fail because the assumed schema
  state is invalid.
- App build may still pass typecheck if `types.generated.ts` wasn't
  regenerated — but runtime RPCs will fail.

### Mitigation (immediate)

1. **Capture the failed migration ID** — `list_migrations` returns
   the version; record it.
2. **Do NOT re-run the same migration**. The transaction may have
   partially committed (some statements in a transaction block can
   commit if `COMMIT` was hit mid-way).
3. **Investigate the actual DB state**:
   ```sql
   -- via execute_sql MCP
   SELECT
     table_name,
     column_name,
     data_type
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN (...affected tables...);
   ```

### Recovery (staging — DEFAULT target)

1. **Hand-write a forward-only "fix" migration** that:
   - Reverses partial changes (DROP COLUMN / DROP TRIGGER etc.).
   - Re-applies the missing statements idempotently
     (`CREATE … IF NOT EXISTS`, `ALTER … ADD COLUMN IF NOT EXISTS`).
2. Apply via MCP `apply_migration`. Name it
   `<original_version>_fix_partial.sql`.
3. Regenerate types via MCP.
4. Commit both the corrupted-applied migration AND the fix migration
   so the chronological lineage stays intact.

### Recovery (production — when we cut over)

Production has stricter rules:
1. **Never DROP**. Always create new versioned RPCs / columns.
2. If the bad migration touched data, prefer PITR (Scenario 2) over a
   hand-fix.
3. Treat any migration outage as a P1 — page on-call.

### Post-mortem template

```
Migration version :
Failure point (statement N of M) :
Root cause :
Fix migration version :
Customer-facing impact :
Action items :
  - [ ] (e.g. add migration dry-run to staging before prod)
  - [ ] (e.g. enforce `BEGIN ; ... ; COMMIT ;` envelope review)
```

---

## Scenario 5 — Total POS device failure

### Symptoms

- POS tablet / kiosk PC is bricked / stolen / dropped.
- Customer is mid-order at that device.
- The cart was in local Zustand store but device is gone.

### Impact

- The in-flight cart on that device is lost (not yet sent-to-kitchen).
- Any orders that already hit `send_to_kitchen` are safe — they live
  in DB.
- Cash drawer state (if open) is at the staff's tally.

### Mitigation (immediate)

1. **Lock the device's account from BO**: Users → <user> → Revoke
   sessions. This kills the JWT.
2. **Floor manager re-rings** the customer's order on another device
   (the catalog + customer state are server-side, so the rebuild is
   ~30 seconds of taps).
3. **Drawer**: count cash physically, mark variance manually in the
   Shift Close screen on the replacement device.

### Recovery (device re-provisioning)

1. On replacement device:
   - Visit POS URL → `/login`.
   - Enter ADMIN-issued PIN.
   - For kiosk roles (Display / Tablet): scan the QR code generated
     by `kiosk-issue-jwt` (Phase 1.B). The kiosk JWT is per-screen
     and per-device — issuing a new QR invalidates the old one.
2. **Realtime state**: KDS / Display screens fetch their state from
   the DB on mount — no local replay needed. Tablet sessions resume
   from the `tablet_orders` table.
3. **Local cart**: there is no way to recover the lost in-flight
   cart from a dead device. The customer re-orders.

### Hardening (preventative)

- ~~Configure POS PWA to write the cart to IndexedDB every 5s~~ **Caduc :
  la PWA a été purgée S62** (décision propriétaire internet-first). Une
  persistance locale du panier reste un candidat, mais **hors PWA**.
- Pair every front-of-house device with a "buddy" device so staff can
  swap mid-shift.

### Post-mortem template

```
Device serial / asset tag :
Failure mode (drop / theft / hardware / power) :
Orders lost (count, value) :
Recovery time (device offline → replacement live) :
Action items :
  - [ ] (e.g. provision spare devices on premises)
  - [ ] (e.g. ship cart-IndexedDB persistence in next sprint)
```

---

## Scenario 6 — Printer outage *(⚠️ RÉVISÉ S62/S65 — `print_queue` supprimée)*

> **Ce scénario a changé de modèle.** La table `print_queue`, la page BO `/print-queue`, le poller `print-queue-poller` et la RPC `requeue_print_job_v1` **n'existent plus** (droppés S62, migration `20260710000110`). L'impression passe désormais par le **service local `apps/print-bridge`** (contrat V2 octet-exact + scan réseau, S65) et les **LAN Devices** (`/lan-devices`, BO CRUD). Ne pas requêter `print_queue`.

### Symptoms

- KDS bumps are received but no kitchen ticket prints.
- POS receipt printer prints partial / blank / garbled text.
- `apps/print-bridge` (poste local) hors ligne / non joignable.

### Impact

- Kitchen still sees orders on KDS (digital path is independent).
- Customers may walk out without a receipt.

### Mitigation (immediate)

1. **Verify printer status** — paper, ribbon, USB cable, LAN.
2. **Verify the print-bridge host** — le poste qui héberge `apps/print-bridge`
   est-il allumé, joignable sur le LAN, le service tourne-t-il ?
3. **Check LAN device registration** — BO `/lan-devices` : l'imprimante /
   station est-elle enregistrée et « online » ?
4. **Bypass**: KDS supports manual write-up mode — pre-printed
   ticket forms in the kitchen.

### Recovery

1. Redémarrer `apps/print-bridge` sur le poste local ; il re-scanne le
   réseau et reprend les jobs.
2. If a printer was permanently lost: re-provision via BO `/lan-devices`
   and re-assign affected stations.

### Post-mortem template

```
Incident date / start / end :
Printer asset (model / location) :
print-bridge host / version :
Tickets manually written :
Action items :
  - [ ] (e.g. superviser la disponibilité du poste print-bridge)
  - [ ] (e.g. add second printer fallback per station)
```

---

## Appendix A — Sentry alarm rules (suggested)

| Trigger | Threshold | Target |
|---|---|---|
| WebSocket close (1006) | >10 events / 5 min | on-call |
| `complete_order_with_payment_v19` 5xx (via EF `process-payment`) | >3 events / 5 min | on-call |
| `auth-verify-pin` 5xx | >5 events / 5 min | on-call |
| `je_unbalanced` (custom) | any | on-call + accounting lead |
| `apps/print-bridge` host unreachable | >2 min | floor manager |

## Appendix B — Daily ops checklist

- [ ] Sentry: 0 unresolved P0 / P1 alerts.
- [ ] `apps/print-bridge` host online et joignable sur le LAN.
- [ ] `stock_movements` integrity (`unit IS NOT NULL`): 100 % rows.
- [ ] `journal_entries` balance (`verify_journal_entry_balance`): 0 errors.
- [ ] Realtime channel `kds:station-*` subscriber count == #stations.

## Appendix C — Contacts

| Role | Contact |
|---|---|
| Supabase status | <https://status.supabase.com> |
| Sentry org | <https://sentry.io/organizations/the-breakery> |
| On-call (P1) | (PagerDuty rotation) |
| Accounting lead | (Slack #accounting) |
| Platform lead | (Slack #platform) |

---

_Update this runbook after every incident. Drift in this document is
itself an incident risk._
