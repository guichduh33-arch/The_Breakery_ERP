# S75 — Floor Plan BO + KDS Configuration — INDEX de session (2026-07-12)

**Spec :** [`docs/superpowers/specs/2026-07-12-s75-floorplan-kds-design.md`](../../superpowers/specs/2026-07-12-s75-floorplan-kds-design.md) · **Plan :** [`2026-07-12-session-75-floorplan-kds-plan.md`](2026-07-12-session-75-floorplan-kds-plan.md)
**Branches :** `swarm/session-75-floorplan-kds` (lot 1, PR #209 base master) → `swarm/session-75-kds-config` (lot 2, PR #210 empilée sur #209).
**Livré :** les 2 dernières tuiles « Planned » du hub Settings BO — Floor Plan (CRUD tables + sections, rendu POS par vraies sections) et KDS Configuration (seuils org + auto-archivage + chips StationFilter câblés). **Le hub n'a plus aucune tuile Soon.** Money-path non touché (pattern-guardian au closeout).

## Migrations appliquées (cloud V3 dev)

| NAME-block | Nom | Contenu |
|---|---|---|
| `20260712000161` | `floor_plan_sections_crud` | `table_sections` + `restaurant_tables.section_id` + backfill (hack `sort_order>=100`) + 6 RPCs CRUD gatées `tables.*` + DROP policies S11 `perm_create`/`perm_update` |
| `20260712000162` | `floor_plan_read_rls_fix` | DEV-S75-01 — `restaurant_tables.auth_read` ne filtre plus `is_active` ; `table_sections.auth_read` masque les soft-deleted |
| `20260712000163` | `settings_kds_thresholds` | 3 colonnes `business_config.kds_*` + catégorie RPC `kds` (regreffage corps live, DEV-S57-02) — appliquée via runner API-from-file (22 Ko > limite MCP), bookkeeping cloud `20260712203438` |
| `20260712000164` | `floor_plan_grants_consistency` | Findings pattern-guardian MEDIUM #1/#2 — ligne `ALTER DEFAULT PRIVILEGES` du trio REVOKE + REVOKE write explicite sur `table_sections` |

pgTAP : `floor_plan_crud.test.sql` **24/24** · `settings_kds.test.sql` **13/13** (re-verts au closeout).

## Déviations numérotées

- **DEV-S75-01 — Migration RLS lecture non planifiée (`_162`).** La policy `auth_read` de `restaurant_tables` (S11) filtrait `is_active` inconditionnellement : le badge Inactive + le flux reactivate de la page BO étaient **unrenderables** ; celle de `table_sections` (`USING (true)`, plan T1) laissait fuir les sections soft-deleted dans les selects BO. Fix : `is_authenticated() AND deleted_at IS NULL` / `deleted_at IS NULL`. POS non affecté (filtre `.eq('is_active', true)` client-side ; RPCs SECURITY DEFINER). **Conséquence : la migration KDS du plan glisse de `_162` à `_163`.**
- **DEV-S75-02 — Bug SQL du plan (backfill).** Le `UPDATE … (SELECT id FROM table_sections WHERE name = CASE WHEN sort_order >= 100 …)` du plan résolvait `sort_order` sur la table INTERNE (`table_sections`) → sous-requête à 2 lignes, échec à l'apply. Fix contrôleur : qualification `restaurant_tables.sort_order`.
- **DEV-S75-03 — ERRCODE 22023, pas P0001 (set_setting_v1).** La convention live de `set_setting_v1` lève `22023` (`setting_*_invalid`/`setting_unknown`) pour toute validation — le pseudo-SQL du plan disait P0001. Corps live = autorité (DEV-S57-02) ; gardes kds et pgTAP alignés sur 22023.
- **DEV-S75-04 — Assertion audit par contenu.** Tous les `set_setting_v1` d'une même transaction partagent `now()` → « dernière ligne par created_at » est non déterministe ; l'assertion audit matche la ligne `new=12` par contenu.
- **DEV-S75-05 — Deactivate ≠ Delete (fix de revue, Critical).** La 1ʳᵉ implémentation BO câblait « Deactivate » sur `delete_*_v1` (soft-delete → ligne masquée par `deleted_at IS NULL`, aucun chemin de réactivation). Fix : Deactivate/Reactivate = flip `is_active` via `update_*_v1` (réversible, gardes `table_occupied`/`section_in_use` actives) ; Delete = action séparée gatée `tables.delete`.
- **DEV-S75-06 — `Number(null) === 0` (fix de revue, Critical).** `useKdsConfig.toMs` transformait un NULL SQL en `0 ms` (tous les tickets instantanément urgents) au lieu du fallback défauts ; le test NULL passait **vacuously** (valeur pré-settle = défauts). Fix : garde `== null` + test dé-vacuisé (sentinelle non-défaut, vérifié RED sur l'ancien code).
- **DEV-S75-07 — Smokes « section vide » réécrits.** `bucketTablesBySection` dérive les sections des tables (pas de registre) : une section à 0 table ne produit structurellement plus d'onglet POS. Les 2 smokes préexistants « clic sur onglet vide » sont réécrits en `tables: []` (même branche de rendu). Voir D-3.
- **DEV-S75-08 — Divers d'exécution.** Test hook en `.test.tsx` (JSX du QueryClientProvider) ; nouveau smoke `CategoryFormDialog` (aucune couverture préexistante du dialog) ; le sweep `section_id` des fixtures (T4) avait raté `packages/ui` (`TableSelectorModal.test.tsx`, rattrapé au closeout) ; suite pgTAP T1 étendue en revue (+5 assertions `update_table_section_v1`, +2 quals RLS).

## Dettes / findings (candidats sessions futures)

- **D-1** (héritée, notée d'office au plan) : la légende `reserved` du floor plan POS n'a **toujours aucun producteur** (aucun état ne la déclenche).
- **D-2** : sections POS au-delà d'Interior/Terrace → icône générique `MapPin` (pas d'icône configurable par section).
- **D-3** : un onglet de section POS **disparaît** si la section n'a aucune table active dans le fetch (contrat derive-from-tables, DEV-S75-07) — à exposer au propriétaire : un manager qui vide une section en plein service perd l'onglet au lieu de le voir vide.
- **D-4** : ordre intra-section non préservé quand une table `section_id NULL` s'intercale avec les tables d'une vraie section « Interior » (limitation documentée en tête de `apps/pos/src/features/floor-plan/sections.ts` ; NULL rare post-backfill).
- **D-5** : toggle d'une table pointant une section **inactive** → erreur serveur `section_not_found` mappée « That section no longer exists » — trompeur (la section existe, il faut la réactiver d'abord).
- **D-6** : si une vraie section nommée « Interior » est inactive, le groupe fallback des tables NULL rend un **second** card « Interior » (clés distinctes, pur label).
- **D-7** : pgTAP kds — pas de `throws_ok` range dédié pour `kds_auto_archive_minutes` (garde identique aux 2 autres) ; DETAIL « expects integer » sur le check `jsonb_typeof <> 'number'` (wording).
- **D-8** : `SettingsKdsConfigPage` — un input vidé désactive la validation client → erreur serveur brute au save (le serveur tient la ligne).
- **D-9** : Deactivate/Reactivate BO renvoie les champs courants de la ligne via l'UPDATE RPC → last-write-wins sur édition concurrente (surface admin basse fréquence).
- **D-10** : pgTAP floor plan — assertion audit #14 non scopée (count global `table.created`) ; `name_taken` non testé côté `restaurant_tables` ; anon-EXECUTE asserté sur 1 RPC/6 (le trio REVOKE est uniforme via la boucle DO).
- **D-11** (INFO pattern-guardian) : post-`_162`, cacher les tables désactivées aux rôles non-BO repose sur le filtre client POS (`.eq('is_active', true)`), plus sur RLS. Donnée peu sensible (nom/seats). Si un audit futur exige du RLS-only : policy role-aware (`authenticated` générique → actives seulement, porteurs `tables.update` → tout).

## Pattern-guardian (closeout)

Verdict : **aucun HIGH**, money-path confirmé intouché, types greffés vérifiés. 2 MEDIUM de convention (trio REVOKE de `_161` sans la ligne `ALTER DEFAULT PRIVILEGES`, pas de REVOKE write explicite sur `table_sections`) **soldés par la migration `_164`** (`floor_plan_grants_consistency`, appliquée cloud) ; 1 INFO → D-11.

## Outillage session

- Runner API-from-file **recréé** : `sb-query.ps1` (token CLI via Credential Manager `Supabase CLI:supabase`, P/Invoke CredReadW, blob **UTF-8**) — utilisé pour `_163` (22 Ko) + les runs pgTAP de closeout. Bookkeeping manuel horloge locale UTC+8 (MEMORY).
- Regen types via **CLI** `supabase gen types` vers scratch + diff **normalisé CRLF** (le regen CLI est LF ; 17 k lignes de faux diff sinon), puis greffe ciblée (DEV-S69-03 : bruit `pos_events_2026_*`/réordonnancements `get_pos_*` exclu).
