# orders — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Audit checklist
- Sources de vérité (pointeurs)
- Verification before claiming complete
- When to escalate

## Audit checklist

- [ ] **Status transition valide** — seuls les états de l'enum réel sont utilisés. Grep `'open'` dans les nouvelles migrations ordres.
- [ ] **`order_type` vs `created_via`** — un filtre ou un guard « tablette » interroge `created_via`, jamais `order_type`.
- [ ] **Edit-items guard** — les 3 RPCs vérifient `status IN ('draft', 'pending_payment')`.
- [ ] **Prix serveur** — aucun nouveau chemin d'écriture d'`order_items` ne calcule un prix hors `_resolve_line_price` (SQL) / `lineTotalOf` (TS).
- [ ] **Totals cohérents** — après chaque edit-item, les totaux viennent de `_recalc_order_totals`, jamais d'un calcul dupliqué au call-site.
- [ ] **Idempotency replay** — même `p_idempotency_key` + même `action` retourne le `result` JSONB stocké sans mutation ; la double lecture autour du `FOR UPDATE` est préservée.
- [ ] **`order_edit_idempotency_keys` isolé** — aucune écriture hors des RPCs SECURITY DEFINER.
- [ ] **Refund integrity** — `SUM(refunds.total) <= orders.total` pour un même `order_id` ; le `refund_status` calculé par `get_orders_list` en découle.
- [ ] **Liste et compteurs d'accord** — un filtre ajouté à `get_orders_list` l'est aussi à `get_orders_counters`, sinon l'en-tête ment sur le tableau.
- [ ] **REVOKE pair complet** — chaque nouvelle RPC ordres a les 3 lignes (PUBLIC + anon + `ALTER DEFAULT PRIVILEGES`). Modèle : le bloc ACL de `20260810000002_adr022_d1_add_order_item_v5.sql`.
- [ ] **Types regen** — toute migration ordres touchant une signature déclenche `generate_typescript_types` → `packages/supabase/src/types.generated.ts`.

---

## Sources de vérité (pointeurs)

```
Migrations (jalons historiques — le vivant se relève par le numéro le plus haut)
  supabase/migrations/20260503000000_init_extensions_enums.sql          — enums order_status / order_type
  supabase/migrations/20260507000001_extend_orders_tablet.sql           — created_via ('pos'|'tablet')
  supabase/migrations/20260601000005_extend_order_type_enum_b2b.sql     — 'b2b' ajouté à order_type
  supabase/migrations/20260618000023_fix_edit_items_rpc_status_enum.sql — corrective 'open' → 'pending_payment'
  supabase/migrations/20260620000015_relax_orders_session_id_for_held.sql — 3ᵉ exemption session_id
  supabase/migrations/20260731000003_adr010_drop_cancel_tablet_order_add_close_cancelled_tablet_order_v1.sql
  supabase/migrations/20260810000004_adr022_d4_drop_cart_hold_path.sql  — drop de la voie brouillon
  supabase/migrations/20260813000002_uxui_lot4_search_orders_v1.sql     — recherche de commandes
  supabase/migrations/20260813000004_seed_orders_refund_reprint_perms.sql
  supabase/migrations/20260813000008_bump_get_orders_list_v4_sort.sql   — tri serveur + keyset générique

Tests pgTAP (vérité comportementale)
  supabase/tests/orders_read_perm.test.sql            — gate orders.read
  supabase/tests/orders_list_v4.test.sql              — filtres serveur
  supabase/tests/orders_list_v4_sort.test.sql         — tri blanc-listé
  supabase/tests/orders_list_v4_envelope.test.sql     — enveloppe + pagination keyset
  supabase/tests/orders_counters_v2.test.sql          — parité compteurs / liste
  supabase/tests/order_edit_items.test.sql            — édition d'items
  supabase/tests/order_item_lock_adr010.test.sql      — verrou cuisine + perte
  supabase/tests/held_orders.test.sql                 — famille held
  supabase/tests/hold_fired_order_v2.test.sql
  supabase/tests/reopen_held_order_v1.test.sql · reopen_held_order_v1_behavior.test.sql
  supabase/tests/adr010_close_cancelled_tablet_order.test.sql
  supabase/tests/complete_order_v27_table_guard.test.sql   — table obligatoire en dine-in
  supabase/tests/create_tablet_order_v8_waiter_identity.test.sql
  supabase/tests/search_orders_v1.test.sql
  supabase/tests/recalc_order_totals_mode_aware.test.sql · recalc_order_totals_pb1_inclusive.test.sql
  supabase/tests/realtime_publication_orders.test.sql

Intention & décisions
  docs/objectifs/ORDERS.md   — l'intention métier du module (ce qui est VOULU)
  docs/adr/009-cycle-de-vie-ordres.md
  docs/adr/010-verrou-items-envoyes-cuisine.md
  docs/adr/013-comptabilite-integrite-void-refund-remise.md
  docs/adr/022-portes-de-vente-pos-vendabilite-hold-envoi-cuisine.md
  docs/adr/025-liste-commandes-compteurs-et-bande-annonce.md
  docs/adr/031-rbac-editable-super-admin.md
```

---

## Verification before claiming complete

```bash
# Type & lint (cheap, run first)
pnpm typecheck

# pgTAP : via MCP execute_sql, enveloppe BEGIN … ROLLBACK (pas de runner local).
# Fichiers pertinents : cf. la liste « Tests pgTAP » ci-dessus.

# BO smoke — attention, les filtres vitest matchent le NOM DE FICHIER,
# pas le describe : localiser les fichiers par glob avant de filtrer.
pnpm --filter @breakery/app-backoffice test orders

# POS smoke
pnpm --filter @breakery/app-pos test order
```

Une part des échecs BO en local est **env-gated** (`VITE_SUPABASE_URL Required`) et n'est pas
une régression (`DEV-S25-2.A-02`). Le compte exact se relève en lançant la suite ; il ne se
grave pas ici, il changerait à chaque fichier de test ajouté.

---

## When to escalate

- Ajouter une valeur à `order_status` ou `order_type` → confirmer l'intention métier, `ADD VALUE` dans sa propre TX, puis re-vérifier **tous** les guards `status IN (…)` existants. Rappel : « tablette » n'est pas un `order_type`.
- Modifier la signature de `complete_order_with_payment` (ou de toute RPC money-path) → bump obligatoire depuis le **corps live** (`pg_get_functiondef`, jamais le fichier d'origine), `DROP` de l'ancienne version dans la même migration, **redéploiement de l'EF** qui l'appelle, puis vérification de tous les callers POS/BO.
- Relaxer ou resserrer `orders_session_id_required_for_pos` → les trois exemptions doivent être reportées ; en oublier une casse B2B, tablette ou held.
- Nouveau filtre de liste → l'ajouter **aussi** à `get_orders_counters`, et profiler si le filtre implique un JOIN sur une table sans index.
- Nouvelle valeur de `p_sort` → elle doit entrer dans la liste blanche **et** recevoir un cast de curseur cohérent, sinon la pagination keyset dérive.
- Changement du mécanisme PIN ou d'un scope de nonce → coordonner avec le skill `security-auth` (mécanique) ou `security-fraud-guard` (traçabilité / abus).
- Réintroduire une mise en attente de panier non envoyé → **contredit l'ADR-022 décision 4** : on le signale à Mamat, on ne l'implémente pas.
