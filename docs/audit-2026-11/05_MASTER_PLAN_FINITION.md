# Master plan de finition — ERP / POS The Breakery

> Établi le **2026-11-09**, à partir des **44 arbitrages rendus** par Mamat en
> phase 2 (`04_QUESTIONS_CLARIFICATION.md`, §2bis et §17) et de la vérité
> fonctionnelle consolidée dans `../SPECS_OFFICIELS_ERP_POS.md`.
>
> **Aucune tâche de ce plan n'est inventée.** Chacune porte la référence de
> l'arbitrage qui l'autorise. Les points encore ouverts sont rassemblés en
> annexe et **ne sont pas planifiés**.

## Comment lire

| Colonne | Sens |
|---|---|
| **Risque prod** | 🔴 touche l'argent, le stock ou les droits en production · 🟠 touche un écran ou un rapport en service · 🟢 sans effet sur l'exploitation |
| **Source** | L'arbitrage ou le constat d'audit qui autorise la tâche |
| **Preuve** | Le test à exécuter avant de déclarer la tâche faite |

**Règles de livraison** (inchangées, `AGENTS.md` fait loi) : une branche par
sujet, jamais de commit direct sur `master`, audit agents avant chaque PR,
pgTAP obligatoire dès que `supabase/` est touché, suite back-office complète
avant toute livraison back-office, types régénérés après tout changement de
schéma.

**Ordre contraignant.** Les sprints s'exécutent dans l'ordre. À l'intérieur d'un
sprint, les dépendances sont notées. Trois tâches sont des **prérequis
absolus** : `S1-01` (sauvegardes) avant toute migration de masse, `S1-03`
(réouverture de période) avant toute clôture comptable, `S1-14` (référence
projet) avant toute installation de tâche planifiée.

---

## Décompte

| Sprint | Tâches | Dont 🔴 |
|---|---|---|
| Sprint 1 — Stabilisation et ambiguïtés critiques | 22 | 15 |
| Sprint 2 — Nettoyage du code abandonné | 13 | 3 |
| Sprint 3 — Features manquantes validées | 24 | 6 |
| Sprint 4 — Optimisation et clôture | 11 | 1 |
| **Total** | **70** | **25** |

*(Décompte du 2026-11-10, après l'ajout de `S1-21` et `S1-22` le 2026-11-09 puis
du bloc « qualité des rapports », `S3-19` à `S3-24`, sur demande de Mamat.)*

---

## Avancement au 2026-11-15 au soir

Relevé du 2026-11-15, tiré des paragraphes **État** de chaque tâche et de
`../runbooks/etat-environnements.md`. Il se périme au prochain lot : la
vérité de chaque tâche reste son propre paragraphe **État**.

| Sprint | En production | En cours | Retirée | Restent | Total |
|---|---|---|---|---|---|
| Sprint 1 | 15 | 1 | 1 | 5 | 22 |
| Sprint 2 | 0 | 0 | 0 | 13 | 13 |
| Sprint 3 | 3 | 1 | 0 | 20 | 24 |
| Sprint 4 | 0 | 0 | 0 | 11 | 11 |
| **Total** | **18** | **2** | **1** | **49** | **70** |

### Fait — en production

| Tâche | Livrée | Ce qui reste à constater |
|---|---|---|
| `S1-02` fonctions absentes | 2026-11-09, PR #666 | Refaire l'aperçu du relevé bancaire d'octobre sur le back-office republié |
| `S1-03` réouverture de période | 2026-11-11 | Le parcours à l'écran avec un compte propriétaire |
| `S1-04` réglages B2B | 2026-11-14, PR #698 | Ouvrir la page de réglages B2B dans un navigateur |
| `S1-05` coût des ventes | 2026-11-11, régularisation le 2026-11-12 | L'écriture d'un retour fournisseur, qui n'existe pas |
| `S1-06` règlements B2B | 2026-11-11, PR #692 | — |
| `S1-07` compte désactivé | 2026-11-12, PR #695 | Le parcours à l'écran avec un compte connecté |
| `S1-09` plafond de remise de ligne | 2026-11-14, PR #700 | Premières ventes réelles, puis retrait de l'ancienne version de la fonction de paiement ; essai à l'écran du POS |
| `S1-11` produit non suivi | 2026-11-14, PR #703 | Une vente réelle d'un produit non suivi |
| `S1-12` promotions aux prix serveur | 2026-11-14, PR #700 | Idem `S1-09`, même livraison |
| `S1-13` injections PostgREST | 2026-11-12, PR #695 | — |
| `S1-14` adresse des tâches planifiées | 2026-11-14, PR #701 | Le secret de production, à poser avec l'installation des tâches |
| `S1-17` comptes de taxe hors régime | 2026-11-11, PR #692 | La fonction du bilan nomme encore leurs codes |
| `S1-18` motifs de perte | 2026-11-15, PR #706, paquet `f46a4eeb` | Une perte saisie à l'écran, sur la caisse et sur le back-office ; l'impression d'un ticket après l'installation |
| `S1-21` addition avant paiement | 2026-11-10, paquet `a35fd5f5` | La preuve sur papier |
| `S1-22` exemplaires du ticket serveur | 2026-11-10, paquet `a35fd5f5` | La preuve sur papier |
| `S3-15` comptes de charge par nature | 2026-11-11, PR #692 | — |
| `S3-19` production contre ventes | 2026-11-10, PR #678 | Ouvrir le rapport en production avec le compte du propriétaire |
| `S3-21` heures et table des ventes | 2026-11-10, PR #676 | Ouvrir les deux écrans en production avec un compte connecté |

### En cours

| Tâche | Où elle en est | Ce qui la débloque |
|---|---|---|
| `S1-01` production récupérable | Runbook, tests, clés et première sauvegarde faits ; déclenchement de 03 h 30 constaté le 2026-11-18 (6 nuits sur 9), réveil du poste autorisé le même soir | Constater que les nuits suivantes ne manquent plus ; activer le PITR, éprouver une restauration, autoriser la copie Google Drive — gestes de Mamat |
| `S3-22` socle des rapports | Étapes 1, 3 et 4 et quatre lots de l'étape 2 en production, relevé du 21 novembre 2026 | Recette connectée du lot panier restante ; autres rapports de vente de l'étape 2 ; ventes par heure avec `S3-23` ; ventes du jour en attente d'arbitrage |

### Retirée

`S1-19` — voir son paragraphe.

### Restent

- **Sprint 1** (5) : `S1-08`, `S1-10`, `S1-15`, `S1-16`, `S1-20`.
- **Sprint 2** (13) : `S2-01` à `S2-13`.
- **Sprint 3** (20) : `S3-01` à `S3-14`, `S3-16`, `S3-17`, `S3-18`, `S3-20`,
  `S3-23`, `S3-24`.
- **Sprint 4** (11) : `S4-01` à `S4-11`.

### Ordre retenu pour la suite du Sprint 1

1. `S1-11` — fait, voir son paragraphe.
2. `S1-18` — fait, voir son paragraphe. **Décision de Mamat du 2026-11-14** : la liste fermée reçoit
   `expired`, `leftover`, `damaged` et `other`, commune à la production, au
   stock et à la vitrine ; les pertes passées gardent leur texte et sont
   marquées « non précisé ».
3. `S1-10` — fait, voir son paragraphe.
4. `S1-08` — seul, en au moins trois paquets.
5. `S1-16` — débloquée par `S1-14`.
6. `S1-15` — dépend de `S1-01`, encore en cours : elle ne part pas sans elle.
7. `S1-20`.

**Actualisation du 20 novembre 2026 pour `S1-15`** — livraison sans reprise de
quantités, voir son état ci-dessous. Le prérequis `S1-01` reste applicable à
toute reprise de masse ; le relevé historique du 15 novembre n'est pas un
comptage actualisé des autres domaines.

---

# Sprint 1 — Stabilisation et ambiguïtés critiques

> Objectif : que la production cesse de perdre de l'information, cesse de
> mentir sur l'argent, et cesse d'être irrécupérable. Rien d'autre.

---

### `[S1-01]` Rendre la production récupérable

**Risque prod** 🟢 (aucune écriture applicative) — **mais c'est la tâche la plus
urgente du plan.**
**Source** — Audit 01 §5.5 et 02 lot 9 : aucune tâche planifiée en production,
PITR désactivé, restauration jamais éprouvée. 11 jours d'argent réel.

**Fichiers** — la chaîne existe dans `scripts/release/`, chiffrée et couverte par
ses propres tests, mais **rien ne la déclenche** :
- `scripts/release/daily-backup.mjs` · `database-backup.mjs` ·
  `encrypted-backup.mjs` · `shop-config-backup.mjs` · `backup-drive.mjs` ·
  `backup-retention.mjs`, et leurs `*.test.mjs`
- `scripts/release/prepare-backup-task.ps1` — **aucune correction à faire.** Ce
  script n'enregistre volontairement aucune tâche : il valide les chemins,
  construit la définition et la rend en mémoire pour inspection, ce que son
  en-tête et sa dernière ligne énoncent. L'installation est en deux temps, par
  `Register-ScheduledTask -InputObject`, documentée dans le runbook. *(Mon
  relevé initial, « il n'enregistre aucune tâche : corriger », prenait une
  conception pour un défaut — même erreur que `S1-19`. Corrigé le 2026-11-09.)*
- `docs/runbooks/<nouveau>-reprise-et-sauvegardes.md` — **à écrire de zéro** :
  l'ancien guide prescrivait 5 objets SQL qui n'existent pas et a été archivé le
  2026-11-09. Ne pas le reprendre comme base.
- décider et écrire **où vit la clé privée de reprise**

**Travail**
1. ✅ **Fait le 2026-11-09** — Écrire le runbook contre les objets qui
   **existent** : `docs/runbooks/sauvegardes-et-reprise.md`. Aucun changement de
   code n'a été nécessaire ; la chaîne est complète, c'est la procédure qui
   manquait.
2. ✅ **Fait le 2026-11-09** — Prouver la chaîne par ses tests : **24 réussis,
   0 échec**. Ils couvrent le chiffrement et le format, **pas** la connexion à
   Supabase ni la restauration d'une application.
3. ✅ **Fait le 2026-11-09** — Générer la paire de clés de reprise, sur
   décision de Mamat : VPS Hostinger, RSA 3072, empreinte de la clé publique
   consignée au runbook. **Aller-retour chiffrer/déchiffrer prouvé avec cette
   paire**, plus trois refus vérifiés (mauvaise référence de projet, mauvaise
   clé, archive altérée). Seconde copie de la clé privée hors du VPS **faite
   par Mamat le 2026-11-09**, sur un SSD externe, vérifiée conforme à l'original
   (voir le runbook, décision `1 bis`).
4. ✅ **Fait le 2026-11-09** — Installer la chaîne sur le PC boutique et
   **produire une première sauvegarde réelle, déchiffrement prouvé** : client
   PostgreSQL 17.6 aligné sur la production, `rclone`, les 5 fichiers, le
   certificat racine, la clé publique, la configuration. Export de 61,7 Mo,
   archive de 56,4 Mo, **déchiffrée avec la clé privée du SSD** et dump restitué
   **identique au bit près**.
5. 🟡 **Installée le 2026-11-09** — Tâche « Breakery V3 Daily Backup » sur le
   PC boutique, compte `Cashier`, chaque jour à 03 h 30. **Lancée une fois à la
   main** le même jour à 16 h 42 : résultat 0, archive de production produite.
   **Déclenchement constaté le 2026-11-18** : six archives produites seules sur
   les neuf nuits du 9 au 18 novembre, la dernière à 03 h 30 avec le résultat 0.
   Trois nuits sans archive, et une sauvegarde partie à 6 h 41 : la tâche ne
   réveillait pas le poste. Réveil autorisé le 2026-11-18 au soir, sur décision
   de Mamat (relevé au runbook). Reste à constater que les nuits suivantes ne
   manquent plus.
6. ⏳ Activer le PITR sur le projet de production (réglage facturé, console
   Supabase, aucun outil du dépôt ne le fait).
7. ⏳ **Éprouver une restauration réelle, une fois**, sur un projet jetable.
8. ⏳ **Copie hors site vers Google Drive** (décision de Mamat du 2026-11-09,
   consignée au runbook). `rclone` est installé ; manque l'autorisation Google,
   que seul Mamat peut donner.

**Preuve** — La tâche apparaît dans le planificateur Windows. Une sauvegarde du
jour existe sur disque. Une restauration complète a été menée à son terme sur un
projet jetable, et le relevé est daté dans `docs/runbooks/etat-environnements.md`.
**Le reçu continuera d'écrire `dailyAutomationInstalled: false`** : le script ne
peut pas constater l'état du planificateur, donc il ne l'annonce pas. Ne pas
« corriger » ce drapeau ; la preuve d'installation est une observation datée.

**Note** — Une sauvegarde chiffrée dont la clé se perd n'est pas une sauvegarde.
L'emplacement de la clé est **écrit** depuis le 2026-11-09 : VPS Hostinger et SSD
externe de Mamat (runbook, décisions `1` et `1 bis`). Le code refuse de
sauvegarder sa propre clé privée.

---

### `[S1-02]` Livrer les 4 fonctions appelées mais absentes de la production

**Risque prod** 🔴
**Source** — Audit 01 §5.4. C'est la **seule panne active** : 4 fonctions
appelées par le back-office déployé manquent en production. *(Correction du
2026-11-09 : elles servent **deux** écrans, le rapprochement bancaire et l'import
du journal de caisse, et non quatre.)*

**État — appliqué en production le 2026-11-09** (PR #666). Migration
`20261109000001_prod_catchup_cash_import_bank_clearing.sql`, appliquée après une
sauvegarde fraîche de la production prise le même jour. Constaté en production :
les 5 corps égaux au dev (md5), droits et politiques identiques au dev,
`post_v4` / `clearing_v2` retirées. Les 4 fonctions sont exposées par l'API et
refusent l'appel anonyme. pgTAP : 345 fichiers verts sur la PR. Les deux écrans
s'ouvrent sans erreur console pour un compte connecté. **Non exercé** : un appel
authentifié réel des 4 fonctions, qui exige d'importer un relevé bancaire ou un
journal de caisse, donc d'écrire en production — premier usage métier à observer.
Essayé le 2026-11-09 avec le relevé bancaire d'octobre : l'aperçu refusait toutes
les lignes, la banque écrivant l'année sur deux chiffres. Corrigé par la PR #668,
fusionnée le même jour ; l'aperçu de ce relevé reste à refaire sur le back-office
republié.

**Fichiers**
- `apps/backoffice/src/features/accounting/bank-reconciliation/api.ts` — nomme
  les fonctions de comptabilisation et de lecture du compte d'attente
- `apps/backoffice/src/features/accounting/components/CashJournalImport.tsx` et
  `cashJournalImportContract.ts` — nomment l'aperçu et l'application de l'import
- `supabase/migrations/20261030000005_cash_journal_import.sql` et
  `20261030000006_cash_journal_import_aliases.sql` — présentes au dépôt, **jamais
  arrivées en production**
- `supabase/migrations/<nouveau>` — paquet de rattrapage

**Travail** — Identifier dans le dépôt les corps des 4 fonctions, vérifier
qu'ils correspondent aux appels du bundle **déployé** (et non à `master`), puis
les appliquer en production par migration.

**Preuve** — `pg_proc` en production contient les 4 fonctions. Les 4 écrans
s'ouvrent sans erreur sur le back-office déployé. pgTAP vert.

**Dépend de** — `S1-01`.

---

### `[S1-03]` Permettre la réouverture d'une période fiscale

**Risque prod** 🔴 — **prérequis absolu avant toute clôture comptable.**
**Source** — Arbitrage §2bis lot 6. Audit 01 §5.9 : le contrôle de période est
appelé par **tous** les émetteurs, y compris l'écriture de vente. Clôturer le
mois en cours **arrête la caisse**, et aucune fonction ne sait rouvrir.

**État — développé et prouvé en dev le 2026-11-11**, branche
`feat/s1-03-reouverture-periode-fiscale`. Migration
`20261111000009_reopen_fiscal_period.sql` appliquée sur la base dev seulement ;
**la production ne l'a pas**. La fonction rouvre une période `closed`, refuse
une période `locked`, et refuse aussi une période dont l'exercice porte déjà son
écriture de clôture annuelle (garde ajoutée : une écriture de résultat passée
après le report fausserait le compte de résultats reportés). Le motif est
facultatif. L'écran des périodes montre le geste au seul propriétaire, et la
fenêtre de clôture avertit quand la période choisie contient le jour courant.
pgTAP : 18 assertions vertes, dont le parcours clôturée → écriture refusée →
rouverte → écriture acceptée. **Non fait** : le parcours à l'écran avec un
compte propriétaire connecté (PIN du propriétaire dev inconnu de l'agent).
**En production depuis le 2026-11-11 au soir**, back-office publié le
2026-11-12 (relevé dans `docs/runbooks/etat-environnements.md`).

**Fichiers**
- `supabase/migrations/<nouveau>` — fonction de réouverture, gatée propriétaire,
  sous PIN, traçant dans `audit_logs`
- `apps/backoffice/src/features/accounting/components/FiscalPeriodModal.tsx`
- `apps/backoffice/src/features/accounting/hooks/useFiscalPeriods.ts`
- un nouveau crochet de réouverture à côté de `useCloseFiscalPeriod.ts`
- `supabase/tests/` — cas pgTAP

**Preuve** — pgTAP : une période `closed` redevient `open` sous PIN valide,
refuse sans PIN, refuse pour un non-propriétaire, et laisse une ligne dans
`audit_logs` avec un `actor_id` de **profil**. Puis, en dev : clôturer une
période, constater le refus d'écriture, rouvrir, constater que l'écriture passe.

---

### `[S1-04]` Réinsérer l'enregistrement unique de réglages B2B

**Risque prod** 🟠
**Source** — Audit 01 §5.2 : `b2b_settings` est **vide** en production ; la page
de réglages B2B lève une erreur serveur à chaque ouverture.

**État — développé et prouvé en dev le 2026-11-14**, branche
`fix/s1-04-b2b-settings-singleton`, migration
`20261114000001_reseed_b2b_settings_singleton.sql` appliquée sur la base dev
seulement, où elle est sans effet (la ligne y existe) ; **la production ne l'a
pas**. Elle réinsère la ligne avec les valeurs par défaut des colonnes et
n'écrase aucun réglage saisi. Relevé du même jour, en lecture seule, des tables
à enregistrement unique (contrainte `CHECK (id = 1)`) : il y en a deux.
`b2b_settings` : 0 ligne en production, 1 en dev. `business_config` : 1 ligne
sur les deux bases. pgTAP : `supabase/tests/b2b_settings_singleton.test.sql`,
5 assertions vertes sur dev.

**En production depuis le 2026-11-14 à midi** (PR #698, `master` à
`d014d9e8`) : migration appliquée, la table porte sa ligne aux valeurs par
défaut, et la fonction de lecture la rend sous l'identité d'un propriétaire.
Aucune publication du back-office n'était nécessaire. Relevé dans
`docs/runbooks/etat-environnements.md`. **Reste** : ouvrir la page de réglages
B2B à l'écran, avec un compte connecté.

**Fichiers**
- `supabase/migrations/<nouveau>` — insertion de l'enregistrement unique, avec
  les valeurs par défaut du dépôt
- **et** un relevé : chercher **toutes** les tables à enregistrement unique et
  vérifier qu'aucune autre n'est vide en production

**Preuve** — La page de réglages B2B s'ouvre. Le relevé des tables à
enregistrement unique est joint à la PR, avec le compte de lignes de chacune en
production.

---

### `[S1-05]` Raccorder la chaîne comptable du stock et reconnaître le coût des ventes

**Risque prod** 🔴 — **le chantier le plus lourd du plan.**
**Source** — Arbitrage §2bis lot 3. Audit 01 §5.7 : ventes 529 959 445 IDR
contre un coût de production de **1 700 IDR** ; `1142` à **−34 767 500 IDR** ;
la chaîne `1141` → `1142` → `1143` ne se raccorde jamais.

**État — développé en dev le 2026-11-11**, branche
`feat/s1-05-chaine-comptable-stock`, migration
`20261111000010_stock_accounting_chain_sale_cogs.sql` appliquée sur la base dev
seulement ; **la production ne l'a pas**. Règle retenue : chaque article a un
seul compte de stock, celui des produits finis s'il porte une recette, celui
des matières premières sinon, et tous ses mouvements passent par lui. Relevé en
production le même jour, en lecture seule : aucun article acheté ne porte de
recette, aucun article fabriqué n'en manque. La vente débite le coût des ventes
(clé de mapping neuve, posée sur `5110` comme le demande la preuve ci-dessous,
réaffectable depuis l'écran des mappings), l'annulation et le remboursement le
rendent, la réception débite les matières premières. `1141` n'est plus
alimenté, hors import historique qui garde son routage. **Traitement du
passé : décision de Mamat du 2026-11-11, une écriture de régularisation.** La
fonction existe, calcule à blanc par défaut, et n'a été exécutée nulle part ;
les mouvements de vente passés n'ayant pas gardé leur coût d'époque, elle les
valorise au coût actuel de l'article. **Non fait** : exécution en production,
relevé des soldes après livraison, et l'écriture d'un retour fournisseur, qui
n'a jamais existé.

**En production depuis le 2026-11-11 au soir** : les ventes écrivent leur coût
(relevé du 2026-11-12 à midi : 2 065 900 de coût pour 7 126 000 de ventes du
jour). Régularisation non enregistrée à ce relevé. Arbitrage de Mamat du même soir : le
coût se calcule sur la fiche de l'article vendu, suivi en stock ou non. Une
migration préparée (`20261112000001_stock_chain_catchup_historical_orders.sql`,
appliquée en dev ce jour-là) remplace la fonction pour compter aussi les ventes
payées de l'import historique, qui n'ont laissé aucun mouvement de stock —
3 915 commandes, coût de fiche 96 914 487 au relevé de production du
2026-11-12 — sorties du compte général de stock. Limites : coût
actuel de la fiche, combos importés sans composants non valorisables.

**Régularisation enregistrée en production le 2026-11-12**, sur accord de
Mamat : migration `20261112000001` appliquée (PR #693), puis écriture
`JE-20261112-0785`, équilibrée à 279 552 702,48, dont 96 924 700 de coût pour
les 3 915 commandes de l'import historique. Y valent zéro : 615 lignes à coût
de fiche nul et 545 combos importés sans composants ; les reprendre demandera
une écriture manuelle complémentaire. Relevé dans
`docs/runbooks/etat-environnements.md`. Soldes relevés en production juste après :
`5110` 137 749 100, `1142` 98 161 701,78 (positif), `1143` 6 067 800, `1141`
46 431 023,94, et `0` écriture déséquilibrée. **Reste** : l'écriture d'un
retour fournisseur.

**Fichiers**
- `supabase/migrations/<nouveau>` — bump du déclencheur comptable des mouvements
  de stock : traiter le type `sale`, débiter le coût des ventes, créditer le
  stock
- `supabase/migrations/<nouveau>` — raccorder les trois comptes : la réception
  alimente les matières premières, la production solde vers les produits finis,
  la vente sort des produits finis
- `supabase/migrations/20260701000015_redesign_create_purchase_journal_entry.sql`
  — **lire le corps live avant de bumper**, pas le fichier
- `supabase/migrations/20260603000014_bump_create_sale_journal_entry_split_by_payment_method.sql`
  — idem
- `supabase/tests/` — pgTAP par événement

**Travail**
1. Écrire les écritures manquantes et corriger la chaîne, **en dev d'abord**.
2. pgTAP par événement : vente, annulation, remboursement, production,
   réception, perte, inventaire.
3. Décider du **traitement du passé** : les 11 jours déjà écoulés n'ont pas de
   coût des ventes. Soit une écriture de régularisation datée, soit une limite
   assumée et écrite. **Cette décision appartient à Mamat** et doit être prise
   avant la mise en production.

**Preuve** — pgTAP vert sur les 7 événements. En dev, après une vente, une
fournée et une réception : `5110` non nul, `1142` positif, `1143` qui se solde,
et `0` écriture déséquilibrée. Puis relevé des mêmes soldes en production après
livraison.

**Dépend de** — `S1-01`, `S1-03`.
**Attention** — Un produit valorisé à **zéro** n'émettra toujours aucune
écriture. 14 produits suivis sont dans ce cas : c'est une limite assumée
(`S4-06` la documente).

---

### `[S1-06]` Unifier le routage comptable des règlements B2B

**Risque prod** 🔴 — **prérequis au rapprochement bancaire.**
**Source** — Arbitrage §2bis lot 6, qui applique la décision 3 de l'ADR-013.
Aujourd'hui un règlement B2B en QRIS va directement en banque alors qu'une vente
QRIS passe par le compte d'attente : les deux chemins ne peuvent pas se
rapprocher.

**État — développé et prouvé en dev le 2026-11-11**, dans le lot comptable
(PR #692), migration `20261111000011_b2b_payment_sale_mapping_routing.sql` ;
**la production ne l'a pas**. Le règlement B2B lit le helper de mapping de la
vente. Relevé en dev, dans une transaction annulée : QRIS → `1115`, carte →
`1116`, virement → `1112`. Les espèces restent sur le coffre non déposé
(`1110`), choix déjà écrit dans le skill B2B (« hors tiroir POS ») et non
modifié. Les règlements passés ne sont pas réécrits. **En production depuis le
2026-11-11**, ancienne version retirée le 2026-11-12 après publication du
back-office.

**Fichiers**
- `supabase/migrations/<nouveau>` — faire lire la table moyen-vers-compte par
  l'émetteur d'écriture de règlement B2B
- `apps/backoffice/src/features/btob/components/RecordB2bPaymentModal.tsx`
  (vérification seulement, si le contrat ne change pas)
- `supabase/tests/`

**Preuve** — pgTAP : un règlement B2B en QRIS crédite `1115`, pas `1112`. Relevé
avant/après des soldes `1112`, `1115`, `1116` en dev.

**Dépend de** — `S1-05`.

---

### `[S1-07]` Couper les droits d'un compte désactivé

**Risque prod** 🔴
**Source** — Arbitrage §2bis lot 1. `has_permission` vérifie que le profil n'est
pas supprimé, mais **pas qu'il est actif**.

**État — développé et prouvé en dev le 2026-11-12**, branche
`fix/lot-auth-s1-07-s1-13`, migrations `20261112000002` et `20261112000003`
appliquées sur la base dev seulement ; **la production ne les a pas**.
`has_permission` exige un profil actif, ainsi que les trois helpers qui
identifient l'appelant (constat de revue : ils ignoraient aussi l'activité).
**Écart relevé** : aucune fonction de désactivation n'existait, seule la
suppression posait un compte inactif. Une fonction de la famille
`set_user_active` est ajoutée — gardée par `users.update`, motif exigé,
auto-désactivation refusée, dernier administrateur actif protégé, sessions
closes, trace au journal d'audit — et la fiche d'un utilisateur du back-office
offre le geste. pgTAP : `supabase/tests/account_deactivation.test.sql`, vert
sur dev par sections. **Non fait** : le parcours à l'écran avec un compte
connecté (PIN du propriétaire dev inconnu de l'agent). Tout détenteur de
`users.update` peut désactiver un `ADMIN`, comme il peut déjà le supprimer :
parité voulue avec l'existant, pas un choix nouveau.

**En production depuis le 2026-11-12 au soir** (PR #695) : les deux migrations
appliquées, corps égaux au dev, back-office publié le même soir. Le verrou CI
sur `has_permission` porte une exception unique pour cette migration, accordée
par Mamat et épinglée au contenu du fichier. Relevé dans
`docs/runbooks/etat-environnements.md`. **Reste** : jouer le geste à l'écran
avec un compte connecté ; aucune désactivation réelle n'a été faite en
production.

**Fichiers**
- `supabase/migrations/<nouveau>` — ajouter le contrôle d'activité dans
  `has_permission` (**partir du corps live**, `pg_get_functiondef`)
- la fonction de désactivation de compte — révoquer les sessions en cours
- `supabase/tests/`

**Preuve** — pgTAP : un profil actif garde ses droits, le même profil désactivé
les perd sur la même requête. Puis en dev : désactiver un compte connecté et
constater le refus serveur **sans** attendre l'expiration du jeton.

**Note** — Cette tâche remplace l'expiration automatique des PIN, explicitement
abandonnée (§2bis lot 1).

---

### `[S1-08]` Rendre la visibilité du stock et des finances déléguable

**Risque prod** 🔴
**Source** — Arbitrage §2bis lot 1 et lot 7. `is_business_owner_v1()` ne
reconnaît qu'un seul compte ; **37 fonctions** et **7 policies restrictives**
passent par cette porte, et les 3 comptes ADMIN détiennent des permissions qui
sont des lettres mortes.

**Fichiers**
- `supabase/migrations/20261107000001_financial_reports_owner_only.sql` — point
  de départ de l'inventaire, **ne pas éditer**
- `supabase/migrations/<nouveau>` — remplacer le contrôle de rôle par
  `reports.inventory.read` et `reports.financial.read` dans les 37 fonctions
- `supabase/migrations/<nouveau>` — les 7 policies restrictives
  (`stock_movements`, `display_stock`, `display_movements`, `audit_logs`,
  `pos_events`, `z_reports`, `notification_outbox`)
- `supabase/tests/` — un cas par famille

**Travail** — **Découper en au moins trois paquets** : les fonctions de stock,
les fonctions financières, les policies. 37 fonctions en une migration est
irrelisable.

**Preuve** — pgTAP : un compte portant `reports.inventory.read` sans le rôle
propriétaire lit le stock ; le même compte sans la permission est refusé. Liste
exhaustive des 37 fonctions jointe à la PR, avec le statut de chacune.

**Débloque** — Le chiffrage du manque avant fournée devient visible par le
boulanger (constat §9 des specs).

**État — paquet 1 développé et prouvé en dev le 2026-11-17**, branche
`fix/s1-08-visibilite-deleguable`. Décision précisée par Mamat le même jour et
gravée dans l'ADR-039 : le stock suit `reports.inventory.read`, les états
financiers une permission neuve, `reports.statements.read`, donnée au seul
propriétaire ; le rôle ADMIN garde ses permissions et ne gagne aucune
visibilité. Écart signalé au relevé du corps live : les sept règles
restrictives ne testaient pas directement le rôle, mais passaient par la
fonction d'aide de la journée métier, elle-même réduite au test de rôle ; cette
fonction est aussi appelée par des fonctions d'écriture, dont celle du paiement.
Les règles des tables pointent donc vers des fonctions d'aide neuves, sans
toucher à l'ancienne. Paquet 1, migration
`20261117000005_s1_08_visibility_permissions_and_policies.sql` : la permission
neuve, deux fonctions d'aide (stock, états financiers), les huit règles
restrictives (les sept de la liste et celle des lignes d'inventaire) et la
règle permissive des journaux, qui testait encore le rôle. Les journaux suivent
`reports.audit.read`, les rapports Z les états financiers. Preuve pgTAP
`s1_08_visibility_permissions.test.sql`, 18 sur 18 en dev le 2026-11-17 : lecture
réelle des mouvements de stock et des journaux par un délégué, avec et sans la
permission ; pour les six autres tables, seule l'expression de la règle est
vérifiée. Un délégué lit une table s'il détient aussi la permission ordinaire de
cette table (ADR-039, Conséquences).
**Paquet 1 en production le 2026-11-18 à 1 h 30** (UTC+8) : PR #725 fusionnée
(`9347514b`), migration appliquée, boutique fermée. Règles, fonctions et droits
relus égaux au dev ; sous l'identité d'un propriétaire, les deux fonctions d'aide
rendent vrai, sous celle d'un compte ADMIN, faux. Relevé dans
`docs/runbooks/etat-environnements.md`, section du 18 novembre.
**Restent** : paquet 2, les fonctions de lecture du stock ; paquet 3, les
fonctions des états financiers ; puis les fonctions d'écriture qui masquent le
stock dans leur réponse, et l'Edge Function du PDF confidentiel, qui lisent
encore l'ancienne fonction d'aide.
**Paquets 2 et 3 développés et appliqués en dev le 2026-11-18**, branche
`fix/s1-08-s1-16-s1-20-lot`, migration
`20261118000001_s1_08_stock_and_statements_reads.sql` (additive) puis
`20261118000002_s1_08_drop_owner_only_reads.sql` (retrait, après publication du
back-office). 29 lectures reçoivent une version neuve : 21 de stock, dont le
grand livre pour ses seuls comptes de stock, le tableau de bord, la nomenclature
complète et le coût direct des recettes et la recherche d'ingrédients, suivent
`reports.inventory.read` ; 8 des états financiers (bilan, résultat, flux de
trésorerie, balance, journal des coffres, marge par produit, PB1 et son calcul)
suivent `reports.statements.read`. Corps repris du vivant (empreinte vérifiée
avant génération, puis égalité fichier-base sur les 29). Le back-office ouvre
ses routes et son menu des états financiers à la permission, et non plus au
rôle ; l'aperçu des matières d'une fournée montre le stock et le manque à qui
détient la permission de stock. L'Edge Function du PDF suit les deux
permissions. **Limite, conforme à l'ADR-039** : la plupart des lectures de
stock gardent la confidentialité de la journée en cours ; un délégué n'y voit le
stock qu'une fois la journée close. Le manque avant fournée devient visible au
délégué dans l'aperçu des matières et la recherche d'ingrédients, qui n'ont pas
ce verrou ; les listes et alertes de stock, non. **Restent hors de ce lot** : les fonctions d'écriture et de
paiement qui masquent le stock dans leurs messages d'erreur, la lecture des
produits opérationnels par la caisse, et les paiements par méthode, rapport et
PDF, dont la permission n'est pas tranchée (voir l'ADR-039, qui ne les range ni
dans les états financiers ni dans les rapports d'exploitation).
**Paquets 2 et 3 fusionnés le 2026-11-18** : PR #727 (`5665eeb9`), CI verte.
**En production le même jour vers 8 h 30** (UTC+8) : la partie additive,
appliquée par un bloc qui refait les remplacements sur le corps vivant de la
production ; les 29 corps relus égaux au corps d'origine remplacé, mêmes
attributs, droits refusés à anon. L'Edge Function du PDF est redéployée en
production (version 9, contrôle du jeton conservé). Back-office publié le
même jour sur `5665eeb9` (approbation de Mamat) ; le code servi appelle les
nouvelles versions, aucune ancienne, et vise la production. Puis retrait des
anciennes versions en production et en dev ; aucun appelant restant, et sous
l'identité d'un propriétaire le bilan et les compteurs de stock répondent.
**Paquets 2 et 3 en production le 2026-11-18.**

---

### `[S1-09]` Plafonner la remise de ligne au sous-total serveur

**Risque prod** 🔴
**Source** — Arbitrage §2bis lot 2. La remise de ligne est aujourd'hui un
**montant libre** envoyé par la caisse, sans plafond.

**État — développé et prouvé en dev le 2026-11-14**, branche
`fix/lot-money-path-s1-09-s1-12` (lot money-path, avec `S1-12`), migration
`20261114000002_payment_line_discount_cap_server_priced_promos.sql` appliquée
sur la base dev, puis en production le 2026-11-14 au soir (voir plus bas). Relevé du corps live
ce jour-là : le défaut ne vivait que dans la vente directe (famille
`complete_order_with_payment`). La famille `fire_counter_order` bornait déjà la
remise de ligne, et aucune autre fonction n'écrit la remise d'une ligne
existante. La vente directe refuse désormais une remise de ligne négative ou
supérieure au sous-total serveur de sa ligne (`check_violation`). La fonction
de paiement monte d'une version, même contrat ; l'ancienne est retirée et
l'Edge Function `process-payment` est repointée et redéployée sur dev. pgTAP :
`supabase/tests/payment_line_discount_cap_server_priced_promos.test.sql`, vert
sur dev. **Non fait** : l'essai depuis l'écran du POS, et la suite pgTAP
complète hors CI.
**En production depuis le 2026-11-14 au soir**, en phase additive, boutique
fermée : la version nouvelle de la fonction de paiement est créée, corps et
droits égaux au dev, puis l'Edge Function `process-payment` est redéployée sur
les fichiers de `master`. **L'ancienne version reste en place** : elle est
retirée après les premières ventes réelles sur la nouvelle. Relevé dans
`docs/runbooks/etat-environnements.md`, section du 14 novembre au soir.

**Fichiers**
- `supabase/migrations/<nouveau>` — bump de la fonction de paiement :
  plafonner la remise de ligne au sous-total serveur de **cette** ligne
  (**partir du corps live**)
- `supabase/functions/process-payment/` — **redéployer après le bump**
- `supabase/tests/`

**Preuve** — pgTAP : une remise supérieure au sous-total de la ligne est
refusée ; une remise égale passe ; une remise à zéro passe. Puis en dev, au POS,
tenter la même chose depuis l'écran.

**Attention** — Un bump de fonction de money-path **exige** le redéploiement de
l'Edge Function qui l'appelle. C'est un oubli récurrent du projet.

---

### `[S1-10]` Corriger l'inventaire tournant

**Risque prod** 🔴
**Source** — Arbitrages §2bis lot 4 (quantité absolue, conforme à l'ADR-027) et
lot 7 (le propriétaire peut finaliser ce qu'il a compté).

**Fichiers**
- `supabase/migrations/20261108000025_production_precision_opname.sql` — point de
  départ, **ne pas éditer**
- `supabase/migrations/<nouveau>` — la finalisation **pose** le stock à la
  quantité comptée au lieu d'appliquer l'écart
- `supabase/migrations/<nouveau>` — retirer le refus « a compté » pour le
  propriétaire
- `apps/backoffice/src/features/inventory/` — l'écran d'inventaire
- `supabase/tests/`

**Preuve** — pgTAP : une ligne comptée à 10, avec un stock passé à 7 entre
l'ajout et la finalisation, donne **10** et non 13. Et : le propriétaire
finalise un inventaire qu'il a compté lui-même.

**Note** — La séparation des tâches disparaît de l'inventaire, en connaissance
de cause (arbitrage lot 7).

**État — développé et prouvé en dev le 2026-11-17**, branche
`fix/s1-10-opname-absolu`. Décision gravée dans l'ADR-038. Migration
`20261117000001_finalize_opname_v7_absolute.sql` : nouvelle version de la
famille `finalize_opname`, additive ; l'ancienne reste jusqu'à la publication du
back-office. Preuve pgTAP `opname_finalize_absolute.test.sql`, 17 sur 17 en dev
le 2026-11-17 : compté 10, stock passé de 4 à 7 pendant le comptage, résultat
10 ; inventaire compté et finalisé par le propriétaire. L'écran appelle la
nouvelle version et ne parle plus de revue « indépendante ».
**En production le 2026-11-17** : PR #719 fusionnée, migration présente en
production, back-office publié sur `60c20d79` ; son bundle appelle la nouvelle
version et ne nomme plus l'ancienne. L'ancienne version est retirée le même
soir, en dev puis en production (PR #723, migration
`20261117000004_drop_finalize_opname_v6_balance_sheet_v4.sql`). Relevé dans
`docs/runbooks/etat-environnements.md`, section du 17 novembre. **Non fait** :
un inventaire réel finalisé à l'écran.

---

### `[S1-11]` Ne plus décrémenter un produit non suivi

**Risque prod** 🔴
**Source** — Arbitrage §2bis lot 4. Un produit dont le suivi est désactivé voit
quand même son compteur décrémenté à la vente : la valeur devient fantôme, et un
produit non suivi est **déjà en négatif** en production.

**État — en production le 2026-11-14**, PR #703, migration
`20261114000004_untracked_products_keep_counter_on_sale.sql` appliquée sur les
deux bases ; relevé avant et après dans `../runbooks/etat-environnements.md` :
47 produits non suivis à compteur non nul, dont un négatif, inchangés. Reste à
constater une vente réelle d'un produit non suivi. Trois helpers internes du
chemin de vente sont remplacés en place : vente, restitution (annulation et
remboursement) et perte sur commande annulée. Le compteur d'un produit non suivi
ne bouge plus ; le mouvement de stock reste écrit, il porte le coût des ventes.
**Décision de Mamat du 2026-11-14** : les compteurs déjà dérivés restent tels
quels, aucun mouvement de correction (47 produits non suivis à compteur non nul
en production ce jour-là, un seul négatif). **Écart avec la décision S09**, qui
disait la garde B2B sur produit non suivi « sans objet » : elle ne l'était pas,
un produit non suivi à compteur nul aurait bloqué toute commande B2B. Elle est
limitée aux produits suivis, comme le dit ADR-036. pgTAP :
`supabase/tests/untracked_counter_on_sale.test.sql`, 9 assertions, 4 rouges
avant la migration et 9 vertes après, sur dev ; T14 de
`sale_stock_unification.test.sql`, qui encodait l'ancien décrément, est mis à
jour.

**Fichiers**
- `supabase/migrations/<nouveau>` — rendre la décrémentation conditionnelle au
  drapeau de suivi (**partir du corps live** de la primitive d'écriture)
- `supabase/migrations/<nouveau>` — remettre à zéro, ou neutraliser, le compteur
  des produits non suivis déjà dérivés
- `supabase/tests/`

**Preuve** — pgTAP : vendre un produit non suivi ne change pas son compteur ;
vendre un produit suivi le change. Relevé en production des produits non suivis
dont le compteur est non nul, avant et après.

---

### `[S1-12]` Faire relire les prix serveur par le moteur de promotions

**Risque prod** 🔴 — **prérequis à la création de la première promotion ciblée.**
**Source** — Arbitrage §2bis lot 5. Audit 01 §5.3 : une promotion ciblée produit
ou catégorie calcule sa remise sur le prix **envoyé par la caisse**, et le
contrôle de cohérence compare deux valeurs issues de ce même prix — il ne détecte
rien. Zéro promotion active aujourd'hui : la faille est **dormante**.

**État — développé et prouvé en dev le 2026-11-14**, dans le lot money-path
(branche `fix/lot-money-path-s1-09-s1-12`, même migration que `S1-09`) ; en
production depuis le 2026-11-14 au soir, avec `S1-09`. **Écart avec la liste de fichiers ci-dessous**, relevé
sur les corps live : la fonction d'évaluation n'est pas bumpée. La faille
tenait à son appelant — la vente directe lui passait les articles au prix
envoyé par la caisse. Elle les lui passe maintenant au prix résolu par le
serveur, la même base que le sous-total qu'elle lui donnait déjà. L'appel
direct de la fonction d'évaluation par la caisse ne sert qu'à l'aperçu : la
porte d'argent est le paiement. Le paiement d'une commande déjà créée était
conforme, il évalue depuis les lignes enregistrées. pgTAP du même fichier que
`S1-09` : prix client falsifié à 100 000 avec une remise déclarée de 10 000 →
refusé ; avec 1 000 → accepté, 1 000 appliqués. Relevé de production du même
jour : aucune promotion n'existe.

**Fichiers**
- `supabase/migrations/<nouveau>` — bump de la fonction d'évaluation des
  promotions : relire les prix côté serveur
- `supabase/migrations/<nouveau>` — bump de la fonction de paiement si son
  contrôle de cohérence change
- `supabase/functions/process-payment/` — **redéployer**
- `packages/domain/src/promotions/` — le moteur local de repli : il ignore les
  plafonds d'usage **par conception**, ne pas « corriger » cela
- `supabase/tests/`

**Preuve** — pgTAP : une promotion de 10 % sur un produit à 10 000 IDR, appelée
avec un prix client falsifié à 100 000 IDR, applique **1 000** et non 10 000.

**Note** — Ne créer **aucune** promotion ciblée produit ou catégorie en
production avant que cette tâche soit livrée.

---

### `[S1-13]` Fermer les deux injections PostgREST

**Risque prod** 🔴
**Source** — Audit 02, P0 de sécurité : deux constructions de filtre `or=`
concatènent une saisie utilisateur sans échappement.

**État — développé le 2026-11-12**, branche `fix/lot-auth-s1-07-s1-13`,
front seulement, **non publié**. Relevé du code ce jour-là : **trois** sites
et non deux — la liste des fournisseurs, la liste des dépenses, et la recherche
du fournisseur de référence de l'import historique, qui n'échappait rien. Les
deux listes retirent les caractères de structure et les jokers par un helper
commun ; l'import pose deux filtres simples à la place du filtre `or`. Les
autres recherches du back-office nettoyaient déjà leur saisie. Un test par
site, plus ceux du helper ; un test rougit quand on retire le nettoyage.
**Publié en production le 2026-11-12 au soir** avec le back-office de la
PR #695.

**Fichiers** — Les deux sites sont nommés dans
`02_DETTE_TECHNIQUE_ET_NETTOYAGE.md` §4 (recherche de liste côté back-office).

**Travail** — Remplacer la concaténation par un paramétrage, ou échapper
strictement. Ajouter un test par site avec une saisie contenant `,` `)` et `*`.

**Preuve** — Les deux tests passent. Une saisie hostile ne ramène pas de lignes
hors périmètre. Vitest ciblé, avec `--passWithNoTests=false`.

---

### `[S1-14]` Sortir la référence de projet des migrations planifiées

**Risque prod** 🔴 — **prérequis absolu avant toute installation de tâche
planifiée.**
**État — développé et prouvé en dev le 2026-11-14**, branche
`fix/s1-14-cron-project-url`, migration
`20261114000003_cron_edge_function_url_from_vault.sql` appliquée sur la base dev
seulement ; **la production ne l'a pas**. Relevé du même jour : deux tâches
appellent une Edge Function par une adresse en dur (anniversaires et envoi des
notifications) ; la troisième migration citée est celle que la deuxième
corrigeait. Les deux tâches lisent maintenant l'adresse dans un secret Vault
par base, `project_url`. Sans ce secret, elles n'envoient aucune requête. La
migration ne réécrit que les tâches déjà présentes : elle n'en installe aucune
en production, qui en porte 0. Les trois anciennes migrations gardent leur
texte ; rejouées dans l'ordre, elles sont réécrites par la nouvelle. Secret posé
sur dev ; la tâche d'envoi des notifications y a répondu 200 sur l'adresse
lue. pgTAP : `supabase/tests/cron_edge_function_url.test.sql`, 9 assertions
vertes sur dev, dont une adresse d'un autre projet suivie par le helper ; le
test rougit si une tâche reprend une adresse en dur. **En production depuis le
2026-11-14 au soir** (PR #701) : helper égal au dev, aucune tâche installée,
aucun secret, le helper n'y rend donc aucune adresse. **Non fait** : le secret
de production, à poser avec l'installation des tâches. **Limite relevée** :
l'en-tête de la tâche des anniversaires porte un secret fixe, recopié tel quel.
**Source** — Audit 01 §5.5 : trois migrations planifient des tâches dont
l'adresse est **écrite en dur sur le projet de développement**. Inerte
uniquement parce qu'aucune tâche n'est installée en production.

**Fichiers**
- Les trois migrations concernées, nommées dans `01_CARTOGRAPHIE...` §5.5 —
  **ne pas les éditer**
- `supabase/migrations/<nouveau>` — lire l'adresse dans un réglage en base
- `supabase/tests/`

**Preuve** — Aucune occurrence de la référence `ikcyvlovptebroadgtvd` dans une
migration applicable à la production. Une tâche planifiée en dev frappe bien le
projet dev, et la même migration appliquée ailleurs frappe l'autre projet.

**Bloque** — Toute tâche planifiée en production, donc indirectement les vues
matérialisées, la purge du rate-limit et les notifications.

---

### `[S1-15]` Sortir le stock B2B au retrait, non à la saisie

**Risque prod** 🔴
**Source** — Arbitrage `B13`, §2bis lot 5, précisé par Mamat le 2026-11-20
([ADR-044](../adr/044-stock-b2b-au-retrait.md)). Le relevé initial confondait
le statut de paiement « en attente » avec un retrait non effectué : le
2026-11-20, les 85 commandes natives sont toutes retirées ; les 192 imports
financiers sans mouvement de vente sont exclus de toute reprise, comme
confirmé par Mamat ce jour-là.

**Fichiers**
- `supabase/migrations/<nouveau>` — déplacer la déduction vers le retrait,
  ajouter un garde-fou de suffisance au retrait (le stock négatif reste
  **toujours** bloqué en B2B, ADR-036)
- `supabase/migrations/<nouveau>` — état de consommation et préflight des
  commandes natives ; aucune réinjection de stock sans cas identifié
- `apps/backoffice/src/features/btob/components/CreateB2bOrderModal.tsx`
- `apps/backoffice/src/features/btob/components/B2bPickupDialog.tsx`
- `apps/backoffice/src/features/btob/__tests__/create-b2b-order-stock.test.tsx`
  et `b2b-pickup-dialog.test.tsx` — disponibilité informative à la création,
  blocage au retrait et reprise après réponse perdue
- `supabase/tests/`

**Preuve** — pgTAP : créer ou modifier une commande B2B ne bouge pas le stock ;
la disponibilité insuffisante avertit sans bloquer la création. Le retrait
déduit une seule fois et refuse un manque même avec le stock négatif autorisé.
L'annulation avant retrait ne rend rien ; après retrait, elle restitue les
quantités réellement sorties. Imports financiers, vitrine et encours sont
préservés. Relever les commandes natives avant la bascule ; toute reprise de
quantités requiert ses preuves avant/après.

**Attention** — Une reprise de masse du stock de production ne part pas sans
`S1-01`. Le préflight préparé refuse la bascule si une commande native non
retirée à examiner apparaît ; il ne traite jamais un import financier comme
un stock à restituer.

**État — livré en production le 2026-11-20**, PR #753, SHA applicatif
`c51737cf7bc440db5253d02f7b25d40eb89a708c`. CI push `44750342179` et pgTAP
manuel `44750356869` réussis : BO complet 2 599 tests réussis et un ignoré
préexistant ; POS 1 569 réussis ; 388 fichiers pgTAP réussis, sans assertion
ignorée détectée. La voie shared ignore 258 tests live : aucune suite live
n'est réputée validée par ce résultat.

Le BO a été préparé par le workflow protégé `44754730840`, puis le changement
DB a été appliqué atomiquement après gel et drain des anciens appels. Les
85 natives antérieures portent leur marqueur de consommation et 237 groupes
de sorties sont conservés ; aucun import n'est marqué. Les 18 ensembles
d'invariants sont identiques avant/après : aucune reprise de quantités, aucun
changement de coût, vitrine, comptabilité, encours ou import.

Le déploiement préparé a été promu sans reconstruction ; ses 383 fichiers
publics correspondent au manifeste et ciblent uniquement la production V3.
Le warning de stock insuffisant et le bouton de création actif ont été vus
à l'écran sur ce bundle, puis le formulaire fermé sans enregistrer. Le refus
et la déduction au retrait sont vérifiés sur DEV ; aucun retrait réel ni
paiement de test en production, ni deux retraits réellement simultanés, n'ont
été exercés. Décision et coût d'annulation courant préservés. Preuves datées
dans le [runbook des environnements](../runbooks/etat-environnements.md).

---

### `[S1-16]` Régulariser le partitionnement du journal du POS

**Risque prod** 🟠
**Source** — Audit 01 §5.6. Tout part dans la partition par **défaut** depuis le
2026-10-07 : 9 741 lignes, aucune partition pour octobre ni novembre. Créer ces
partitions **échouera** désormais sans déplacer les lignes d'abord.

**Fichiers**
- `supabase/migrations/<nouveau>` — détacher la partition par défaut, créer les
  partitions mensuelles manquantes, replacer les lignes, rattacher
- `supabase/migrations/<nouveau>` — une tâche de création à l'avance (**après**
  `S1-14`)
- `supabase/tests/`

**Preuve** — Les partitions d'octobre et novembre existent et portent leurs
lignes. La partition par défaut est vide. Comptage total **identique** avant et
après.

**Dépend de** — `S1-01`, `S1-14`.

**État — développé et appliqué en dev le 2026-11-18**, branche
`fix/s1-08-s1-16-s1-20-lot`, migration
`20261118000003_s1_16_pos_events_partitions.sql`. Relevé du même jour : 22 889
lignes dans la partition par défaut en production (octobre et novembre), 212 en
dev (octobre). La migration détache la partition par défaut, crée d'octobre 2026
à février 2027 par la fonction qui ferme chaque partition, recrée une partition
par défaut vide et fermée, réinsère les lignes par la table mère, compare le
comptage, puis supprime l'ancienne table par DROP : aucune ligne n'est supprimée
une à une. Essai en transaction annulée, puis application en dev : 212 lignes en
octobre, partition par défaut vide, comptage égal. Une tâche planifiée, sans
adresse ni secret, crée le 20 de chaque mois les partitions des deux mois
suivants. Écart vu par la CI : la fonction de création ne posait pas la règle
de session PIN des tables publiques. La migration
`20261118000004_s1_16_partition_pin_policy.sql` la pose sur chaque partition,
crée la version suivante de la fonction, qui la pose aussi, et y branche la
tâche. Preuve pgTAP `s1_16_pos_events_partitions.test.sql`, 10 sur 10 en dev,
et la garde des règles PIN verte.
**Non fait** : la production, à appliquer boutique fermée (le détachement
bloque l'écriture du journal le temps de la transaction).
**Fusionné le 2026-11-18** : PR #727 (`5665eeb9`). Relevé en production le même
jour à 8 h 35 : 23 028 lignes, toutes dans la partition par défaut ; la
boutique était ouverte. Application prévue après la fermeture, avec l'accord de
Mamat du même jour.
**En production le 2026-11-18 à 19 h 50**, boutique fermée : les deux
migrations sont appliquées. 23 908 lignes avant et après, 0 dans la partition
par défaut ; chaque partition porte la règle PIN ; la tâche planifiée appelle la
version suivante de la fonction, et l'ancienne est retirée. Relevé daté dans
`docs/runbooks/etat-environnements.md`.

---

### `[S1-17]` Désactiver les deux comptes de taxe hors régime

**Risque prod** 🟠
**Source** — Arbitrage §2bis lot 6. `2143` est actif, postable, cible d'aucun
mapping ; `2142` « VAT Output » est actif, postable, et agrégé au bilan avec la
taxe à payer — dans un plan **NON-PKP**.

**État — développé en dev le 2026-11-11**, dans le lot comptable (PR #692),
migration `20261111000012_reserve_tax_accounts_2142_2143.sql`. **Écart avec le
constat ci-dessus**, relevé le même jour en dev et en production : les deux
comptes étaient **déjà inactifs**, sans aucune ligne ni mapping. La migration
les rend en plus non postables et dit pourquoi dans leur libellé. **Non fait** :
la fonction du bilan nomme encore leurs codes (sans effet tant qu'ils ne
portent aucune ligne), et rien n'interdit de les réactiver comme c'est le cas
pour `1151`. **En production depuis le 2026-11-11.**

**Fichiers**
- `supabase/migrations/20260603000021_deactivate_account_1151_non_pkp.sql` —
  **le modèle à suivre**, ne pas éditer
- `supabase/migrations/<nouveau>` — même geste pour `2142` et `2143`
- `supabase/tests/`

**Preuve** — pgTAP : les deux comptes sont inactifs et non postables. Le bilan
ne les agrège plus. Aucun mapping ne les cible.

---

### `[S1-18]` Fermer la liste des motifs de perte

**Risque prod** 🟠
**Source** — Arbitrage §2bis lot 4. La production a une liste fermée de 6
motifs ; le stock et la vitrine utilisent du **texte libre**.

**État — en production le 2026-11-15**, PR #706. Migrations
`20261114000005_waste_reason_loss_values.sql` et
`20261114000006_loss_reason_closed_list.sql` appliquées sur les deux bases. En
production, le 2026-11-15, en trois temps : la base a reçu les valeurs, les
colonnes et les nouvelles fonctions sans le retrait des anciennes ; le
back-office a été publié depuis `master` à `f46a4eeb` ; le paquet de la caisse
`f46a4eeb` a été installé en boutique, puis les huit anciennes versions ont été
retirées. La liste fermée s'impose depuis ce retrait. **Reste à constater** :
une perte saisie à l'écran, sur la caisse et sur le back-office, et une
impression après l'installation. Relevé :
`docs/runbooks/etat-environnements.md`. **Décision de Mamat du
2026-11-14** : le type `waste_reason` reçoit `expired`, `leftover`, `damaged`
et `other`, liste commune à la production, au stock et à la vitrine ; les
pertes passées gardent leur texte, sans motif, et se lisent « non précisé ».
Aucune ligne existante n'est réécrite. Toutes les pertes de stock et de
vitrine passent par la déclaration de stock : le motif y est exigé, avec une
note facultative, obligatoire pour `other`. Les familles `waste_stock`,
`waste_display_stock`, `submit_stock_declaration`, `adjust_stock`,
`submit_display_day_closing`, `get_display_day_closing` et
`correct_display_day_count` passent à leur version suivante, les anciennes
sont retirées. Le back-office (perte de stock, déclarations, revue du comptage)
et le POS (perte de vitrine, comptage du jour) proposent la liste. pgTAP :
`supabase/tests/loss_reason_closed_list.test.sql`, 24 assertions vertes sur
dev avant les corrections de revue ; les cas du comptage du jour sont dans
`antifraud_display_day.test.sql`. **Limites** : les écrans n'ont pas été vus
dans un navigateur ; aucune contrainte de table n'impose le motif (les pertes
en attente d'avant n'en ont pas et leur approbation les met à jour) ; une
caisse mise à jour avec un comptage en attente dont la première tentative a
abouti garde cette tentative en attente pour ce jour-là ;
`types.generated.ts` ne reçoit que le delta du lot, une régénération complète
depuis la base dev y ajoute des objets d'autres branches. **Livraison** : faite en
application additive d'abord, le retrait des anciennes fonctions après la
publication du back-office et l'installation du paquet de la caisse.

**Fichiers**
- `supabase/migrations/<nouveau>` — étendre un type énuméré aux deux chemins
- Les fonctions d'écriture de perte de stock et de vitrine (**corps live**)
- L'écran de perte de stock du back-office et celui de vitrine
- `supabase/tests/` et les tests Vitest des deux écrans

**Preuve** — pgTAP : un motif hors liste est refusé. Les deux écrans proposent
une liste et non un champ libre. Les 8 pertes de vitrine et les pertes de stock
existantes sont **rattachées** à un motif, ou une valeur de reprise est créée et
documentée.

---

### `[S1-19]` ~~Fermer la faille HTTP en clair de la coquille Android~~ — **RETIRÉE**

**Cette tâche décrivait un défaut qui n'existe pas.** Retirée le 2026-11-09, à
l'audit agents précédant l'ouverture de la PR. Conservée ici pour que personne ne
la réintroduise.

**Ce que j'avais écrit** — « la coquille Capacitor autorise encore le trafic en
clair vers `192.168.1.92`, alors que l'ADR-034 impose HTTPS et WSS », classé
🔴 à corriger en sprint 1.

**Ce que disent les sources**
- `apps/pos/android/app/src/main/res/xml/network_security_config.xml` refuse le
  trafic en clair **par défaut** et n'autorise qu'une **liste d'hôtes nommés** :
  `localhost`, `127.0.0.1`, `10.0.2.2` (développement) et le seul hub de la
  boutique. Aucun `cleartextTrafficPermitted="true"` global, aucune plage.
- `apps/pos/capacitor.config.ts` **ne pose pas** `cleartext` et explique
  pourquoi : ce réglage est celui du rechargement à chaud et la doc Capacitor le
  déconseille en production.
- L'**ADR-029 est ACTÉ** (2026-08-22) et cette autorisation étroite est
  exactement ce qu'il demande, sa conséquence 1 exigeant qu'elle reste étroite.
  `androidScheme: 'http'` est là pour que le bus LAN en `ws://` passe : une page
  servie en `https` ne peut pas l'ouvrir. Le retirer recréerait la panne que
  l'ADR-029 cite comme argument décisif du passage au natif — **la cuisine ne
  reçoit plus rien dès qu'internet tombe**.
- L'**ADR-034 porte le statut « projet, texte à valider »**, et non « acté ». Il
  prévoit bien HTTPS/WSS sur le LAN, mais subordonne sa mise en production à un
  certificat accepté par les terminaux, un compte de service, des ACL système et
  **une mise à jour coordonnée des terminaux**. Il écrit lui-même qu'il
  n'autorise « aucun déploiement production ni installation boutique ».

**Conclusion** — Il n'y a pas d'écart à corriger, et surtout pas en sprint 1. Le
passage du LAN en HTTPS/WSS est un **chantier entier**, gouverné par l'ADR-034 et
sa spécification d'exécution `docs/specs/006x-lan-device-security.md` (vivante).
Retirer l'autorisation en clair **seule** casserait la cuisine en coupure.

**Leçon** — Un titre d'ADR n'est pas un périmètre, et un ADR en statut *projet*
n'impose rien. `AGENTS.md` le dit : « On ne déclare pas un ADR applicable sans
avoir lu son corps. » J'avais opposé l'ADR-034 au code sans lire ni son statut
ni ses conditions.

---

### `[S1-20]` Graver les règles qui ne vivent que dans des commentaires

**Risque prod** 🟢
**Source** — Arbitrages §2bis lots 3, 4, 6. Trois règles métier opposables
n'existent aujourd'hui que dans un commentaire de fonction ou de migration :
invisibles à tout contrôle, perdues au premier bump.

**Fichiers**
- `docs/adr/00XX-exoneration-pb1-ventes-b2b.md` — la vente B2B n'est pas
  assujettie à la PB1
- `docs/adr/00XX-circuit-declaration-approbation-stock.md` — les ajustements et
  pertes passent par déclaration puis approbation, par une personne différente
  du déclarant, **plus la cadence de traitement de la file** (3 déclarations sont
  en attente : les traiter)
- `docs/adr/00XX-comportement-cout-moyen-pondere.md` — le coût moyen se
  **réinitialise** sur stock nul ou négatif, et se pondère contre le stock **au
  moment de la saisie**, pas à la date de réception

**Preuve** — Les 3 ADR sont rédigés, relus en contexte vierge, et référencés
depuis `../SPECS_OFFICIELS_ERP_POS.md`. Les 3 déclarations en attente sont
traitées. `node scripts/ci/relative-links.mjs` vert.

**État — rédigé le 2026-11-18**, branche `fix/s1-08-s1-16-s1-20-lot` :
`../adr/040-exoneration-pb1-ventes-b2b.md`,
`../adr/041-circuit-declaration-approbation-stock.md`,
`../adr/042-comportement-cout-moyen-pondere.md`, référencés depuis les règles
correspondantes de `../SPECS_OFFICIELS_ERP_POS.md`. Écart signalé : les
décisions ne sont pas aux lots 3, 4 et 6 cités en source, mais au lot 2
(`G04`), au lot 10 (`S06`) et au bloc documentaire du §13 (`P01`, `P03`) du
registre ; les ADR citent ces sources. **Non fait** : la cadence de traitement
de la file des déclarations, qu'aucune décision ne fixe, et le traitement des 3
déclarations en attente, geste de Mamat.
**Fusionné le 2026-11-18** : PR #727 (`5665eeb9`) ; les trois ADR sont sur
`master`.

---

### `[S1-21]` Imprimer une addition chiffrée avant paiement, sur l'imprimante choisie

**Risque prod** 🟠 — écran et ticket en service, aucune écriture d'argent.

**État — code fusionné le 2026-11-09** (PR #669), **installé le 2026-11-10** :
paquet `a35fd5f5` en service sur le PC boutique (pont d'impression et POS,
contrôlé sur les deux origines) et tablettes en 1.21. Relevés datés dans
`../runbooks/etat-environnements.md`. Rechargement de la page de la caisse non
confirmé. La preuve sur papier reste à faire.

**Source** — Demande de Mamat du 2026-11-09, **à prioriser** : présenter
l'addition au client avant qu'il paie. Règle et intention dans
`../SPECS_OFFICIELS_ERP_POS.md`, section 7.

**Constat** (code de `master`, 2026-11-09)
- Le bouton d'addition de la caisse choisit l'imprimante **tout seul** : une
  commande de table ou reprise part sur l'imprimante des serveurs, les autres sur
  celle de la caisse. Personne ne peut choisir.
- Les lignes envoyées à l'impression ne portent **aucun prix**. Les totaux
  (sous-total, taxe, total) sont envoyés, mais le rendu du pont d'impression
  **ne les imprime pas** : l'addition sort comme un ticket serveur, avec le nom
  du rôle en titre, et « Table N » ou « Walk-in » à la place d'un numéro de
  commande.
- La tablette des serveurs n'a **aucun** bouton d'addition.

**Fichiers**
- `apps/pos/src/features/cart/hooks/usePrintBill.ts` et `PrintBillButton.tsx` —
  contenu de l'addition et choix de l'imprimante
- `apps/print-bridge/src/render/stationTicket.ts` — rendu, qui ignore les prix
  et les totaux
- `packages/domain/src/printing/payloads.ts` — format du ticket
- `apps/pos/src/features/tablet/` — l'addition part **aussi** de la tablette des
  serveurs (tranché par Mamat le 2026-11-09)

**Travail** — Ajouter le prix de chaque ligne et les totaux à l'addition, avec
un titre d'addition et la mention qu'elle ne vaut pas reçu. Laisser choisir
l'imprimante, caisse ou serveurs, au moment d'imprimer. Offrir la même action
sur la tablette des serveurs. Les montants doivent
être **ceux que la caisse encaissera** : réutiliser le calcul de ligne du
domaine, jamais une recomposition locale (garde `line-total-formula`).

**Preuve** — Tests du rendu et du contenu de l'addition. Une addition imprimée
**sur papier** depuis chacune des deux imprimantes, comparée au total encaissé
de la même commande.

**Dépend de** — rien.

---

### `[S1-22]` Régler le nombre d'exemplaires du ticket serveur

**Risque prod** 🟠 — ticket en service, aucune écriture d'argent.

**État — fusionné et base de production à jour le 2026-11-09** (PR #670) :
colonne et fonction présentes en production, égales au dev. **Écrans installés
le 2026-11-10** : back-office publié sur `a35fd5f5` (réglage passé à 2 copies par
Mamat), paquet `a35fd5f5` en service sur le PC boutique, tablettes en 1.21.
Relevés datés dans `../runbooks/etat-environnements.md`. La preuve sur papier
reste à faire.

**Source** — Demande de Mamat du 2026-11-09, **à prioriser**. Règle et intention
dans `../SPECS_OFFICIELS_ERP_POS.md`, section 7.

**Constat** (code de `master`, 2026-11-09) — Le nombre d'exemplaires se règle
déjà **par poste de préparation** (cuisine, barista, vitrine), dans les réglages
d'impression du back-office. Le ticket récapitulatif envoyé à l'imprimante des
serveurs sort, lui, en **un seul exemplaire**, écrit en dur — que la commande
parte de la tablette ou de la caisse.

**Fichiers**
- `apps/pos/src/features/tablet/hooks/printTabletTickets.ts`,
  `apps/pos/src/features/cart/hooks/useFireToStations.ts` et
  `apps/pos/src/features/cart/hooks/printPaidSnapshot.ts` — les trois envois de
  l'exemplaire unique du ticket serveur *(le troisième relevé le 2026-11-09)*
- `apps/pos/src/features/settings/hooks/useKotCopies.ts` — lecture des réglages
- `apps/backoffice/src/pages/settings/SettingsPrintingPage.tsx` — l'écran de
  réglage
- `supabase/migrations/<nouveau>` — une colonne de réglage, sur le modèle des
  copies par poste, et une fonction d'écriture **dédiée**. *(Corrigé le
  2026-11-09 : la version suivante des familles `set_setting` et `get_settings`
  devait supprimer les versions en service, que le POS de la boutique appelle
  encore ; l'ajout dédié ne retire rien.)*

**Travail** — Ajouter le réglage, sur le modèle exact des copies par poste
(valeur par défaut 1, zéro autorisé pour couper le papier : tranché par Mamat
le 2026-11-09), et l'appliquer aux **trois** envois : depuis la tablette,
depuis la caisse, et à l'impression d'une commande payée avant tout envoi.

**Preuve** — pgTAP sur la colonne et ses bornes. Tests du nombre de tickets
émis. Types régénérés. Deux exemplaires constatés **sur papier** après réglage.

**Dépend de** — rien.

---

# Sprint 2 — Nettoyage du code abandonné

> Objectif : supprimer ce que Mamat a explicitement écarté, et découper les
> fichiers monolithiques. Aucun comportement voulu ne change.

---

### `[S2-01]` Retirer la mécanique de lots et de péremption

**Risque prod** 🔴 — **la plus délicate du sprint : elle touche la primitive qui
écrit tous les mouvements de stock.**
**Source** — Arbitrage §2bis lot 4, qui confirme l'ADR-004 : **pas de dates de
péremption, pas de consommation premier entré premier sorti.**

**Fichiers**
- `supabase/migrations/<nouveau>` — retirer le bloc de résolution de lot de la
  primitive d'écriture de mouvement (**corps live**, c'est un bump de money-path
  indirect)
- `supabase/migrations/<nouveau>` — retirer la création de lots déclenchée par la
  durée de conservation, à la réception et à la fournée
- `packages/domain/src/inventory/expiry/fifo.ts` — **à supprimer**, avec ses
  tests
- `packages/domain/src/inventory/index.ts` — retirer l'export
- `apps/pos/src/features/products/hooks/useActiveLotsByProduct.ts` — **à
  supprimer** ; retirer la lecture 60 s et la désactivation de tuile des deux
  grilles du POS
- `apps/backoffice/src/features/inventory/hooks/useStockLots.ts` — **à
  supprimer**, ainsi que l'écran des lots expirants et sa route
- `supabase/tests/` — l'invariant pgTAP nommé dans l'en-tête de `fifo.ts` devient
  caduc : le remplacer par l'invariant inverse

**Travail** — **Décider du sort des 21 lots actifs** avant de supprimer quoi que
ce soit. Trois options : garder la table en lecture seule, archiver puis
supprimer, ou supprimer. **Cette décision appartient à Mamat.**

**Preuve** — pgTAP : un mouvement de sortie ne consulte plus aucun lot. Aucune
occurrence de `stock_lots` dans `apps/` ni dans `packages/domain`. Suite
back-office complète verte. Suite POS en CI verte. Relevé du stock avant et
après, inchangé.

**Note** — `packages/supabase/src/types.generated.ts` cite `stock_lots` : c'est
un fichier **généré**, il se régénère, on ne l'édite pas.

**État — développé et prouvé en dev le 2026-11-18**, branche
`chore/s2-retrait-lots`, migration `20261118000006_s2_01_retire_stock_lots.sql`,
commune à `S2-02` et `S2-08`. **Sort des lots** : l'ADR-004 l'a déjà tranché —
« conserver `stock_lots` dormante (pas de DROP) » —, la table et ses lignes
restent donc en lecture seule (41 lots actifs en production au 2026-11-18, contre
21 au relevé du 2026-11-09). Plus aucune fonction ne lit ni n'écrit la table,
hors le rapport des pertes qui affiche le lot d'une perte passée. La primitive du
ledger et la fonction interne de production sont remplacées en place (aucun
grant à `authenticated`, aucun appel applicatif), la primitive refuse désormais
un lot fourni ; la réception de bon de commande, l'annulation de production et le
tableau de bord produit passent à une version neuve ; les fonctions de lots et
la tâche planifiée de dev sont retirées. Retirés aussi : le module du domaine,
la lecture POS et la désactivation de tuile des deux grilles. Preuve pgTAP
`s2_01_stock_lots_retired.test.sql`, 20 sur 20 en dev (un lot actif n'est plus
décrémenté par une perte), et tous les fichiers pgTAP retouchés, verts.
**En production le 2026-11-19 vers 0 h 10**, boutique fermée, avec le
back-office de `47ac4756` : versions neuves créées, back-office publié, puis
anciennes versions retirées. Empreintes des fonctions égales au dev ; 41 lots
et le registre du stock intacts. Écart propre à la production : la publication
temps réel de `business_config` y liste ses colonnes, et la liste a été reprise
moins la colonne retirée. Relevé daté dans `docs/runbooks/etat-environnements.md`.

---

### `[S2-02]` Retirer le suivi des causes d'écart de rendement

**Risque prod** 🟠
**Source** — Arbitrage §2bis lot 9 : l'écran de saisie n'était importé par
personne. Les rapports montreront l'écart **sans** la cause.

**Fichiers**
- `apps/backoffice/src/features/inventory-production/components/YieldVarianceModal.tsx`
  — **à supprimer**
- `apps/backoffice/src/features/inventory-production/__tests__/YieldVarianceModal.smoke.test.tsx`
  — **à supprimer**
- Les deux autres composants de la même famille, nommés dans
  `02_DETTE_TECHNIQUE...` (liste des orphelins)
- Le réglage `production_yield_variance_threshold_pct` en base
- `apps/backoffice/src/features/reports/hooks/useProductionYield.ts` — vérifier
  qu'il ne lit pas la cause

**Preuve** — Aucune référence restante. Le rapport de rendement affiche l'écart.
Suite back-office complète verte.

**État — non commencée, écart signalé le 2026-11-18.** Le relevé du jour
contredit la source : la fenêtre de saisie de la cause est **importée** par le
formulaire de production, qui l'ouvre quand l'écart dépasse le seuil et envoie
la cause à la fonction d'enregistrement de la production. La retirer change ce
parcours et la fonction d'écriture du stock de production : la tâche ne tient
pas dans un lot de nettoyage et part seule.
**Développé et prouvé en dev le 2026-11-18**, dans le lot de `S2-01` (même
fonction de production touchée). Retirés : la fenêtre de saisie et son test, le
seuil et sa lecture dans le formulaire, le motif des deux points d'appel de la
production, la colonne de motif, la tuile « Variances explained » et l'export du
motif dans le rapport de rendement, et la colonne de seuil en base. Le formulaire
affiche toujours l'écart. Relevé du jour en production : aucune des 898
productions ne porte de motif. Écarts : la source cite « deux autres composants
de la même famille », que `02_DETTE_TECHNIQUE...` ne nomme pas et qu'aucun
fichier ne porte ; la fonction de production accepte encore un motif (paramètre
de sa signature, aucun appelant ne l'envoie) et le rapport d'efficacité de
production expose encore un indicateur « motifs présents », servi par sa fonction
de lecture. Ces deux restes partent au prochain changement de version de chaque
fonction.
**En production le 2026-11-19 vers 0 h 10**, avec `S2-01` : colonne de seuil
retirée, back-office de `47ac4756` publié.

---

### `[S2-03]` Retirer la réservation de stock

**Risque prod** 🟢
**Source** — Arbitrage §2bis lot 4. Table, fonctions, module de calcul et deux
filtres d'écran qui ne ramènent **jamais** rien.

**Fichiers**
- `packages/domain/src/inventory/reservations/` — **le dossier entier**
- `packages/domain/src/inventory/index.ts` — retirer l'export
- `supabase/migrations/<nouveau>` — supprimer la table et les fonctions
- Les deux filtres d'écran, nommés dans `02_DETTE_TECHNIQUE...`

**Preuve** — Aucune référence. Types régénérés. Suites vertes.

**État — développé et prouvé en dev le 2026-11-18**, branche
`chore/s2-nettoyage-lot`, migration
`20261118000005_s2_retire_abandoned_objects.sql`, commune à `S2-03`, `S2-04`,
`S2-05` et `S2-09`. Relevé du jour : 0 réservation en dev et en production, aucun
mouvement de réservation dans les deux bases, aucune tâche planifiée en
production. Retirés : la table, la vue de disponibilité qui la lisait, les cinq
fonctions (dont celle du schéma privé du stock) et la tâche planifiée de dev ;
le module de calcul du domaine ; les deux options du filtre de type de
mouvement. Les deux valeurs de réservation **restent** dans l'énumération des
mouvements : le registre du stock ne perd aucune valeur. Preuve pgTAP
`s2_retired_objects.test.sql`, 18 sur 18 en dev, et quatre fichiers allégés des
cas devenus caducs, verts.
**Fusionné le 2026-11-18** : PR #729 (`a2d3a285`), CI verte. **En production le
même jour vers 11 h** (UTC+8), pour `S2-03`, `S2-04`, `S2-05` et `S2-09` : relevé
refait juste avant (mêmes signatures, 0 ligne, aucune dépendance cachée), essai
en transaction annulée, puis migration appliquée. Après : 160 permissions, aucun
des objets retirés, `mv_stock_variance` et les deux valeurs d'énumération
conservées. Le back-office servi n'appelait aucun objet retiré. Back-office
`a2d3a285` publié vers 12 h 53 (textes `S2-10` servis). Relevé dans
`../runbooks/etat-environnements.md`, section du 18 novembre à 11 h.

---

### `[S2-04]` Retirer le planning de production hebdomadaire

**Risque prod** 🟢
**Source** — Arbitrage §2bis lot 9 : table et fonction sans aucun appelant,
**zéro ligne** en production.

**Fichiers** — `supabase/migrations/<nouveau>`.
**Preuve** — Comptage à zéro confirmé en production **avant** la suppression.
Types régénérés.

**État — développé et prouvé en dev le 2026-11-18**, même migration que
`S2-03`. Comptage à zéro relevé en production le même jour, avant toute
suppression. Retirés : la table, ses deux déclencheurs, la fonction de garde
et la fonction de suggestion.

---

### `[S2-05]` Retirer les deux vues matérialisées mortes

**Risque prod** 🟢
**Source** — Arbitrage §2bis lot 10 : `mv_sales_daily` et `mv_pl_monthly` ne sont
**jamais peuplées** et aucune fonction applicative ne les lit. La tendance de
rentabilité sur 12 mois est abandonnée.

**Fichiers** — `supabase/migrations/<nouveau>`.
**Preuve** — Aucune fonction applicative ne les référence (relevé joint). Elles
n'existent plus. Types régénérés.

**Note** — Les supprimer **évite** qu'un futur rapport s'y branche et échoue
silencieusement.

**État — développé et prouvé en dev le 2026-11-18**, même migration que
`S2-03`. Relevé du jour : non peuplées en production ; en dev, peuplées par
deux tâches planifiées, et lues par aucune fonction applicative. Retirées avec
leurs deux fonctions de rafraîchissement et ces deux tâches. La vue du stock
`mv_stock_variance`, vivante, reste.

---

### `[S2-06]` Retirer le troisième palier de prix par catégorie

**Risque prod** 🟠
**Source** — Arbitrage §2bis lot 8. `product_category_prices` est câblé et
**vide**. Piège signalé : il s'édite depuis la fiche d'**un** client alors qu'il
s'applique à **toute** sa catégorie.

**Fichiers**
- `supabase/migrations/<nouveau>` — retirer le palier de la résolution de prix
  (**corps live**, money-path)
- `supabase/functions/process-payment/` — **redéployer**
- L'onglet de la fiche client qui l'édite
- `supabase/tests/`

**Preuve** — pgTAP : la résolution de prix reste négocié → catégorie → public, le
palier retiré ne change aucun prix. Comptage à zéro confirmé en production avant
suppression.

---

### `[S2-07]` Retirer l'interrupteur « produit test »

**Risque prod** 🟢
**Source** — ADR-035, confirmé §2bis lot 10. Un crochet orphelin.
**Fichiers** — le crochet nommé dans `02_DETTE_TECHNIQUE...` (liste des
orphelins).
**Preuve** — Aucune référence. Suites vertes.

**État — développé le 2026-11-18**, branche `chore/s2-nettoyage-lot` : le
crochet `useSetProductTestFlag.ts` est supprimé, sans importeur. Le drapeau, sa
fonction serveur et l'exclusion des rapports restent, comme l'ADR-035 le
décide.

---

### `[S2-08]` Retirer le rapport de rotation des périssables

**Risque prod** 🟢
**Source** — Arbitrage §2bis lot 4. Sa route survivait à la décision ADR-004.
**Fichiers** — la route et sa tuile de hub, nommées dans `01_CARTOGRAPHIE...` §4.
**Preuve** — Le hub passe de 45 à 44 tuiles. Aucune route morte.
**Dépend de** — `S2-01`.

**État — développé et prouvé en dev le 2026-11-18**, dans le lot de `S2-01`.
La tuile avait déjà quitté le hub le 2026-08-22 ; restaient la route, la page, sa
fonction de lecture, son gabarit PDF et l'entrée du générateur de PDF, tous
retirés. Le test du hub compte toujours ses tuiles sans elle.
**En production le 2026-11-19 vers 0 h 10**, avec `S2-01` : fonction de lecture
retirée, back-office de `47ac4756` publié.

---

### `[S2-09]` Retirer les trois permissions qui ne gardent rien

**Risque prod** 🟠
**Source** — Audit 01 §5.1 : `audit_log.read`, `users.view_audit` et
`settings.kiosk.manage` ne contrôlent **aucun** objet.

**Fichiers**
- `supabase/migrations/<nouveau>` — retirer du catalogue et des attributions
- `supabase/tests/`

**Preuve** — Le catalogue passe de 162 à 159 permissions. Relevé des attributions
retirées, par rôle, joint à la PR. **Vérifier d'abord** qu'aucune policy ni
fonction ne les cite.

**Dépend de** — `S1-08` : ne pas retirer une permission avant d'avoir fini de
redistribuer les contrôles.

**État — développé et prouvé en dev le 2026-11-18**, même migration que
`S2-03`. Relevé du jour : aucune règle d'accès ni aucune fonction ne cite les
trois codes, en dev ; en production, chacun est attribué au seul rôle
SUPER_ADMIN, sans exception par compte. Le catalogue de production compte 163
permissions (la permission des états financiers de `S1-08` s'y est ajoutée) :
il passera à 160. Retirés aussi de la liste des codes du paquet partagé et de
la base de départ. Les paquets de `S1-08` qui redistribuent les contrôles sont
en production ; les fonctions d'écriture restantes de `S1-08` ne citent aucun
des trois codes.

---

### `[S2-10]` Retirer la promesse de notification par e-mail

**Risque prod** 🟢
**Source** — Arbitrage §2bis lot 10. Les deux Edge Functions ne sont **pas
déployées**, aucune clé de prestataire n'est posée, les tables sont vides. **Le
code reste dormant** ; c'est la *promesse* qu'on retire.

**Fichiers**
- Retirer toute mention d'envoi d'e-mail des documents vivants
- `supabase/functions/notification-dispatch/` et
  `supabase/functions/customer-birthday-notify/` — **conserver**, non déployées
- L'écran qui annonce une alerte par e-mail : retirer la promesse

**Preuve** — Aucun document vivant ne promet un envoi. Aucun écran ne l'annonce.

**État — développé le 2026-11-18**, branche `chore/s2-nettoyage-lot` : les deux
pages de réglage des notifications et des modèles d'e-mail disent désormais
qu'aucun e-mail n'est envoyé ; la checklist du skill de stock aussi. Les Edge
Functions et les tables restent, dormantes.

---

### `[S2-11]` Corriger le miroir d'énumérations

**Risque prod** 🟢
**Source** — Audit 01 §5.10 : le miroir omet quatre valeurs de statut de
commande. La source unique est Postgres.
**Fichiers** — `packages/domain/src/.../enums.ts` (chemin exact dans
`02_DETTE_TECHNIQUE...`).
**Preuve** — Le miroir liste les 6 valeurs réelles. Un test compare le miroir aux
valeurs de l'énumération générée.

**État — développé le 2026-11-18**, branche `chore/s2-nettoyage-lot`. Écart
signalé : le fichier est `packages/supabase/src/enums.ts`, et le défaut ne se
limite pas aux statuts de commande ; le type de commande `b2b`, la plupart des
types de mouvement et le type de fidélité `refund` manquaient aussi. Les sept
listes ne sont plus recopiées : elles dérivent des énumérations générées.
`enums.test.ts` les compare une à une (7 cas verts). Seule la liste des moyens
de paiement a un consommateur, et ses valeurs sont inchangées.

---

### `[S2-12]` Découper les fichiers monolithiques

**Risque prod** 🟠
**Source** — Audit 02 : 11 fichiers au-delà de 500 lignes, dont
`apps/backoffice/src/routes/index.tsx` à **1 278**.

**Fichiers** — Les 11, listés dans `02_DETTE_TECHNIQUE...` §2.

**Travail** — **Un fichier par commit.** Déplacement pur, aucun changement de
comportement. Commencer par la table de routes.

**Preuve** — Chaque fichier sous 500 lignes. Suite back-office complète verte
après **chaque** commit. Le lint-ratchet passe : toucher un vieux fichier le fait
entrer dans le périmètre et **réveille ses erreurs préexistantes** — prévoir le
travail.

**Attention** — Rejouer le lint-ratchet en local se fait **par lots** : `xargs`
sur ~170 fichiers dépasse la limite de ligne de commande Windows et **échoue en
silence**.

---

### `[S2-13]` Nettoyer les 18 fichiers orphelins et les scripts oubliés

**Risque prod** 🟢
**Source** — Audit 02 §3.
**Fichiers** — Les 18, listés dans `02_DETTE_TECHNIQUE...` §3.
**Travail** — Vérifier l'absence d'import **par glob**, jamais depuis un seul
répertoire : un même module a souvent plusieurs dossiers de tests.
**Preuve** — Aucun import. Suites vertes. Relevé joint.

**État — développé et vérifié le 2026-11-17**, branche `chore/s2-13-orphelins`,
base `651fe781`. Écart signalé : la liste des orphelins est au §2 de l'audit 02,
pas au §3 (le §3 traite des doublons). Relevé fait par `git grep` sur tout le
dépôt (apps, packages, scripts, workflows, skills, `.design-sync/`), le jour du
geste.
**Supprimés** (aucun importeur de production) : les 11 du §2.1 —
`useAuthPin`, le `UserPicker` du POS (celui du back-office est vivant et reste),
`CustomerAttachButton`, `DiscountButton`, `LineDiscountButton`,
`CategorySidebar`, le `CategoryPicker` des dépenses, les composants
`CustomerListRow`, `PromotionListRow` et `SupplierListRow` (les **types** du même
nom restent, dans leurs hooks), le dossier `features/devices/` du back-office ;
du §2.2 — `useVoidServerOrder`, `CustomerAttachedBadge`, `HeldOrdersInboxButton`,
le `useCreateCustomer` du POS (celui du back-office reste), `useTabletOffline`
(remplacé par `useTabletConnectionState`) ; du §2.3 — les 4 fichiers de la boîte
de réception tablette : les commandes tablette s'ouvrent depuis la liste des
commandes en attente, qui appelle elle-même `pickup_tablet_order`. Retirés avec
eux : les `vi.mock` de modules supprimés dans deux tests, le bloc de test de
`useTabletOffline`, les deux fichiers de test de la boîte de réception, la ligne
de baseline de la garde 1 devenue sans objet, les mentions dans trois skills et
une eval, et les commentaires qui pointaient vers un fichier supprimé. Reste
inerte : la clé de cache `pending-tablet-orders`, encore invalidée par plusieurs
hooks alors qu'aucune requête ne la porte plus ; sans effet, à retirer au
prochain passage.
**Gardés** : `ServiceSpeedIndicator` + `useServiceSpeed` (fonction écrite et
jamais affichée, à trancher) ; `useStockLots` (relève de `S2-01`, décision des
lots à Mamat) ; `useSetProductTestFlag` (relève de `S2-07`) ; `useUpdateVariant`
(trou de parcours, décision produit) ; `ProductionRecordList` (orphelin assumé) ;
`clearKioskPairing` (export d'un fichier vivant, trou de parcours) ; le composant
`TabletInboxRow` de `packages/ui` (preview versionnée) ; les deux scripts du §9.3
(`uxui-test-data-cleanup.sql` attend la relecture de Mamat,
`prepare-backup-task.ps1` est une procédure manuelle). Restent des mentions
historiques dans `supabase/seed.sql`, une migration et un test pgTAP : zones non
touchées par ce lot.
**Preuves** : typecheck 7/7 ; lint des fichiers modifiés propre ; gardes de
gouvernance vertes ; suite back-office complète 389 fichiers et 2 525 tests
verts, 1 test ignoré (un `it.skip` préexistant de `suppliers-crud.smoke.test.tsx`,
non touché) ; tests POS des dossiers touchés 90 fichiers, 557 tests, 0 ignoré ;
primitives de `packages/ui` 16 fichiers, 52 tests. Suite POS complète : CI
seulement. Revue indépendante : aucun bloquant, remarques corrigées.

---

# Sprint 3 — Features manquantes validées

> Objectif : livrer ce que Mamat a demandé, dans l'ordre base → serveur → écran.
> Rien qui ne soit pas dans ses réponses.

---

### `[S3-01]` Rendre le terminal obligatoire et la session unique par terminal

**Risque prod** 🔴 · **Source** — Arbitrage §2bis lot 2.

**État — développé et prouvé en dev le 2026-11-19**, branche
`feat/s3-sessions-caisse`, lot des sessions de caisse avec `S3-02` et `S3-03`
([ADR-043](../adr/043-sessions-de-caisse-terminal-et-annulation-de-cloture.md)).
Le POS ouvrait sa session par une écriture directe dans `pos_sessions`, terminal
facultatif. Migration `20261119000002_s3_01_open_shift_terminal_required.sql` :
un index unique partiel (une session ouverte par terminal) et la fonction
d'ouverture `open_shift_v1`, qui exige un terminal de caisse actif ; l'exclusion
« une session ouverte par caissier » reste. Migration
`20261119000003_s3_01_revoke_direct_session_insert.sql`, à appliquer en
production après l'installation du paquet caisse : retrait du droit d'écriture
directe. Écran d'ouverture : terminal obligatoire, présélectionné s'il est le
seul, message en clair pour chaque refus. Les 6 sessions historiques sans
terminal (relevé production du 2026-11-19, toutes clôturées, du 31 octobre au
2 novembre) sont **marquées**, non rattachées : rien ne prouve le poste qui les a
ouvertes ; le commentaire de la colonne dit qu'un terminal vide désigne une
session antérieure à la règle. Preuve pgTAP `s3_01_open_shift_terminal.test.sql`,
19 sur 19 en dev le 2026-11-19.
**Après la revue indépendante du même jour** : la migration de retrait retire
aussi la modification et la suppression directes (une clôture ou une remise en
open par écriture directe contournerait `S3-02` et `S3-03`). Décision de Mamat
du 2026-11-19 (ADR-043, point 7) : une session oubliée ne bloque pas le
terminal ; qui détient `pos.session.close_other` la clôture depuis la liste des
sessions en cours, qui montre désormais le code du terminal. `close_shift_v15`
exige cette permission pour la session d'un autre (v14 ne le vérifiait pas), et
l'aperçu de clôture passe en v2 (migration
`20261119000007_s3_01_close_other_shift_preview.sql`, la v1 se retire avec v14).
Sur un refus « terminal occupé » ou « session déjà ouverte », l'écran d'ouverture
relit la session courante.
**Production, relevé du 2026-11-20** (PR #743, fusion dans `master`) :
`20261119000002` et `20261119000007` sont appliquées ; le paquet caisse
`e7c43cfd`, qui ouvre par `open_shift_v1`, est installé sur le poste et la page
de caisse rechargée ; la connexion par PIN est constatée à l'écran
([relevé](../runbooks/etat-environnements.md)). **Non fait** : le retrait
`20261119000003`, qui attend une APK tablette tirée de ce paquet (les tablettes
en 1.23 ouvrent encore par écriture directe) ; l'ouverture d'une session à
l'écran.

**Fichiers**
- `supabase/migrations/<nouveau>` — unicité par terminal, terminal obligatoire
- `supabase/migrations/<nouveau>` — reprise des 6 sessions sans terminal
- `apps/pos/src/features/shift/OpenShiftModal.tsx`
- `apps/pos/src/features/shift/__tests__/OpenShiftModal.denominations.smoke.test.tsx`
- `supabase/tests/`

**Preuve** — pgTAP : ouvrir sans terminal est refusé ; deux sessions ouvertes sur
le même terminal sont refusées ; deux terminaux différents passent. Les 6
sessions historiques sont rattachées ou marquées.

---

### `[S3-02]` Figer les totaux à la clôture de session

**Risque prod** 🔴 · **Source** — Arbitrage §2bis lot 2.

**État — développé et prouvé en dev le 2026-11-19**, même lot que `S3-01`.
Écart signalé au relevé du corps vivant : le rapport Z créé à la clôture
figeait déjà les encaissements par moyen et le chiffre d'affaires dans son
instantané, et le rapport de session les y lisait ; seul le nombre de commandes
restait calculé à la lecture, et rien n'était porté par la session elle-même.
Migration `20261119000004_s3_02_freeze_shift_totals.sql` : trois colonnes sur
la session, renseignées par `close_shift_v15` depuis l'instantané du rapport Z
(les deux portent donc les mêmes sommes), un déclencheur qui refuse de les
réécrire tant que la session reste clôturée, et `get_pos_sessions_report_v5`
qui les lit. Corps repris du vivant ; égalité fichier-base vérifiée par
empreinte sur les trois fonctions. Les sessions clôturées avant la règle gardent
des totaux vides : les recalculer aujourd'hui serait un chiffre du jour présenté
comme figé. Migration `20261119000006_s3_02_retire_close_shift_v14.sql`, après
installation du paquet caisse : retrait de `close_shift_v14` et du rapport v4.
Les versions plus anciennes encore présentes sont de deux sortes (relevé du
2026-11-19) : v10 et v13 sont des enveloppes qui transmettent l'appel à la
version courante, et passent sur v15 ; v12 (et v11 en dev) portent un ancien
corps complet, qui clôturerait sans figer, et perdent leur droit d'exécution
client. Preuve
pgTAP `s3_02_frozen_shift_totals.test.sql`, 20 sur 20 en dev le 2026-11-19, garde
de la clôture d'une autre session comprise.
**Production, relevé du 2026-11-20** : `20261119000004` est appliquée et la
caisse `e7c43cfd` clôture par `close_shift_v15`. **Non fait** : le retrait
`20261119000006`, qui attend la même APK tablette que `S3-01` (la 1.23 clôture
encore par `close_shift_v14`) ; une clôture à l'écran.

**Fichiers**
- `supabase/migrations/<nouveau>` — colonnes de totaux par moyen de paiement,
  chiffre d'affaires, nombre de commandes ; renseignées à la clôture
- `apps/pos/src/features/shift/components/CloseShiftModal.tsx`
- `apps/pos/src/features/reports/POSSessionsReportPage.tsx` et
  `hooks/reportSessions.ts` — lire les totaux figés
- `supabase/tests/`

**Preuve** — pgTAP : après clôture, les totaux figés égalent la somme des
règlements de la session ; une vente ultérieure ne les change pas. Le rapport de
session affiche les valeurs figées.

**Dépend de** — `S3-01`.

---

### `[S3-03]` Permettre d'annuler la dernière clôture de session

**Risque prod** 🔴 · **Source** — Arbitrage §2bis lot 2. Remplace l'état
intermédiaire de recomptage, explicitement abandonné.

**État — développé et prouvé en dev le 2026-11-19**, même lot que `S3-01`.
Précisions de Mamat du même jour, gravées dans
[ADR-043](../adr/043-sessions-de-caisse-terminal-et-annulation-de-cloture.md) :
« la dernière » s'entend par terminal, et un rapport Z signé interdit
l'annulation. Écart signalé : la clôture ne pose pas que l'écriture d'écart ; à
la création du rapport Z, elle règle aussi le tiroir en comptabilité (fond rendu
à la petite caisse, reste en fonds non déposés) et rend la session immuable.
L'annulation défait donc les deux écritures et remet le règlement à faire, sans
quoi la clôture suivante l'aurait compté deux fois. Migration
`20261119000005_s3_03_undo_shift_close.sql` : `undo_shift_close_v1`, réservée au
propriétaire, PIN vérifié avec verrouillage ; contre-passation miroir des deux
écritures, datée du jour ; suppression du rapport Z brouillon, son contenu gardé
dans la trace d'audit avec l'état d'avant de la session. L'index d'idempotence
des écritures n'admet qu'une écriture par type, référence et étiquette : la
contre-passation porte sa propre étiquette, et l'écriture d'origine reçoit une
étiquette « contre-passée », ses montants et ses lignes inchangés.
`close_shift_v15` ignore une écriture d'écart contre-passée. Le rapport de
session du POS montre au propriétaire un bouton d'annulation sur les sessions
clôturées. Preuve pgTAP `s3_03_undo_shift_close.test.sql`, 21 sur 21 en dev le
2026-11-19 : refus (non-propriétaire, PIN absent ou faux, session sans terminal,
session non dernière, rapport Z signé, session ouverte), annulation, chaque
compte touché revenu à zéro, puis reclôture avec ses propres écritures, son
rapport Z et ses totaux.
**Après la revue indépendante du même jour** : décision de Mamat (ADR-043,
point 6), l'annulation est refusée si les fonds non déposés contiennent moins
que ce que la clôture y a mis ; le cas est ajouté au test, joué en dev dans un
passage réduit (15 sur 15), la suite complète du fichier revient à la CI. Le rapport de session
n'affiche plus les comptages de l'ancienne clôture sur une session rouverte.
**Non fait** : la production, l'essai à l'écran ; le PDF du rapport Z brouillon
éventuellement stocké reste dans le stockage ; l'étiquette technique d'une
écriture contre-passée est réécrite, ce qu'un futur verrou d'immuabilité des
écritures devra prendre en compte.
**Écart signalé au relevé de production du 2026-11-19**, avant livraison : la
migration `20261030000007_shift_cash_drawer.sql` (compte « Cash Drawer » 1119,
suivi `shift_cash_treasury`, émission du fond et règlement du tiroir) est
appliquée en dev, jamais en production ; en production, les ventes espèces et
les fonds non déposés partagent le compte 1110. La v1 de l'annulation lisait ce
suivi et ne pouvait pas s'exécuter en production. Migration
`20261119000008_s3_03_undo_shift_close_v2.sql` : `undo_shift_close_v2` lit et
remet à zéro le suivi du tiroir seulement s'il existe ; sans lui, elle
contre-passe l'écart, retire le rapport Z brouillon et rouvre la session. Preuve
pgTAP `s3_03_undo_without_drawer_treasury.test.sql`, qui reproduit l'état de
production dans sa transaction, 10 sur 10 en dev. Le déploiement de la
séparation du tiroir en production reste hors de ce lot : c'est un changement
comptable à décider.
**Production, relevé du 2026-11-20** (PR #744) : `undo_shift_close_v2` et la
fonction de contre-passation qu'elle appelle sont ajoutées, sans
`undo_shift_close_v1`, jamais créée en production ; empreintes égales au dev.
La caisse `e7c43cfd` porte le bouton d'annulation. **Non fait** : une annulation
à l'écran.

**Fichiers**
- `supabase/migrations/<nouveau>` — fonction d'annulation, gatée propriétaire,
  contre-passant l'écriture d'écart et remettant la session en `open`
- `apps/pos/src/features/shift/LastShiftReportButton.tsx` ou un nouveau geste
- `supabase/tests/`

**Preuve** — pgTAP : la dernière session clôturée redevient `open`, l'écriture
d'écart est contre-passée, le journal d'audit porte le geste. Une session **non**
dernière est refusée. Un non-propriétaire est refusé.

**Dépend de** — `S3-02`.

---

### `[S3-04]` Alerter sur une session ouverte depuis plus de 24 heures

**Risque prod** 🟠 · **Source** — Arbitrage §2bis lot 2 : une **alerte**, jamais
une clôture automatique.

**État — développé le 2026-11-18**, lot caisse (branche `feat/s3-lot-caisse`).
La liste des sessions en cours marque une session ouverte depuis plus de 24 h ;
24 h pile ne déclenche rien. Tests du domaine et de la liste verts en local.
Non livré, non vu dans un navigateur.

**Fichiers**
- `apps/pos/src/features/shift/LiveSessionsModal.tsx`
- `apps/pos/src/features/shift/components/VarianceWarningBadge.tsx` — modèle à
  suivre
- `apps/backoffice/src/features/inventory-alerts/components/AlertsBadge.tsx` —
  modèle du côté back-office

**Preuve** — Une session ouverte depuis 25 h affiche l'alerte ; depuis 23 h, non.
Vitest ciblé sur les deux cas. **Aucune** clôture automatique n'existe.

---

### `[S3-05]` Annuler une réception de bon de commande

**Risque prod** 🔴 · **Source** — Arbitrage §2bis lot 9.

**État — développé et prouvé en dev le 2026-11-20**, branche
`feat/s3-05-annulation-reception`. Migration
`20261120000001_s3_05_cancel_goods_receipt.sql` appliquée en dev : fonction
neuve `cancel_goods_receipt_v1` (permission `purchasing.po.cancel`, raison
obligatoire, idempotente). Elle écrit un mouvement `purchase_return` par ligne
reçue, remet le coût moyen par retrait pondéré, contre-passe l'écriture de la
réception (stock crédité sur le compte courant des matières premières, y compris
pour une réception d'avant la régularisation de `S1-05`), recalcule le statut du
bon et trace l'annulation. Refus explicites : stock déjà consommé, paiements
supérieurs au reçu restant, réception d'import historique, double annulation.
Le back-office porte l'action « Cancel receipt » sur chaque réception, affiche
une réception annulée avec sa date et sa raison, et le message d'annulation du
bon dit la vérité. pgTAP `s3_05_cancel_goods_receipt.test.sql` 41/41 en dev (relecture indépendante
appliquée : coût moyen laissé inchangé quand l'article a bougé depuis la
réception, verrous par article dans un ordre fixe, erreur explicite pour une
ligne sans quantité) ;
Vitest 16/16 sur trois fichiers ; suite back-office complète verte. Non publié.
**Limites relevées** :
- une réception payée au comptant est toujours refusée, faute de chemin pour
  annuler un paiement fournisseur ;
- un bon dont toutes les réceptions sont annulées peut être reçu de nouveau,
  mais ni annulé ni modifié (les deux fonctions refusent dès qu'une réception
  existe, même annulée) ;
- les écarts de stock comptent la réception annulée en entrée et son
  annulation en « autre » (net juste) ; le fournisseur suggéré au
  réapprovisionnement peut être celui d'une réception annulée.

**Fichiers**
- `supabase/migrations/<nouveau>` — fonction d'annulation de réception :
  contre-passer le mouvement de stock, le coût moyen et la dette fournisseur
- `apps/backoffice/src/features/purchasing/components/ReceiveDialog.tsx`
- `apps/backoffice/src/features/purchasing/components/CancelDialog.tsx` — son
  message renvoie aujourd'hui vers un retour fournisseur **inexistant**
- `apps/backoffice/src/features/purchasing/hooks/useReceivePurchaseOrder.ts`
- `supabase/tests/`

**Preuve** — pgTAP : après annulation, le stock, le coût moyen et la dette
reviennent à l'état antérieur ; l'écriture comptable est contre-passée ; le
statut du bon redescend. Relevé avant/après des trois valeurs.

**Dépend de** — `S1-05`.
**Limite à écrire** — La marchandise avariée **rendue** au fournisseur reste sans
chemin. C'est assumé (§10 des specs).

---

### `[S3-06]` Ajouter frais de livraison et escomptes aux bons de commande

**Risque prod** 🔴 · **Source** — Arbitrage §2bis lot 9. Une facture avec port ne
peut pas être saisie à son montant réel.

**État — développé et prouvé en dev le 2026-11-20, puis publié en production
le même jour** (voir plus bas), branche `feat/s3-06-po-frais-escomptes`. Migrations `20261120000030` à
`20261120000033` appliquées en dev : colonnes d'escompte (bon et ligne) et de
port, répartition au centime par le plus fort reste, nouvelles versions de la
création, de la modification et de la réception de bon. Le port se saisit tel
que facturé, sans PPN ajoutée ; la PPN porte sur le montant après escomptes. La réception valorise chaque ligne
à sa part du total du bon, port et escomptes compris, en différence cumulée :
les réceptions partielles d'une ligne retombent exactement sur sa part.
L'écriture de réception et l'annulation de réception (`S3-05`) sont inchangées.
pgTAP `s3_06_po_delivery_fee_discounts.test.sql` 36/36 en dev (bon de 3 lignes,
port 30 000 réparti à 30 000,00 exactement, là où un arrondi ligne à ligne
donnerait 30 000,01). Le back-office saisit escompte de ligne, escompte global
et port, affiche le coût par unité et la part de port à la réception ; parcours
création, modification et réception vus au navigateur sur dev.

**Publié en production le 2026-11-20** (PR #752, SHA `536d0e7c`), relevé du
2026-11-21. CI push `44689894681` et pgTAP manuel `44690958668` réussis sur ce
SHA. Étapes additives sans `DROP` appliquées d'abord, back-office publié par le
run `44693948304`, puis retrait des trois anciennes versions
(`s3_06_drop_previous_versions`). Les cinq fonctions du lot ont le même corps et
les mêmes droits qu'en dev. Le back-office servi appelle les nouvelles versions,
aucune ancienne. Le relevé demandé ci-dessous est fait : aucun bon reçu en
partie en production (151 reçus, 2 en attente, 2 annulés). Aucun bon avec port
ou escompte n'a encore été saisi en production : le parcours n'y est pas vu.
Preuves dans le [runbook des environnements](../runbooks/etat-environnements.md).

**Limites relevées** :
- le module `landedCostAllocation.ts` n'est pas utilisé : il répartit en
  flottants sans garantir la somme ; un module voisin exact le remplace ;
- les rapports d'achats par article lisent encore le prix unitaire brut, sans
  escompte ni port ;
- une réception annulée au milieu de réceptions partielles peut décaler d'un
  centime la valeur des suivantes ;
- un bon déjà reçu en partie avant la publication voit ses réceptions suivantes
  calculées par la nouvelle règle : quelques centimes d'écart possibles avec
  son total. Aucun bon dans ce cas en dev le 2026-11-20, ni en production au
  relevé du 2026-11-21.

**Fichiers**
- `supabase/migrations/<nouveau>` — port au niveau du bon, réparti **au prorata**
  sur les lignes ; escompte global et par ligne
- `supabase/migrations/<nouveau>` — l'écriture de réception intègre le port dans
  le coût du stock
- `apps/backoffice/src/features/purchasing/components/POFormDraft.tsx`
- `apps/backoffice/src/features/purchasing/components/ReceiveDialog.tsx`
- `supabase/tests/`

**Preuve** — pgTAP : un bon de 3 lignes avec 30 000 IDR de port répartit
exactement 30 000 IDR, sans perte d'arrondi ; le coût moyen en tient compte ; le
total du bon égale la facture.

**Dépend de** — `S1-05`, `S3-05`.

---

### `[S3-07]` Une seule réponse à « combien je dois à ce fournisseur »

**Risque prod** 🟠 · **Source** — Arbitrage §2bis lot 9. La fiche fournisseur
calcule l'impayé depuis le **statut du bon**, sans lire les paiements : un bon à
crédit entièrement reçu et jamais payé est compté **payé**.

**État — développé le 2026-11-18**, lot back-office (branche
`feat/s3-lot-backoffice`). La tuile « Unpaid », le total payé et les badges de
ligne lisent le journal des paiements avec la règle du rapport, sans plafond de
100 lignes. Un bon non reçu affiche « awaiting receipt ». Le montant « Overdue »
garde sa règle de livraison attendue : non traité. Tests verts en local ; la
comparaison avec le rapport sur un fournisseur de dev reste à faire.
**Fusionnée le 2026-11-18 (PR #739), publiée en production le 2026-11-19 vers
0 h 10** (back-office `47ac4756`). Écran non vu en production.

**Fichiers**
- La fiche fournisseur du back-office et son crochet d'impayé
- `apps/backoffice/src/features/purchasing/hooks/usePoPayments.ts` — la **bonne**
  source

**Preuve** — Sur un fournisseur de dev avec un bon reçu non payé, la fiche et le
rapport des paiements affichent **le même** montant. Vitest ciblé.

---

### `[S3-08]` Corriger stock fini **et** matières en un geste

**Risque prod** 🔴 · **Source** — Arbitrage §2bis lot 9. Une fournée dont une
partie est vendue ne peut pas être annulée, et l'ajustement proposé ne corrige
que le produit fini : la matière consommée à tort **reste sortie**.

**Fichiers**
- `supabase/migrations/<nouveau>` — un ajustement portant sur le produit fini et
  sur les matières, gaté propriétaire
- `apps/backoffice/src/features/inventory-production/components/ProductionForm.tsx`
  — son message d'erreur renvoie vers le mauvais geste
- Un nouvel écran ou dialogue d'ajustement combiné
- `supabase/tests/`

**Preuve** — pgTAP : l'ajustement combiné remet le produit fini **et** les
matières à leur valeur attendue, en une transaction, avec une écriture
comptable équilibrée.

**Dépend de** — `S1-05`, `S1-08`.

---

### `[S3-09]` Arrondir les suggestions de production au pas métier

**Risque prod** 🟢 · **Source** — Arbitrage §2bis lot 9. La couverture reste à
**3 jours** ; seul l'arrondi change.

**État — développé et prouvé en dev le 2026-11-20**, branche
`feat/s3-09-arrondi-suggestions`. Migration
`20261120000010_s3_09_production_rounding_step.sql` appliquée en dev : colonne
facultative `products.production_rounding_step`, fonction de réglage
`set_production_rounding_step_v1` (permission `products.update`, trace dans
`audit_logs`), famille `get_production_suggestions` bumpée en v5 depuis le corps
live, v4 retirée (seul appelant : le crochet du back-office, basculé). L'onglet
des suggestions montre et règle le pas (« Batch step »). pgTAP
`s3_09_production_rounding_step.test.sql` 14/14 en dev (relecture indépendante
appliquée : pas validé et tracé après arrondi à 3 décimales) : 17 → 24 avec un pas
de 12, 20 avec un pas de 5, 17 sans pas. Vitest ciblé 7/7. Non publié.

**Fichiers**
- `supabase/migrations/<nouveau>` — un pas d'arrondi par produit
- `apps/backoffice/src/features/inventory-alerts/hooks/useProductionSuggestions.ts`
- `apps/backoffice/src/features/inventory-alerts/components/ProductionAlertsTab.tsx`
- `supabase/tests/`

**Preuve** — pgTAP : un besoin de 17 avec un pas de 12 suggère 24. Un produit
sans pas garde l'arrondi entier.

---

### `[S3-10]` Dire que l'alerte de stock bas ne sait pas

**Risque prod** 🟠 · **Source** — Arbitrage §2bis lot 4. **245 des 249** produits
suivis ont un seuil à zéro : l'écran affiche une liste vide qui se lit comme
« tout va bien ». **Pas de promesse d'e-mail.**

**État — développé le 2026-11-18**, lot back-office (branche
`feat/s3-lot-backoffice`). Le bandeau vit dans l'onglet de stock bas, au-dessus
de la liste, et non dans l'onglet des problèmes de configuration. Il compte les
produits actifs suivis dont le seuil est à zéro ; tout produit est suivi par
défaut, produits finis compris. Tests verts en local. Reste : la saisie des
seuils par Mamat.
**Fusionnée le 2026-11-18 (PR #739), publiée en production le 2026-11-19 vers
0 h 10** (back-office `47ac4756`). Écran non vu en production.

**Fichiers**
- `apps/backoffice/src/features/inventory-alerts/components/LowStockTab.tsx`
- `apps/backoffice/src/features/inventory-alerts/components/ConfigIssuesTab.tsx`
  — l'endroit naturel du bandeau
- `apps/backoffice/src/features/inventory-alerts/hooks/useStockConfigIssues.ts`

**Preuve** — Le bandeau annonce le nombre de produits suivis **sans seuil**.
Avec 0 produit sans seuil, il disparaît. Vitest ciblé sur les deux cas. Puis :
Mamat saisit les seuils.

---

### `[S3-11]` Ouvrir le palier et la formule dans le formulaire de promotion

**Risque prod** 🟠 · **Source** — Arbitrage §2bis lot 5. Les 6 mécaniques sont
évaluées par le serveur ; le formulaire n'en propose que **4**.

**État — développé le 2026-11-18**, lot back-office (branche
`feat/s3-lot-backoffice`). Le formulaire partagé propose le palier et la formule
(`bundle`), validés comme la contrainte de la base. Un palier en pourcentage
exige un plafond, car le serveur lit le plafond comme le mode. Tests verts en
local ; l'évaluation au POS en dev n'est pas faite. Le filtre par type de la
liste des promotions ignore encore ces deux types.
**Fusionnée le 2026-11-18 (PR #739), publiée en production le 2026-11-19 vers
0 h 10** (back-office `47ac4756`). Aucune promotion de ces types créée en
production.

**Fichiers**
- `apps/backoffice/src/features/promotions/components/PromotionFormModal.tsx`
- `apps/backoffice/src/features/promotions/components/ThresholdForm.tsx` —
  existe déjà, à brancher
- un formulaire de formule, sur le modèle de `BogoForm.tsx`
- `apps/backoffice/src/features/promotions/utils/emptyPromotionDefaults.ts`
- `apps/backoffice/src/features/promotions/hooks/promotionRowMappers.ts`

**Preuve** — Les 6 types se créent depuis l'écran et sont évalués correctement au
POS en dev. Vitest ciblé par type.

**Dépend de** — `S1-12`. **Ne pas créer de promotion ciblée en production
avant.**

---

### `[S3-12]` Auditer la suppression d'une promotion

**Risque prod** 🟠 · **Source** — Audit 01 §5.1. Le déclencheur d'audit des
promotions couvre la création et la modification, **pas la suppression**.

**État — appliqué en dev le 2026-11-18**, lot back-office (branche
`feat/s3-lot-backoffice`), migration
`20261118000007_s3_12_audit_promotion_hard_delete.sql`. La suppression logique
était déjà tracée par la famille `delete_promotion` ; il manquait la suppression
physique. Un déclencheur séparé la trace. Prouvé en dev dans une transaction
annulée : 0 ligne avant la migration, 1 après, auteur = profil.
**En production le 2026-11-19 vers 0 h 10** : déclencheur
`audit_promotion_hard_delete` présent. Aucune suppression essayée en production.

**Fichiers**
- `supabase/migrations/<nouveau>` — étendre le déclencheur
- `supabase/tests/`

**Preuve** — pgTAP : supprimer une promotion laisse une ligne dans `audit_logs`,
avec un `actor_id` de **profil** et le différentiel en `payload`.

---

### `[S3-13]` Appliquer l'ordre d'affichage des combos au POS

**Risque prod** 🟠 · **Source** — Audit 01 §5.3. L'ordre est enregistré par le
back-office et **jamais appliqué** : le POS trie par nom.

**État — développé le 2026-11-18**, lot caisse (branche `feat/s3-lot-caisse`).
Le POS range les combos par l'ordre saisi, puis par nom, dans tous les onglets
de la grille. Aucune migration : la colonne arrivait déjà au POS. Tests verts en
local. Non livré, non vu dans un navigateur.

**Fichiers** — La grille de combos du POS et son crochet (chemins dans
`01_CARTOGRAPHIE...` §4).
**Preuve** — L'ordre saisi au back-office est celui affiché au POS. Vitest ciblé.

---

### `[S3-14]` Câbler l'édition du libellé de variante

**Risque prod** 🟢 · **Source** — Audit 01 §5.3. La fonction serveur **et** le
crochet existent ; aucun bouton ne les appelle.

**État — développé le 2026-11-18**, lot back-office (branche
`feat/s3-lot-backoffice`). Bouton « Edit » sur chaque variante, réservé au droit
d'écriture des variantes, et dialogue du libellé. Tests verts en local.
**Fusionnée le 2026-11-18 (PR #739), publiée en production le 2026-11-19 vers
0 h 10** (back-office `47ac4756`). Écran non vu en production.
**Fichiers** — La fiche produit, onglet variantes.
**Preuve** — Le libellé se modifie et persiste. Vitest ciblé.

---

### `[S3-15]` Un compte de charge par nature de dépense

**Risque prod** 🟠 · **Source** — Arbitrage §2bis lot 6. **Six** catégories sur
douze atterrissent toutes sur « autres charges ».

**État — développé en dev le 2026-11-11**, dans le lot comptable (PR #692),
migration `20261111000013_expense_accounts_by_nature.sql`. Cinq comptes créés
(`6118` transport, `6119` assurance, `6121` taxes et licences, `6122` frais
bancaires, `6123` bureau) ; « Other » garde `6190`. Une catégorie déjà utilisée
garde son compte, règle en vigueur que la migration respecte. Relevé en
production le même jour : dix catégories, quatre sur `6190`, dont « Office »
qui porte 2 dépenses (896 926,14 IDR). **Arbitrage de Mamat du 2026-11-11** :
les dépenses futures de « Office » vont sur `6123`, les deux passées restent
sur `6190`. La migration `20261111000014_expense_office_category_account.sql`
lève la garde une seule fois pour cette catégorie, trace le geste dans le
journal d'audit et la remet en place ; prouvé en dev sur un cas simulé, dans
une transaction annulée. Aucune écriture passée n'est réécrite. **En production
depuis le 2026-11-11** : « Office » y est passée de `6190` à `6123`, geste tracé.

**Fichiers**
- `supabase/migrations/<nouveau>` — comptes transport, assurance, taxes, frais
  bancaires, bureau
- `supabase/migrations/<nouveau>` — réaffectation des catégories
- `supabase/migrations/20260909000001_expense_payment_account_routing.sql` —
  modèle, **ne pas éditer**
- `apps/backoffice/src/features/expenses/components/ExpenseCategoryDialog.tsx`
- `supabase/tests/`

**Preuve** — pgTAP : chaque catégorie vise son compte. Aucune catégorie ne
tombe sur « autres charges » sauf celle qui le mérite. Le grand livre des 11
dépenses existantes est **relevé avant** la réaffectation.

**Dépend de** — `S1-03` (ne pas réaffecter des comptes sur une période clôturée
sans pouvoir rouvrir).

---

### `[S3-16]` Le son « commande prête » au comptoir

**Risque prod** 🟠 · **Source** — Arbitrage §2bis lot 11. Aujourd'hui le **seul**
son existant est celui de l'écran cuisine.

**État — reportée le 2026-11-18 par Mamat**, sortie du lot caisse. Rien n'est
développé. Décision de Mamat : la tâche est remise à plus tard, pas abandonnée ;
l'intention des specs reste valable.

**Fichiers**
- Le poste de caisse du POS et son abonnement temps réel
- Le composant de son de l'écran cuisine — modèle à suivre
- **Attention** : les noms de canaux temps réel sont **uniques par montage**
  (`useKdsRealtime.ts` est la référence) ; un nom partagé collisionne en silence

**Preuve** — En dev, passer une commande en prêt depuis le KDS déclenche le son
au comptoir, **une seule fois**. Deux onglets de caisse ouverts ne se volent pas
l'événement. Vitest ciblé plus une vérification en navigateur.

---

### `[S3-17]` Alerter en caisse quand un règlement est mis en quarantaine

**Risque prod** 🔴 · **Source** — Décision 5 de l'ADR-018, **non implémentée** :
un règlement définitivement rejeté au rejeu part en quarantaine **sans alerte**.
Le consommateur du résultat de rejeu ignore le champ.

**État — développé le 2026-11-18**, lot caisse (branche `feat/s3-lot-caisse`).
L'écran de vente affiche une alerte sans bouton de fermeture tant qu'un
règlement est en quarantaine ; le rejeu la rafraîchit aussitôt. Les formats de
la file sont inchangés. Tests verts en local, sur le repli localStorage de jsdom
et non sur un vrai IndexedDB. Non livré : le hors ligne reste désarmé en
production.

**Fichiers**
- `apps/pos/src/features/.../offlineReplay.ts` et son consommateur
- Un composant d'alerte persistante en caisse

**Preuve** — Vitest : un rejeu produisant une quarantaine remonte l'alerte ; un
rejeu propre non. L'alerte **ne disparaît pas** d'elle-même : elle est de
l'argent à régulariser.

**Note** — Le réglage hors ligne est à `false` en production : la tâche est de la
dette dormante, pas une panne. Elle doit être livrée **avant** d'armer le hors
ligne.

---

### `[S3-18]` Écrire le runbook de mise en service du hub réseau

**Risque prod** 🟢 · **Source** — ADR-034 : le runbook est **dû et jamais
écrit**. De plus `apps/print-bridge/README.md` omet les 4 variables TLS
obligatoires — **le pont ne démarre pas** si on suit la documentation.

**État — rédigé le 2026-11-20**, branche `docs/s3-18-runbook-hub-reseau` :
`docs/runbooks/hub-reseau-mise-en-service.md` écrit depuis le code du pont. Le
README du pont liste les trois variables sans lesquelles le pont refuse de
démarrer (`HUB_TLS_CERT`, `HUB_TLS_KEY`, `HUB_ALLOWED_ORIGINS`), plus
`HUB_REGISTRY_FILE`, absente aussi, dont le défaut relatif perd le registre, et
retire `HUB_TOKEN`, que le code ne lit plus, ainsi que le mode ouvert qu'il
décrivait. Le fragment OpenAPI de `packages/supabase/README.md` porte les PIN
en en-têtes (`x-login-pin`, `x-current-pin`, `x-new-pin`), comme le code, et
ses statuts d'erreur des deux fonctions de PIN suivent le code relu le même
jour. Relecture indépendante appliquée (imprimante de reçus à déclarer pour le
tiroir, capacités par défaut des appareils). Garde des liens relatifs verte le
2026-11-20. **Reste** : la preuve sur un poste neuf.

**Fichiers**
- `docs/runbooks/<nouveau>-hub-reseau-mise-en-service.md`
- `apps/print-bridge/README.md` — ajouter les 4 variables
- `packages/supabase/README.md` — son exemple met le PIN dans le **corps JSON**,
  contre `AGENTS.md` : corriger

**Preuve** — Un poste neuf suit le runbook et le pont démarre, appairage compris.
`node scripts/ci/relative-links.mjs` vert.

**Dépend de** — `S1-19`.

---

## Bloc « qualité des rapports » — `S3-19` à `S3-24`

> Ajouté le **2026-11-10** sur demande de Mamat : des rapports pertinents,
> filtrables, faciles à lire, accompagnés de graphiques utiles. Règles et
> intentions dans `../SPECS_OFFICIELS_ERP_POS.md`, section 15.
>
> **Constat d'audit** (code de `master`, 2026-11-10, lecture seule des pages du
> back-office et des migrations ; aucune requête sur la base, aucun rendu
> navigateur) :
> - Aucun rapport ne met la production en regard des ventes, ni par jour, ni par
>   article, ni par catégorie. Trois pages de production lisent la même table
>   sans jamais lire une vente.
> - Le rapport des lignes d'achat est un journal plat : deux filtres (période,
>   fournisseur), aucun tri, aucune vue par article, un plafond de 1 000 lignes
>   sur lequel les totaux sont calculés.
> - Aucun écran ne montre ensemble l'heure de création, l'heure de paiement et
>   la table d'une vente. Les trois données existent en base ; seule la fiche
>   d'**une** commande les réunit.
> - Aucune page du dossier des rapports de vente ne filtre par type de commande,
>   moyen de paiement ou table. La liste des commandes filtre déjà par type et
>   par moyen de paiement, pas par table.
> - Un socle commun existe (coquille de rapport, contrôle de période, en-tête
>   triable). Il lui manque une barre de filtres au-delà de la période, et une
>   table de rapport avec tri, pied de total et recherche : chaque page réécrit
>   les siennes, et le tri manque sur la majorité.
> - Plusieurs pages se recouvrent, et plusieurs listes n'ont aucun graphique.
>
> **Ordre interne** — `S3-22` (socle de filtres et de table) d'abord : les cinq
> autres s'appuient dessus.

---

### `[S3-19]` Créer le rapport « production contre ventes »

**Risque prod** 🟠 · **Source** — Demande de Mamat du 2026-11-10.

**État — publié en production le 2026-11-10** (PR #678). Fonction en
production égale au dev, back-office publié. **Reste** : ouvrir le rapport en
production avec le compte du propriétaire. Relevé dans
`docs/runbooks/etat-environnements.md`, complément du 10 novembre.

**Constat** — Les données existent toutes : les fournées (date, produit,
quantité), les lignes de vente, les pertes, les catégories. Aucune fonction ne
les croise. La clôture de vitrine fait déjà ce calcul pour un jour et un
produit, mais sur une courte liste de produits écrite en dur, et hors des
rapports.

**Fichiers**
- `supabase/migrations/<nouveau>` — une fonction de rapport neuve au grain
  **jour × article**, repliable par catégorie : produit, vendu, perdu, écart,
  taux d'écoulement
- `apps/backoffice/src/features/reports/hooks/` — un nouveau crochet, réponse
  **validée dans le crochet**
- `apps/backoffice/src/pages/reports/` — une nouvelle page, sa route et sa tuile
  de hub
- `supabase/migrations/20260624000017_create_get_production_report_v1_rpc.sql`
  et `20261105000036_product_sales_permission.sql` — les deux définitions à
  réutiliser (jour métier, lignes annulées exclues), **ne pas éditer**
- `supabase/tests/` et les tests Vitest de la page

**Travail** — Filtres : période, catégorie, article. Vue par jour, par article
et par catégorie. Graphique : production et ventes côte à côte par jour, et
classement des articles par écart. Descente d'un article vers ses fournées et
ses lignes de vente.

**Tranché par Mamat le 2026-11-10**
1. « Produit » = la quantité **enregistrée en production**. Le rapport est
   **informatif** : il ne modifie et n'écrit rien dans le stock.
2. Ventes B2B : dans une **colonne séparée** des ventes au comptoir.
3. Pertes : seules les pertes **enregistrées et approuvées** comptent. Une
   déclaration en attente n'est pas une perte.
4. Périmètre : les articles frais du jour. Catégories retenues avec Mamat le
   2026-11-10, sur les noms relevés en production : Classic Breads, Sourdough
   Breads, Classic Viennoiserie, Others Viennoiserie, Savouries, Individual
   Pastries, Buns et Bagel. Aucune autre catégorie n'entre dans le rapport.
5. Accès : le **propriétaire seul**. L'ouverture à d'autres comptes pourra
   suivre `S1-08`.
6. Ventes B2B (après publication, même jour) : une commande B2B compte **le
   jour où elle est livrée**, payée ou à crédit. Non livrée, elle ne compte pas.
7. Bilan complet (même jour) : les restes déclarés par la caisse en fin de
   journée entrent dans le rapport. Par jour et par article : reste de la veille
   + produit − vendu − pertes approuvées − reste du soir = non expliqué. La
   dernière correction d'une déclaration compte. Un jour sans déclaration, ou
   un article absent d'une déclaration, est **inconnu**, jamais zéro.
8. Articles de combo (2026-11-11) : un article servi comme composant d'un
   combo compte comme **vendu** dans ce rapport, en quantité seulement
   (quantité de la ligne du combo × quantité du composant). La recette reste
   sur le combo. Relevé de production du même jour, en lecture seule : 104
   lignes de combo du 2026-09-01 au 2026-11-10, portant 254 articles.
   **Publié en production le 2026-11-11** (PR #684). Le même jour, la lenteur
   du rapport pour le propriétaire (23 à 42 s sur 7 jours, pour une limite de
   8 s) est corrigée dans la vue des commandes closes (PR #685) : moins de 5 s
   mesurées ensuite. Relevé dans `docs/runbooks/etat-environnements.md`,
   section du 11 novembre.

**Choix technique de l'agent (2026-11-10), dans le cadre du point 7** — Une
perte saisie dans la déclaration de fin de journée compte le jour de cette
déclaration, et non le jour de son approbation : sans cela, une perte approuvée
le lendemain fausse le bilan des deux jours. Les autres pertes approuvées
restent datées de leur approbation.

**Preuve** — pgTAP : sur un jeu fixe (une fournée de 20, 15 vendus, 2 perdus),
la ligne rend 20 / 15 / 2 et l'écart 3 ; une fournée annulée et une ligne de
vente annulée ne comptent pas ; le jour est le jour métier. Vitest de la page.
Suite back-office complète verte. Comparaison à la main d'un jour réel en dev.

**Dépend de** — `S3-22`. **Limite écrite** — Un article vendu comme composant
d'un combo n'a pas de ligne de vente propre. La page dit s'il est compté :
non jusqu'au point 8, oui depuis. Le rapport des ventes par article, lui, ne
compte toujours pas les composants, et sa page le dit.

---

### `[S3-20]` Refondre le rapport des achats par article

**Risque prod** 🟠 · **Source** — Demande de Mamat du 2026-11-10 : aussi
détaillé et filtrable que les ventes par article.

**Constat** — Voir le constat du bloc. S'y ajoutent trois défauts factuels : le
sous-titre annonce des bons « reçus » alors que la fonction prend tout sauf
brouillon et annulé ; la tuile d'unités commandées additionne des unités
différentes ; les fournisseurs sont dédoublonnés par nom et non par identifiant.

**État — développé et prouvé en dev le 2026-11-20**, branche
`feat/s3-20-achats-par-article`. Migration
`20261120000020_s3_20_purchase_items_by_article.sql` appliquée en dev : famille
`get_purchase_items` bumpée en v2 depuis le corps live (agrégat par article
serveur, totaux non tronqués, période précédente, dépense par jour, filtres
catégorie, article et statut), v1 retirée (seul appelant : le crochet du
back-office, basculé ; `s40_reports.test.sql` basculé) ; fonction neuve
`get_purchase_item_lines_v1` pour les lignes d'un article, paginées. Les trois
défauts factuels sont corrigés : sous-titre « bons en attente, partiels ou
reçus », quantité en unité de base par article (la tuile d'unités disparaît),
fournisseurs comptés par identifiant. Page : vue par article triable et
cherchable, comparaison à la période précédente, graphique de dépense dans le
temps et classement des articles, descente paginée. Date de réception affichée :
celle du bon entièrement reçu. pgTAP `s3_20_purchase_items_by_article.test.sql`
26/26 en dev, dont 1 005 lignes au-delà de l'ancien plafond, unités
mélangées, statuts et borne de 366 jours. Relecture indépendante appliquée. Vitest de la page
8/8. Non publié.

**Fichiers**
- `supabase/migrations/20260624000012_create_get_purchase_items_v1_rpc.sql` —
  point de départ, **ne pas éditer** ; partir du **corps live**
- `supabase/migrations/<nouveau>` — version suivante de la famille
  `get_purchase_items` : agrégat **par article** calculé serveur (quantité,
  valeur, part, coût unitaire moyen, nombre de bons, nombre de fournisseurs),
  totaux **non tronqués**, filtres catégorie, article, statut du bon ; et une
  lecture paginée des lignes d'un article
- `apps/backoffice/src/pages/reports/PurchaseItemsPage.tsx` et son crochet
- `apps/backoffice/src/pages/reports/__tests__/purchase-items-page.smoke.test.tsx`
- `supabase/tests/`

**Travail** — Vue par article triable, avec comparaison à la période précédente.
Filtres : période, fournisseur, catégorie, article, statut. Colonnes ajoutées :
catégorie, part, coût unitaire moyen, unité d'achat, date de réception.
Graphique : classement des articles par dépense, et dépense dans le temps.
Descente d'un article vers ses lignes d'achat, paginée. Corriger les trois
défauts factuels.

**Preuve** — pgTAP : les totaux égalent la somme des lignes au-delà de 1 000
lignes ; chaque filtre restreint bien ; les brouillons et annulés restent
exclus. Vitest de la page. Types régénérés. Suite back-office complète verte.

**Dépend de** — `S3-22`.

---

### `[S3-21]` Montrer l'heure de création, l'heure de paiement et la table des ventes

**Risque prod** 🟠 · **Source** — Demande de Mamat du 2026-11-10.

**État — publié en production le 2026-11-10** (PR #676). Fonctions nouvelles
en production égales au dev, back-office publié, anciennes versions retirées
après la publication. **Reste** : ouvrir la liste des commandes et les ventes
par article en production avec un compte connecté. Relevé dans
`docs/runbooks/etat-environnements.md`, complément du 10 novembre. La famille
des compteurs de la liste a été bumpée avec celle de la liste, pour garder les
deux sur le même filtre.

**Fichiers**
- `supabase/migrations/<nouveau>` — version suivante des familles
  `get_orders_list` et `get_product_sales_lines` (**corps live**). La liste des
  commandes renvoie déjà l'heure de création : y ajouter l'heure de paiement,
  le numéro de table et un filtre par table. Les lignes de vente d'un article
  ne renvoient qu'une heure de vente : y ajouter les trois champs
- `apps/backoffice/src/pages/orders/OrdersListPage.tsx`,
  `apps/backoffice/src/features/orders/hooks/useOrdersList.ts` et
  `apps/backoffice/src/features/orders/exportOrdersCsv.ts`
- `apps/backoffice/src/features/reports/components/ProductSalesLinesDrawer.tsx`
  et `hooks/useProductSalesLines.ts`
- `apps/backoffice/src/pages/reports/SalesByTablePage.tsx` — rendre une table
  cliquable vers ses commandes
- `supabase/tests/` et les tests Vitest des trois écrans

**Travail** — Liste des commandes : la colonne d'heure existante devient
« Created », s'y ajoutent « Paid » et « Table », un filtre par table, et les
trois champs dans l'export. Lignes de vente d'un article :
les trois mêmes champs, plus le tri et l'export. Ventes par table : descente
vers les commandes de la table.

**Preuve** — pgTAP : une commande créée à 10 h et payée à 11 h rend les deux
heures distinctes et sa table ; une commande sans table rend une valeur vide,
jamais une erreur ; le filtre par table ne ramène que cette table. Vitest des
trois écrans. Types régénérés. Suite back-office complète verte.

**Attention** — Un bump de famille retire l'ancienne version dans la même
migration : vérifier qu'aucun **autre** appelant en service ne la lit encore
(leçon de `S1-22`). **Dépend de** — rien. Elle part **avant** `S3-22` : les deux
bumpent la famille des lignes de vente d'un article, et deux bumps concurrents
d'une même famille se marchent dessus.

---

### `[S3-22]` Donner aux rapports un socle commun de filtres et de table

**Risque prod** 🟠 · **Source** — Demande de Mamat du 2026-11-10 (« filtrable,
facile à lire »). Constat d'audit : voir le bloc.

**État — étapes 1, 3 et 4 publiées en production le 2026-11-10** (PR #677,
entrée dans `master` par #676), avec `S3-21`. Fait : le socle, prouvé sur les ventes par article ;
l'article dans le journal des mouvements de stock ; la catégorie d'achat dans
le rapport de dépense ; les deux liens de l'étape 4. **Reste** : l'étape 2, les
autres rapports de vente sur le socle, une page par commit. S'y ajoute un lien
non prévu à l'étape 4 : des ventes par origine vers les commandes, qui demande
un filtre d'origine sur la liste des commandes.
**Étape 2, premier lot — publié en production le 2026-11-11** (PR #683) : les
ventes par catégorie et les ventes par vendeur portent les trois filtres (type
de commande, moyen de paiement, table). Les familles `get_sales_by_category` et
`get_sales_by_staff` sont bumpées, production égale au dev. Relevé dans
`docs/runbooks/etat-environnements.md`, section du 11 novembre.
**Étape 2, deuxième lot — publié en production le 2026-11-11** (PR #687) : les ventes par
origine et les ventes par client portent les trois mêmes filtres. Les familles
`get_sales_by_origin` et `get_sales_by_customer` sont bumpées ; le serveur
applique les filtres à la période et à la fenêtre précédente. Sur les ventes
par client, le drapeau « nouveau client » reste lu sur toutes les commandes du
client, choix de l'agent : il dit qui découvre la boutique, pas qui essaie un
autre type de commande. Production égale au dev, relevé dans
`docs/runbooks/etat-environnements.md`, section du 11 novembre après-midi.
**Étape 2, troisième lot — publié en production le 2026-11-11** (PR #689) : les ventes de
combos portent les trois filtres ; les ventes par table ne portent que le moyen
de paiement, choix de l'agent : le rapport ne lit déjà que des commandes sur
place avec une table, et la table est sa dimension. Le lien d'une table vers ses
commandes transporte le filtre. Les familles `get_combo_sales` et
`get_sales_by_table` sont bumpées, production égale au dev. Relevé dans
`docs/runbooks/etat-environnements.md`, section du 11 novembre au soir.
**Étape 2, quatrième lot — publié en production le 2026-11-21** (PR #755,
SHA applicatif `e79f91b7`) : l'analyse de panier reçoit les trois filtres
communs et la table partagée avec tri et recherche persistée dans l'URL. Les
filtres restreignent les commandes avant les supports, la confiance et le lift ;
un paiement mixte ne duplique pas un panier. CSV et données du PDF suivent les
paires visibles et leur ordre ; un résultat vide bloque l'export. Le pied
additionne les occurrences de paires, jamais les ratios, et le libellé distingue
ces occurrences des paniers uniques. Migration
`20261120000048_basket_analysis_filters.sql` appliquée en DEV puis production V3 ; pgTAP du lot
23/23 et suite financière existante 12/12, sous transaction annulée, sans test
ignoré. Types régénérés : seul le bloc de la famille `get_basket_analysis` est
repris de la sortie complète, dont les dérives DEV indépendantes restent hors
lot. Recette locale sur données simulées, thèmes clair et sombre, largeurs de
bureau ; CSV téléchargé et relu. Suite BO locale complète : 2 611 tests réussis,
un ignoré préexistant. CI et pgTAP du SHA intégré réussis ; 389 fichiers SQL
exécutés. Après préparation protégée du BO, migration ciblée et promotion du
même déploiement : 383 fichiers publics conformes au manifeste, cible production
seule. Les 926 paires du 14 au 20 novembre et leur empreinte sont inchangées sans
filtre avant/après migration. Recette connectée non effectuée : pilote navigateur
indisponible ; PDF final non ouvert. Le lot est publié, sa vérification en usage
reste ouverte. Relevé et preuves dans `docs/runbooks/etat-environnements.md`,
complément du 21 novembre. Le graphique reste porté par `S3-23`.
Restent sur l'étape 2 les autres rapports de vente. Les ventes par heure
attendent `S3-23`, qui change déjà leur portée (toute la période au lieu d'un
jour) : deux bumps de la même famille se marcheraient dessus. Les ventes du jour sont
laissées de côté à dessein : un filtre de commande n'y a pas de sens défini
pour les remboursements, les encaissements et les annulations, et ce sens est
à trancher par Mamat. Limite relevée : un PDF exporté sous filtre ne mentionne
pas le filtre (relevé du 2026-11-10, sur les trois pages qui portaient alors le
socle).
**Tranché par Mamat le 2026-11-10** : la route des ventes par article n'est
**pas** alignée ; elle reste gardée par la seule permission des rapports de
vente. La puce « aligner » des fichiers ci-dessous est donc close sans
changement.

**Fichiers**
- `apps/backoffice/src/features/reports/components/` — une barre de filtres
  partagée (état dans l'URL, comme la période) et une table de rapport partagée
  (tri, pied de total, recherche texte). Point de départ : `ReportShell.tsx`,
  `PeriodControl.tsx`, `SortableTh.tsx` et `hooks/useSortedRows.ts`. **Étendre
  ce socle, ne pas en créer un second**
- Les pages de vente du dossier `apps/backoffice/src/pages/reports/` — brancher
  le socle, page par page
- `supabase/migrations/<nouveau>` — versions suivantes des fonctions de vente
  qui reçoivent les nouveaux filtres (**corps live**, une famille par migration)
- `apps/backoffice/src/routes/index.tsx` — la route des ventes par article
  refuse un compte que sa fonction accepte : aligner
- `supabase/tests/` et les tests Vitest des pages touchées

**Travail**
1. Écrire le socle et le prouver sur **une** page, les ventes par article :
   filtres type de commande, moyen de paiement, table, plus la recherche.
2. L'étendre aux autres rapports de vente, **une page par commit**.
3. Exposer les filtres que le serveur accepte déjà et que l'écran ne propose
   pas : l'article dans le journal des mouvements de stock, la catégorie dans
   `CostSpendAnalyticsPage.tsx`. **Relire le corps live** des deux fonctions
   avant de s'y fier : ce relevé vient des fichiers de migration.
4. Relier les rapports entre eux : achats par date et par fournisseur vers les
   lignes d'achat filtrées ; ventes par catégorie vers les ventes par article
   filtrées.

**Preuve** — Vitest : chaque filtre s'écrit dans l'URL, se relit au rechargement
et arrive dans l'appel serveur. pgTAP par fonction bumpée : chaque filtre
restreint bien, et sans filtre le total est **inchangé** par rapport à la
version précédente. Suite back-office complète verte après chaque page.

---

### `[S3-23]` Ajouter les graphiques qui manquent

**Risque prod** 🟢 · **Source** — Demande de Mamat du 2026-11-10 (« accompagnés
de diagrammes ou graphiques utiles »).

**Fichiers** — Les pages de `apps/backoffice/src/pages/reports/` listées
ci-dessous ; les composants de graphique existants de
`apps/backoffice/src/features/reports/components/charts/` sont à **réutiliser**,
aucune librairie nouvelle.

**Travail** — Un graphique par page, choisi pour la question que la page pose :
- ventes par heure : lire **toute la période** et non son dernier jour ; carte
  heure × jour de semaine
- ventes par article et par catégorie : évolution dans le temps
- écart de stock : corrections et pertes par article
- mouvements de stock : entrées et sorties par jour et par type
- rendement de production et coût des recettes : écart par recette
- analyse de panier et ventes hors horaires : un visuel de répartition
- production : quantités produites et perdues par jour, pas seulement la valeur

**Preuve** — Chaque graphique a un test de rendu avec données et un test d'état
vide. Contrôle au navigateur, thème clair et thème sombre. Suite back-office
complète verte.

**Dépend de** — `S3-22`.

---

### `[S3-24]` Arbitrer les rapports qui se recouvrent et ranger le hub

**Risque prod** 🟠 · **Source** — Audit du 2026-11-10, sur demande de Mamat
(« vérifie leur pertinence »).

**Constat** — Recouvrements relevés :
- ventes par employé ⊂ performance des employés (mêmes lignes, le second ajoute
  annulations, remboursements et remises)
- rendement de production ↔ efficacité de production ↔ rapport de production :
  trois pages pour une seule table
- marge brute ↔ ventes par article sur quantité et chiffre d'affaires
- achats par date ↔ rapport de dépense sur les achats par jour
- historique des mouvements de stock ↔ l'écran des mouvements du module stock
- le rapport des pertes lit encore les lots (colonne et lignes de péremption) :
  à nettoyer **avec** `S2-01`
- rangement : l'écart de caisse est classé dans les ventes ; la production est
  répartie sur deux sections ; la tuile de l'écart de stock porte un libellé
  qui ne dit pas ce que la page mesure. Le renommage du « coût de production »
  reste porté par `S4-07`, pas par cette tâche

**Travail** — **Aucune suppression sans décision de Mamat.** Lui présenter, pour
chaque paire, les deux options : fusionner dans le plus complet, ou garder les
deux avec un rôle distinct écrit dans le sous-titre. Appliquer ensuite, une
fusion par commit. Reclasser les tuiles et corriger les libellés, **en anglais**.

**Preuve** — Aucune route morte, aucun lien du hub cassé, la recherche du hub
trouve chaque rapport restant. Le hub est **recompté à la date de la tâche** (le
chiffre écrit dans `S2-08` ne tient plus dès qu'une tuile s'ajoute), et le
décompte de la section 15 des specs est remis à jour et **daté**. Suite
back-office complète verte.

**Dépend de** — `S2-01` (retrait des lots, pour le rapport des pertes), `S2-02`
(les causes d'écart de rendement disparaissent des pages de production),
`S2-08`, `S3-19`.

---

# Sprint 4 — Optimisation et clôture

> Objectif : refermer la dette signalée en phase 1 et laisser le dépôt dans un
> état où la prochaine session ne se trompe pas.

---

### `[S4-01]` Mettre les Edge Functions sous le filet de lint

**Risque prod** 🟢 · **Source** — Audit 02, P0 : `supabase/functions` n'est
**pas** membre du workspace, donc **jamais linté**. C'est un trou de filet sur du
code de money-path.

**Fichiers** — `pnpm-workspace.yaml`, la configuration de lint, `.github/workflows/ci.yml`.
**Preuve** — Le lint tourne sur `supabase/functions` en CI et **échoue** sur une
faute introduite exprès. Les erreurs préexistantes sont soit corrigées, soit
posées en baseline — **plafond, jamais plancher**.

---

### `[S4-02]` Réduire les déréférencements de réponse non validés

**Risque prod** 🟠 · **Source** — Audit 02 : **248** `as unknown as`. Une réponse
de fonction déréférencée sans garde **blanchit la page**.

**Travail** — Par lots, en commençant par les chemins d'argent. Valider dans le
**crochet**, pas dans le composant. Ne pas viser zéro : viser les chemins qui
cassent une page.
**Preuve** — Chaque lot : un test avec une réponse malformée qui affiche une
erreur au lieu d'une page blanche. Suite back-office complète verte par lot.

---

### `[S4-03]` Retirer les 24 `any` du code de production

**Risque prod** 🟢 · **Source** — Audit 02 §5.
**Preuve** — Zéro `any` hors fichiers générés. Typecheck vert.

---

### `[S4-04]` Alléger les 190 Mo d'outillage ignoré

**Risque prod** 🟢 · **Source** — Audit 02 §8.
**Preuve** — Relevé de taille avant/après. Rien de suivi par git n'est supprimé.

---

### `[S4-05]` Corriger les 10 références croisées manquantes entre ADR

**Risque prod** 🟢 · **Source** — Audit 03 : le graphe de remplacement a 10
liens manquants. Un ADR remplacé qui ne le dit pas **trompe la prochaine
session**.

**Fichiers** — Les ADR concernés, listés dans `03_AUDIT_DOCUMENTATION.md`.
**Travail** — **Le texte de décision reste immuable.** Seuls le statut et le
bilan factuel se mettent à jour.
**Preuve** — Chaque ADR remplacé porte son `Statut: remplacé par ADR-00XX`.
`relative-links.mjs` vert.

---

### `[S4-06]` Écrire les limites assumées

**Risque prod** 🟢 · **Source** — Arbitrages §2bis lots 3, 4, 8, 12.

**Limites à écrire dans `../SPECS_OFFICIELS_ERP_POS.md`**
1. Un mouvement valorisé à **zéro** n'émet aucune écriture ; **14** produits
   suivis sont à coût zéro.
2. Il n'existe **aucune photo du coût au moment de la vente** : la marge est
   toujours valorisée au coût moyen du jour de lecture. Le coût de report de
   cette limite **augmente chaque jour**.
3. Un **plafond de crédit B2B absent vaut crédit illimité** ; le suivi reste
   humain.
4. La marchandise avariée **rendue** au fournisseur n'a pas de chemin.
5. Les permissions sont figées dans l'écran jusqu'au rechargement, alors que le
   serveur est une lecture vivante : un bouton peut rester affiché.

**Preuve** — Les 5 limites sont écrites et marquées. Aucune n'est présentée comme
un défaut à corriger.

---

### `[S4-07]` Renommer le rapport de « coût de production »

**Risque prod** 🟠 · **Source** — Arbitrage §2bis lot 10. Il mesure des **achats
commandés**, réception non incluse.
**Travail** — Le renommer « dépense d'achat ». Le vrai coût des ventes vient de
`S1-05`.
**Preuve** — Le titre, la tuile du hub et l'export portent le nouveau nom, **en
anglais**.
**Dépend de** — `S1-05`.

---

### `[S4-08]` Vérifier la programmation du pgTAP nocturne

**Risque prod** 🟢 · **Source** — `AGENTS.md` : `pgtap-nightly.yml` contient une
programmation périodique dont **l'activation effective se vérifie sur GitHub**.
Un horaire déclaré ne prouve pas une exécution.
**Preuve** — Relevé daté des exécutions réelles du workflow, joint à
`docs/runbooks/etat-environnements.md`.

---

### `[S4-09]` Relever les avertissements de sécurité Supabase

**Risque prod** 🟠 · **Source** — Audit 01 §5.11.
**Travail** — Reprendre les avertissements un par un. Pour toute révocation sur
fonction : `REVOKE ... FROM PUBLIC` **et**
`ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM PUBLIC` — une révocation sur `anon`
seule est **insuffisante**, `anon` hérite par `PUBLIC`.
**Preuve** — Nouveau relevé d'avertissements, joint, avec la justification de
chaque point restant. Tout besoin `anon` légitime porte un
`COMMENT ... 'anon-callable: <raison>'`.

---

### `[S4-10]` Clore les 10 points ouverts

**Risque prod** 🟠 · **Source** — §19 des specs.
**Travail** — Les poser à Mamat, un lot de 5 maximum, les plus critiques
d'abord. Deux demandent une **observation en boutique** (l'entrée au panier hors
ligne, la journée du 2026-11-02) et ne se tranchent pas depuis le code.
**Preuve** — Chaque point tranché est écrit dans les specs avec sa marque, ou
reste listé comme ouvert.

---

### `[S4-11]` Retirer les 4 rapports d'audit et clore le chantier

**Risque prod** 🟢 · **Source** — `AGENTS.md`, règle documentaire 3 : une spec
meurt à la livraison du chantier.

**Travail** — Quand les sprints 1 à 3 sont livrés : retirer
`01_CARTOGRAPHIE_ET_ARCHITECTURE.md`, `02_DETTE_TECHNIQUE_ET_NETTOYAGE.md`,
`03_AUDIT_DOCUMENTATION.md`, `04_QUESTIONS_CLARIFICATION.md` et **ce fichier**.
Le résiduel se note dans le bilan factuel des ADR concernés, **après
vérification**. `../SPECS_OFFICIELS_ERP_POS.md` et `docs/adr/` survivent.

**Preuve** — Les specs reflètent l'état livré. Aucun reste du plan non tracé.
`relative-links.mjs` vert. Jamais plus de 3 specs vivantes.

---

# Annexe A — Dépendances contraignantes

```
S1-01 (sauvegardes)
  └─> S1-02, S1-05, S1-15, S1-16   (toute écriture de masse en production)

S1-03 (réouverture de période)
  └─> S1-05, S3-15                 (toute clôture comptable)

S1-14 (référence projet)
  └─> S1-16, et toute tâche planifiée

S1-05 (chaîne comptable)
  └─> S1-06, S3-05, S3-06, S3-08, S4-07

S1-08 (visibilité par permission)
  └─> S2-09, S3-08

S1-12 (prix serveur en promotion)
  └─> S3-11

S2-01 (retrait des lots)
  └─> S2-08

S3-01 ─> S3-02 ─> S3-03             (chaîne des sessions de caisse)

S1-19 (ADR du hub)
  └─> S3-18

S3-22 (socle de filtres et de table des rapports)
  └─> S3-19, S3-20, S3-23

S3-21 ─> S3-22                      (même famille de fonction : un bump à la fois)

S2-01, S2-02, S2-08, S3-19
  └─> S3-24                        (arbitrage des rapports qui se recouvrent)
```

# Annexe B — Pièges d'exécution de ce dépôt

Ces pièges ont déjà coûté des sessions. Ils s'appliquent à **toutes** les tâches
ci-dessus.

1. **Un bump de fonction de money-path exige le redéploiement de l'Edge
   Function** qui l'appelle. Oubli récurrent.
2. **Tout nouveau corps part du corps live** (`pg_get_functiondef`), jamais du
   fichier de migration d'origine.
3. **Toujours régénérer les types** après un changement de schéma. Première
   cause de CI cassée.
4. **Jamais de `BEGIN;` / `COMMIT;`** dans un corps de migration.
5. **Les filtres Vitest matchent le nom de fichier**, pas le `describe`, et
   beaucoup de tests du back-office sont en **kebab-case**. Localiser par
   **glob**. Ajouter `--passWithNoTests=false` et **lire les nombres exécutés et
   ignorés** : une suite entièrement ignorée n'est pas validée.
6. **Un même module a souvent plusieurs dossiers de tests.** Ne jamais conclure
   « pas de test » depuis un seul répertoire.
7. **Le lint-ratchet ne lint que les fichiers changés** : toucher une ligne d'un
   vieux fichier réveille ses erreurs préexistantes. Le rejouer en local **par
   lots** — `xargs` sur ~170 fichiers dépasse la limite de ligne de commande
   Windows et **échoue en silence**.
8. **Les gardes à baseline sont un plafond, jamais un plancher.**
9. **L'interface parle anglais.** Aucune garde CI ne le surveille ; le français
   y glisse par réflexe de session.
10. **Pas d'alpha sur un jeton de couleur nu** : Tailwind supprime la
    déclaration **en silence**.
11. **Le fuseau métier est un paramètre de session Postgres.** Un cast `::date`
    sur un `timestamptz` rend **déjà** le bon jour métier : ne jamais conclure à
    un décalage sans l'avoir vérifié sur les données.
12. **Des fichiers de 0 octet apparaissent à la racine** sous Windows.
    `git status` avant chaque commit, suppression **par chemin exact** — jamais
    `git clean -f`.
13. **Les surcharges de sécurité vivent dans `pnpm-workspace.yaml`**, jamais
    dans `package.json` : pnpm 11 ne lit plus ce champ et l'ignore **en
    silence**. La seule preuve qu'elles s'appliquent est leur recopie en tête de
    `pnpm-lock.yaml`.
14. **Le contenu ne transite jamais par un shell.** Un `>` de citation y devient
    une redirection.

# Annexe C — En réserve, non planifié

Ces points sont établis, mais Mamat a décidé de **ne pas les traiter pour
l'instant**. Ils n'entrent ni dans le décompte ni dans l'avancement. Chacun
nomme le signal qui justifierait d'y revenir ; sans ce signal, il reste ici.

### `[R-01]` Ordre de prise des verrous entre une vente et le règlement d'une commande ouverte

**Risque prod** 🔴 si le signal apparaît, faible en l'état · **Source** —
constat du 2026-11-18, en lecture seule sur dev et sur la production V3, après
les interblocages du premier run pgTAP en morceaux (PR #731, run
44241956458). **Décision de Mamat du 2026-11-18** : en réserve, une seule
caisse encaisse.

**Constat** — Deux verrous communs à toute la boutique sont pris dans un ordre
inverse selon le parcours :

- toute écriture d'une commande (création, statut, date de paiement ou total)
  déclenche la famille `invalidate_business_day_release`, qui prend le verrou
  du jour métier, puis supprime la publication du jour. Les triggers de cette
  table, posés par instruction, se déclenchent même quand rien n'est supprimé :
  ils mettent à jour les lignes `catalog` et `orders` de
  `ui_invalidation_topics` (famille `signal_ui_invalidation`) ;
- toute déduction de stock de vente écrit dans les produits ou la vitrine, ce
  qui met à jour la ligne `catalog`.

La vente au comptoir (famille `complete_order_with_payment`) et la création
d'une commande prennent le verrou du jour **puis** `catalog`. Le règlement
d'une commande ouverte (famille `pay_existing_order`, utilisée pour les tables,
les dettes et le rejeu hors ligne) déduit le stock **puis** écrit la commande :
`catalog` **puis** le verrou du jour. Les familles `cancel_b2b_order` et
`edit_b2b_order` suivent le même ordre inverse.

**Effet** — Si la caisse règle une table au moment où une tablette envoie une
commande, PostgreSQL annule l'une des deux transactions. Rien n'est faussé :
l'annulation est entière. L'écran reçoit une erreur générique et le geste est à
refaire. Au relevé du 2026-11-18, les fonctions concernées sont identiques en
dev et en production, et aucun interblocage ne figure dans les journaux
Postgres de production des dernières 24 heures. Ce dernier point est une
indication, pas une preuve : la présence de cette source de journaux n'a pas
été vérifiée.

**Signal pour y revenir** — une erreur inexpliquée sur un règlement ou un envoi
de commande pendant un coup de feu, ou un nouveau poste qui encaisse ou envoie
des commandes.

**Travail proposé** — Une nouvelle version de la famille
`invalidate_business_day_release` qui ne supprime la publication du jour que si
elle existe, vérifiée sous le verrou du jour déjà pris. Une vente ordinaire ne
touche alors plus la ligne `catalog` : le cycle et le point de contention
disparaissent, sans modifier aucune fonction de paiement. Le cas résiduel, la
première écriture d'un jour déjà publié, demanderait que les familles
`pay_existing_order`, `cancel_b2b_order` et `edit_b2b_order` prennent le verrou
du jour en premier.

**Preuve** — Un test pgTAP qui reproduit l'interblocage entre deux sessions
avant la correction et montre qu'il ne se produit plus après. Types régénérés,
pgTAP vert sur la PR.
