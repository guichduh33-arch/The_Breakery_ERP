# Session 72 — Journal d'audit opérationnel POS (5 lots) — INDEX

**Branche :** `swarm/session-72-pos-audit-journal` (base master `875c9e8d`)
**Plan :** [`2026-07-11-session-72-pos-audit-journal-plan.md`](2026-07-11-session-72-pos-audit-journal-plan.md)
**Décisions propriétaire 2026-07-11 :** table dédiée · enregistrement des terminaux · loguer chaque
changement · partitionnement (purge = DROP partition) · offline comptoir aussi · fraude d'abord ·
source unique dans le périmètre.

## Livré

L'onglet Activity passe d'un flux « Sale completed » à un **journal d'audit opérationnel complet** :
chaque manipulation opérateur, par terminal, immuable, résiliente offline **sans perte ni doublon**,
consultable (filtres/timeline/CSV) et **unifié** avec les outcomes serveur qui réconcilient avec les
onglets financiers. **Money-path byte-identique** (ancre `s44_money_gates` 12/12 re-passée au closeout,
`num_failed=0`).

### Lot 1 — Fondation DB (migrations `_154`/`_155`/`_156`)
- **`pos_devices`** — registre des terminaux : `device_token` opaque UNIQUE (localStorage), label,
  kind (`counter/tablet/kds/kiosk/unknown`), auto-provisionné au 1ᵉʳ batch (`unknown`/non-enregistré),
  nommé par un manager via **`register_pos_device_v1`** (gate `reports.audit.read`, upsert idempotent).
  RLS SELECT `reports.audit.read` ; REVOKE DML `authenticated`.
- **`pos_events`** — table **dédiée, partitionnée par mois** sur `occurred_at` (partitions 2026_07..09
  + DEFAULT catch-all ; purge = DROP partition, DDL non affecté par le trigger). **Append-only strict** :
  RLS SELECT gaté, REVOKE INSERT/UPDATE/DELETE, trigger BEFORE UPDATE/DELETE → `0A000`. Enum
  **`pos_event_type`** (34 valeurs). Idempotence offline : `UNIQUE (client_event_id, occurred_at)` —
  `occurred_at` figé une seule fois à l'émission et rejoué verbatim. Pas de FK (convention `audit_logs`) ;
  `actor_id` = opérateur à l'émission, `synced_by` = flusher. 5 index (occurred/order/type/device/actor).
- **`record_pos_events_v1(p_device_token, p_events jsonb)`** — ingest **batch idempotent**
  (`ON CONFLICT DO NOTHING`), auto-provision device + `last_seen_at`, write authentifié (42501 sinon),
  → `{device_id, received, inserted, duplicates}`. Trio REVOKE S20 sur tout.

### Lot 2 — Outbox client + fraude d'abord (`apps/pos/src/features/audit/`)
- **`deviceIdentity.ts`** — `device_token` stable + `device_seq` monotone en **localStorage brut**
  (durable ; `safeStorage` = sessionStorage sur web, inutilisable ici).
- **`outbox.ts`** — file durable async : **IndexedDB** en navigateur, fallback localStorage
  (jsdom/tests). Dédup `client_event_id` ; un enregistrement n'est supprimé qu'après ACK serveur.
- **`emitPosEvent.ts`** — point d'entrée unique fire-and-forget : enveloppe immuable figée à
  l'émission, enqueue, flush débouncé. **Ne jette jamais**, n'attend aucune I/O. `flushPosEvents`
  no-op offline/non-authentifié ; batch via `record_pos_events_v1` ; **lazy-import** du client supabase.
- **`PosEventOutboxMount.tsx`** — flush au mount / `online` / interval 30 s, monté au shell App
  (toutes routes POS : comptoir, tablette, KDS).
- Fraude câblée : `cash_drawer_opened` (vente SuccessModal + **manuel** DevicesSettingsTab),
  `session_opened` (useShift), `payment_failed` (catch checkout).

### Lot 3 — Émission fine (additive, reducers purs — emit APRÈS `set`)
- **cartStore** (choke point comptoir+tablette) : `order_opened` (vide→1ʳᵉ ligne), `item_added`
  (add/addCombo), `item_qty_changed`, `item_removed_pre_fire`, `item_voided_post_fire`
  (markCancelled), `order_type_changed`, `table_assigned`, `discount_applied/removed` (ordre+ligne).
  Garde `canEdit` hissée avant `set` sur update/remove (comportement identique).
- **Paiement** : `payment_method_selected` (paymentStore), `payment_started`/`payment_completed`
  (dispatchCheckout). **Cuisine** : `sent_to_kitchen` (après succès `fire_counter_order_v4` + scellage),
  `kitchen_bumped` (KDS). **Cycle** : `order_held`, `order_resumed` (reopen firé + restore draft).
  **Reçus** : `receipt_printed` / `receipt_reprinted` (ref première-impression).

### Lot 4 — Lecture + UI Journal (migration `_157`)
- **`get_pos_events_v1(p_start, p_end, p_event_types[], p_device_id, p_actor_id, p_order_id, p_limit, p_cursor)`**
  — keyset `(occurred_at DESC, id DESC)`, fenêtre WITA `business_config`, gate **`reports.audit.read`**
  (42501), gardes P0001 (dates + curseur malformé), limit clampé 1..200. Page 1 : total réel + facettes
  devices/acteurs ; pages curseur : sentinelle `-1`, facettes vides.
- **UI** : onglet Activity scindé **Sales | Journal** (toggle visible avec `reports.audit.read` seulement).
  `ActivityJournal` : chips famille (cart/kitchen/payment/control/session), selects terminal+opérateur,
  **timeline par ticket** (clic n° → filtre `order_id`, chip effaçable), **signaux de contrôle** rouges
  (tiroir manuel, payment_failed, reprint, voids, refunds, paid_out), horodatage WITA
  (`Intl.DateTimeFormat` sur la tz du rapport), scroll infini (IntersectionObserver + Load-more),
  **export CSV** (`buildCsv`/`downloadCsv` domain). Hook `usePosEventsJournal` (useInfiniteQuery).

### Lot 5 — Source unique : flux unifié (migration `_158`, même signature)
**Décision d'architecture** : dériver les chiffres financiers d'un flux émis client (best-effort,
falsifiable par tout opérateur authentifié) serait une **régression de confiance** → les onglets
financiers restent sur les tables money-path. La « source unique » est réalisée **à la lecture** dans
le journal : `get_pos_events_v1` fusionne gestes client ∪ **outcomes serveur** dérivés des tables,
même périmètre canonique → réconciliation par construction (**assertée en pgTAP**).
- `sale_completed` ← `orders` (périmètre canonique Lot A) — **compte == Overview orders, exact**.
- `order_voided` ← `orders.voided_at` (**type synthétique reader-only**, hors enum), acteur `voided_by`.
- `refund_issued` ← `refunds` (partiels seulement ; un full void ne sort qu'une fois).
- `session_opened` ← `pos_sessions`, **dédupé** si le terminal a déjà sync son propre événement.
- `session_closed` ← `pos_sessions.closed_at` (montant = cash compté).
- Lignes dérivées : `payload.source='server'`, uuid synthétique stable (md5 — keyset déterministe),
  device NULL (le filtre terminal les exclut), label « Server (money-path) » + badge **server** UI.

## Tests (tous live sur le cloud V3 dev, enveloppe BEGIN…ROLLBACK)
- **pgTAP `pos_events` 9/9** — gate anon, ingest batch, auto-provision, replay idempotent (2 dup/0 ins),
  no-double-insert, `synced_by` = caller, UPDATE/DELETE bloqués `0A000`, register → `counter/true`.
- **pgTAP `pos_events_reader` 13/13** — gate, gardes P0001 (dates + curseur), newest-first, filtres
  type/ticket, limit, next_cursor, **pagination sans chevauchement**, sentinelle `-1`, facettes device.
  **Re-passée verte post-`_158`** (comportement flux client inchangé).
- **pgTAP `pos_events_unified` 8/8** — **réconciliation `sale_completed` == Overview orders (exacte)**,
  marqueur `source=server`, dérivation session open/close (+ cash compté), **dédup client/serveur**,
  filtre device excluant les lignes serveur, label UI.
- **Ancre `s44_money_gates` 12/12 (`num_failed=0`)** — preuve `complete_order_with_payment_v17`
  intact (change forgé/non-cash rejetés, JE cash sans fallback, replay idempotent, promos exactes/forgées,
  multiplier DB 73 pts).
- **POS unit/smoke** : `posEventOutbox` 9/9 (LS backend ; enqueue/dédup/ordre/ack/no-loss/no-auth),
  `ActivityJournal` + `POSActivityReportPage` 11/11, suite reports **41/41**. Typecheck **7/7**,
  build POS vert. Pattern-guardian **14/14 × 2** (diff Lot 2, diff Lot 3) + revue de branche au closeout.

## Déviations
- **DEV-S72-01** — pgTAP Lot 1 : lire `pos_devices` dans le **même statement** que l'appel
  `register_pos_device_v1` donne une visibilité MVCC indéfinie → mutation et assertion scindées en
  2 statements (8/9 → 9/9).
- **DEV-S72-02** — types **greffés** sur `types.generated.ts` (générateur MCP divergent, cf.
  DEV-S69-03) : blocs `pos_devices`/`pos_events`/enum `pos_event_type`/3 RPCs insérés aux ancres
  alphabétiques, pas de regen complet.
- **DEV-S72-03** — `_157` : `CREATE TEMP TABLE` est interdit dans une fonction `STABLE` → réécrit en
  requêtes séparées réappliquant le WHERE ; total+facettes calculés **page 1 uniquement** (les pages
  curseur les sautent).
- **DEV-S72-04** — outbox : IndexedDB en prod, **fallback localStorage** exercé par la CI (jsdom n'a
  pas d'IndexedDB ; pas de `fake-indexeddb` dans le repo) — API async identique sur les 2 backends.
- **DEV-S72-05** — l'import statique du client supabase dans `emitPosEvent` (importé par cartStore →
  quasi tout le graphe de test) a poussé des smokes produits/cart au-delà du `testTimeout` 15 s en run
  parallèle → **lazy import** dans `flushPosEvents` (vi.mock intercepte toujours).
- **DEV-S72-06** — Lot 5 réinterprété (« dériver voids/paiements/ventes du flux ») : dériver du flux
  **client** = régression de confiance → source unique réalisée à la **lecture** (client ∪ serveur),
  onglets financiers inchangés, réconciliation assertée. Aucun trigger sur les tables money-path
  (un trigger défaillant aurait avorté les ventes).
- **DEV-S72-07** — pgTAP unified : sessions seedées **pré-fermées** — la contrainte d'exclusion
  `one_open_session_per_user` interdit un 2ᵉ tiroir ouvert pour l'owner (shift E2E ouvert sur le dev).
- **DEV-S72-08** — `order_voided` = type **synthétique reader-only**, volontairement PAS ajouté à
  l'enum `pos_event_type` (jamais émis client ; l'ajouter serait un ALTER TYPE irréversible sans usage).
- **DEV-S72-09** (note INFO pattern-guardian, revue de branche) — l'idempotence de
  `record_pos_events_v1` dévie du pattern canonique « table `*_idempotency_keys` dédiée »
  (CLAUDE.md, saveur 2) : la clé est `client_event_id NOT NULL` **sur le ledger lui-même**
  (`UNIQUE (client_event_id, occurred_at)` + `ON CONFLICT DO NOTHING`). Architecturalement voulu —
  `pos_events` EST le ledger, la clé n'est pas nullable et ne pollue aucune table métrique — mais à
  connaître pour un audit ultérieur des patterns d'idempotence.

## Dettes (D-1..)
- **D-1** — types enum non émis côté client : `note_added`, `table_transferred`, `kitchen_recalled`,
  `change_given`, `manager_pin_used`, `login`, `logout`, `device_switch`, `paid_in`, `paid_out`
  (les 3 derniers n'ont pas de flux POS aujourd'hui). Candidats à un lot complémentaire sécurité.
- **D-2** — pas d'automatisation des partitions : `2026_07..09` + DEFAULT créées ; le DROP mensuel
  (purge) et la création des partitions futures sont **manuels** (la DEFAULT capte l'overflow, rien
  n'est perdu). Candidat pg_cron.
- **D-3** — le flush exige un JWT : des événements émis juste avant un logout restent en outbox
  jusqu'au prochain login sur ce terminal (aucune perte, sync différée).
- **D-4** — `device_token` en localStorage brut : un wipe navigateur re-provisionne un terminal
  `unknown` neuf (l'historique de l'ancien token reste lisible) ; le re-nommage est manuel (BO/manager).
- **D-5** — flakiness **pré-existante** de la suite POS complète sous charge parallèle (smokes
  produits/cart à 8–16 s vs `testTimeout` 15 s) : jeu d'échecs non-déterministe, chaque fichier vert en
  isolation. Marginalement aggravée par le graphe plus grand ; réduite par DEV-S72-05. À traiter par
  un bump de timeout ciblé ou du sharding si elle gêne la CI.
- **D-6** — la facette devices ne liste que les terminaux du flux client (les lignes serveur sont
  sans device — voulu) ; facettes et total calculés page 1 uniquement (design).
- **D-7** — UI Journal côté POS uniquement ; pas de page BO dédiée (le BO garde `audit_logs` via
  `get_audit_logs_v2` pour le sensible). Candidat si le propriétaire veut la lecture depuis le BO.

## Commits
```
f2712568 feat(pos-audit): S72 Lot 1 — infra DB du journal d'audit opérationnel POS
dcc7e9b8 feat(pos): audit journal Lot 2 — client outbox + fraud-first events
1e070f3d feat(pos): audit journal Lot 3 — fine-grained event emission
c568e83e feat(pos): audit journal Lot 4 — Activity Journal UI + get_pos_events_v1
c212d563 feat(pos): audit journal Lot 5 — unified stream (source unique)
```
