# Session 78 — INDEX (queue vitest D-6 soldée)

**Date** : 2026-07-14 · **Branche** : `swarm/session-78` (base master `303dbd7d`)
**Plan** : [2026-07-14-session-78-vitest-d6-plan.md](2026-07-14-session-78-vitest-d6-plan.md)
**Objectif** : solder la dette **D-6 S77** — le job `live-rpc-vitest` du nightly, 36 rouges / 15 fichiers.

## Résultat

| Run | Verts | Rouges | Note |
|---|---|---|---|
| Base (S77, run 29279963950) | 204 | 36 (15 fichiers) | queue D-6 figée |
| Lot 1 (29322600180) | 234 | 6 (5 fichiers) | 30 tests réparés |
| Lot 2 (29323719581) | 249 | 3 (1 fichier : transfers P0002) | +2 EF bugs réels fixés |
| Lot 2b (transfers ciblé, 29324735785) | 7 | 0 | seed `current_stock` (P0002 après la couche section) |
| **Closeout (suite complète, 29324826674)** | **252** | **0** | **40 fichiers verts / 12 skippés (env-gated + quarantaine S77 + skips D-3 datés) — queue D-6 SOLDÉE** |

## Livré

### Lot 1 — 15 specs réconciliés avec le live (commit `443d6f08`)
- **sign-zreport** : v1 **droppée** → `sign_zreport_v2(p_zreport_id, p_manager_pin)` (PIN in-RPC depuis S37), action d'audit `zreport.sign` (pas `zreport.signed`).
- **generate-pdf** : le spec envoyait `params` + attendait `pdf_url` — le contrat EF réel est `data` (shape template-specific, l'EF ne fetch RIEN) + `{storage_path, signed_url}` ; pas de replay serveur (path déterministe par filename).
- **generate-zreport-pdf** : fixture snapshot sans `opened_at` → crash template (`reading 'slice'`) ; shape alignée sur `ZReportSnapshotData` ; enveloppe = `storage_path` ; ZP4 accepte l'enveloppe 401 gateway.
- **process-payment** : produits `LIMIT 2` sans filtre (2ᵉ produit stock 0 → 409) + prix client 80000 asserté alors que le prix est **canonique serveur** depuis S50 → sélection filtrée + assertions dynamiques `priceA+priceB` ; **afterAll** ferme la session (fuite EMP000 = la pollution D-7 S77).
- **promotions-rls** : 3 comportements re-statués — anon SELECT = **42501 grants-level** (S20, plus de « RLS-empty ») ; soft-delete par UPDATE direct **rejeté par le moteur pour tous** (cf. F-1) ; SUPER_ADMIN passe par la RPC. + afterAll (le seed « RLS Seed » fuyait à chaque run).
- **promotions-evaluate-v1** : `.insert([3 shapes hétérogènes])` — PostgREST **refuse un batch aux clés non uniformes (PGRST102)**, erreur avalée sans check → aucune promo insérée → `[]` partout. Inserts séparés + assertions d'erreur. (Le flux SQL équivalent passe 3/3 — vérifié MCP.)
- **inventory-transfers / opname / alerts / rls / stock-reservations / record-b2b-payment** : cause systémique = **BEV-AMER soft-deleted** sur la DB dev vivante (référencé par 11 specs). Réparé via `_helpers/fixtures.ts` **`ensureTestProduct`** (produits `ZZ-TEST-*` upsert-restaurés par sku fixe, idempotents, pas d'accumulation) ou sélection filtrée `track_inventory=true AND deleted_at IS NULL`. record-b2b-payment = la **dette S69 D-4 démasquée** (create_b2b_order_v5 sur produit soft-deleted → no_data_found).
- **inventory-rls** : le seed movement violait DEUX contraintes du ledger (`unit` NOT NULL `_019`, section movement-type-aware `_020`) — jamais vu car le job mourait avant.
- **inventory-production** : `allow_negative_stock=true` live → la RPC accepte légitimement le négatif, pas d'`insufficient_stock`. Toggle-restore du flag dans le test (try/finally, exécution sérielle).
- **expenses** : montant 1,1 M ≥ seuil `expense_approval_thresholds` 1 M = **2 étapes** (Manager puis Owner) — la 1ʳᵉ approbation seule ne crée pas de JE. Montant ramené en bande 1 étape (550k) ; **le JE credit+VAT fait 2 lignes depuis S59 F-4** (VAT foldée NON-PKP), plus 3 ; assertion de statut `approved` ajoutée.
- **idempotency-hardening TS3/TS4** : `refund_order_rpc_v4` n'émet `idempotent_replay` **que sur le replay** (convention CLAUDE.md) — le premier appel l'omet.

### Lot 2 — 2 bugs produit réels + redéploiement EF (commits `d4a5…`/ce lot)
- **F-1 (produit, migration `_167`)** — **le soft-delete des promotions était CASSÉ pour tout le monde** : le moteur applique la policy SELECT `auth_read (deleted_at IS NULL)` au NEW row d'un UPDATE → `42501 new row violates RLS` même pour SUPER_ADMIN, et le BO (`useDeletePromotion`) faisait exactement cet UPDATE. Fix conforme doctrine : **`delete_promotion_v1`** SECURITY DEFINER gatée `promotions.delete` (ADMIN/SUPER_ADMIN — ferme au passage le finding session 9 « MANAGER peut soft-deleter par OR-merge » : le gate voulu par le spec §3.5 est enfin appliqué), idempotente, audit `promotion.delete`, REVOKE trio ; BO câblé sur la RPC ; vérifié live 4/4 (MANAGER 42501 · délete · replay · deleted_at posé). Types regen (+1 ligne).
- **F-2 (EF, finding S71 s43-T2 soldé)** — `_shared/permissions.ts` lisait `user_id`/`override_type`, colonnes **inexistantes** (live = `user_profile_id`/`is_granted`/`expires_at`) : la requête overrides échouait à CHAQUE login et **les overrides par-user étaient silencieusement ignorés côté EF** — un DENY posé en BO n'atteignait jamais les gates EF (verify-manager-pin autorise les remises !). Réaligné verbatim sur `has_permission()` live (DENY non-expiré > grants rôle `is_granted=true` > GRANT non-expiré). **Vérifié de bout en bout post-deploy** : login EMP003 = 104 perms → DENY `reports.sales.read` posé → re-login 103 perms, permission absente → sonde nettoyée.
- **F-3 (EF generate-pdf)** — re-export du même filename = upsert d'un path storage existant via le client **user** = UPDATE `storage.objects` que la RLS refuse → **500 upload_failed à tout re-export**. Upload + signed URL passés au service role (miroir generate-zreport-pdf ; permission caller déjà gatée en amont, path scoped user_id).
- **5 EFs redéployées** depuis le repo (CLI `supabase functions deploy --use-api`, sans Docker) : auth-verify-pin, auth-get-session, verify-manager-pin, process-payment, generate-pdf. verify_jwt inchangés (config.toml/défauts = état live). Smoke login PIN 200 post-deploy.
- **Résidus lot 2** : transfers exige section_stock (P0001) **et** `products.current_stock` (P0002) → seed des 2 couches.

### Hygiène données (one-shot, DB dev)
- **15 promotions de test fuitées purgées** (14 hard-delete + 1 soft — elle avait une vraie `promotion_application` : la pollution avait un effet money réel sur les paniers dev). Cause : specs sans afterAll (corrigé).
- **2 sessions POS ouvertes fermées** : E2E002 (fuitée depuis le 09/07) + EMP000 (fuitée par process-payment à chaque run — afterAll ajouté).
- ⚠️ **Constat** : les anciens runs du test « insufficient stock » ont créé de **vraies commandes payées ~2,2 Mds IDR** (99999 × prix) dans les données dev quand `allow_negative_stock` est passé à true — le test toggle désormais le flag. Les commandes géantes résiduelles sont un chantier de nettoyage data à trancher (voir D-2).

### Outillage
- **`.github/workflows/vitest-live.yml`** : dispatch manuel du seul job vitest, input `filter` (itération ~4-6 min vs ~25 min nightly sérialisé). Posé aussi sur master (commit direct CI).
- **`supabase/tests/functions/_helpers/fixtures.ts`** : `ensureTestProduct` (produits `ZZ-TEST-*` stables). Convention : ces skus sont des artefacts de test admis sur la DB dev, ne pas purger à la main.

## Déviations
- **DEV-S78-01** : `vitest-live.yml` commité en direct sur master (outillage CI pur, pattern S77) pour être dispatchable, la branche portant la version canonique.
- **DEV-S78-02** : deploy EF via CLI `--use-api` (token login CLI) plutôt que MCP `deploy_edge_function` (bundles multi-fichiers à recomposer à la main = risque d'écart à l'octet).
- **DEV-S78-03** : deux toggles temporaires de `business_config.allow_negative_stock` dans des tests live (try/finally, suite sérielle) — si un runner meurt exactement entre toggle et restore, le flag reste à false ; symptôme : ventes POS refusées pour stock — remettre à true.

## Dettes
- **D-1** : specs encore verts mais dépendant de seeds mutables (`BEV-AMER` référencé par adjust-stock, inventory-concurrent, receive-stock, waste-stock, promotions-check-constraints, inventory-opname legacy) — migrer vers `ensureTestProduct` à la prochaine casse.
- ~~**D-2** : commandes géantes créées dans les données dev par les anciens runs process-payment~~ ✅ **SOLDÉE post-merge (2026-07-14, purge confirmée propriétaire)** : la pollution se réduisait à UNE commande `#0021` (3 499 965 000 IDR, 99999 × Matcha Powder, paid). Void officiel impossible (session fermée → interdiction cross-shift v4, et le restore +99999 aurait re-pollué le stock déjà re-seedé à 100) → purge chirurgicale one-shot en 1 transaction : commande + 1 paiement + 1 item + JE (3 lignes) + mouvement de stock −99999 (sa suppression RESTAURE la cohérence ledger↔stock). Ligne `audit_logs` d'origine conservée comme trace. Vérifié post-purge : 0 commande ≥ 10 M, max total = 490 k, stock Matcha = 100.
- **D-3** : `cash-register-close` + `mark-item-served` ouvrent des sessions sans afterAll (passent aujourd'hui) — même traitement D-7 à la prochaine casse.
- **D-4** : 9 specs quarantainées S77 (`functions/_quarantine/`) toujours à réécrire (générations money-path v1/v9).
- **D-5** : 12 fichiers skippés env-gated dans le run (recipe-*, settings-inventory, etc.) — skippés aussi en CI ? à auditer (certains `describe.skipIf` sur des variables jamais posées).

## Post-merge (2026-07-14, commits master directs)

**Skip daté S77 D-3 SOLDÉ** — décision propriétaire actée : le PIN d'EMP000 (« Mamat (Owner) ») a été **changé volontairement par le propriétaire et reste privé** — pas de reset. Les 2 specs `auth-verify-pin*` sont **ré-armées et vertes 6/6** (run 29329371189), repointées sur EMP003 (la mécanique testée n'est liée à aucun compte). Deux découvertes au ré-armement :
- **La gateway Supabase n'honore plus le spoof `x-forwarded-for`** — tout tombe dans le bucket rate-limit 3/min de l'IP réelle du runner ; les anciens buckets par IP falsifiée sont morts. Redesign : tests fonctionnels en retry-on-429 (honore `retry_after_sec`), tests de rate-limit chacun dans une fenêtre propre (65 s) — le fichier prend ~4 min, prix accepté au nightly.
- **L'UUID « inexistant » `…999` du spec est devenu RÉEL** (compte système SYS-CRON, inactif) → 403 `user_inactive` au lieu de 401 : UUID aléatoire désormais. Même classe que BEV-AMER : une fixture qui suppose un état de la DB vivante finit toujours par mentir.

Le combo `combo_base_price NULL` (F-1 S77) est **résolu en données** — plus aucun combo vivant sans prix de base (vérifié live 2026-07-14) ; plus rien à décider.

## Rappels décisions propriétaire (héritées S77)
- ~~PIN EMP000~~ ✅ actée (changé volontairement, privé — specs ré-armées sur EMP003, cf. Post-merge).
- ~~Combo `combo_base_price NULL`~~ ✅ résolu en données (vérifié live, cf. Post-merge).
