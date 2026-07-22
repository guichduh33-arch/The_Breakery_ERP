# ADR-006 — Module Settings : socle unique `business_config`, traçabilité via `audit_logs`, périmètre acté

> **Date** : 2026-07-16
> **Statut** : ✅ Accepted
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : —
> **Contexte** : audit code intégral du module Settings (2026-07-16, 17 routes
>   auditées page par page, câblage RPC/tables/consommateurs vérifié). Le brief V2
>   (~23 pages en 6 groupes, hub LAN, table `settings_history`) décrivait une
>   architecture jamais déployée. Cet ADR acte les choix structurels du module :
>   ceux que l'implémentation V3 a faits et qui sont confirmés (décisions 1-3, 6),
>   et les objectifs voulus contre ou au-delà de l'état actuel du code
>   (décisions 4-5, 7-10 : propagation temps réel, réseau local hub,
>   `tax_inclusive` global effectif, organisation par feature en sous-menus,
>   six réglages du backlog retenus, arbitrages complémentaires).

## 1. Décisions

1. **Socle unique `business_config`.** Tous les réglages org-wide scalaires vivent
   dans la table `business_config`, partitionnée en catégories symboliques
   (dictionnaire typé `packages/supabase/src/settings-keys.ts`). Accès exclusif via
   les RPCs `get_settings_by_category_v2` (lecture) et `set_setting_v2` (écriture,
   validation par clé). Ajouter une clé = ajouter sa branche RPC + le dictionnaire,
   dans la même migration.
2. **Tables dédiées seulement pour le structuré.** Les réglages non scalaires
   gardent leur table propre avec leurs RPCs (`b2b_settings`,
   `notification_templates`, `receipt_templates`/`email_templates`,
   `expense_approval_thresholds`, `restaurant_tables`/`table_sections`,
   `roles.session_timeout_minutes`, `holidays`). Pas de troisième mécanisme.
3. **Traçabilité via `audit_logs` uniquement.** Chaque écriture `set_setting_v2`
   est audit-loguée (auteur, clé, ancienne → nouvelle valeur, horodatage). La table
   `settings_history` de la vision V2 **ne sera pas créée** ; une vue dédiée de
   consultation, si elle arrive un jour, sera un filtre d'`audit_logs`.
4. **Propagation temps réel VOULUE.** Décision du propriétaire : un changement de
   réglage doit se propager en temps réel aux appareils connectés (caisses, KDS,
   écrans client), objectif « push < 2 s » de la vision V2 **maintenu**. État
   actuel du code : propagation par refetch (TanStack Query) — c'est un ÉCART à
   résorber, pas un choix. Le refetch + fallbacks codés reste le filet de sécurité
   quand le canal temps réel est indisponible. Implémentation : chantier dédié
   (contrainte projet : noms de channels Realtime uniques par mount).
5. **Pages LAN Network / Network Devices VOULUES, avec système hub + local.**
   Décision du propriétaire : le module Settings doit offrir la gestion du réseau
   d'appareils (vision V2 §8.7/8.8) — enregistrement et identification de chaque
   appareil (caisse, KDS, écran client, tablette, imprimante), heartbeat, et un
   **système hub + communication locale assurant la CONTINUITÉ des communications
   entre les appareils** quand la connexion internet tombe (aujourd'hui, sans
   internet, les appareils ne communiquent plus entre eux ; seule l'impression
   directe continue). État actuel du code : rien n'existe — c'est un chantier
   d'architecture majeur (transport local, arbitrage hub, resynchronisation cloud
   au retour d'internet), à spécifier avant tout développement.
6. **Périmètre du module.** Settings ne porte PAS : le programme fidélité
   (`/backoffice/loyalty`), le catalogue (produits/catégories/types), la
   consultation d'audit (Reports → AuditPage), le mapping comptable
   (`/accounting` MappingsPage), la gestion des comptes et rôles
   (`/backoffice/users`). La matrice de permissions dans Settings est read-only
   par conception. L'URL du print-server reste per-terminal (localStorage).
7. **`tax_inclusive` global À CRÉER (rendre effectif).** Décision du propriétaire :
   le réglage global « prix taxe incluse » ne doit plus être write-only — il doit
   avoir un effet réel comme comportement par défaut de la boutique. État actuel du
   code : la clé est écrite mais jamais lue ; le mode effectif est porté par
   produit (`products.tax_inclusive`, consommé par le money-path). L'articulation
   global ↔ par-produit (précédence, valeur à la création produit, migration de
   l'existant) est à spécifier avant dev — le money-path est concerné, donc
   RPCs versionnées et pgTAP obligatoires.
8. **Réglages organisés PAR FEATURE, en sous-menus.** Décision du propriétaire :
   le hub Settings doit être structuré en groupes par fonctionnalité (sous-menus),
   chaque feature disposant de sa catégorie de réglages et de sa page dédiée —
   l'esprit des groupes de la vision V2, appliqué à la surface réelle V3. Cette
   organisation est une structure de NAVIGATION et de catégorisation : le stockage
   reste le socle des décisions 1-2 (une catégorie `business_config` ou une table
   dédiée par feature), pas un mécanisme de persistance par module.
9. **Six nouveaux réglages du backlog RETENUS.** Décision du propriétaire — les
   réglages suivants, identifiés par l'audit comme absents du code, sont voulus :
   - **Business hours** : horaires d'ouverture, pour marquer les ventes
     hors-horaire dans les rapports d'audit (signal fraude) ;
   - **Politique PIN configurable** : exposer dans Settings le lockout/expiration
     déjà implémentés côté edge functions ;
   - **Payment methods enrichis** : ordre d'affichage, e-wallets individuels
     (GoPay/OVO/DANA), frais par méthode ;
   - **Toggles workflow cuisine** : auto-send KDS, impression ticket cuisine,
     lock des items envoyés ;
   - **Vue « Settings History »** : filtre dédié d'`audit_logs` sur les
     changements de settings (la donnée existe déjà) ;
   - **Floor plan visuel** : drag & drop + positions, en complément du CRUD
     listes existant.
   L'ordre de réalisation reste à prioriser par le propriétaire.
10. **Arbitrages complémentaires du backlog.** Décision du propriétaire :
   - **Affectation serveur → section : REJETÉE.** Ne pas re-proposer.
   - **Multi-devise : REJETÉE.** La facturation reste en IDR uniquement.
   - **Multi-boutique : REJETÉE.** Le projet est propre à UNE localisation —
     aucun scoping par site, aucune préparation multi-site. Ne pas re-proposer.
   - **Happy hour : rattaché au module Promotions & Combos, pas à Settings.**
     Constat code : c'est déjà LIVRÉ — la table `promotions` porte les fenêtres
     jours/horaires (`day_of_week_mask`, `start_hour`/`end_hour`) et
     `evaluate_promotions_v2` les applique. Aucun développement Settings ;
     retiré du backlog du module.

## 2. Conséquences

- Le doc d'objectifs `docs/objectifs/SETTINGS.md` (version 2026-07-16) est aligné
  sur ces décisions ; le brief V2 archivé ne fait plus référence.
- Les invariants opposables du module : sauvegarde explicite, trace `audit_logs`
  systématique, gates UI = RLS, defaults sûrs côté consommateur.
- Quatre chantiers sont ouverts par les décisions 4, 5, 7 et 8 : (a) propagation
  Realtime des settings, (b) hub local + pages réseau, (c) `tax_inclusive` global
  effectif, (d) réorganisation du hub en sous-menus par feature. Le (b) touche
  l'architecture de communication de toute l'application (POS/KDS/displays) et le
  (c) touche le money-path — specs dédiées requises avant développement.
- Les autres surfaces livrées-mais-mortes identifiées par l'audit (templates
  reçu/email, identité entreprise non rendue, `holidays` sans consommateur) ne
  sont PAS tranchées par cet ADR — elles restent au backlog de
  `docs/objectifs/SETTINGS.md` §6, à prioriser par le propriétaire.

## 3. Alternatives rejetées

- **Table `settings_history` dédiée** : redondante avec `audit_logs` (métadonnées +
  diff déjà séparés), double écriture à maintenir.
- **Refetch assumé comme état final** (proposition initiale de l'audit) : rejeté
  par le propriétaire — la propagation temps réel est un objectif, le refetch n'est
  que l'état transitoire et le fallback.
- **Abandon des pages LAN/Network Devices** (proposition initiale de l'audit,
  au motif de l'architecture cloud) : rejeté par le propriétaire — la continuité
  des communications entre appareils en cas de coupure internet est un besoin
  métier ; le tout-cloud sans filet local est l'écart, pas la cible.
- **Un stockage de settings éclaté par module** (une table de config libre par
  feature) : dispersion des gates et de l'audit ; le socle unique garde une seule
  surface de validation et de trace. À ne pas confondre avec la décision 8, qui
  organise la NAVIGATION par feature au-dessus de ce socle.

## 4. Révision

Les décisions 4 et 5 seront précisées par leurs specs dédiées (transport local,
topologie hub, resynchronisation) sans nécessiter de nouvel ADR, sauf remise en
cause du principe lui-même. Les rejets de la décision 10 (serveur → section,
multi-devise, multi-boutique) ne se rouvrent que par un nouvel ADR du propriétaire.

## 5. Addendum (2026-07-21) — décision 5 précisée par la spec 006x, livrée en lots 1-4

Conformément au §4, la décision 5 a été précisée sans nouvel ADR par la spec
dédiée `docs/specs/006x-hub-lan.md`, **actée par le propriétaire le 2026-07-19**
(PR #241). La spec mourant à la livraison du chantier (règle documentaire n°4),
ses arbitrages propriétaire sont consignés ici :

- **A1 — Périmètre offline (option b)** : prise de commande + envoi en cuisine +
  impression KOT + encaissement **cash différé**. Restent online-only :
  paiements non-cash, remises PIN (nonce serveur), B2B (prix résolus serveur),
  promotions à plafond (advisory lock) et toute écriture stock — l'UI les
  désactive proprement hors-ligne.
- **A2 — Hôte du hub** : extension du print-bridge existant (même process
  Node :3001, même supervision). Pas de second service.
- **A3 — Topologie** : hub fixe unique (le PC boutique). Élection dynamique
  rejetée. Hub down = mode dégradé actuel.
- **A4 — Politique de replay : ACCEPTER + TRACER.** Au retour d'internet, le
  serveur accepte le replay d'une vente encaissée même s'il viole un plafond
  promo ou passe un stock en négatif (jamais de rejet silencieux) et marque
  l'écart dans `audit_logs` (metadata `offline_replay: true`). Réalisation :
  l'INSERT direct dans `audit_logs` étant interdit côté app, le marquage est
  porté par le bump versionné `pay_existing_order_v13` (arg `p_offline_replay`,
  migration `_198`) ; `fire_counter_order_v4` et `create_tablet_order_v4` sont
  rejouées inchangées avec leurs clés d'idempotence d'origine.
- **A5 — Fenêtre offline maximale : 4 heures.** Au-delà, blocage des nouveaux
  encaissements cash offline avec bannière rouge, jusqu'au retour du cloud.
  Réglage `offline_max_hours` (défaut 4, bornes [1,24]) + activation explicite
  `offline_cash_enabled` (défaut false), catégorie `business_config` `network`
  (migration `_197`).

**État de livraison au 2026-07-21** : lots 1 → 4 mergés — PR #242 (hub WS +
presence + ring-buffer, validé boutique), #245 (heartbeat batch
`update_lan_heartbeat_v2` + EF `lan-heartbeat-batch`), #246 (mode OFFLINE,
fire `L-x` sur le bus, KDS/display fusion cloud + bus, validé boutique),
#248 (outbox durable, cash différé, replay idempotent, gates UI, settings
`network`). Déviation actée : le token hub transite dans le hello WS, pas en
header (limitation navigateur sur l'upgrade WebSocket).

**Résiduels ouverts à la clôture du chantier** : lot 5 (durcissement — chaos
tests, runbook), validation boutique de l'encaissement cash hors-ligne complet,
verdict mixed-content HTTPS→ws:// (§4.1 de la spec — la CSP Vercel ne permet
pas ws:// vers le hub, la voie « SPA servies en LAN » reste à trancher),
`HUB_TOKEN` à poser en prod.
