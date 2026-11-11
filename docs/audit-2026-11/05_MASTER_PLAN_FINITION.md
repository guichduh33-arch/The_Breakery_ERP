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
   Reste à constater le **déclenchement** de 03 h 30 (contrôle du lendemain,
   décrit au runbook).
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

---

### `[S1-09]` Plafonner la remise de ligne au sous-total serveur

**Risque prod** 🔴
**Source** — Arbitrage §2bis lot 2. La remise de ligne est aujourd'hui un
**montant libre** envoyé par la caisse, sans plafond.

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

---

### `[S1-11]` Ne plus décrémenter un produit non suivi

**Risque prod** 🔴
**Source** — Arbitrage §2bis lot 4. Un produit dont le suivi est désactivé voit
quand même son compteur décrémenté à la vente : la valeur devient fantôme, et un
produit non suivi est **déjà en négatif** en production.

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
**Source** — Arbitrage §2bis lot 8. Le stock d'une commande B2B sort
aujourd'hui **à la saisie** ; **119 commandes** sont en attente avec un stock
déjà déduit.

**Fichiers**
- `supabase/migrations/<nouveau>` — déplacer la déduction vers le retrait,
  ajouter un garde-fou de suffisance au retrait (le stock négatif reste
  **toujours** bloqué en B2B, ADR-036)
- `supabase/migrations/<nouveau>` — reprise des 119 commandes déjà déduites
- `apps/backoffice/src/features/btob/components/CreateB2bOrderModal.tsx`
- `apps/backoffice/src/features/btob/components/B2bPickupDialog.tsx`
- `apps/backoffice/src/features/btob/__tests__/create-b2b-order-stock.test.ts`
  et `b2b-pickup-dialog.test.tsx` — **à mettre à jour, ils encodent l'ancien
  comportement**
- `supabase/tests/`

**Preuve** — pgTAP : créer une commande B2B ne bouge pas le stock ; le retrait le
bouge ; un retrait sans stock suffisant est refusé même avec le stock négatif
autorisé. Puis relevé du stock des produits des 119 commandes, avant et après la
reprise.

**Attention** — La reprise des 119 commandes est une écriture de masse sur le
stock de production. Elle ne part pas sans `S1-01`.

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

---

### `[S1-17]` Désactiver les deux comptes de taxe hors régime

**Risque prod** 🟠
**Source** — Arbitrage §2bis lot 6. `2143` est actif, postable, cible d'aucun
mapping ; `2142` « VAT Output » est actif, postable, et agrégé au bilan avec la
taxe à payer — dans un plan **NON-PKP**.

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

---

### `[S2-04]` Retirer le planning de production hebdomadaire

**Risque prod** 🟢
**Source** — Arbitrage §2bis lot 9 : table et fonction sans aucun appelant,
**zéro ligne** en production.

**Fichiers** — `supabase/migrations/<nouveau>`.
**Preuve** — Comptage à zéro confirmé en production **avant** la suppression.
Types régénérés.

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

---

### `[S2-08]` Retirer le rapport de rotation des périssables

**Risque prod** 🟢
**Source** — Arbitrage §2bis lot 4. Sa route survivait à la décision ADR-004.
**Fichiers** — la route et sa tuile de hub, nommées dans `01_CARTOGRAPHIE...` §4.
**Preuve** — Le hub passe de 45 à 44 tuiles. Aucune route morte.
**Dépend de** — `S2-01`.

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

---

### `[S2-11]` Corriger le miroir d'énumérations

**Risque prod** 🟢
**Source** — Audit 01 §5.10 : le miroir omet quatre valeurs de statut de
commande. La source unique est Postgres.
**Fichiers** — `packages/domain/src/.../enums.ts` (chemin exact dans
`02_DETTE_TECHNIQUE...`).
**Preuve** — Le miroir liste les 6 valeurs réelles. Un test compare le miroir aux
valeurs de l'énumération générée.

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

---

# Sprint 3 — Features manquantes validées

> Objectif : livrer ce que Mamat a demandé, dans l'ordre base → serveur → écran.
> Rien qui ne soit pas dans ses réponses.

---

### `[S3-01]` Rendre le terminal obligatoire et la session unique par terminal

**Risque prod** 🔴 · **Source** — Arbitrage §2bis lot 2.

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

**Fichiers**
- `supabase/migrations/<nouveau>` — étendre le déclencheur
- `supabase/tests/`

**Preuve** — pgTAP : supprimer une promotion laisse une ligne dans `audit_logs`,
avec un `actor_id` de **profil** et le différentiel en `payload`.

---

### `[S3-13]` Appliquer l'ordre d'affichage des combos au POS

**Risque prod** 🟠 · **Source** — Audit 01 §5.3. L'ordre est enregistré par le
back-office et **jamais appliqué** : le POS trie par nom.

**Fichiers** — La grille de combos du POS et son crochet (chemins dans
`01_CARTOGRAPHIE...` §4).
**Preuve** — L'ordre saisi au back-office est celui affiché au POS. Vitest ciblé.

---

### `[S3-14]` Câbler l'édition du libellé de variante

**Risque prod** 🟢 · **Source** — Audit 01 §5.3. La fonction serveur **et** le
crochet existent ; aucun bouton ne les appelle.
**Fichiers** — La fiche produit, onglet variantes.
**Preuve** — Le libellé se modifie et persiste. Vitest ciblé.

---

### `[S3-15]` Un compte de charge par nature de dépense

**Risque prod** 🟠 · **Source** — Arbitrage §2bis lot 6. **Six** catégories sur
douze atterrissent toutes sur « autres charges ».

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
**Étape 2, troisième lot — développé en dev le 2026-11-11** : les ventes de
combos portent les trois filtres ; les ventes par table ne portent que le moyen
de paiement, choix de l'agent : le rapport ne lit déjà que des commandes sur
place avec une table, et la table est sa dimension. Le lien d'une table vers ses
commandes transporte le filtre. Les familles `get_combo_sales` et
`get_sales_by_table` sont bumpées en dev ; production non touchée.
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
