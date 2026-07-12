# S75 — Floor Plan BO + KDS Configuration — Design

> **Date** : 2026-07-12 · **Statut** : validé propriétaire (brainstorm S75)
> **Origine** : session dédiée actée S73 (audit Settings, décision 4 — `docs/workplan/audits/settings-pos-bo-audit.md` §4) : les deux dernières tuiles `planned: true` du hub Settings BO (« Floor Plan » + « KDS Configuration », `SettingsHubPage.tsx:66,98`) n'ont **zéro backend** aujourd'hui.
> **Exécution** : branche `swarm/session-75-floorplan-kds`, 2 lots empilés, 1 PR/lot. **Money-path non touché** (aucune RPC de vente/paiement modifiée).

## 1. Décisions de cadrage (propriétaire, 2026-07-12)

| # | Question | Décision |
|---|---|---|
| 1 | Ambition Floor Plan | **CRUD + sections** — pas d'éditeur visuel x/y. Le POS garde sa grille auto (flex wrap) ; seul le groupement change. L'éditeur visuel reste un chantier ultérieur distinct (le schéma l'accueillera par simple ajout de colonnes x/y nullables). |
| 2 | Modèle des sections | **Table `table_sections` + FK** (pas de texte libre, pas d'enum fixe). CRUD sections intégré à la même page BO. |
| 3 | Périmètre KDS Config | Seuils warning/urgent org + délai d'auto-archivage + édition `kds_station` des catégories (ce qui implique de **câbler les chips StationFilter**, sinon réglage mort). **Tempo par article (prep times) exclu** — chantier lourd D3.1 fiche 04, spec dédiée. |
| 4 | Permission Floor Plan | **Nouvelle `floor_plan.manage`** seedée SUPER_ADMIN, ADMIN, MANAGER (style `customer_prices.manage`). Un manager réorganise la salle sans détenir `settings.update`. |

## 2. État de l'existant (vérifié code + migrations, 2026-07-12)

### Floor plan
- **`restaurant_tables`** (`20260506000001`) : liste plate `name UNIQUE, seats CHECK 1..20, sort_order, is_active, deleted_at`. **Pas de coordonnées, pas de section en DB.** RLS `auth_read` seule — **aucune écriture possible** hors migration (seed 10 tables en dur). Aucun RPC CRUD.
- La « section » Interior/Terrace est un **hack front** : `sort_order >= 100` → Terrace (`FloorPlanModal.tsx:86-94`, `FloorPlanView.tsx:63-73`). Le seed n'ayant aucune table ≥ 100, Terrace est vide.
- Rendu POS/tablette : grille auto `flex-wrap` de pills/cercles (forme dérivée de `seats`), composant partagé `TableCell`. Données : `useRestaurantTables` (SELECT direct) + `useTableOccupancy` (dérivée d'`orders.table_number` actifs, realtime + 30 s).
- **`orders.table_number` référence la table par NOM (TEXT)** — contrainte structurante pour rename/désactivation.
- RPC existante non touchée : `transfer_order_table_v1` (`_121`) valide la destination contre `restaurant_tables`.
- BO : **aucune page, aucun hit `restaurant_tables`**.

### KDS
- Seuils **hardcodés en 2 fichiers** : `WARNING_THRESHOLD_MS = 300 s` / `URGENT_THRESHOLD_MS = 600 s` (`KdsOrderCard.tsx:55-56`, dupliqué `useKdsAlarm.ts:45`). Le commentaire (`KdsOrderCard.tsx:53`) référence déjà un « BO KDS Configuration panel » inexistant.
- Auto-archivage des items `ready` : **5 min hardcodé** client-side (`KdsBoard.tsx:48,143-149`).
- **Deux systèmes de stations** : (a) `dispatch_station(s)` kitchen/barista/display — routage serveur, snapshoté sur `order_items`, éditable BO (catégorie : select `CategoryFormDialog.tsx` ; produit : checkboxes `GeneralPanel.tsx`) — **hors périmètre, on n'y touche pas** ; (b) **`categories.kds_station`** hot/cold/bar/prep/expo (`20260517000150`, CHECK + défaut `'expo'`) — filtre UI client, **seed-only, aucune UI d'édition**, et les chips `StationFilter` sont **no-op** (la query ne remonte jamais le champ — fiche 04 §2.3 #4 « câbler ou retirer »).
- `kdsStore` (par appareil) : `selectedStation`, `kdsStationFilter`, `alarmMuted` — inchangé.
- `business_config` (dernier état : `_159` S73) : **aucune clé KDS**. Catégories RPC actuelles : business, localization, tax, pos, pos_presets, inventory, payments, customer_display, printing.

## 3. Lot 1 — Floor Plan

### DB — migration `_161` (NAME-block : vérifier le plus haut au moment de l'exécution ; ≥ `20260712000161`)
- **`table_sections`** : `id UUID PK`, `name TEXT NOT NULL UNIQUE`, `sort_order INT NOT NULL DEFAULT 0`, `is_active BOOL NOT NULL DEFAULT true`, `created_at/updated_at/deleted_at`. RLS `auth_read` (SELECT authentifié) ; **aucune policy write** — écriture via RPC SECURITY DEFINER uniquement. REVOKE anon (défaut projet S20 déjà en place via default privileges ; REVOKE explicite par défense en profondeur).
- **`restaurant_tables.section_id UUID NULL REFERENCES table_sections(id)`**.
- **Seed + backfill** : sections `Interior` (sort 0) et `Terrace` (sort 100) ; backfill `section_id` depuis le hack (`sort_order < 100` → Interior, `>= 100` → Terrace).
- **Permission `floor_plan.manage`** seedée SUPER_ADMIN, ADMIN, MANAGER (`role_permissions`, ON CONFLICT idempotent).
- **6 RPCs** SECURITY DEFINER, gate `has_permission('floor_plan.manage')`, REVOKE EXECUTE FROM PUBLIC + anon, GRANT authenticated :
  - `create_table_section_v1(p_name, p_sort_order)` · `update_table_section_v1(p_id, p_name, p_sort_order, p_is_active)` · `delete_table_section_v1(p_id)` — delete = soft (`is_active=false, deleted_at=now()`), **bloqué (P0001) si la section contient des tables actives**.
  - `create_restaurant_table_v1(p_name, p_seats, p_section_id, p_sort_order)` · `update_restaurant_table_v1(p_id, …)` · `delete_restaurant_table_v1(p_id)` — delete = soft ; CHECK `seats` 1..20 conservé ; unicité `name` remontée en erreur propre.
  - **Garde nom-occupé (P0001)** : `orders.table_number` étant un nom TEXT, le **rename** et la **désactivation** d'une table sont refusés si une commande active (`table_number = name AND status NOT IN ('completed','voided')`) la référence.
  - **Audit** : chaque mutation écrit `audit_logs` (`action='floor_plan.update'`, `entity_type='restaurant_table'|'table_section'`, `entity_id`, `metadata` = before/after) — jamais d'INSERT direct app-side, conformément au pattern S56.

### BO
- **`SettingsFloorPlanPage`** — route `/backoffice/settings/floor-plan`, gate route + tuile `floor_plan.manage`. Liste groupée par section (ordre `table_sections.sort_order`), par section : tables (name, seats, sort_order, actif), dialogs create/edit, désactivation avec confirmation, réordonnancement (`sort_order`). CRUD sections inline (ajouter/renommer/réordonner/désactiver). Erreurs serveur (P0001 nom-occupé, section non vide, nom dupliqué) affichées en clair.
- Hub : tuile **Floor Plan** passe de `planned: true` à `to: '/backoffice/settings/floor-plan'`.
- Hooks : query admin (tables + sections, y compris inactives) + mutations RPC, invalidation `['restaurant_tables']` partagée.

### POS/tablette (rendu inchangé, groupement corrigé)
- `useRestaurantTables` remonte `section_id` + nested `table_sections(name, sort_order)`.
- `FloorPlanModal` + `FloorPlanView` : groupement par **vraie section** (tri par `sort_order` de section), fallback groupe « Interior » pour `section_id NULL` ; **suppression du hack `sort_order >= 100`**.
- Type domaine `RestaurantTable` (`packages/domain`) étendu (`section_id`, et le type section) — domaine reste IO-free.

## 4. Lot 2 — KDS Configuration

### DB — migration `_162`
- 3 colonnes `business_config` : `kds_warning_threshold_minutes INT NOT NULL DEFAULT 5`, `kds_urgent_threshold_minutes INT NOT NULL DEFAULT 10`, `kds_auto_archive_minutes INT NOT NULL DEFAULT 5`.
- `get_settings_by_category_v1` + `set_setting_v1` : **CREATE OR REPLACE depuis le corps live (`pg_get_functiondef`), jamais depuis le fichier de migration d'origine (leçon DEV-S57-02)**. Nouvelle catégorie **`kds`** (3 clés) ; whitelist `set_setting_v1` : bornes 1..120 min par clé + **cohérence inter-clés validée au set** (`warning < urgent`, en lisant l'autre valeur courante). Gates inchangés (`settings.read` / `settings.update`) ; l'audit `setting.update` existant couvre les nouvelles clés gratuitement.
- **RPCs catégorie** : `create_category_v1` / `update_category_v1` étendues **depuis le corps live** (version live à vérifier au moment du plan — règle CLAUDE.md) avec `p_kds_station TEXT DEFAULT NULL` validé contre hot/cold/bar/prep/expo.

### POS
- **`useKdsConfig`** : hook lecture seule façon `useTaxRate` (SELECT direct `business_config`, fallback silencieux sur les défauts actuels 5/10/5, staleTime ~60 s). Consommé par :
  - `KdsOrderCard` — bandes couleur (les constantes `WARNING/URGENT_THRESHOLD_MS` disparaissent) ;
  - `useKdsAlarm` — seuil urgent (la **duplication** de la constante disparaît) ;
  - `KdsBoard` — fenêtre d'auto-archivage.
- **Chips StationFilter câblés** (ferme fiche 04 §2.3 #4) : `useKdsOrders` ajoute `categories(kds_station)` au nested select produit (`products(name, categories(kds_station))`) ; le prédicat client de `KdsBoard` filtre réellement ; chip `all` = comportement actuel. Un chip actif change la liste affichée.

### BO
- **`SettingsKdsConfigPage`** — moule S73 (`useSettings('kds')` + `useSetSetting`, pattern draft/dirty/save, gate édition `settings.update`, lecture `settings.read`). Saisie **en minutes** (stockage = minutes aussi, pas de conversion), validation front warning < urgent en miroir du serveur.
- **`CategoryFormDialog`** : select `kds_station` (hot/cold/bar/prep/expo, libellés lisibles) branché sur les RPCs catégorie étendues.
- Hub : tuile **KDS Configuration** liée (`to: '/backoffice/settings/kds'`), `planned: true` retiré. Le commentaire d'en-tête de `SettingsHubPage.tsx` (« only KDS Configuration + Floor Plan ») est mis à jour — plus aucune tuile `planned`.

## 5. Tests & garde-fous
- **pgTAP live (MCP `execute_sql`, BEGIN…ROLLBACK)** :
  - `floor_plan_crud.test.sql` — gates (`floor_plan.manage` requis, anon/PUBLIC révoqués), CRUD nominal, garde rename/désactivation table occupée (P0001), garde section non vide, soft-delete, FK section, unicité nom, audit `floor_plan.update` émis.
  - `settings_kds.test.sql` — catégorie `kds` exposée, whitelist + bornes, cohérence warning < urgent, audit `setting.update`, `p_kds_station` validé sur les RPCs catégorie.
- **Vitest** : smoke BO des 2 pages (gate + rendu + save), groupement POS par section (fallback NULL), `useKdsConfig` (fallback défauts sur erreur), chips StationFilter (un chip actif filtre la liste).
- **Types greffés** (DEV-S69-03 — pas de regen brut, diff contrôlé), typecheck + build verts, **pattern-guardian** au closeout.
- Closeout : CLAUDE.md (In flight / Merged latest), bandeau « MAJ S75 » sur les fiches 04 (KDS) et remise-à-plat touchées, INDEX S75 avec déviations/dettes.

## 6. Hors périmètre (tracé, pas fait)
- **Éditeur visuel x/y** (drag & drop, refonte rendu POS/tablette) — chantier ultérieur distinct au workplan.
- **Tempo par article** (prep times par produit, ordonnancement) — fiche 04 D3.1, spec dédiée avant code.
- **Réglages par poste terminal** (police, disposition, mute déjà couvert par `kdsStore`) — fiche 04 D2.1, reste côté device.
- **`dispatch_station(s)`** (routage serveur kitchen/barista/display) — déjà éditable BO, non modifié.
- **Statut `reserved`** des tables (légende POS à 3 états, 2 réels) — non traité ici.
