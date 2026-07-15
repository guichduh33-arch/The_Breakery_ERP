# S66 — Clôture de caisse ① : PIN manager sur gros écart (+ dette D-9 station-printers)

> **Date :** 2026-07-07 · **Branche :** `swarm/session-66` · **Source :** fiche 12 remise-à-plat D2.1 (B1.4) + dette D-9 INDEX S65.
> **Décisions propriétaire (brainstorm 2026-07-07) :** seuil PIN **distinct et plus élevé** que le seuil note ; manager **désigné explicitement** (sélection + PIN, pas de matching anonyme) ; défauts 200 000 IDR / 2 % ; auto-approbation autorisée (un manager clôturant son propre shift se sélectionne lui-même — la « double signature » B2.3 reste un chantier futur).

## 1. Principe

Deux étages de contrôle à la clôture de shift :

| Étage | Seuil (business_config) | Exigence | État |
|---|---|---|---|
| Note d'écart | `shift_variance_threshold_abs/pct` (50 000 / 0,5 %) | note obligatoire | livré S60 (`close_shift_v3`) |
| **Approbation manager** | **`shift_variance_pin_threshold_abs/pct` (200 000 / 2 %)** — nouveaux | **note + manager désigné + PIN 6 chiffres validé serveur** | **S66 (`close_shift_v4`)** |

Les deux gardes sont indépendantes (un seuil PIN configuré sous le seuil note exigerait le PIN sans la note — choix de config assumé). Le replay idempotent (session déjà fermée) sort **avant** les deux gardes, comme en S60.

## 2. DB (migrations `_117..119`, cloud V3 via MCP)

1. **`_117`** — `business_config` : + `shift_variance_pin_threshold_abs NUMERIC NOT NULL DEFAULT 200000` et `shift_variance_pin_threshold_pct NUMERIC NOT NULL DEFAULT 0.02` (CHECK ≥ 0 nommés). Nouvelle permission **`shift.variance.approve`** (module `shift`) seedée `SUPER_ADMIN`/`ADMIN`/`MANAGER` (idempotent ON CONFLICT). `pos_sessions` : + `variance_approved_by UUID NULL REFERENCES user_profiles(id)`.
2. **`_118`** — **`close_shift_v3 → v4`** : corps repris du **live** (`pg_get_functiondef`, règle DEV-S57-02, corps vérifié identique au fichier `_105`), + `p_approver_id uuid DEFAULT NULL` + `p_manager_pin text DEFAULT NULL` ; **DROP v3 même migration** ; trio S20 (REVOKE PUBLIC + anon, GRANT authenticated).
   Garde insérée après la garde note (le SELECT seuils est étendu aux 4 colonnes) :
   - sur-seuil PIN sans `p_approver_id`/`p_manager_pin` → **`pin_approval_required`** (P0001, DETAIL avec variance) ;
   - approbateur introuvable / inactif / supprimé / `auth_user_id` NULL / sans `has_permission(auth_uid, 'shift.variance.approve')` (les overrides user comptent) → **`approver_not_authorized`** (P0003) ;
   - PIN faux → **`invalid_pin`** (P0003) via **`_verify_pin_with_lockout(p_approver_id, pin)`** (helper S38 réutilisé tel quel — lockout 5/15 min ciblé sur le manager désigné, audit `pin.failed`/`pin.locked` inclus) ; compte verrouillé → `account_locked` (P0004) remonte tel quel.
   - Succès : `pos_sessions.variance_approved_by = p_approver_id`, approbateur dans le metadata `audit_logs` `shift.close` et dans le jsonb de retour (`variance_approved_by`).
3. **`_119`** — réglages : branche `'pos'` de `get_settings_by_category_v1` + 2 cases `set_setting_v1` (validation number ≥ 0, audit old/new hérité) — **in-place depuis les corps live** (S64 a modifié `set_setting_v1` : ne jamais repartir du fichier `_190`).
4. Types regénérés (`types.generated.ts`) + commit.

## 3. POS

- `useCloseShift` → `close_shift_v4` (+ `approver_id`/`manager_pin` optionnels dans l'input) ; mapping des erreurs `pin_approval_required`, `approver_not_authorized`, `invalid_pin`, `account_locked` en messages propres.
- `CloseShiftModal`, étape **review** uniquement (le blind count reste intact) : si sur-seuil PIN (prédicat client miroir, même style que `shouldShowWarning`), section « Manager approval » — **select natif** du manager (`list_login_users_v1` via `useLoginUsers`, filtré rôles `Manager`/`Admin`/`Super Admin`) + champ PIN masqué (`inputMode="numeric"`, 6 chiffres) ; « Close Shift » désactivé tant que manager + PIN 6 chiffres non saisis.
- Seuils PIN propagés par `useShiftCloseSummary` (lit déjà `business_config`) → props du modal.

## 4. BO

- `SettingsGeneralPage` : + 2 champs catégorie `pos` (`shift_variance_pin_threshold_abs/pct`), à côté des seuils note.

## 5. Tests

- **pgTAP `close_shift_pin_gate.test.sql`** (live, BEGIN/ROLLBACK) : sous-seuil PIN sans args OK · sur-seuil sans approver → `pin_approval_required` · PIN faux → `invalid_pin` (+ échec compté) · approbateur sans permission → `approver_not_authorized` · happy path → closed + `variance_approved_by` + audit · replay exempté · garde note toujours active.
- Repoint des suites existantes `close_shift_note_enforced` + `cash_register` (v3 → v4 ; si leurs fixtures dépassent le seuil PIN, ajuster la variance entre les 2 seuils ou fournir approbateur+PIN).
- Smoke Vitest POS : la section Manager approval apparaît et bloque au-dessus du seuil.
- **Money-path v17/v11/fire_v4 non touchée** (close_shift est hors money-path) ; ancres habituelles au closeout.

## 6. Dette D-9 S65 — station-printers (AUDIT LIVE FAIT, trou confirmé)

Constat live 2026-07-07 : policy `lan_devices_select_authenticated` = `has_permission(auth.uid(), 'lan.devices.read')` ; la permission n'est accordée qu'à `SUPER_ADMIN`/`ADMIN`/`MANAGER`. Les rôles POS **`CASHIER`** et **`waiter`** ne l'ont pas → `useStationPrinters` (SELECT direct POS) reçoit **0 ligne en silence** → map d'imprimantes vide → routage KOT muet pour un caissier/serveur.
**Fix S66** : migration seed `lan.devices.read` → `CASHIER` + `waiter` (lecture seule : nom/IP/port d'imprimantes LAN, non sensible) + vérification que la suite `lan_devices_rls` S65 n'asserte pas le contraire (adapter sinon) + note dans l'INDEX.

## 7. Hors périmètre

Comptage 3 volets (D2.2), comptage par coupure (D2.3), rapport écarts par caissier (D2.4), double signature caissier+manager (B2.3), alerte d'écart pré-clôture (D1.2).
