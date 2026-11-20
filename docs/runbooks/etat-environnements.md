# État des environnements et reprise factuelle

Relevé initial du 8 octobre 2026 (UTC+8), validé par Mamat.
Le [complément du lot 1](#complément-du-8-octobre-2026--lot-1-de-préparation-production)
est validé par Mamat le 9 octobre 2026 ; les sections hors complément conservent
les limites du relevé initial et ne sont pas réécrites en état actuel.
Le complément du 29 octobre décrit séparément la mise en service observée.

## Usage et sources

Ce document est le point d'entrée des observations opérationnelles. Une date
décrit un relevé, jamais la durée de validité d'un environnement. Recontrôler
la cible et l'artefact réellement chargé avant toute action qui en dépend.
Ni une mémoire, ni un numéro de version, ni un résultat CI ne prouve une
installation. Aucune autorisation opérationnelle n'est accordée par ce bilan.

Les décisions restent dans les ADR et les règles dans [AGENTS](../../AGENTS.md).
Les procédures et bilans d'import restent dans le [runbook V3](production-v3-cutover.md).
Pour reprendre un chantier, utiliser le [bilan de lot](agent-tooling.md#reprise-et-clôture-dun-lot),
Git, les PR et leurs preuves. Les plans de session restent en conversation.

| Qualification | Signification |
|---|---|
| Observé directement | Lecture effectuée à la date indiquée, sur la surface nommée |
| Rapporté par une preuve datée | Constat d'un autre relevé ; non relu sur la surface réelle |
| Configuré mais non vérifié | Déclaration ou mécanisme présent, sans preuve d'exécution |
| Inconnu | Accès ou preuve insuffisants ; ne pas compléter par déduction |

## Complément du 20 novembre 2026, 22 h 43 — stock B2B au retrait en production (`S1-15`)

Relevés du 20 novembre, 22 h 38 à 22 h 43 UTC+8. Observés directement.
Source applicative : `c51737cf7bc440db5253d02f7b25d40eb89a708c`, fusion de
la PR #753 ; aucune installation POS nécessaire. Décision :
[ADR-044](../adr/044-stock-b2b-au-retrait.md).

| Surface | Observation | Limite |
|---|---|---|
| Candidat final | CI push `44750342179` réussie : BO complet, 397 fichiers et 2 599 tests réussis, un test/fichier ignoré préexistant ; POS 286 fichiers et 1 569 tests réussis. pgTAP manuel `44750356869` réussi : 388 fichiers, 52 reports tous relancés seuls avec succès, aucune assertion ignorée détectée | La voie shared ignore 49 fichiers / 258 tests du package live ; elle ne prouve pas leur exécution |
| Préparation BO | Workflow protégé `44754730840`, mode `stage_only`, réussi ; approbation par le mécanisme Production du compte `guichduh33-arch`, validation technique de l'agent dans le mandat. Déploiement `dpl_HaKB7Q4BJp69YMSnA5zcbgLSTAbW` READY, domaine encore sur l'ancien `536d0e7c` avant migration | Ce contrôle technique n'est pas présenté comme un nouvel accord personnel de Mamat |
| Production V3 | Cible `yjhhhmjgsmyzyymvixot`, zéro native non retirée et zéro caisse ouverte. Anciens appels gelés, transactions antérieures drainées, huit migrations appliquées en une transaction. Résultat : 85 natives marquées, 237 groupes de consommation conservés, zéro import marqué ; anciennes fonctions retirées, cinq fonctions finales avec droits anon refusés | Aucune reprise des quantités historiques ; les 192 imports financiers restent exclus |
| Intégrité DB | Les 18 ensembles d'invariants sont identiques avant/après : quantités, coûts, vitrine, ledgers, écritures et lignes comptables, encours, règlements, allocations, imports et champs B2B. Les cinq RPC et la garde des marqueurs ont leurs corps conformes aux sources | Le coût d'annulation courant est préservé ; pas de reconstitution des anciens drapeaux de suivi |
| BO servi | Promotion du même déploiement, sans reconstruction. Les deux domaines personnalisés sont associés ; les 383 fichiers publics correspondent au manifeste. Référence Supabase de production seule, cinq appels B2B attendus présents, anciens appels absents | Les cinq fichiers non publics du manifeste ne sont pas déclarés comme relus par HTTP |
| Navigateur connecté | Bundle chargé `/assets/index-CCRsoZa8.js` ; warning de manque observé avec bouton de création actif. Formulaire fermé par Cancel, sans soumission ; liste inchangée à 277 commandes | Refus et déduction au retrait prouvés par pgTAP DEV ; aucun retrait réel, paiement de test ou retrait simultané à deux sessions en production |

Manifeste SHA-256 :
`1f735d383ff8ef158f72933f0eab8650005421bf0249a7a192d8b063ceee8e43`.
Paquet SQL atomique SHA-256 :
`72341ede009636ce0a5d5710b185cc7e4eef5d7ddcbeda147b0c560ba525e156`.
Les preuves privées du worktree sont dans `.release-manifests/s1-15/` :
`production-cutover-execution-c517.json`, `stage-proof-c517.json`,
`served-c517.json`, `ui-production-c517.json`, les rapports `master-c517/`
et les avis Supabase avant/après. Elles ne sont pas transportées par un clone.
La capture de l'avertissement reste hors Git avec les visualisations du poste.

Avis Supabase du lot : les nouvelles fonctions SECURITY DEFINER accessibles
aux comptes authentifiés sont intentionnelles, sous leurs gates ; aucune
nouvelle exécution anon. Un [avis INFO de clé étrangère sans index couvrant](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
concerne le produit de l'instantané. Les opérations du lot recherchent par
commande et utilisent la clé primaire ; aucun benchmark de volumétrie ni
optimisation indépendante n'est déclaré livré.

Retour : les anciennes fonctions ont été supprimées. Un ancien BO ne suffit
pas à revenir au contrat précédent ; conserver les mouvements et corriger en
avant selon l'ADR. Le prérequis de sauvegarde et de restauration éprouvée reste
entier pour une éventuelle reprise de masse. Ni PITR, ni copie hors site, ni
restauration n'ont été activés ou certifiés par cette livraison.

## Complément du 20 novembre 2026 — stock B2B au retrait, vérification DEV

Relevé en UTC+8, branche `feat/s1-15-b2b-stock-pickup`, base Git `d2266ed3`.
Ce complément ne constate aucune livraison en production du lot.

| Surface | Observation | Limite |
|---|---|---|
| Production V3, lecture seule | 85 commandes natives toutes retirées ; 192 imports financiers sans mouvement de vente, répartis entre septembre et octobre. Mamat confirme que l'absence de mouvement de ces imports est normale | Un solde à payer ne prouve pas une absence de retrait ; refaire ce relevé avant bascule |
| DEV V3 | Migrations `20261120000040` à `20261120000047` appliquées sur `ikcyvlovptebroadgtvd` : consommation au retrait, disponibilité informative, instantané des sorties et annulation selon le suivi courant | Aucune réinjection de stock en production ; préflight bloquant si une native non retirée apparaît |
| pgTAP DEV | Relevé à 21 h 12 : 17 fichiers, 20 transactions annulées, 218 assertions réussies, zéro ignorée. Couvre 13 anciennes suites adaptées et quatre nouvelles | Les fichiers `antifraud_owner_visibility`, `b2b_foundation`, `b2b_settlement` et `recipe_reversal_compatibility` attendent la CI ; retraits simultanés non exercés |
| Types | Régénération MCP fraîche, puis projection AST reproductible sur les seuls objets B2B du lot ; types hors périmètre conservés depuis la base Git | Ce fichier représente `master` plus le lot, pas la parité globale avec DEV. La dérive indépendante de la famille `hold_fired_order` n'est ni livrée ni corrigée ici ; l'ancienne version appelée par le POS existe en production |
| Helpers de vente et de restitution | Corps relus sur DEV et production : empreintes normalisées égales ; compteur modifié uniquement si le produit est suivi au moment du geste, indépendance B2B/vitrine conservée | Coût d'annulation toujours courant ; l'instantané initial des natives livrées ne reconstitue pas leurs anciens drapeaux de suivi |

Décision et limites : [ADR-044](../adr/044-stock-b2b-au-retrait.md).
Les preuves privées sont dans `.release-manifests/s1-15/` du worktree du lot :
`dev-regressions-final.json`, `types-projection-proof.json`,
`project-types-s1-15.cjs` et les définitions live. Elles ne sont pas transportées
par un clone. La projection des types n'a changé aucun corps hors B2B.

La production devra appliquer atomiquement le changement de contrat après
préparation du BO, puis basculer celui-ci. Le préflight refuse une reprise de
quantités non examinée ; les imports financiers restent exclus. Aucun retour
automatique vers les anciennes fonctions n'est réputé compatible avec les
commandes créées après bascule.

## Complément du 20 novembre 2026, 12 h 40 — achats par article (`S3-20`), arrondi de production (`S3-09`), annulation de réception (`S3-05`) et back-office `b0ed05d6`

Relevé du 20 novembre 2026 entre 12 h 29 et 12 h 40, UTC+8. Observé directement.

| Surface | Observation | Limite |
|---|---|---|
| Preuves du SHA `b0ed05d6` | Fusion de #750 (après #749, qui porte aussi `S3-09`). `ci.yml` run `44667117665` réussi ; pgTAP PR run `44668700416` réussi | pgTAP tourne sur la base de dev |
| Backend production, avant | Étapes additives déjà présentes, appliquées entre 11 h 35 et 11 h 38 : `s3_09_production_rounding_step_additive`, `s3_20_purchase_items_by_article_additive`, `s3_05_cancel_goods_receipt_additive_part1_columns`, `s3_05_cancel_goods_receipt_additive_part2_function`. Empreintes `md5(prosrc)` égales au dev pour `cancel_goods_receipt_v1`, `get_production_suggestions_v5`, `get_purchase_item_lines_v1`, `get_purchase_items_v2`, `set_production_rounding_step_v1` ; aucune exécutable par `anon`, toutes par `authenticated` | Auteur de l'étape additive non retrouvé ; colonnes de la partie 1 non relues |
| Back-office | `production-backoffice.yml`, run `44675245835`, réussi après l'approbation de l'environnement Production par le compte `guichduh33-arch` (Mamat) ; déploiement `dpl_HaDxTigSfy5quMKTQkKrJs4jt4Xo` sur `b0ed05d6`, associé à `backoffice.the-breakery.com`. Code servi relu (326 fichiers) : référence de production seule ; appelle les cinq fonctions neuves, jamais `get_production_suggestions_v4` ni `get_purchase_items_v1` | Lecture des fichiers servis, pas d'un parcours à l'écran |
| Backend production, retrait | Avant : aucune autre fonction ne cite les deux anciennes versions ; ni la caisse `e7c43cfd`, ni les Edge Functions. `s3_09_s3_20_drop_previous_versions` : `DROP` de `get_production_suggestions_v4` et `get_purchase_items_v1`, les deux `DROP` de `20261120000010` et `20261120000020`. Après : seules `get_production_suggestions_v5` et `get_purchase_items_v2` restent | — |
| POS | Aucun changement de la caisse depuis `e7c43cfd` ; rien à installer | — |

Toujours non appliqués : les retraits `20261119000003` et `20261119000006`
du complément ci-dessous, pour les mêmes raisons.

Retour : le back-office `e7c43cfd` appelle les deux fonctions supprimées et n'est
plus un recours pour les écrans des suggestions de production et des achats par
article.

## Complément du 20 novembre 2026, 1 h 30 — rapprochement groupé (#745), annulation de clôture (`S3-03`) et caisse `e7c43cfd`

Relevé du 20 novembre 2026 entre 0 h 10 et 1 h 30, UTC+8. Observé directement.
Boutique fermée : aucune session de caisse ouverte, dernière commande le
19 novembre à 17 h 58.

| Surface | Observation | Limite |
|---|---|---|
| Backend production, avant | Dernière migration `20261119170112`. Déjà présents (relevé sans trace de session) : `open_shift_v1`, `close_shift_v15`, `get_pos_sessions_report_v5`, `get_shift_close_preview_v2`, `_guard_frozen_shift_totals_v1`. Absents : `_reverse_shift_journal_entry_v1`, `undo_shift_close_v2`, `bank_reconciliation_post_v6`, `bank_reconciliation_clearing_days_v1`. Les fonctions d'aide du rapprochement ont le même corps qu'en dev | Auteur et heure de l'application partielle de #743 non retrouvés |
| Preuves du SHA `e7c43cfd` | Fusion de #745. `ci.yml` run `44560373860` réussi ; pgTAP lancé à la main, run `44562903552`, réussi (`pgtap` et `db-gate`) | pgTAP tourne sur la base de dev |
| Backend production, étape additive | `bank_reconciliation_grouped_fees_additive` (`20261119000010` sans le `DROP`) puis `s3_03_undo_shift_close_v2_additive` (`_reverse_shift_journal_entry_v1` de `20261119000005`, sans `undo_shift_close_v1` ; `20261119000008` sans son `DROP`). Empreintes `md5(prosrc)` égales au dev pour les quatre fonctions ; aucune exécutable par `anon` ; `_reverse_shift_journal_entry_v1` non exécutable par `authenticated` | — |
| Back-office | `production-backoffice.yml`, run `44568258255`, réussi après l'approbation de Mamat ; déploiement `dpl_HVnw2kQ1coVS76jm6qTWkNrEV5j8` sur `e7c43cfd`. Code servi par `backoffice.the-breakery.com` relu (301 fichiers) : référence de production seule, appelle `bank_reconciliation_post_v6` et `bank_reconciliation_clearing_days_v1`, jamais `bank_reconciliation_post_v5` | Lecture des fichiers servis, pas d'un parcours à l'écran |
| Backend production, retrait | `bank_reconciliation_grouped_fees_drop_post_v5` : `bank_reconciliation_post_v5` supprimée après la bascule du back-office | — |
| Paquet caisse | `package-shop-release.yml`, run `44568270215`, approuvé par Mamat ; artefact `shop-release-e7c43cfd814b535a8bcc35e5e441f585da052e2f-1`, SHA-256 de l'archive `851250f167f5fcae68a4c0a464e55d50334e60f150ca5101a2f82ea5d3ae5800` égal au fichier `.sha256`. `release.json` : SHA `e7c43cfd`, projet de production, preuves CI et pgTAP ci-dessus. Bundle : référence de production seule ; appelle `open_shift_v1`, `close_shift_v15`, `get_shift_close_preview_v2`, `undo_shift_close_v2`. Les 55 fonctions versionnées qu'il appelle existent en production | Liste extraite du bundle par motif de nom, pas par exécution |
| POS production, installation | Archive envoyée en deux parts par la console de supervision, recollée dans `C:\BreakeryV3\updates-e7c43cfd` ; empreinte égale au `.sha256`. `shop-update.json` repris de la livraison `6854931a`, empreintes du Node, du lanceur et de la configuration externe relues sur le poste, release précédente `6854931a`. Installateur lancé vers 1 h 18 ; sortie `SHOP_RELEASE_VERIFIED e7c43cfd814b535a8bcc35e5e441f585da052e2f`, code 0 | — |
| POS production, après | Sur le poste, à 1 h 24 : `https://pos.the-breakery.com/health` et `:3001/health` rendent `e7c43cfd` ; la page servie sur 3001 charge `index-BvR7I9Te.js`, fichier du paquet | Écran de la caisse, écran client et KDS non rechargés sous observation ; aucune vente, aucune impression, aucune ouverture de session constatée |
| Caisse, rechargement | Vers 1 h 33, par le bureau à distance de la console de supervision : page de caisse en plein écran sur l'écran de saisie du PIN, aucun utilisateur connecté ; touche F5 envoyée, la page revient sur le même écran. Le pont affiche `POS SPA: C:\BreakeryV3\releases\e7c43cfd…\apps\pos\dist`. L'écran client indique la perte de liaison avec la caisse et attend d'être rouvert depuis le menu de la caisse. Vers 1 h 40, un utilisateur s'est connecté par PIN : la grille des produits s'affiche, le bandeau indique « No shift · Open », l'écran client est de nouveau relié. Aucune session ouverte en production à ce moment (dernière : 19 novembre, 14 h 37 – 18 h 32, clôturée) | Bundle chargé par le navigateur non lu : le rechargement est constaté à l'écran, pas prouvé par le nom du fichier |
| Tablettes | Non mises à jour : elles portent l'APK 1.23 (bundle `6854931a`), qui ouvre une session par insertion directe et clôture par `close_shift_v14` | — |

Non appliqué : les retraits `20261119000003_s3_01_revoke_direct_session_insert`
et `20261119000006_s3_02_retire_close_shift_v14`. Ils bloqueraient la page de
caisse déjà chargée tant qu'elle n'est pas rechargée, et les tablettes en 1.23.
Les appliquer après le rechargement de la caisse et l'installation d'une APK
tirée du paquet `e7c43cfd`.

Retour : le lanceur sauvegardé `start.cjs.rollback-e7c43cfd…` et la release
`6854931a` restent sur le poste ; `6854931a` appelle `close_shift_v14`, encore
présente. Le back-office précédent `9be05a02` appelle `bank_reconciliation_post_v5`,
supprimée : il n'est plus un recours pour l'écran de rapprochement. Pour la
livraison suivante, la release précédente devient
`e7c43cfd814b535a8bcc35e5e441f585da052e2f` et l'empreinte du lanceur a changé.

## Complément du 19 novembre 2026, 0 h 15 — retrait des lots (`S2-01`, `S2-02`, `S2-08`), audit de suppression de promotion (`S3-12`) et back-office `47ac4756`

Relevé du 18 novembre 2026 à 23 h 15 au 19 novembre 2026 à 0 h 15, UTC+8.
Observé directement. Boutique fermée : aucune session de caisse ouverte,
dernière commande à 18 h 03.

| Surface | Observation | Limite |
|---|---|---|
| Preuves du SHA `47ac4756` | Fusion de #739 (après #738). `ci.yml` run `44320527684` réussi ; pgTAP lancé à la main, run `44333947398`, réussi (`pgtap` et `db-gate`) | pgTAP tourne sur la base de dev |
| Backend production, avant | Dernière migration `20261118194839` ; ni `20261118000006` ni `20261118000007`. Les cinq fonctions remplacées portent les marqueurs du dev (même lignée) ; seules `record_production_v10` et `receive_purchase_order_v6` appellent les fonctions de lots retirées. Aucun appel dans le code des applications, des Edge Functions ni des types | — |
| Back-office, préparation | `production-backoffice.yml` en `stage_only`, run `44338988561`, réussi après l'approbation de l'environnement Production par Mamat ; déploiement `dpl_5exWss8amH6NHep5ydk6Uj2W1oEA` READY, sans alias ; empreinte de l'artefact du manifeste `93bee28c5d0236046e0c1a2e4a58ff37f83ec7de778ae6bed14eff644e9c45b9`. Le domaine servait encore `a2d3a285` (`dpl_5SE8NAvj5JpDDo21aN5t6M6A61yy`) | — |
| Backend production, étape additive | Entre 0 h 03 et 0 h 06, `apply_migration` des sections 1 à 5 de `20261118000006_s2_01_retire_stock_lots.sql`, sans les trois `DROP` des anciennes versions. Empreintes `pg_get_functiondef` égales au dev pour `record_stock_movement_v2`, `stock_private.record_production_v10`, `receive_purchase_order_v7`, `revert_production_v5`, `get_product_dashboard_v9` ; les trois versions neuves exécutables par `authenticated`, pas par `anon` | — |
| Back-office, bascule | Promotion de `dpl_5exWss8amH6NHep5ydk6Uj2W1oEA` par l'API Vercel ; `backoffice.the-breakery.com` lui est associé. Code servi relu (299 fichiers) : il vise la production, jamais le dev ni la V2 ; il appelle `receive_purchase_order_v7`, `get_product_dashboard_v9`, `revert_production_v5`, aucune ancienne version ni fonction retirée | Lecture des fichiers servis, pas d'un parcours à l'écran |
| Backend production, retrait | `apply_migration` de `20261118000007_s3_12_audit_promotion_hard_delete.sql`. Le premier essai du retrait a échoué en entier : la publication `supabase_realtime` y publie `business_config` avec une **liste de colonnes** (le dev publie la table entière). Le retrait appliqué ensuite retire la table de la publication, supprime la colonne et la remet avec la même liste moins `production_yield_variance_threshold_pct` | Écart non traité : la liste de production omet `kot_copies_waiter`, que le dev publie |
| Backend production, après | Aucune des neuf fonctions retirées ni la colonne ; publication de `business_config` sur 42 colonnes ; déclencheur `audit_promotion_hard_delete` présent ; 41 lots dans `stock_lots` et 15 614 mouvements, comme avant ; aucune tâche planifiée de lots. Sous l'identité simulée d'un `SUPER_ADMIN`, `get_product_dashboard_v9` répond, transaction annulée | Identité simulée par `request.jwt.claims` |
| POS | Non installé : la caisse reste sur `6854931a`, qui n'appelle aucun objet retiré. Le lot caisse de #738 (`S3-04`, `S3-13`, `S3-17`) attend un paquet et une installation | — |

Retour : le back-office `a2d3a285` appelle des fonctions supprimées et n'est plus
un recours. Les fonctions retirées se recréent seulement par une nouvelle
migration, depuis leur corps dans l'historique Git ; la valeur de la colonne de
seuil n'a pas été relevée avant sa suppression.

## Complément du 18 novembre 2026, 19 h 50 — partitions du journal du POS (`S1-16`) et lectures `S1-08`, paquets 2 et 3

Relevé du 18 novembre 2026, UTC+8. Observé directement sur la production V3.

| Surface | Observation | Limite |
|---|---|---|
| `S1-08`, étape additive | Vers 8 h 30, `apply_migration` du bloc additif (`s1_08_stock_and_statements_reads_additive`) : 29 versions neuves des lectures de stock et d'états financiers, attributs et droits égaux au dev, gardes non exécutables par `anon`. `generate-pdf` redéployée (version 9) | — |
| `S1-08`, back-office | `5665eeb9` (fusion de #727) publié après l'approbation de l'environnement Production par Mamat. Code servi relu : 26 des 29 versions neuves appelées, les 3 autres sans appel direct depuis le BO ; aucune ancienne version ; il vise la production, jamais le dev | Lecture des fichiers servis, pas d'un parcours à l'écran |
| `S1-08`, retrait | `apply_migration` du texte de `20261118000002_s1_08_drop_owner_only_reads.sql`, en production puis en dev. Après : aucune ancienne version ; sous l'identité simulée d'un `SUPER_ADMIN`, le bilan et les compteurs de stock répondent | Identité simulée par `request.jwt.claims` |
| `S1-16`, avant | 19 h 47 : dernière commande à 18 h 03, aucune session de caisse ouverte. 23 908 lignes dans `pos_events`, toutes dans `pos_events_default`. Huit événements d'une tablette entre 19 h 28 et 19 h 29 (articles ajoutés puis retirés, aucune commande) | — |
| `S1-16`, migrations | `apply_migration` du texte de `20261118000003_s1_16_pos_events_partitions.sql`, puis de `20261118000004_s1_16_partition_pin_policy.sql` (PR #727, `5665eeb9`) | — |
| `S1-16`, après | 23 908 lignes : 920 dans `pos_events_2026_10`, 22 988 dans `pos_events_2026_11`, 0 dans la partition par défaut. Partitions de 2026-07 à 2027-02 et défaut : RLS active, règle `pin_session_required`, aucune lecture pour `anon` ni `authenticated`, déclencheurs `pos_events_no_update` et `pos_events_no_delete`. `create_pos_events_partition_v2` seule, non exécutable par `anon` ni `authenticated` ; tâche `pos-events-partitions-ahead` (`0 3 20 * *`) sur la v2 ; aucune table `pos_events_default_s116` restante | Aucune écriture de caisse observée après la migration |

Retour : aucun geste simple ne remet le journal dans une seule partition par
défaut, et ce retour n'est pas utile ; les lignes sont intactes. Les anciennes
lectures `S1-08` sont supprimées : leur retour exigerait une nouvelle migration.

## Complément du 18 novembre 2026, 19 h 25 — paquet caisse et APK 1.23 sur `6854931a`, installés

Relevé du 18 novembre 2026 entre 17 h et 19 h 25, UTC+8. Observé directement.
Boutique fermée à l'installation : aucune session de caisse ouverte, aucune
commande ouverte du jour, dernière commande à 18 h 03.

| Surface | Observation | Limite |
|---|---|---|
| POS production, avant | `https://pos.the-breakery.com:3001/health` rend `f46a4eeb` (vers 17 h 30) ; 443 répond 403 hors du poste | — |
| Compatibilité | Les 54 fonctions SQL appelées par le POS de `6854931a` existent en production, dont `close_shift_v14` ; les 13 Edge Functions qu'il appelle sont actives. `close_shift_v13` et `close_shift_v10` y sont des enveloppes vers `close_shift_v14` ; `close_shift_v12` existe encore sans la garde des commandes impayées, sans appelant dans `master` | Lecture du schéma, pas d'appel exécuté |
| Preuves du SHA `6854931a` | Fusion de #733. `ci.yml` run `44282889463` réussi ; pgTAP lancé à la main, run `44283595879`, réussi (`pgtap` et `db-gate`) | pgTAP tourne sur la base de dev |
| Paquet caisse | `package-shop-release.yml`, run `44287258563`, approuvé par Mamat ; artefact `shop-release-6854931afe98444d138381288121484a923f8533-1`, SHA-256 de l'archive `70a69558c770ad60db6384e2936bfa318ce7a551c7a0c9645df37ba3490d7965` égal au fichier `.sha256`. `release.json` : SHA `6854931a`, projet de production. Bundle : référence de production seule, ni dev ni V2 ; `close_shift_v14` présent, `close_shift_v13` absent ; le mode `background` de la synchronisation présent | — |
| POS production, installation | Archive envoyée en deux parts par la console de supervision, recollée sur le poste dans `C:\BreakeryV3\updates-6854931a` ; empreinte égale au `.sha256`. `shop-update.json` (version 2) produit sur le poste par un script qui relit les empreintes du Node, du lanceur et de la configuration externe et vérifie que le lanceur nomme `f46a4eeb`. Installateur du paquet lancé vers 19 h 15 ; sortie `SHOP_RELEASE_VERIFIED 6854931afe98444d138381288121484a923f8533` | — |
| POS production, après | Sur le poste, `https://pos.the-breakery.com/health` et `:3001/health` rendent `6854931a` (19 h 18). Depuis le LAN, la page servie sur 3001 charge `index-B4q0kfzo.js`, fichier du paquet | Rechargement de la caisse, de l'écran client et du KDS non vu ; aucune impression, aucune vente constatées. Vers 19 h 23, une commande de listage destinée au terminal a été tapée par erreur dans la vue « Bureau » de la caisse, ouverte entre-temps par un autre observateur : l'écran montrait la page des rapports, sans champ de saisie, et rien n'y a paru modifié |
| Tablettes, APK 1.23 | Fabriquée sur le poste de développement : `com.thebreakery.pos`, version 1.23 (code 24), SHA-256 `e98dbf582b2e61b80d41eacf7ff91ee192fec4d56cdd98fd1d710bad97a14fda`. Les 88 fichiers de `assets/public/assets` sont identiques au bundle du paquet ci-dessus, repris de l'archive sans reconstruction. Certificat `100d48b8…`, égal à celui de l'APK 1.21. Conservée hors Git sous `.release-manifests/tablet-apk-1.23-20261118/` | — |
| CS30, APK 1.23 | `adb install -r` à 19 h 18 sur `A59T11BGT3A01119`, qui portait la 1.22 (code 23). Après : 1.23 (code 24), fichier installé de même SHA-256, date de première installation inchangée (2026-10-08) | Application non ouverte, aucune commande essayée |
| Galaxy Tab A8, APK 1.23 | `adb install -r` à 19 h 22 sur `R9RT200NJHB` (SM-X205), qui portait la 1.22 (code 23). Après : 1.23 (code 24), fichier installé de même SHA-256, date de première installation inchangée (2026-08-22) | Idem. Tout autre appareil Android reste non mis à jour |

Retour : le lanceur sauvegardé `start.cjs.rollback-6854931a…` et la release
`f46a4eeb` restent sur le poste ; `f46a4eeb` appelle `close_shift_v13`, encore
présente en production comme enveloppe. Pour la livraison suivante : la release
précédente devient `6854931afe98444d138381288121484a923f8533`, et l'empreinte du
lanceur a changé. Le retour d'une tablette à la 1.22 exigerait une
désinstallation, donc la perte de ses données.

## Complément du 18 novembre 2026, 11 h — retrait des objets abandonnés (`S2-03`, `S2-04`, `S2-05`, `S2-09`)

Relevé du 18 novembre 2026 vers 11 h, UTC+8. Observé directement. Boutique
ouverte : la migration ne touche aucune table de vente ni de stock en écriture.

| Surface | Observation | Limite |
|---|---|---|
| Backend production, avant | `stock_reservations` et `production_schedules` à 0 ligne ; `mv_sales_daily` et `mv_pl_monthly` non peuplées ; aucune tâche planifiée de ces objets ; les 3 permissions `audit_log.read`, `users.view_audit`, `settings.kiosk.manage` détenues par `SUPER_ADMIN` seul, sans dérogation ; 163 permissions ; aucune règle ni fonction ne cite ces codes ; seule dépendance des tables : la vue `v_product_available_stock` | — |
| Back-office servi, avant | Le code servi n'appelle aucun objet retiré ; il vise la production, pas le dev | Lecture des fichiers servis, pas d'un parcours à l'écran |
| Backend production, migration | Essai en transaction annulée, puis `apply_migration` du texte de `20261118000005_s2_retire_abandoned_objects.sql` (PR #729, fusionnée sur `a2d3a285` après une CI et un pgTAP verts) | — |
| Backend production, après | 160 permissions ; aucune des 5 relations ni des 9 fonctions retirées ; `mv_stock_variance` et `refresh_mv_stock_variance` présentes ; les deux valeurs `reservation_*` de `movement_type` présentes ; registre du stock intact (15 327 mouvements) | — |
| Back-office | `a2d3a285` publié (run `44233470065`, réussi à 12 h 53 après l'approbation de l'environnement Production). Code servi relu ensuite : les nouveaux textes des réglages e-mail sont présents ; il vise la production, jamais le dev ; aucun appel aux objets retirés ; `reservation_hold` et `reservation_release` restent seulement comme libellés de valeurs d'enum conservées | Lecture des fichiers servis, pas d'un parcours à l'écran |

Retour : aucun geste ne rend les objets supprimés ; ils étaient vides et sans
appelant. Les trois permissions se recréent par leur ligne d'origine de
`supabase/seed.sql` (historique Git) et une attribution à `SUPER_ADMIN`.

## Complément du 18 novembre 2026, 1 h 30 — visibilité confidentielle par permission (`S1-08`, paquet 1)

Relevé du 18 novembre 2026 entre 1 h 25 et 1 h 40, UTC+8. Observé directement.
Boutique fermée : aucune session de caisse ouverte, dernière commande le 17 à
17 h 40.

| Surface | Observation | Limite |
|---|---|---|
| Backend production, avant | Les neuf règles visées et les fonctions `has_permission`, `can_view_stock_v1`, `can_view_business_day_v2` égales au dev d'avant la migration. `SUPER_ADMIN` (2 comptes actifs) détient `reports.inventory.read` et `reports.audit.read` ; aucun autre rôle ni aucune dérogation individuelle | — |
| Backend production, migration | `apply_migration` du texte de `20261117000005_s1_08_visibility_permissions_and_policies.sql` (PR #725, fusionnée sur `9347514b` après un pgTAP vert) | — |
| Backend production, après | Permission `reports.statements.read` au catalogue, détenue par `SUPER_ADMIN` seul. `can_view_stock_v2` et `can_view_statements_v1` présentes, corps égaux au dev, non exécutables par `anon`. Les huit règles restrictives et la règle `admin_read` d'`audit_logs` lisent une permission dans un `(SELECT …)` | — |
| Backend production, identités | Lecture seule, identité simulée par `request.jwt.claims` : propriétaire → stock et états financiers visibles ; compte ADMIN → ni stock, ni états financiers, ni journaux | Fonctions d'aide appelées directement, sans session PIN : les tables elles-mêmes n'ont pas été lues sous ces identités |
| Back-office et caisse | Aucune publication : aucun écran ne change dans ce paquet | — |

Retour, relevé sur la production avant la migration : remettre par
`ALTER POLICY … USING (…)` les expressions précédentes rétablit l'état d'avant.

- `stock_movements.confidentiality_stock_movements`,
  `display_movements.confidentiality_display_movements`,
  `audit_logs.confidentiality_audit_logs`,
  `notification_outbox.confidentiality_notifications` :
  `can_view_business_day_v2((created_at)::date)`.
- `pos_events.confidentiality_pos_events` :
  `can_view_business_day_v2((occurred_at)::date)`.
- `display_stock.confidentiality_display_stock` :
  `can_view_business_day_v2(CURRENT_DATE)`.
- `inventory_count_items.count_items_owner_only` : `is_business_owner_v1()`.
- `z_reports.confidentiality_zreports` : `EXISTS (SELECT 1 FROM pos_sessions s
  WHERE s.id = z_reports.shift_id AND can_view_business_day_v2((s.opened_at)::date))`.
- `audit_logs.admin_read` : `get_current_role() = ANY (ARRAY['SUPER_ADMIN','ADMIN'])`.

Les deux fonctions neuves et la permission peuvent rester : elles n'ouvrent
rien seules.

## Complément du 17 novembre 2026, 23 h 15 — inventaire `S1-10`, charte de comptes, bilan v5 et retrait

Relevé du 17 novembre 2026 entre 22 h 00 et 23 h 15, UTC+8. Observé directement,
sauf mention contraire. Boutique fermée au moment du retrait : aucune session de
caisse ouverte, aucun inventaire en cours, dernière commande à 17 h 40.

| Surface | Observation | Limite |
|---|---|---|
| Backend production, migrations | Présentes dans l'historique de la base de production : `finalize_opname_v7_absolute`, `coa_company_chart`, `balance_sheet_v5_fixed_assets` (PR #719 et #722), et quatre migrations de factures du même jour | Gestes d'application **non observés** par ce relevé : seule leur présence est lue |
| Backend production, fonctions | `finalize_opname_v7` et `get_balance_sheet_v5` présentes, corps égaux au dev (`md5` du source sans retour chariot). Aucune fonction SQL ne nomme `finalize_opname_v6` ni `get_balance_sheet_v4` | — |
| Back-office production | Run « Publish Backoffice Production » `44080901277` sur `60c20d79`, réussi, de 20 h 12 à 20 h 40 (lu sur GitHub). Bundle servi par `backoffice.the-breakery.com` relu en entier (324 fichiers JS) : `finalize_opname_v7` et `get_balance_sheet_v5` présents ; `finalize_opname_v6`, `get_balance_sheet_v4` et la référence dev absents ; la référence de production présente. Fichier d'entrée inchangé entre 22 h et 23 h 15 | Lecture du bundle, pas un parcours d'écran : aucun inventaire finalisé, aucun bilan ouvert |
| Backend production, retrait | À 23 h 15, `apply_migration` du texte de `20261117000004_drop_finalize_opname_v6_balance_sheet_v4.sql` (PR #723, fusionnée sur `a3039af7` après un pgTAP vert). Après : seules `finalize_opname_v7(uuid,uuid)` et `get_balance_sheet_v5(date)` restent dans ces deux familles | — |
| Dev | Même retrait appliqué avant l'ouverture de la PR #723 | — |
| POS production | Non relevé ce soir. La PR #720 (`S2-13`, fichiers orphelins) touche du code du POS : elle ne change aucun appel, et la caisse n'a pas été réinstallée | — |

Retour : recréer `finalize_opname_v6` ou `get_balance_sheet_v4` à partir de leur
migration d'origine n'est utile qu'avec un back-office antérieur à `60c20d79` ;
le back-office publié n'appelle plus ces versions.

## Complément du 15 novembre 2026, 21 h 40 — motifs de perte `S1-18`, caisse installée et retrait

Relevé du 15 novembre 2026 entre 21 h 20 et 21 h 40, UTC+8. Observé directement,
sauf mention contraire. Boutique fermée : aucune session de caisse ouverte,
dernière commande à 18 h 01.

| Surface | Observation | Limite |
|---|---|---|
| POS production, avant | Les deux origines servaient `a35fd5f5` ; tâche « Breakery V3 Production » en marche | — |
| POS production, installation | Paquet `shop-release-f46a4eeb4712dd5e1f5f858de96a8bd138764942-1` installé à 21 h 36 par l'installateur du paquet, lancé depuis le terminal de la console de supervision du poste. Empreinte de l'archive sur le poste égale à celle du workflow. Sortie : `SHOP_RELEASE_VERIFIED f46a4eeb4712dd5e1f5f858de96a8bd138764942` | Premier passage réel de cet installateur en boutique. L'archive a voyagé en deux parts, recollées sur le poste |
| POS production, après | `https://pos.the-breakery.com/health` et `https://pos.the-breakery.com:3001/health` rendent `f46a4eeb` ; tâche en marche. Les fichiers installés nomment la référence Supabase de production, `waste_display_stock_v5` et `submit_display_day_closing_v2` ; ils ne nomment ni `waste_display_stock_v4`, ni `submit_display_day_closing_v1`, ni la référence de dev | Lecture des fichiers installés, pas un parcours d'écran |
| POS production, écrans | Rechargement de la caisse, de l'écran client et des tablettes **rapporté par Mamat**, non vu | Aucune impression, aucune vente et aucune perte constatées après l'installation |
| Tablettes | L'application Android embarque son propre bundle : la version 1.21 du 2026-11-09 n'est **pas** mise à jour par ce paquet. Son bundle nomme encore les anciennes fonctions de perte de vitrine et de comptage du jour | Version réellement installée sur les tablettes non relevée ; accès du profil serveur à ces écrans non vérifié. Une perte de vitrine ou un comptage du jour saisi depuis une tablette non mise à jour échouerait |
| Tablettes, APK 1.22 | Fabriquée à 21 h 49 sur le poste de développement : `com.thebreakery.pos`, version 1.22 (code 23), SHA-256 `9ddf16b50da6a78c69f6e6774d77bbb47228a796be3744f0ac1315e76560d6d4`. Son bundle est celui du paquet de la caisse `f46a4eeb`, repris de l'archive du workflow sans reconstruction : il nomme la référence Supabase de production et les nouvelles fonctions, aucune ancienne. Certificat de signature égal à celui des APK relevées sur les appareils le 2026-10-08 | Aucun appareil joint par `adb` au moment de la fabrication |
| CS30, APK 1.22 | Installée à 21 h 51 par `adb install -r` sur l'appareil `A59T11BGT3A01119`, qui portait la 1.21 du 2026-11-09. Après : version 1.22 (code 23), fichier installé de même SHA-256 que l'APK fabriquée, date de première installation inchangée. L'application s'ouvre sur l'écran du PIN et reconnaît le dernier utilisateur | Aucune connexion par PIN, aucune commande, aucune impression essayées. — |
| Galaxy Tab A8, APK 1.22 | Installée à 21 h 52 par `adb install -r` sur l'appareil `R9RT200NJHB` (SM-X205), qui portait la 1.21 du 2026-11-09. Après : version 1.22 (code 23), fichier installé de même SHA-256, date de première installation inchangée. L'application s'ouvre sur l'écran du PIN et reconnaît le dernier utilisateur | Aucune commande, aucune impression essayées. Tout autre appareil Android reste **non mis à jour** tant qu'il n'est pas relevé |
| Backend production | Appelants relevés avant le retrait : seules les anciennes versions s'appelaient entre elles ; aucun appel dans les applications ni les Edge Functions de `master` à `e4ff8f85`. Les huit anciennes versions retirées à 21 h 39 : `submit_stock_declaration_v2`, `adjust_stock_v4`, `waste_stock_v4`, `waste_display_stock_v4`, `submit_display_day_closing_v1`, `get_display_day_closing_v1`, `correct_display_day_count_v1`, `stock_private.submit_day_waste_v1`. Les huit nouvelles sont présentes | Retrait par requête directe, texte des `DROP` de `20261114000006_loss_reason_closed_list.sql` |

Retour : le lanceur précédent est conservé à côté du lanceur courant, et la
release `a35fd5f5` reste dans le répertoire des releases. Un retour de la caisse
à `a35fd5f5` exigerait de recréer d'abord les huit anciennes fonctions : cette
release les appelle.

Pour la livraison suivante de la caisse : la release précédente devient
`f46a4eeb4712dd5e1f5f858de96a8bd138764942`, et l'empreinte du lanceur a changé.

## Complément du 15 novembre 2026, 15 h 30 — vente d'un produit à recette, vitrine, attente de la caisse

Relevé du 15 novembre 2026 vers 15 h 30, UTC+8. Lecture seule sur la base de
production `yjhhhmjgsmyzyymvixot`. Observé directement. Aucune écriture.

| Surface | Observation | Limite |
|---|---|---|
| Git | `master` à `83c5b374` : la fusion de #709 (lecture du journal d'audit) s'est ajoutée. Son back-office appelle `get_activity_logs_v4` | — |
| Backend production | Seule `get_activity_logs_v3` existe : la migration `20261115000001_activity_log_resolved_context.sql` n'y est pas appliquée. Les huit anciennes versions des fonctions de perte sont toujours présentes | Le back-office publié vient de `f46a4eeb` et appelle encore la version présente. **Toute publication ou tout paquet construit depuis `master` exige d'abord cette migration en production** |
| POS production | Paquet `shop-release-f46a4eeb4712dd5e1f5f858de96a8bd138764942-1` toujours **non installé** : le poste de la boutique est en service, Mamat a demandé d'attendre la fin du service | — |
| Vente d'un produit à recette | « Beef Cheese Croissant » et « Banh Mi Croissant » ne sont pas suivis en stock ; leur recette contient un « Croissant », suivi et vendu en vitrine. Commandes `T114112026089` (deux vendus) et `T115112026107` (un vendu) : le stock général du Croissant baisse de 2 puis de 1, avec le bœuf, la mozzarella et la béchamel ; le compteur de la vitrine du Croissant baisse des mêmes quantités, motif « POS recipe consumption (pay existing) » | Deux commandes réglées après coup. Aucune vente réglée directement n'a été relue ; les autres chemins de vente appellent le même helper de la famille `_record_sale_stock` |
| Compteurs du Croissant | Stock général 115, vitrine 279 | Écart **non expliqué**, cause non cherchée : la vitrine dépasse le stock général |

Suite : inchangée pour `S1-18` — installation du paquet de la caisse, puis
retrait des huit anciennes versions.

## Complément du 15 novembre 2026, 13 h 50 — motifs de perte `S1-18`, back-office publié

Relevé du 15 novembre 2026 entre 13 h 50 et 14 h 20, UTC+8. Observé directement.

| Surface | Observation | Limite |
|---|---|---|
| Git | `master` à `f46a4eeb` : la fusion de #707 (export du journal d'audit, back-office seul, sans changement de base) s'est ajoutée à celle de #706. CI de `master` et pgTAP lancé à la main verts sur ce SHA | — |
| BO production | Publication par `production-backoffice.yml`, run `43681181421`, source `f46a4eeb`, approbation de l'environnement « Production » par Mamat ; alias `backoffice.the-breakery.com` posé à 13 h 50. Un premier run, `43620957573`, a échoué au contrôle du SHA exact : `master` avait avancé entre son lancement et son approbation. Rien n'avait été publié | Aucune session ouverte sur le back-office publié : les écrans de perte n'y ont pas été vus, et aucune perte n'y a été saisie |
| BO production, artefact servi | Les fichiers servis par `backoffice.the-breakery.com` nomment la référence Supabase de production, `submit_stock_declaration_v3` et `get_display_day_closing_v2`, et ne nomment plus `submit_stock_declaration_v2` ni `get_display_day_closing_v1` | Lecture des fichiers servis, pas un parcours d'écran |
| Backend production | Inchangé depuis le relevé de 00 h 35 : nouvelles et anciennes versions présentes | Les huit anciennes versions restent en place |
| POS production | Paquet de la caisse construit à 14 h 06 par `package-shop-release.yml`, run `43683176243`, source `f46a4eeb`, artefact `shop-release-f46a4eeb4712dd5e1f5f858de96a8bd138764942-1`. **Non installé** en boutique | La caisse appelle encore les anciennes versions et envoie du texte libre |

Suite : installation du paquet de la caisse, puis retrait des huit anciennes
versions.

## Complément du 15 novembre 2026, 00 h 35 — motifs de perte `S1-18`, étape additive

Relevé du 15 novembre 2026 entre 00 h 32 et 00 h 40, UTC+8. Observé directement.
PR #706. Aucune commande, aucun paiement, aucune déclaration ni aucun mouvement
de stock n'a été créé en production.

| Surface | Observation | Limite |
|---|---|---|
| Git | `master` à `6d735128` (fusion de #706). CI et pgTAP de la PR verts avant fusion | — |
| Backend production, avant | 0 session de caisse ouverte, dernière commande le 14 à 17 h 34. Type `waste_reason` à six valeurs. Corps de production des fonctions remplacées égaux à ceux du dev d'avant le lot, après normalisation des retours chariot. 17 déclarations de stock, toutes des pertes de vitrine, 9 en attente | — |
| Backend production, livraison | Application **additive** : texte de `20261114000005`, puis texte de `20261114000006` **sans ses `DROP`**. Le type reçoit `expired`, `leftover`, `damaged`, `other` ; deux colonnes de motif ; huit fonctions créées, corps égaux au fichier du dépôt (md5 de `prosrc`), EXECUTE pour `authenticated` et `service_role`, `anon` sans droit ; le helper privé réservé à `postgres` | Les anciennes versions **restent en place** : `submit_stock_declaration_v2`, `adjust_stock_v4`, `waste_stock_v4`, `waste_display_stock_v4`, `submit_display_day_closing_v1`, `get_display_day_closing_v1`, `correct_display_day_count_v1`, `stock_private.submit_day_waste_v1` |
| Backend production, après | 17 déclarations, aucune ne porte de motif : aucune ligne réécrite. Les versions nouvelles de la lecture et de la correction du comptage égalent les anciennes, au motif près | Aucun appel réel n'est passé par les nouvelles fonctions au moment du relevé |
| BO et POS production | Non republiés à ce relevé : ils appellent encore les anciennes versions, qui acceptent le texte libre | La liste fermée ne s'impose en production qu'après le retrait des anciennes versions |

Suite, dans cet ordre : publication du back-office, installation du paquet de la
caisse, puis retrait des huit anciennes versions, comme le fait la migration.

Retour arrière, si nécessaire, tant qu'aucune ligne ne porte de motif : retirer
les huit nouvelles fonctions, puis les deux colonnes. Les quatre valeurs du type
restent : une valeur d'énumération ne se retire pas, et rien ne l'utilise alors.

## Complément du 14 novembre 2026, 20 h 40 — compteur des produits non suivis `S1-11`

Relevé du 14 novembre 2026 à 20 h 40, UTC+8. Observé directement. PR #703.
Aucune commande, aucun paiement ni aucun mouvement de stock n'a été créé en
production.

| Surface | Observation | Limite |
|---|---|---|
| Git | `master` à `708b5751`. CI et pgTAP de la PR #703 verts avant fusion ; CI de `master` verte sur ce SHA | — |
| Backend production, avant | 0 session de caisse ouverte, dernière commande à 17 h 34. Les trois helpers `_record_sale_stock_v1`, `_restore_sale_stock_v1` et `_record_cancel_waste_stock_v1` ont l'empreinte attendue par la migration (`43b76a7c…`, `41310d19…`, `59341f76…`). 47 produits non suivis à compteur non nul, dont 1 négatif | — |
| Backend production, livraison | Migration `20261114000004` appliquée, texte du dépôt. Les trois helpers sont remplacés en place : définitions égales au dev (`495f5122…`, `316bcfef…`, `9a32de1d…`), EXECUTE pour `postgres` et `service_role` seulement, `anon` et `authenticated` sans droit | — |
| Backend production, après | 47 produits non suivis à compteur non nul, dont 1 négatif : inchangé, comme décidé | Aucune vente réelle n'est passée par les nouveaux helpers au moment du relevé |
| BO et POS production | Non republiés : le lot ne change aucun fichier d'application | — |

Retour arrière, si nécessaire : recréer les trois helpers depuis leur corps
d'avant, en retirant la condition `AND COALESCE(track_inventory, true)` et en
remettant `ELSIF v_track OR v_is_b2b THEN` dans `_record_sale_stock_v1`. Les
empreintes d'avant ci-dessus servent de contrôle.

## Complément du 14 novembre 2026, fin de soirée — adresse des tâches planifiées `S1-14`

Relevé du 14 novembre 2026 après 19 h 40, UTC+8. Observé directement. PR #701.

| Surface | Observation | Limite |
|---|---|---|
| Git | `master` à `c6a69096` (fusion de #701). CI et pgTAP de la PR verts avant fusion | — |
| Backend production, avant | 0 tâche planifiée, aucun secret Vault | — |
| Backend production, livraison | Migration `20261114000003` appliquée : schéma `scheduling_private` et helper `edge_function_url`, corps égal au dev (md5 de `prosrc` `280478e4…`), EXECUTE pour `postgres` seul, `anon` et `authenticated` sans droit sur le schéma | — |
| Backend production, usage | 0 tâche après livraison : la migration n'en installe aucune. Le helper rend NULL, faute de secret `project_url` | Le secret se pose avec l'installation des tâches |
| Backend dev | Secret `project_url` posé sur l'adresse du projet dev. La tâche d'envoi des notifications y répond 200 | — |

Retour arrière, si nécessaire : `DROP SCHEMA scheduling_private CASCADE`, tant
qu'aucune tâche de production ne l'appelle.

## Complément du 14 novembre 2026 au soir — lot money-path `S1-09` et `S1-12`

Relevé du 14 novembre 2026 entre 17 h 48 et 19 h 20, UTC+8. Observé directement.
PR #700. Aucune commande ni aucun paiement n'a été créé en production.

| Surface | Observation | Limite |
|---|---|---|
| Git | `master` à `04b55bb4` (fusion de #700). CI et pgTAP de la PR verts avant fusion | — |
| Backend production, 17 h 48 | Boutique ouverte : 1 session de caisse, 9 commandes dans l'heure. Livraison reportée | — |
| Backend production, avant, 18 h 52 | 0 session de caisse ouverte, dernière commande à 17 h 34. Corps de `stock_private.complete_order_with_payment_v30` normalisé égal à l'empreinte épinglée par la migration (`dcf1ae89…`). Edge Function `process-payment` version 4 égale aux fichiers de `master` d'avant le lot | — |
| Backend production, livraison | Application additive `payment_line_discount_cap_server_priced_promos_additive` : texte de `20261114000002` **sans ses `DROP`**. Les deux `complete_order_with_payment_v33` créées, corps égaux au dev (md5 de `prosrc` `21361069…` public, `6fe8f72a…` privé), mêmes droits, `anon` sans EXECUTE | `public.complete_order_with_payment_v32` et `stock_private.complete_order_with_payment_v30` **restent en place** |
| Edge Function production, 19 h 19 | `process-payment` redéployée, version 5, `verify_jwt` actif. Les 10 fichiers servis sont égaux à ceux de `master`. `OPTIONS` répond 200, un `POST` sans en-tête d'autorisation répond 401 | Aucun paiement réel n'est passé par la version 5 au moment du relevé |
| BO et POS production | Non republiés : le lot ne change aucun fichier d'application | — |

Retour arrière, si nécessaire : redéployer `process-payment` sur les fichiers de
`db37a505^` (appel de `v32`), puis retirer les deux `v33`. Une fois les ventes
réelles vérifiées sur `v33`, retirer `public.complete_order_with_payment_v32` et
`stock_private.complete_order_with_payment_v30`, comme le fait la migration.

## Complément du 14 novembre 2026 — réglages B2B `S1-04`

Relevé du 14 novembre 2026 vers 12 h, UTC+8. Observé directement. PR #698.
Aucune commande, aucun paiement ni aucun réglage métier n'a été saisi en
production ; la seule écriture est la ligne décrite ci-dessous.

| Surface | Observation | Limite |
|---|---|---|
| Git | `master` à `d014d9e8` (fusion de #698). CI et pgTAP de la PR verts avant fusion | pgTAP de la PR, pas un lancement manuel sur le commit de fusion : aucune publication du back-office n'en dépendait |
| Backend production, avant, 12 h 02 | `b2b_settings` : 0 ligne. Valeurs par défaut des colonnes et contraintes égales au dev, aucun déclencheur sur la table | — |
| Backend production, livraison | Migration `20261114000001` appliquée : une ligne `id = 1` insérée aux valeurs par défaut (`net_30`, cinq délais proposés, seuil critique 30 jours, trois tranches d'ancienneté) | — |
| Backend production, usage | `get_b2b_settings_v1` rend la ligne sous l'identité d'un `SUPER_ADMIN` actif | Lecture seule, par requête SQL. La page de réglages B2B n'a pas été ouverte dans un navigateur connecté |
| BO production | Non republié : le lot ne change aucun fichier du back-office | — |

Retour arrière, si nécessaire : `DELETE FROM public.b2b_settings WHERE id = 1`,
tant qu'aucun réglage n'a été saisi depuis. La page de réglages retombe alors
dans l'erreur d'avant la livraison.

## Complément du 12 novembre 2026 au soir — lot sécurité `S1-07` et `S1-13`

Relevé du 12 novembre 2026 entre 20 h et 22 h, UTC+8. Observé directement.
PR #695. Aucune commande, aucun paiement ni aucun compte n'a été créé ou
désactivé en production ; les essais ont eu lieu sur dev, en transaction annulée.

| Surface | Observation | Limite |
|---|---|---|
| Git | `master` à `ec4a3707` (fusion de #695). CI et pgTAP verts sur ce commit exact, pgTAP lancé à la main | — |
| Backend production, avant, 20 h 04 | Corps de `has_permission` et des trois helpers d'identité égaux au dev d'avant modification (md5). 11 profils actifs, aucun inactif, aucune session de caisse ouverte | Un compte inactif aurait perdu ses droits à la livraison : il n'y en avait pas |
| Backend production, livraison | Migrations `20261112000002` et `20261112000003` appliquées : `has_permission`, `get_current_role`, `get_current_profile_id` et `_current_profile_id` exigent un profil actif ; `set_user_active_v1` créée | Livraison en deux appels, quelques minutes d'écart |
| Backend production, corps | md5 de `prosrc`, retours chariot retirés, égaux au dev et aux fichiers du dépôt : `has_permission` `5918a8f5…`, `set_user_active_v1` `eeed733e…`, `get_current_role` `a09c1984…`, `get_current_profile_id` `01aa1f50…`, `_current_profile_id` `beb9759b…`. `anon` sans EXECUTE sur `set_user_active_v1` | — |
| Backend production, usage | Chacun des 11 profils actifs garde au moins une permission de son rôle par `has_permission` | Lecture seule ; aucune désactivation réelle n'a été jouée en production |
| BO production, 21 h 58 | Publication réussie sur `ec4a3707`, approuvée par Mamat dans l'environnement « Production » de GitHub | — |
| BO production, bundle servi | `https://backoffice.the-breakery.com` : le bundle chargé nomme `set_user_active_v1` et ne porte que la référence Supabase de production | Lu par téléchargement des fichiers servis, pas dans un onglet connecté. Le parcours du bouton à l'écran n'a pas été joué |

Retour arrière, si nécessaire : recréer `has_permission` depuis
`20260517000030_refactor_has_permission.sql` (md5 du corps de production avant
livraison : `34064863…`) et les helpers depuis `20260510000002_init_rls_helpers.sql`
et la migration qui définit `_current_profile_id` ; retirer `set_user_active_v1`
seulement après retour du back-office au bundle précédent, qui ne l'appelle pas.

## Complément des 11 et 12 novembre 2026 — lot comptable

Relevé du 11 novembre 2026 au soir, puis du 12 novembre à midi et en début
d'après-midi, UTC+8. Observé directement. Lot : `S1-03`, `S1-05`, `S1-06`,
`S1-17`, `S3-15` (PR #691, #692 et #693).
Aucune commande ni aucun paiement n'a été créé ; les essais ont eu lieu dans des
transactions annulées.

| Surface | Observation | Limite |
|---|---|---|
| Git | `master` à `01e9de59` (fusion de #692) | — |
| Backend production, 11 nov. vers 21 h 40 | Aucune session de caisse ouverte, période de novembre ouverte. Appliqué en **phase additive** : réouverture de période, clé `SALE_COGS`, helper du compte de stock par article, fonction de régularisation, déclencheur des mouvements de stock et écriture de réception remplacés, `record_b2b_payment_v6` créée **sans retirer** `v5`, `2142` et `2143` non postables, cinq comptes de charge, catégorie « Office » réaffectée | La sauvegarde la plus récente datait de 03 h 30 le même jour |
| Backend production, corps | md5 de `prosrc`, retours chariot retirés, égaux au dev et aux fichiers du dépôt : `reopen_fiscal_period_v1` `0401b9fa…`, `_stock_inventory_mapping_key_v1` `39ee54cc…`, `tr_stock_movement_je` `c75a9af9…`, `create_purchase_journal_entry` `0f309097…`, `post_stock_chain_catchup_v1` `2c8bcab9…`, `record_b2b_payment_v6` `c8113f23…`. `anon` sans EXECUTE sur aucune | `record_b2b_payment_v6` a été dérivée du `v5` live par remplacement, puis créée seulement si l'empreinte égalait celle du fichier |
| Backend production, essai annulé | Vente d'un article fabriqué : débit `5110`, crédit `1143`. Vente d'un article acheté : débit `5110`, crédit `1142` | Deux articles seulement |
| Backend production, « Office » | Compte `6190` → `6123`, 2 dépenses passées inchangées, trace `expense.category.account_reassigned` au journal d'audit, garde de catégorie de nouveau active | — |
| Régularisation, à blanc, 11 nov. | 5 966 mouvements de vente sans écriture, coût 37 759 000 ; réceptions reclassées 55 754 502,48 ; écriture équilibrée à 182 628 202,48 | **Non enregistrée.** Elle ne voyait pas les ventes payées sans mouvement de stock. Mesuré le même soir par une requête de lecture sur `orders`, `order_items` et `products`, hors de la fonction : 3 917 commandes payées sans mouvement, coût de fiche 96 935 058, dont 3 915 de l'import historique. Une migration préparée (`20261112000001`) remplace la fonction pour les compter ; **elle n'est pas appliquée en production à ce relevé** |
| BO production, 12 nov. 12 h 05 | Publication n° 29 réussie sur `01e9de59`, après un premier refus du contrôle préalable faute de passage pgTAP sur ce commit exact (lancé à la main, vert) | Lu dans la liste des déploiements GitHub, pas dans le bundle chargé |
| Backend production, 12 nov. 12 h 10 | `record_b2b_payment_v5` retirée après la publication | Un onglet du back-office resté ouvert sur l'ancien bundle échouera sur un règlement B2B jusqu'à son rechargement ; aucun règlement B2B n'avait été saisi entre-temps |
| Backend production, usage, 12 nov. 12 h 09 | 70 ventes payées (7 126 000). 340 mouvements de vente, 337 avec écriture, coût des ventes du jour 2 065 900, aucune écriture déséquilibrée depuis la livraison | Les 3 mouvements sans écriture valent zéro après arrondi |
| Backend production, 12 nov. 13 h 35 | Migration `20261112000001` appliquée (PR #693, `master` à `ee8b4fa6`) : `post_stock_chain_catchup_v2` créée, `v1` retirée. md5 du corps `04a4f6ea…`, égal au dev et au fichier. `anon` et `authenticated` sans EXECUTE | L'outil a rendu une erreur « already exists » alors que la migration figurait déjà au registre une minute plus tôt : lue comme une seconde tentative automatique. Une session de caisse était ouverte ; aucune fonction de caisse n'est touchée |
| Régularisation, à blanc, 12 nov. 13 h 37 | 5 969 mouvements de vente sans écriture (18 à coût zéro), coût 37 801 100 ; 3 915 commandes de l'import historique, coût 96 924 700 ; réceptions reclassées 55 754 502,48 ; mouvements reclassés 102 191 500, tous antérieurs à la livraison du 11 nov. Écriture équilibrée à 279 552 702,48 : débit `5110` 134 725 800 et `1142` 144 826 902,48, crédit `1141` 240 643 802,48 et `1143` 38 908 900 | Lignes historiques valant zéro : 615 articles à coût zéro, 545 combos sans composants. Coût actuel des fiches, pas celui du jour de la vente |
| Régularisation, enregistrée, 12 nov. | Sur accord de Mamat : `JE-20261112-0785`, statut `posted`, datée du 12 nov., mêmes montants et mêmes quatre lignes que le passage à blanc. Auteur : le seul profil `SUPER_ADMIN` actif. Une trace `accounting.stock_chain.catchup_posted` au journal d'audit. Un nouveau passage à blanc répond `already_posted` | Les lignes à coût zéro restent à zéro : les corriger demandera une écriture manuelle complémentaire |
| Backend production, soldes, 12 nov. après l'écriture | `5110` 137 749 100 ; `1142` 98 161 701,78 ; `1143` 6 067 800 ; `1141` 46 431 023,94. Aucune écriture déséquilibrée, en en-tête comme en lignes | Soldes cumulés de toutes les écritures `posted` ou `locked`, toutes périodes |

Retour arrière, si nécessaire : recréer `tr_stock_movement_je` depuis
`20260727000246_adjustment_je_emit_types_noop.sql` (md5 du corps de production
avant livraison : `30fbda51…`, égal à ce fichier) et `create_purchase_journal_entry`
depuis la migration qui la précède dans le dépôt ; les écritures de coût déjà
émises resteraient et devraient être contre-passées à la main.

## Complément du 10 novembre 2026 — fonctions de rapport `S3-21` et `S3-22`

Relevé du 10 novembre 2026 en fin d'après-midi, UTC+8. Observé directement.
Aucun essai créant une écriture, une commande ou un paiement n'a été effectué.

| Surface | Observation | Limite |
|---|---|---|
| Git | `master` à `b095fc27` (fusion de #676, qui porte `S3-21` et `S3-22`) ; sa source appelle `get_orders_list_v8`, `get_orders_counters_v6`, `get_product_sales_lines_v7` et `get_sales_by_product_v6` | — |
| BO production | Dernier déploiement de production : `a35fd5f5`, du 2026-11-09. Les fusions du 10 novembre ne sont **pas publiées** ; ce code appelle encore `get_orders_list_v7`, `get_orders_counters_v5`, `get_product_sales_lines_v5` et `get_sales_by_product_v5` | Lu dans la liste des déploiements GitHub, pas dans le bundle chargé |
| Backend production | Phase **additive** des migrations `20261110000001` et `20261110000002`, sur décision de Mamat : les quatre fonctions nouvelles sont créées, **aucune ancienne n'est retirée**. Quatre applications : `sales_by_product_filters_aggregate_additive`, `sales_by_product_filters_lines_additive`, `sales_created_paid_table_orders_list_additive`, `sales_created_paid_table_orders_counters_additive` | Le texte appliqué est celui des fichiers, **sans leurs `DROP`** ; `get_product_sales_lines_v6`, intermédiaire, n'est pas créée |
| Backend production | Corps des quatre fonctions nouvelles **égaux au dev** (md5 de `prosrc` : `d63888b7…`, `29fc8f6f…`, `0db669e8…`, `0a61d206…`) ; mêmes droits qu'en dev, `anon` sans EXECUTE ; les quatre anciennes toujours présentes, corps inchangés | — |
| Backend production, lecture | Sous l'identité du propriétaire, dans une transaction annulée, sur le 2026-11-08 : liste v7 et v8, mêmes 114 commandes ; compteurs v5 et v6 égaux ; ventes par article v5 et v6 égales, résumé et lignes ; 46 lignes de la liste portent une table | Un seul jour comparé ; aucun appel depuis le back-office |

**Reste dû, dans cet ordre** : publier le back-office depuis `master` (workflow
« Publish Backoffice Production », approbation de Mamat) ; vérifier la liste des
commandes et Sales by Product sur le back-office publié ; **puis seulement**
retirer les quatre anciennes fonctions (`get_orders_list_v7`,
`get_orders_counters_v5`, `get_product_sales_lines_v5`,
`get_sales_by_product_v5`), par un retrait ciblé. Les fichiers ne se rejouent
pas tels quels : le second retire aussi `get_product_sales_lines_v6`, absente
de la production, et ce `DROP` échouerait. Après ce retrait, la production
porte le même état final que les deux fichiers.
Retirer avant de publier casserait le back-office en service. Tant que le
retrait n'est pas fait, la production porte les deux générations : état
transitoire voulu, pas une dérive.

La fonction de `S3-19` (`get_production_vs_sales_v1`, migration
`20261110000003`) est **absente** de la production à ce relevé (lecture du
catalogue des fonctions) ; sa PR #678 n'est pas fusionnée.

### Même jour, en soirée — publication du back-office et retrait

Relevé du 10 novembre 2026 vers 19 h 30, UTC+8, candidat `a577f82a` (fusions
#676, #678, #679), sur demande de Mamat de publier tout le travail du jour.
Observé directement. Ce relevé **clôt** l'état transitoire décrit ci-dessus.

| Surface | Observation | Limite |
|---|---|---|
| Preuves du SHA | `ci.yml` sur `master`, run 42800017228, réussi ; pgTAP lancé à la main, run 42800184564, réussi (`pgtap` et `db-gate`) | pgTAP tourne sur la base de dev |
| Backend production | Migration `production_vs_sales_report` appliquée avant la publication : `get_production_vs_sales_v1`, corps égal au dev (md5 `58bc9622…`), `anon` sans EXECUTE. Additive : rien de retiré | — |
| Backend production, lecture | Sous l'identité du propriétaire, dans une transaction annulée, du 2026-11-01 au 2026-11-08 : 8 catégories, 8 jours, 52 articles ; produit 2 864, vendu 1 773 dont 238 en B2B, pertes approuvées 0, écart 1 091 | Aucun appel depuis le back-office |
| BO production | Workflow « Publish Backoffice Production », run 42805598428, réussi, approuvé par Mamat ; déploiement de production sur `a577f82a` | — |
| BO production, bundle servi | `backoffice.the-breakery.com` sert `index-DT-QkAzg.js` (avant : `index-CZtgSqXd.js`). Dans les fichiers servis : les cinq fonctions nouvelles sont appelées, aucune des quatre anciennes ; référence du projet de production présente, référence du projet de dev absente | Fichiers téléchargés et relus, pas un parcours connecté |
| Backend production | Retrait ciblé `sales_reports_drop_superseded_versions`, après la publication : `get_orders_list_v7`, `get_orders_counters_v5`, `get_product_sales_lines_v5`, `get_sales_by_product_v5` retirées | Un onglet du back-office ouvert avant la publication appelle encore les anciennes : il faut le recharger |
| Backend production, état final | Cinq fonctions seulement dans ces familles, corps égaux au dev, `authenticated` avec EXECUTE, `anon` sans | — |
| API | Appel anonyme de `get_orders_list_v8` et de `get_production_vs_sales_v1` : HTTP 401 | Aucun appel authentifié par l'API |

**Non fait** : aucun parcours dans le back-office publié avec un compte
connecté. La liste des commandes, Sales by Product et Production vs Sales
restent à ouvrir une fois en production.

**Retour** : les corps retirés ne sont pas sauvegardés hors Git. Ils se
retrouvent dans les fichiers `20261107000002` (liste et compteurs) et
`20261105000036` (ventes par article et ses lignes) ; les empreintes des corps
de production retirés, relevées avant le retrait, sont `0b3b1bd6…`,
`647328b9…`, `ae37eacf…` et `4ea0817e…`. Un retour demande de recréer ces
quatre fonctions **puis** de republier le back-office précédent (`a35fd5f5`).

### Nuit du 10 au 11 novembre — bilan Production vs Sales (PR #681)

Relevé de la nuit du 10 au 11 novembre 2026, vers 0 h 45, UTC+8, candidat
`10a815f8` (fusions #680 et #681), sur demande de Mamat. Observé directement.
Aucun essai créant une écriture, une commande ou un paiement n'a été effectué.

| Surface | Observation | Limite |
|---|---|---|
| Preuves du SHA | `ci.yml` sur `master`, run 42827502415, réussi ; pgTAP lancé à la main, run 42841826618, réussi (`pgtap` et `db-gate`) | pgTAP tourne sur la base de dev |
| Backend production, avant | `get_production_vs_sales_v1` seule dans sa famille ; tables, vues et gardes lues par la version suivante présentes | — |
| Backend production | Application additive `production_vs_sales_display_balance_additive`, avant la publication : `get_production_vs_sales_v3` créée, corps égal au dev (md5 `307758e9…`), mêmes droits, `anon` sans EXECUTE | Texte du fichier `20261110000005` **sans son `DROP`** ; `get_production_vs_sales_v2`, intermédiaire, n'est pas créée et le fichier `20261110000004` n'est pas joué |
| Backend production, lecture | Sous l'identité du propriétaire, sans écriture, du 2026-11-01 au 2026-11-08, anciennes et nouvelle versions côte à côte : produit 2 864 et comptoir 1 535 égaux ; vendu B2B 238 → 599 (commandes livrées, payées ou non) ; pertes 0 → 3 ; 8 catégories, 8 jours, 52 articles ; deux jours portent une clôture de vitrine (06 et 07) ; 290 cellules au non-expliqué inconnu | Un seul intervalle comparé ; aucun appel depuis le back-office |
| BO production | Workflow « Publish Backoffice Production », run 42848794540, réussi, approuvé par Mamat ; déploiement de production sur `10a815f8` | — |
| BO production, bundle servi | `backoffice.the-breakery.com` sert `index-Dc2HyGfM.js` (avant : `index-DT-QkAzg.js`). Dans les fichiers servis : `get_production_vs_sales_v3` appelée, aucune autre version de la famille ; référence du projet de production présente, référence du projet de dev absente | Fichiers téléchargés et relus, pas un parcours connecté |
| Backend production | Retrait ciblé `production_vs_sales_drop_superseded_version`, après la publication : `get_production_vs_sales_v1` retirée | Un onglet du back-office ouvert avant la publication appelle encore l'ancienne : il faut le recharger |
| Backend production, état final | `get_production_vs_sales_v3` seule dans sa famille, corps égal au dev, `authenticated` avec EXECUTE, `anon` sans | — |
| API | Appel anonyme de `get_production_vs_sales_v3` : HTTP 401 | Aucun appel authentifié par l'API |

**Non fait** : aucun parcours dans le back-office publié avec un compte
connecté. Production vs Sales reste à ouvrir une fois en production, comme la
liste des commandes et Sales by Product.

**Retour** : le corps retiré n'est pas sauvegardé hors Git. Il se retrouve dans
le fichier `20261110000003` ; son empreinte en production, relevée avant le
retrait, est `58bc9622…`. Un retour demande de recréer cette fonction **puis**
de republier le back-office précédent (`a577f82a`).

### 11 novembre 2026 — filtres de vente, articles de combo, lenteur du propriétaire

Relevé du 11 novembre 2026 en matinée, UTC+8, sur demande de Mamat. Candidat du
back-office : `d4fdc4f1` (fusions #683 et #684). Correctif de vue : `40d0dd69`
(fusion #685). Observé directement. Aucun essai créant une écriture, une
commande ou un paiement n'a été effectué.

| Surface | Observation | Limite |
|---|---|---|
| Preuves du SHA `d4fdc4f1` | `ci.yml` sur `master`, run 42884721040, réussi ; pgTAP lancé à la main, run 42931506865, réussi | pgTAP tourne sur la base de dev |
| Backend production, avant | `get_sales_by_category_v6`, `get_sales_by_staff_v5` et `get_production_vs_sales_v3` seules dans leurs familles ; le corps de la troisième égal au dev d'avant le bump (md5 `307758e9…`) ; vues et gardes lues par les versions suivantes présentes | — |
| Backend production | Applications additives `sales_by_category_staff_filters_additive` et `production_vs_sales_combo_components_additive`, avant la publication : `get_sales_by_category_v7`, `get_sales_by_staff_v6` et `get_production_vs_sales_v4` créées, corps égaux au dev (md5 `399c4b1c…`, `5ab8fd92…`, `35a3648c…`), mêmes droits, `anon` sans EXECUTE | Texte des fichiers `20261111000001` à `20261111000003` **sans leur `DROP`** |
| Backend production, lecture | Sous l'identité du propriétaire, sans écriture, sur 7 jours, anciennes et nouvelles versions côte à côte : ventes par catégorie 20 lignes et 86 557 000 des deux côtés, 17 lignes et 39 325 000 sous le filtre `dine_in` ; ventes par vendeur 4 lignes et 86 557 000 des deux côtés ; production contre ventes, vendu 1 974 → 2 062, dont 88 en combo, non expliqué 200 → 159 | Un seul intervalle comparé ; aucun appel depuis le back-office |
| BO production | Workflow « Publish Backoffice Production », run 42937311668, réussi, approuvé par Mamat ; déploiement de production sur `d4fdc4f1` | — |
| BO production, bundle servi | `backoffice.the-breakery.com` sert `index-DJhDSxYs.js`. Dans les fichiers servis : les trois nouvelles versions appelées, aucune des trois anciennes ; référence du projet de production présente, référence du projet de dev absente | Fichiers téléchargés et relus, pas un parcours connecté |
| Backend production | Retrait ciblé `sales_filters_and_combo_components_drop_replaced`, après la publication : les trois anciennes versions retirées | Un onglet du back-office ouvert avant la publication appelle encore les anciennes : il faut le recharger |
| Lenteur, constat | Avant correctif, sous l'identité du propriétaire, production contre ventes sur 7 jours : 42 s (ancienne version) et 23 s (nouvelle), pour une limite de 8 s du rôle `authenticated`. Une lecture complète de `reporting_private.closed_pos_orders_v1` (5 290 commandes) : 1,2 s, le contrôle de visibilité tournant une fois par commande | L'échec à l'écran n'a pas été observé : il est déduit des deux mesures |
| Preuves du correctif | PR #685 : `pgtap` et `db-gate` réussis, run 42938315631, sur `95a6f47d` | Aucun pgTAP manuel sur `40d0dd69` : le changement ne touche pas le back-office et n'a pas demandé de publication |
| Backend production | Application `reporting_owner_check_once` : la vue teste le propriétaire une fois par requête. Définition égale au dev (md5 `cc6c9d92…`), aucun droit direct, le propriétaire voit 5 310 commandes sur 5 310 | Texte entier du fichier `20261111000004` |
| Lenteur, après | Sous l'identité du propriétaire : production contre ventes 4,6 s sur 7 jours (premier appel), 2,3 s sur 30 jours, 4,4 s sur 91 jours ; ventes par catégorie sur 7 jours 0,03 s (avant : 2,2 s) | Mesures uniques ; la marge sous 8 s reste mince pour production contre ventes |

**Non fait** : aucun parcours dans le back-office publié avec un compte
connecté. Sales by Category, Sales by Staff et Production vs Sales restent à
ouvrir une fois en production.

**Limites du correctif de lenteur** : un compte non propriétaire garde le
contrôle par ligne ; les vues de confidentialité des règlements, des
remboursements et des sessions gardent le leur.

**Retour** : les corps retirés ne sont pas sauvegardés hors Git. Ils se
retrouvent dans `20261105000023` (ventes par catégorie), `20261105000027`
(ventes par vendeur) et `20261110000005` (production contre ventes, md5
`307758e9…`). Un retour des fonctions demande de les recréer **puis** de
republier le back-office précédent (`10a815f8`). Un retour de la vue se fait en
rejouant sa définition du fichier `20261105000001` ; il ne dépend pas du
back-office.

### Même jour, après-midi — filtres des ventes par origine et par client (PR #687)

Relevé du 11 novembre 2026 après-midi, UTC+8, sur demande de Mamat. Candidat
du back-office : `d2744da4` (fusion #687). Observé directement. Aucun essai
créant une écriture, une commande ou un paiement n'a été effectué.

| Surface | Observation | Limite |
|---|---|---|
| Preuves du SHA `d2744da4` | `ci.yml` sur `master`, run 42954307200, réussi ; pgTAP lancé à la main, run 42954334692, réussi | pgTAP tourne sur la base de dev |
| Backend production, avant | `get_sales_by_origin_v3` et `get_sales_by_customer_v3` seules dans leurs familles ; corps égaux au dev d'avant le bump, fins de ligne mises à part (md5 sans retour chariot `ebc92e68…` et `d8c5e259…`) ; vues et garde lues par les versions suivantes présentes | — |
| Backend production | Applications additives `sales_by_origin_filters_additive` et `sales_by_customer_filters_additive`, avant la publication : `get_sales_by_origin_v4` et `get_sales_by_customer_v4` créées, corps égaux au dev (md5 `5cc4f206…`, `60dd6fab…`), mêmes commentaire et droits, `anon` sans EXECUTE | Texte des fichiers `20261111000005` et `20261111000006` **sans leur `DROP`** |
| BO production | Workflow « Publish Backoffice Production », run 42966889206, réussi, approuvé par Mamat ; déploiement de production sur `d2744da4` | — |
| BO production, bundle servi | `backoffice.the-breakery.com` sert `index-jhCi2DSt.js`. Dans les 321 fichiers servis : les deux nouvelles versions appelées, aucune des deux anciennes ; référence du projet de production présente, référence du projet de dev absente | Fichiers téléchargés et relus, pas un parcours connecté |
| Backend production | Retrait ciblé `sales_origin_customer_filters_drop_v3`, après la publication : les deux anciennes versions retirées ; seules les v4 restent | Un onglet du back-office ouvert avant la publication appelle encore les anciennes : il faut le recharger |
| Backend production, lecture | Sous l'identité du propriétaire, sans écriture, sur 7 jours : ventes par origine 84 572 000, dont 39 606 000 sous le filtre `dine_in` ; ventes par client, identifié 6 604 000, dont 771 000 sous le filtre `cash` ; les quatre appels en 0,53 s | Un seul intervalle ; mesure unique |

**Non fait** : aucun parcours dans le back-office publié avec un compte
connecté. Sales by Origin et Sales by Customer restent à ouvrir une fois en
production.

**Retour** : les corps retirés ne sont pas sauvegardés hors Git. Ils se
retrouvent dans `20261105000026` (ventes par origine) et `20261105000024`
(ventes par client). Un retour demande de les recréer **puis** de republier le
back-office précédent (`d4fdc4f1`).

### Même jour, soir — filtres des ventes de combos et par table (PR #689)

Relevé du 11 novembre 2026 en soirée, UTC+8, sur demande de Mamat. Candidat du
back-office : `f2249dfb` (fusion #689). Observé directement. Aucun essai créant
une écriture, une commande ou un paiement n'a été effectué.

| Surface | Observation | Limite |
|---|---|---|
| Preuves du SHA `f2249dfb` | `ci.yml` sur `master`, run 42987909552, réussi ; pgTAP lancé à la main, run 42988150709, réussi | pgTAP tourne sur la base de dev |
| Backend production, avant | `get_combo_sales_v4` et `get_sales_by_table_v3` seules dans leurs familles (md5 sans retour chariot `ace5fbb2…` et `22e9f6bf…`) ; vues et garde lues par les versions suivantes présentes | — |
| Backend production | Applications additives `combo_sales_filters_additive` et `sales_by_table_filters_additive`, avant la publication : `get_combo_sales_v5` et `get_sales_by_table_v4` créées, corps égaux au dev (md5 `c4234732…`, `56af9681…`), mêmes droits, `anon` sans EXECUTE | Texte des fichiers `20261111000007` et `20261111000008` **sans leur `DROP`** |
| Backend production, lecture | Sous l'identité d'un compte autorisé aux rapports de vente, dans une transaction annulée, sur 7 jours : sans filtre, anciennes et nouvelles versions rendent le même résultat ; combos 7 018 000, dont 5 725 000 sous le filtre `dine_in` ; ventes par table 39 047 000, dont 8 677 000 sous le filtre `cash` | Un seul intervalle ; aucun appel depuis le back-office |
| BO production | Workflow « Publish Backoffice Production », run 42993676805, réussi, approuvé par Mamat ; déploiement de production sur `f2249dfb` | — |
| BO production, bundle servi | `backoffice.the-breakery.com` sert `index-DfI1FoNk.js`. Dans les 322 fichiers servis : les deux nouvelles versions appelées, aucune des deux anciennes ; référence du projet de production présente, référence du projet de dev absente | Fichiers téléchargés et relus, pas un parcours connecté |
| Backend production | Retrait ciblé `combo_table_filters_drop_replaced`, après la publication : les deux anciennes versions retirées ; seules `get_combo_sales_v5` et `get_sales_by_table_v4` restent, `authenticated` avec EXECUTE, `anon` sans | Un onglet du back-office ouvert avant la publication appelle encore les anciennes : il faut le recharger |

**Non fait** : aucun parcours dans le back-office publié avec un compte
connecté. Combo Sales et Sales by Table restent à ouvrir une fois en
production.

**Retour** : les corps retirés ne sont pas sauvegardés hors Git. Ils se
retrouvent dans `20261105000011` (ventes de combos) et `20261105000026` (ventes
par table). Un retour demande de les recréer **puis** de republier le
back-office précédent (`d2744da4`).

## Complément du 9 novembre 2026 — rattrapage `S1-02` et sauvegarde

Relevé du 9 novembre 2026, UTC+8. Observé directement, sauf mention contraire.
Aucun essai créant une écriture, une commande ou un paiement n'a été effectué.

| Surface | Observation | Limite |
|---|---|---|
| BO production | Vercel READY sur `e204d57a` (PR #662) ; à ce SHA, la source appelle les 4 RPC du rattrapage | Source relue, pas le bundle compilé |
| Sauvegarde | Tâche « Breakery V3 Daily Backup » lancée à la main sur `Pos` à 16 h 42, résultat 0 ; archive de production de 59 830 263 octets et son reçu, listage vérifié | Déchiffrement de cette archive non refait ; déclenchement de 03 h 30 non constaté |
| Backend | Migration `prod_catchup_cash_import_bank_clearing` appliquée à 17 h 10 ; texte reçu identique au fichier (md5) | — |
| Backend | 5 fonctions et table `cash_journal_import_rows` : corps, droits et politiques égaux au dev ; `post_v4` et `clearing_v2` retirées | — |
| API | Les 4 RPC répondent `42501` à un appel anonyme ; `clearing_v2` répond `PGRST202` | Aucun appel authentifié |
| BO, compte connecté | Rapprochement bancaire (« No bank statements ») et trésorerie de caisse, panneau d'import compris, ouverts sans erreur console | Les 4 RPC ne partent qu'avec un relevé ou un import : non exercées, faute d'écriture autorisée |

Retour préparé hors Git, sous `.release-manifests/s1-02-prod-catchup-20261109/` :
corps exacts de production des deux versions retirées, empreintes vérifiées.

### Même jour — copies du ticket serveur (`S1-22`, PR #670)

| Surface | Observation | Limite |
|---|---|---|
| Backend | Migration `kot_copies_waiter` appliquée en production (version enregistrée `20261109232338`) après fusion de la PR #670 ; texte reçu identique au fichier de `master` (md5) | Additive : rien de retiré, pas de geste de retour nécessaire |
| Backend | Colonne `business_config.kot_copies_waiter` NOT NULL DEFAULT 1, CHECK 0..5, valeur 1 ; fonction `set_kot_copies_waiter_v1` : corps et droits égaux au dev, `anon` sans EXECUTE ; copies par poste inchangées (1/1/1) | — |
| API | `set_kot_copies_waiter_v1` répond `42501` à un appel anonyme | Aucun appel authentifié |
| BO production, avant publication | `e204d57a` (PR #662) : les fusions du jour (#668, #669, #670) n'étaient pas publiées ; la publication est un geste distinct de la fusion | — |

### 10 novembre 2026 — publications et installations

Relevé du 10 novembre 2026 peu après minuit, UTC+8, candidat `a35fd5f5`
(fusions #668, #669, #670). Preuves de ce SHA : CI `ci.yml` run 42637243405 et
pgTAP lancé à la main run 42644979774, tous deux réussis.

| Surface | Observation | Limite |
|---|---|---|
| BO production | Workflow « Publish Backoffice Production » run 42651670138 réussi, approuvé par Mamat ; `backoffice.the-breakery.com` aliasé sur le déploiement de `a35fd5f5` | — |
| BO, compte connecté | Settings → Printing affiche la section « Waiter ticket » sans erreur console ; Mamat y a réglé **2** copies à 00 h 16 : ligne d'audit `setting.update` (1 → 2, acteur `mamat`) | Premier appel authentifié réel de `set_kot_copies_waiter_v1` |
| Tablette Samsung SM-X205 | APK 1.21 / code 22 installée par ADB (`install -r`), signature identique (`100d48b8…`), APK relue sur l'appareil identique à l'APK fabriquée (SHA-256 `c413df1a…`) ; avant : 1.20 / code 21 du 2026-11-08 | Aucune impression ni connexion constatées après mise à jour |
| CS30 | Même APK 1.21 / code 22, même vérification ; date de première installation conservée (2026-10-08) ; avant : APK identique à celle de la Samsung | Idem |
| Bundle des APK | Cible production seule (`yjhhhmjgsmyzyymvixot`), aucune référence dev ni V2 ; aucun texte d'interface de la 1.20 absent de la 1.21 | Comparaison de textes, pas de recette fonctionnelle |
| Paquet PC boutique | Workflow « Package Shop Production » run 42651675723 réussi ; `shop-release.zip`, SHA-256 `1cc5d1ad…` conforme au fichier `.sha256` ; `release.json` : SHA `a35fd5f5`, projet production ; rendu de l'addition et copies du ticket serveur présents | Voir la ligne d'installation ci-dessous |
| Installation PC boutique `Pos` | Vers 00 h 34, depuis le terminal MeshCentral, par la procédure adaptée « imported-bridge-launcher » (scripts de la livraison du 2026-11-06, seuls SHA attendu et empreinte d'archive changés) : étape *stage* (6 901 fichiers vérifiés), bascule du lanceur, redémarrage de la tâche « Breakery V3 Production », vérification sur les deux origines ; marqueur `CASHIER_RELEASE_VERIFIED_a35fd5f5`, code de sortie 0. Release précédente `ce1d4a39` conservée ; lanceur sauvegardé (`start.cjs.rollback-a35fd5f5…`) | — |
| Service boutique | `https://pos.the-breakery.com:3001/health` : `ok`, `release_sha` `a35fd5f5` ; page servie : `index-QRgUTh-Z.js`, identique au paquet ; fenêtre du pont : « POS SPA: …\releases\a35fd5f5… », synchronisation de 5 appareils | Rechargement de la page POS de la caisse non confirmé ; aucune impression ni vente constatée |
| Contrôle du service, 01 h 20 | Depuis le terminal MeshCentral du nœud `Pos`, en lecture seule : `/health` sur `https://pos.the-breakery.com/` **et** `:3001` rend `ok`, `release_sha` `a35fd5f5` ; page servie sur 443 : `index-QRgUTh-Z.js`. Depuis le LAN : les 92 fichiers POS servis sur 3001 sont identiques au paquet ; 443 répond 403 hors du PC lui-même | Écran de la caisse non regardé : rechargement de la page toujours non confirmé |

Le paquet ne s'extrait pas avec `Expand-Archive` (chemins trop longs dans
`node_modules`) : `tar -xf` l'extrait correctement. L'installeur générique du
paquet (`install-shop.ps1`) ne reconnaît pas le lanceur actuel, dont les chemins
sont échappés à la manière de JavaScript : la procédure adaptée a donc servi.
L'installeur du dépôt est corrigé par la PR #673, fusionnée le 2026-11-10
(`c173f9fb`) ; voir l'[installation boutique](shop-install.md). Il n'a pas
encore servi en boutique. Il ne voyage que dans un paquet construit depuis un
SHA qui contient cette fusion, et il exige une configuration version 2 : le
paquet `a35fd5f5` porte encore l'ancien installeur.

Numéro de version des APK : les fabrications antérieures portaient un numéro
jamais commité (1.20 / code 21 sur les appareils, 1.13 / code 14 au dépôt). La
1.21 / code 22 est commitée (branche `chore/tablet-apk-1.21`).

APK et paquet conservés hors Git, sous `.release-manifests/tablet-apk-1.21-20261109/`
(nouvelle APK et ancienne 1.20 relue sur la Samsung) et
`.release-manifests/shop-release-a35fd5f5-20261110/`. Un retour à la 1.20 sur
les tablettes exigerait une désinstallation, donc la perte de leurs données :
l'ancienne APK est une trace, pas un retour prêt à l'emploi.

## Complément du 29 octobre 2026 — mise en service V3

Statut documentaire : contenu validé par Mamat le 29 octobre 2026.
Relevé de livraison du 29 octobre 2026, UTC+8, jusqu’à 03 h 26.
Le backend, le BO et le POS sont déployés ; la recette financière de production
et le premier shift ne sont pas encore vérifiés. Cette distinction ne vaut
ni certification générale des fonctions ni autorisation d’inventer un fond de caisse.

### Candidat et cibles observés

Le candidat Git est `b29c78ee771d857f919a390af5ae16971ef43922`.
Le BO est compilé depuis ce candidat ; les artefacts POS/Android proviennent de
`82d820c92750d060fecd01806f9caaa557dbc00d`. Les deux commits ont le même arbre
`250c8316b07c972267f54b908fda9494693b2138`.
La cible compilée et déployée est la production V3 `yjhhhmjgsmyzyymvixot`.

| Surface | Observation du 29 octobre | Limite |
|---|---|---|
| Backend | Paquet de 62 migrations appliqué atomiquement ; 15 Edge Functions livrées et relues | Aucune vente de test production |
| BO | Vercel READY, domaine https://backoffice.the-breakery.com ; connexion confirmée par Mamat | Aucun parcours financier authentifié complet |
| POS caisse | https://pos.the-breakery.com ; catalogue chargé, Mamat connecté, panier vide | Shift fermé, premier encaissement non vérifié |
| Service Windows | Tâche « Breakery V3 Production » Running sous Cashier ; santé HTTPS 200 | Redémarrage du PC non testé |
| POS1 | Navigateur appairé au terminal existant ; droits conservés ; heartbeat récent | Aucun droit ajouté |
| Imprimantes | Cinq heartbeats récents ; un envoi de ticket TEST accepté par le bridge | Sortie papier physique non observée ; tiroir non actionné |
| Écran client | État « CONNECTED TO CHECKOUT » observé après retour au POS | Parcours après paiement non testé en production |
| Samsung SM-X205 | Mise à jour conservant les données, version 1.6/code 7 ; APK relue et conforme ; écran PIN observé | Connexion authentifiée et contenu des files locales non vérifiés |
| CS30 | Appareil absent du relevé USB | Aucune mise à jour constatée dans ce lot |

À 03 h 25 UTC+8, commandes, paiements, remboursements et journaux sont à zéro.
Les paiements hors ligne restent désactivés. Les stocks initiaux restent à zéro
et la configuration autorise le stock global négatif ; cela ne prouve aucun inventaire physique.

### Installation caisse et empreintes

La release caisse est `C:/BreakeryV3/releases/b29c78ee-20261029`.
Le compte existant Cashier a reçu uniquement lecture/exécution et traversée du
dossier `C:/BreakeryV3/security/production-b29c78ee`, après accord explicite.
La tâche démarre à l’ouverture de session Cashier, avec reprise sur échec.
Apache conserve l’origine LAN et relaie le bridge sur 3001 ; Olsera est conservé.
Ces réglages ne prouvent pas une reprise après reboot.

| Artefact | SHA-256 relevé |
|---|---|
| Paquet SQL production, 687 808 octets | `c0f79a452a4ae0372079c819f93e848df0dc41c3b1c4bd3f09b25360b74e541e` |
| Entrée BO `index-CJy2xbpy.js` | `a9fd8eeeeb7679b83a18376a7f97e4cc5e9b44448e083d4137f159d3b55f3551` |
| Entrée POS servie `index-B6QcfkWC.js` | `d0bd05fbf0cce1e8c5beb5d0ee1b51a603e59550ea619953ea261c8fd733c2bb` |
| APK Samsung installée | `1ea52dc8849510643cf308745d4fd9a9fa10fb0bce021f804f1161bc6d19c6ed` |

Publication BO : [workflow réussi](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/40739207119),
déploiement `dpl_HitfVyNBWA8LEvmznsbW6Nawf8Bi`.
La CI du candidat rapporte 1 366 tests POS, 1 934 BO et un BO ignoré ;
la preuve pgTAP porte sur 298 fichiers avec deux assertions ignorées.
Ces résultats concernent le candidat, pas le diff local de reprise historique.

### Sauvegarde, reprise historique et réserves

La sauvegarde physique Supabase disponible est datée du 29 octobre à 00 h 04 UTC+8.
Mamat a explicitement accepté la réserve : aucun nouvel export natif complet ni
restauration fraîche n’est prouvé avant cette livraison. Un complément logique
chiffré a été conservé ; ce fichier partiel ne remplace pas un dump restaurable
complet. La sauvegarde quotidienne autonome n’est pas activée.

La décision d’importer les ventes historiques d’octobre remplace l’ancienne
consigne de conserver zéro vente. Au présent relevé, les imports réels et le
socle local d’import historique ne sont pas installés en production. Les produits
et recettes sont conservés ; aucune purge n’est effectuée.

Restent non vérifiés : ouverture du premier shift avec fond réel, premier
encaissement, sortie papier sur place, connexion Samsung authentifiée,
mise à jour CS30, reprise après reboot et sauvegarde quotidienne autonome.

### Preuves privées de ce relevé

Les justificatifs sont hors Git, sous le profil utilisateur, dans
`.codex/visualizations/2026/10/17/01a14a32-8220-7fd2-bd43-ffcff5d86720/` :
`production-cutover-backend-20261029.json`, `production-bo-verification-20261029.json`,
`production-edge-source-readback-20261029.json`,
`samsung-production-installed-observed-20261029.json` et les captures
`production-pos-live-paired-20261029.png`, `production-pos-print-test-20261029.png`,
`production-windows-service-observed-20261029.png`.
Le JSON backend relu après correction porte l’empreinte
`38c80a8b7df199386e36ddcf897c5abcadaf84d56f3ee1f2404fb7b4ea70322a`.
Il conserve l’ancien blocage Windows et les observations qui le lèvent.
Ces preuves privées ne sont pas transportées par un clone ; aucun secret, code
d’activation ou jeu de données client n’est ajouté à ce bilan.

## Complément du 8 octobre 2026 — lot 1 de préparation production

Statut documentaire : validé par Mamat le 9 octobre 2026.
Le lot termine un inventaire en lecture seule, pas une recette de production.
Les inconnues ci-dessous restent des conditions de départ non satisfaites.
Aucun démarrage applicatif, reboot, déploiement, installation sur appareil,
restauration ou essai créant une vente ou un paiement n'a été effectué.

### Sauvegardes et conservation

Observé directement dans le dashboard du projet `yjhhhmjgsmyzyymvixot` :
sept sauvegardes physiques quotidiennes du 1er au 7 octobre UTC, la dernière
au 8 octobre à 00:04:42 UTC+8. Le PITR est désactivé. Le dashboard précise que
les objets Storage sont exclus ; aucune sauvegarde n'a été téléchargée.
La liste visible ne prouve ni une restauration, ni la conservation contractuelle.

La restauration métier sur cible isolée, la copie externe des objets Storage,
des secrets, des configurations boutique et des files offline restent inconnues.
Les fichiers présents sur le PC ne prouvent pas une sauvegarde indépendante.
Le responsable et l'emplacement de conservation externe ne sont pas établis.

### Installations et exécution observées

| Composant | Observation directe datée du 8 octobre | Limite |
|---|---|---|
| POS conservé sur PC | `C:/BreakeryV3/releases/1fc54978/pos` : 122 fichiers conformes au manifeste, aucun fichier supplémentaire ; cible compilée production | SHA `1fc549787c0ae1b735553282747ce458c65b2815` déclaré par le manifeste ; provenance de compilation et application chargée non certifiées |
| Bridge corrigé conservé | Release `bridge-prod-printer-presence-20261008`, empreinte du `server.cjs` relevée | SHA source et intégrité complète des dépendances inconnus ; processus non observé |
| PC `Pos`, `192.168.1.92` | À 21:35:49 UTC+8, aucun processus Node ni écoute sur 3001/3443 ; runtime Node installé 24.13.1 | Observation ponctuelle ; pas de preuve TLS servi, de service actif ou de reprise après reboot |
| Démarrage Cashier | Raccourci vers `Desktop/breakery-caisse/demarrer-caisse.cmd`, port 3001 et dossier `pos-dist` de ce répertoire | Autre bundle que la release vérifiée ; asset d'entrée production, anciens assets dev présents ; leur présence ne prouve pas leur chargement |
| Samsung SM-X205 | ADB USB : POS 1.5/code 6, mise à jour rapportée 00:45:14 ; APK exact lu et ciblant production | Aucun processus POS détecté ; WebView/cache chargé et SHA source inconnus |
| CS30 Android 11 | ADB USB : POS 1.5/code 6, mise à jour rapportée 00:50:40 ; même APK que la Samsung | Aucun processus POS détecté ; WebView/cache chargé et SHA source inconnus |
| KDS et écran client | Aucune identité de bundle chargé établie sur les surfaces accessibles | Recette physique et versions chargées inconnues |

SHA-256 commun aux deux APK installés :
`e0814960e7d0ad856231aa3001671793c7b49738a358f11c3db73b81c73f6ca0`.
Les copies privées sont conservées sous `.release-manifests/android-delivery-20260930/`,
dans `installed-samsung-observed-20261008.apk` et `installed-cs30-observed-20261008.apk`.
Elles diffèrent des APK historiques du 30 septembre ; aucun SHA source ne leur
est attribué par déduction. L'ADB local a été démarré pour la lecture USB.

Certificat public sur disque pour `pos.the-breakery.com` : expiration le
29 décembre 2026 à 10:48:45 UTC+8. La tâche `Breakery V3 TLS Renewal` rapporte
un résultat 0 le 8 octobre à 03:08:46, selon l'horloge du PC distant.
Cela ne certifie ni le certificat servi, ni le prochain renouvellement.

### Écarts cloud et limites de livraison

Relecture directe à 21:38:33 UTC+8 sur production : `business_config` ne contient
aucune ligne, commandes et paiements sont à zéro. Les réglages métier ne sont
donc pas réputés initialisés ; l'ancien constat de paiements offline désactivés
ne vaut pas preuve d'une configuration métier effective.
L'inventaire des Edge Functions expose sept fonctions actives, dont le heartbeat,
mais pas `process-payment`, `refund-order`, `void-order` ou `cancel-unpaid-order`.

Rapporté par la conversation du 8 octobre : comparaison de 380 signatures SQL
applicatives sur dev, production et répétition, avec égalité des corps après
normalisation des seuls retours à la ligne. Ce résultat ne certifie pas les
données, les Edge Functions ou un parcours métier. Les sorties intégrales de
cette comparaison ne sont pas disponibles dans le justificatif local de reprise.
Le BO relevé sur `23fbbf0903c3ec136f0e63d9e6d3f6521c567c08` et le candidat Git
`17b2ea37112b277bcb69f521efff9e76dd27aaa8` restent des identités distinctes.
La preuve pgTAP du candidat n'est pas établie par ce lot ; aucune suite cloud
n'a été déclenchée pour compléter ce contrôle.

### Références de preuve et clôture

Les observations boutique, ADB et dashboard sont transcrites dans le justificatif
privé `.release-manifests/production-candidate-20261005/lot1-backups-installation-observed-20261008.json`.
La relecture cloud finale est conservée dans `lot1-production-final-observed-20261008.json`
du même dossier. Leurs empreintes sont restituées dans le bilan conversationnel.
Ces fichiers ignorés ne sont ni une sauvegarde DB, ni un export des captures,
ni un contenu transporté par un clone propre. Les observations brutes de l'UI
et de l'ADB restent dans la conversation ; les secrets et données clients ne
sont pas recopiés dans ce document.

L'inventaire est terminé avec réserves explicites. Les corrections de configuration,
le déploiement des fonctions manquantes et la répétition physique restent des
travaux ultérieurs exigeant leur propre périmètre et autorisation.
Les contrôles locaux du 8 octobre ont réussi : liens relatifs, miroirs agents,
garde des références documentaires interdites et `git diff --check`.
La garde signale une baseline préexistante trop permissive dans `kiosk-issue-jwt`,
laissée hors périmètre. Aucun test applicatif, pgTAP ou E2E n'a été exécuté.
La conservation du complément sur `docs/production-lot1-observations` est validée,
sans PR ni push ; la validation documentaire reste distincte d'une permission de bascule.

## Développement et livraison POS

Observé directement le 8 octobre 2026 : la
[PR #560](https://github.com/guichduh33-arch/The_Breakery_ERP/pull/560) est fusionnée
dans `ade24e2294ce0c6a742088ff72a7066b0aa2415c`, le 8 octobre à 02:58:57 UTC+8.
Le contrôle CI principal et la gouvernance de ce commit sont réussis dans le
[run 37670993875](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/37670993875).
Le contrôle Supabase Preview est ignoré ; ce n'est pas une preuve SQL.

Le relevé physique antérieur décrit les optimisations du panier et des
variantes, le préchargement des options tablette, le routage cuisine et la
présence des imprimantes. La fusion prouve la livraison Git du lot, pas son
installation intégrale sur les terminaux. Les mesures p95 PC/Android, les prix
avec client, les réponses promotionnelles désordonnées, la reconnexion et
l'écran client après paiement ne sont pas certifiés par ce relevé.

## Back-office et Vercel

| Observation | Date | Qualification et preuve | Limite |
|---|---|---|---|
| BO production sur le SHA `23fbbf0903c3ec136f0e63d9e6d3f6521c567c08` | 8 octobre 2026 | Observé directement : API Vercel, déploiement `dpl_6Vd7MVZYV8fo7DVR3eiKN6DcHMRE`, état READY, cible production | État Vercel ; bundle dans un navigateur et connexion non relus |
| Alias `backoffice.the-breakery.com` associé à ce déploiement | 8 octobre 2026 | Observé directement : API des alias du déploiement | Ni test HTTP ni parcours métier |
| Publication manuelle réussie sur ce SHA | 8 octobre 2026 | Observé directement : [run 37391497089](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/37391497089) | Résultat d'une publication datée, pas des changements ultérieurs |
| Tentative production du SHA de fusion #560 | 8 octobre 2026 | Observé directement : API Vercel, `dpl_4w5SWTLm5sDaEK25892dJM9Edwos`, état CANCELED | Fusion Git distincte d'une publication BO |

L'API projet a retourné `live: false` et une dernière tentative annulée.
Ces champs ne suffisent pas à conclure que le BO est indisponible : le
déploiement READY et ses alias ont été inspectés séparément. L'état réellement
servi au navigateur reste inconnu dans ce relevé.

## Supabase et données

| Cible | Référence | Dernière preuve disponible | Qualification et limite |
|---|---|---|---|
| V3 dev | `ikcyvlovptebroadgtvd` | Bilans et CI ; migration de garde rapportée le 5 octobre dans le [guide de coupure](pos-internet-outage.md#livraison-vérifiée-le-2026-10-05) | Rapporté ; schéma et fonctions actuels non relus |
| V3 répétition | `getctmbpjnrrjzncaqze` | Relevé de préparation du 29 septembre 2026 | Rapporté ; disponibilité, état actuel et conservation à décider |
| V3 production | `yjhhhmjgsmyzyymvixot` | [Imports et coûts des 6 et 7 octobre](production-v3-cutover.md) | Rapporté ; aucune certification actuelle de l'ensemble du schéma, des droits ou des données |
| Ancienne V2 | `abjabuniwkqpfsenxljp` | Identité historique | Ne reçoit pas la lignée V3 ; usage actuel inconnu |

Le MCP Supabase sous le préfixe imposé par AGENTS n'était pas exposé pendant
ce relevé. Aucune requête DB ni inspection de fonctions live n'a été effectuée.
Les identités ne prouvent pas la cible d'une application chargée.

Les imports rapportés ne constituent pas une ouverture réelle : les stocks
physiques et soldes restent à intégrer selon le bilan V3. Les coûts exclus
ou absents ne sont pas réputés validés. La restauration complète n'est pas
prouvée par ces imports ou par leurs essais sous rollback.

## Boutique, terminaux et matériel

Les observations suivantes sont rapportées par la note de reprise V3 et les
preuves locales datées. Aucun appareil boutique n'a été relu pendant ce relevé.

| Composant | Cible / identité | Date et version rapportées | Résultat rapporté | Limite |
|---|---|---|---|---|
| PC caisse / POS1 | PC `POS`, LAN `192.168.1.92`, V3 production | 7–8 octobre : PC servant POS et bridge | Appairage et présence observés ; Mesh utilisé comme télécommande | SHA/empreinte du POS réellement chargé inconnus ici ; reboot non éprouvé |
| Print bridge | V3 production ; `C:/BreakeryV3/releases/bridge-prod-printer-presence-20261008` | 8 octobre | Release corrigée démarrée ; premier paquet incomplet remplacé après remise temporaire de l'ancienne release | SHA et empreinte du bridge non établis ; service permanent non certifié |
| Galaxy Tab A8 SM-X205 | Tablette serveur, V3 production rapportée | 30 septembre : 1.4 / code 5 ; 7–8 octobre : 1.5 rapportée | Installation conservant les données ; ajout Fresh Juice / Orange observé dans le relevé récent | Empreinte de l'APK actuellement installée inconnue ; version seule insuffisante |
| CS30 Android 11 | Tablette serveur, V3 production rapportée | 30 septembre : 1.5 / code 6 ; 7–8 octobre : 1.5 rapportée | Installation ADB et activité observées ; pas une caisse | Bundle actuellement chargé non relu |
| KDS et écran client | Service local prévu par ADR-033 | Versions installées inconnues | Parcours locaux décrits dans le code et les bilans | Aucune recette actuelle complète |
| Imprimantes | Caisse `.8`, cuisine `.13`, waiter `.14`, display `.15`, barista `.32` sur `192.168.1.*:9100` | 7–8 octobre | Sondes TCP sans octet d'impression et enrichissement du registre rapportés | Aucune imprimante coupée ; aucune impression physique dans ce lot |
| EF heartbeat | `lan-heartbeat-batch`, V3 production | 8 octobre | Déploiement et présence BO rapportés | Version/corps/configuration live non relus |

La version Android ne désigne pas un bundle unique : le relevé du 30 septembre
distingue deux APK 1.4 de contenu différent. Le candidat des bundles Android
à cette date était `1fc549787c0ae1b735553282747ce458c65b2815` ; cela n'attribue
pas ce SHA aux applications modifiées ensuite.

Le relevé récent rapporte les deux tablettes devenues `stale` après arrêt de
leurs heartbeats, ainsi que les paiements hors ligne désactivés dans le BO.
Recontrôler ces états avant toute action. Aucun paiement n'a été créé pendant
les essais récents rapportés. Ces essais n'autorisent pas une vente future.

## Certificats, démarrage et retour arrière

Rapporté au 30 septembre : certificat public pour `pos.the-breakery.com`,
tâche de renouvellement testée et sonde HTTPS/WSS à `:3443` ; accès protégé
refusé sans identité appareil. Le certificat et les secrets sont hors Git.
Le serveur lit les fichiers TLS au démarrage ; rechargement, ACL et démarrage
permanent LocalService n'étaient pas acquis dans ce relevé. Leur état actuel
est inconnu. Apache et l'ancien service caisse étaient préservés.

La signature Android était identique pour les remplacements rapportés du
30 septembre, sans désinstallation. Le contenu des files offline n'était pas
inspecté ; la conservation des données ne certifie pas leur rejeu.

Observé directement le 8 octobre sur les artefacts locaux : les SHA-256 des
APK concordent avec `tablet-proof.json` et `cs30-proof.json` du dossier Android :

- APK tablette 1.4 : `105b885af39ea1e6faf67f53544ec628beb17a0b4d557e772c2d654da6eca58f`.
- APK V3 1.5 : `5e99d90dd6d045ab417f8176ab05431ae14add8b75b824e63e8c1ba2e71935d8`.
- Certificat public rapporté par ces preuves : `100d48b8b0070544183a6437fe4139f1bc54ebd8d82318af5e226833b26c1477`.

Ces empreintes identifient les fichiers locaux, pas les APK actuellement
chargées sur les appareils. Les preuves JSON rapportent la vérification des
versions après installation au 30 septembre ; aucun appareil n'est relu ici.

La remise temporaire de l'ancien bridge le 8 octobre prouve uniquement ce
geste rapporté. Aucun rollback général ni restauration DB complète n'est
certifié. Utiliser les limites du [retour arrière V3](production-v3-cutover.md#arrêt-et-retour-arrière)
avant de promettre une réversibilité.

## Conservation des preuves et transfert

| Preuve privée ou locale | Date | Emplacement déclaré | Empreinte / disponibilité |
|---|---|---|---|
| Imports catalogue, recettes et coûts | 6–7 octobre | `.release-manifests/production-candidate-20261005/` ; noms détaillés dans le bilan V3 | Non versionnés ; empreintes non relevées ici |
| APK et empreintes Android | 30 septembre, fichiers relus le 8 octobre | `.release-manifests/android-delivery-20260930/` | Non versionnés ; empreintes locales ci-dessus, appareil actuel non relu |
| Préparation, schéma et répétition | 29 septembre–5 octobre | `.release-manifests/v3-bootstrap/` et preuves locales mentionnées dans la note | Non certifiés comme dossier complet transférable |
| Note source de reprise | Jusqu'au 8 octobre | Ancien chemin `.release-manifests/v3-bootstrap/memoire-mise-en-production.md` ; historique Git | Observations transférées ; retrait validé par Mamat le 8 octobre |

Un clone transporte les documents commités, pas les justificatifs privés,
APK, accès, certificats ou chats locaux. La date, la référence et l'empreinte
d'un justificatif doivent accompagner son transfert privé autorisé ; aucun
secret ou jeu de données client ne doit être ajouté au bilan Git.

Mamat a validé le transfert et le retrait de la note source le 8 octobre 2026.
Les observations utiles sont reprises ici ; les préparations renvoient aux
procédures existantes. Les autorisations rapportées et anciennes premières
actions ne sont pas des permissions nouvelles. L'historique reste dans Git ;
ne pas y puiser une consigne plus ancienne contre les sources actuelles.
