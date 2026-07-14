# Session 78 — Queue vitest D-6 : solder les 36 rouges du job `live-rpc-vitest`

**Date** : 2026-07-14 · **Branche** : `swarm/session-78` · **Base** : master `303dbd7d` (post-S77)
**Source** : INDEX S77 `2026-07-14-session-77-INDEX.md`, dette **D-6** (queue figée au run 29279963950 : 204 verts / 36 rouges, ~14 fichiers).

## Objectif

Le job `live-rpc-vitest` du nightly passe au **vert** (ou exclusions datées/motivées résiduelles),
sans toucher le money-path. Bonus hygiène : pollution durable soldée (E2E002), discipline de
cleanup des specs (D-7), dérive EF déployée-vs-repo (finding S71) tranchée.

## Queue D-6 (par classe de cause suspectée)

| Classe | Fichiers (rouges) | Hypothèse de départ |
|---|---|---|
| **Contrats EF** | generate-zreport-pdf (3) · generate-pdf (3) · sign-zreport (2) | dérive EF **déployée** vs repo — finding S71 : `_shared/permissions.ts` déployé lit `user_id`/`override_type` périmés (live = `user_profile_id`/`is_granted`) |
| **EF 422** | process-payment (2) · idempotency-hardening (2) | contrat body/headers dérivé, ou même dérive permissions |
| **Promotions** | promotions-rls (3, 42501) · promotions-evaluate-v1 (3, 0 promo) | RLS/perm dérivée + fixtures promos vs CHECK `_165` durci |
| **Inventory résiduels** | inventory-transfers (6) · inventory-opname (3) · inventory-alerts (2) · inventory-production (1) | sections inactives, données live mouvantes, messages d'assert périmés |
| **Divers** | stock-reservations (3, `available_quantity` null) · record-b2b-payment (2) · expenses (1) | RPC/vue dérivée ou fixture |

## Lots

- **Lot 0 — diagnostic dérive EF (controller, MCP)** : comparer les EFs déployées
  (`get_edge_function`) au repo pour `_shared/permissions.ts` + les EFs de la queue ;
  si dérive → **redeploy depuis le repo** (source de foi, hard cutover) et re-runs.
- **Lot 1 — classe EF** : specs generate-pdf / generate-zreport-pdf / sign-zreport /
  process-payment / idempotency-hardening re-vertes (fix EF déployée et/ou contrat spec).
- **Lot 2 — promotions** : rls + evaluate-v1 (attention au CHECK `_165` : les fixtures
  bogo/bundle doivent porter de vrais tableaux).
- **Lot 3 — inventory + divers** : transfers/opname/alerts/production, stock-reservations,
  record-b2b-payment, expenses.
- **Lot 4 — hygiène D-7** : clôture live de la session E2E002 fuitée (data fix one-shot) +
  `afterAll` de cleanup dans les specs qui ouvrent des sessions POS.

## Règles

- Money-path **intouché** (aucun bump RPC prévu ; si une EF money-path doit être redéployée,
  c'est le code du repo verbatim, jamais une édition).
- Chaque lot : re-run ciblé local (`pnpm --filter @breakery/supabase test <name>`) ; verdict
  global via le job CI (dispatch en fin de session seulement, jamais concurrent du cron).
- Toute exclusion résiduelle = quarantaine/skip **daté et motivé** (convention S77).
