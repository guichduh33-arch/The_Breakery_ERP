# Audit 04 — Questionnaire d'arbitrage

> **Relevé du 2026-11-09**, branche `master` à `e204d57a`. Production V3
> `yjhhhmjgsmyzyymvixot`, en service depuis le 2026-10-29.
>
> Mode **lecture seule** : aucun fichier applicatif modifié, aucune écriture en
> base. Les mesures de production viennent de `SELECT` sur le catalogue système,
> sur les corps de fonctions live (`pg_get_functiondef`) et sur des comptages.
>
> **Deux règles appliquées sans exception.** Une intention documentée non
> implémentée est du **backlog**, pas une erreur : c'est précisément ce qu'on
> cherche ici. Et un fait vérifié en base l'emporte sur un fichier de migration :
> les corps live ont divergé des fichiers en plusieurs endroits, et c'est signalé
> à chaque fois.

---

## 0. Comment répondre

Chaque question a un identifiant (`C01`, `S04`, …) et quatre réponses possibles.

| Choix | Signification |
|---|---|
| **[A]** | **Coder la fonctionnalité telle que la doc la décrit.** Entre au backlog de fin de projet. |
| **[B]** | **Le code a raison, la doc est périmée.** On met la doc à jour ou on l'archive. |
| **[C]** | **Abandonner l'idée.** On supprime la doc **et** les bouts de code orphelins. |
| **[D]** | **Autre** : vous précisez la vraie règle métier. |

Répondez par l'identifiant et la lettre : `C01 B`, `S04 D : on fait comme ça…`.

Les questions marquées **« tranché par la preuve »** n'attendent pas de réponse :
la base a déjà donné le verdict. Elles sont là pour que la correction ne se
rejoue pas.

---

## 1. Décompte des écarts

Les cinq balayages de domaine ont relevé **environ 150 écarts**. Après
regroupement des écarts de même cause — les codes de permission inventés,
présents dans 8 fiches, font **une** question — il reste **99 questions**.

Répartition des 99 questions par catégorie :

| Catégorie | Questions |
|---|---|
| **[CONTRADICTOIRE]** — le code fait l'inverse de la doc, ou deux docs se contredisent | 32 |
| **[AMBIGU / DANGEREUX]** — règle floue partout, sur l'argent, le stock ou les droits | 26 |
| **[ABSENT DU CODE]** — décrit, rien dans le code, ou coquille vide | 24 |
| **[INACHEVÉ / PARTIEL]** — table sans écran, RPC sans appelant, bouton sans logique | 17 |

Par section de ce document :

| Section | Identifiants | Questions |
|---|---|---|
| Caisse / POS / Commandes / Cuisine | `C01`–`C18` | 18 |
| Écran client | `C19`–`C22` | 4 |
| Impression et réseau local | `C23`–`C25` | 3 |
| Stocks / Inventaire / Vitrine | `S01`–`S14` | 14 |
| Production / Recettes | `P01`–`P08` | 8 |
| Achats / Fournisseurs | `A01`–`A07` | 7 |
| Comptabilité / Taxes / Dépenses | `G01`–`G13` | 13 |
| Reporting | `R01`–`R05` | 5 |
| Catalogue / Promotions / Clients / B2B | `B01`–`B14` | 14 |
| Architecture / Droits / Sécurité / Exploitation | `X01`–`X13` | 13 |
| **Total** | | **99** |

**8 questions sont marquées « tranché par la preuve »** (`C17`, `C23`, `C24`,
`G07`, `G08`, `X06`, `B12`, et `C06` requalifié) : la base a déjà donné le
verdict, elles n'attendent pas de réponse. Il reste donc **91 arbitrages** à
rendre, plus 2 points à confirmer en boutique (`Z01`, `Z02`).

---

## 2. Les 12 questions les plus critiques pour la production

À trancher en premier. Chacune porte sur de l'argent, du stock ou un droit, et
chacune est vérifiée en base.

| # | Sujet | Mesure en production |
|---|---|---|
| **G01** | La vente ne produit **aucune écriture de coût de revient** | CA 529 959 445 IDR pour **1 700 IDR** de COGS |
| **G02** | Les comptes de stock ne se raccordent pas entre eux | `1142` Matières premières à **−34 767 500 IDR** (actif négatif) |
| **G03** | Les comptes d'attente QRIS et carte ne sont jamais soldés | **406 831 000 IDR** immobilisés, aucun rapprochement bancaire fait |
| **S01** | Le FIFO par lot tourne, alors que l'ADR-004 l'interdit | **21 lots actifs** avec date de péremption, créés du 31/10 au 08/11 |
| **X01** | Un seul compte voit le stock et les comptes | `is_business_owner_v1()` = `SUPER_ADMIN` → **`mamat` seul**, 37 RPC concernées |
| **X02** | Un compte désactivé garde ses droits | `has_permission` ne teste **pas** `is_active` (corps live) |
| **B01** | Le crédit B2B n'est jamais contrôlé | **21 clients B2B, les 21 sans plafond**, 24 285 400 IDR d'encours |
| **S02** | L'alerte de stock bas ne peut pas se déclencher | **245 produits suivis sur 249** ont un seuil à 0, `alert_email` vide |
| **G04** | La taxe PB1 n'est pas collectée sur le B2B | 63 534 500 IDR de CA B2B, 4 181 133 IDR de PB1 portée |
| **C01** | Une session de caisse peut couvrir plusieurs jours | **75 heures** pour la plus longue, 2 sessions à cheval |
| **X03** | Aucune sauvegarde autonome, PITR désactivé | 11 jours d'argent réel sur les seules sauvegardes Supabase |
| **X02** | Un compte désactivé garde ses droits | `has_permission` ne teste **pas** `is_active` (corps live) |

> **Une entrée a été retirée de cette liste.** `S03` (« un recomptage de vitrine
> fait disparaître la marchandise sans perte ») était un **faux constat** : le
> sous-agent avait lu la version `v2` de la fonction dans un fichier de
> migration, alors que la version vivante en production est la `v4`, qui ne
> touche plus le stock général. Vérifié sur les corps live. Voir `S03`.

---

## 2bis. Décisions rendues

Répondu en conversation, par lots. Ce tableau est le registre ; les décisions
durables devront être gravées dans un ADR.

### Lot 1 — 2026-11-09

| # | Question | Décision | Conséquence |
|---|---|---|---|
| **G01** | La vente ne produit aucune écriture de coût de revient | **[A] Reconnaître le COGS à la vente** | La vente débite le coût des ventes et relève le stock. **Tranche G02 par la même occasion** : la chaîne de comptes doit être raccordée (achats → matières premières, production → produits finis, vente → COGS). Chantier de money-path : nouvelle version de la RPC de paiement + mapping `SALE_COGS`. |
| **S01** | Le FIFO par lot et les dates de péremption tournent contre l'ADR-004 | **[C] Retirer le FIFO et les lots** | L'ADR-004 redevient vrai. À retirer : le bloc de résolution de lot dans `record_stock_movement_v2`, la création de lots déclenchée par `default_shelf_life_hours`, la lecture POS toutes les 60 s et la surcharge « Expired » des deux grilles. **Tranche S14** (supprimer la route perishable-turnover) et **le sort de `useStockLots.ts`** (rapport 02 §2.4). Décider du devenir des 21 lots existants. |
| **X01** | Un seul compte voit le stock et les états financiers | **[D] Gater sur une permission** | Remplacer `is_business_owner_v1()` par un contrôle de permission dans les 37 RPC concernées et les 7 policies restrictives. Les permissions `reports.inventory.read` et `reports.financial.read` deviennent déléguables depuis l'écran RBAC. **Tranche S13 et P04** : les pages Stock et le chiffrage de faisabilité redeviennent lisibles à qui détient le droit. Le rôle `office` (42 permissions, 0 compte) devient utilisable. |
| **B01** | Les 21 clients B2B sont sans plafond de crédit, 24,3 M IDR d'encours | **[B] Illimité, assumé et écrit** | « Plafond absent = crédit illimité » est la règle. À écrire dans `docs/objectifs/B2B.md` et dans le bilan factuel de l'ADR-020 (déc. 1). Le suivi de l'encours reste humain : **aucun garde-fou applicatif ne sera ajouté**. Le blocage dur `credit_limit_exceeded` ne se déclenchera que sur les clients pour lesquels un plafond est saisi volontairement. |

### Lot 2 — 2026-11-09

| # | Question | Décision | Conséquence |
|---|---|---|---|
| **X03** | Aucune sauvegarde autonome, PITR désactivé, restauration jamais éprouvée | **[A] Installer cette semaine** | Installer la tâche quotidienne sur le PC boutique (`prepare-backup-task.ps1` n'enregistre aujourd'hui aucune tâche), écrire le runbook de restauration, et **éprouver une restauration réelle une fois**. Décider et écrire où est gardée la clé privée `recovery-private.pem` : une sauvegarde chiffrée dont la clé se perd n'est pas une sauvegarde. **Attention X04** : les 3 migrations qui planifient des tâches pointent sur le projet **dev** — à corriger avant d'installer quoi que ce soit en production. |
| **G04** | La PB1 n'est pas collectée sur les ventes B2B | **[B] Exonération confirmée, à écrire** | La livraison B2B n'est pas assujettie au PBJT. À graver dans un ADR et dans `docs/objectifs/B2B.md`, au lieu du commentaire SQL actuel (« HORS CHAMP — décision propriétaire du 2026-07-17 ») invisible à tout contrôle. **Corollaire** : `ACCOUNTING.md:302` (« CR PB1 Payable » sur la vente B2B) est faux et se corrige. Les 4,18 M de PB1 déjà portés sur des commandes B2B proviennent de la reprise historique : à expliquer dans l'ADR. |
| **X02** | Un compte désactivé garde ses droits pendant une heure | **[A] Corriger : ajouter `is_active`** | Ajouter `AND is_active` à `has_permission` et révoquer les sessions à la désactivation (le helper `_revoke_user_sessions_v1` existe déjà, il n'est appelé qu'à la suppression et au changement de rôle). **Tranche X07** : avec une désactivation qui coupe vraiment, l'expiration de PIN n'est plus nécessaire. |
| **S03** | Le recomptage de vitrine | **[D] Règle métier précisée** | « Le stock vitrine n'influence pas le stock général, il est dissocié ; il sert seulement à éviter les ventes sans stock disponible. » **Le code est conforme** — mon constat initial était faux (version `v2` lue dans un fichier au lieu de la `v4` vivante). Aucun développement. Seule action : écrire la règle de dissociation dans `docs/objectifs/INVENTORY.md` §5, où elle manque. |

### Lot 3 — 2026-11-09

| # | Question | Décision | Conséquence |
|---|---|---|---|
| **G03** | 407 M IDR dans les comptes d'attente QRIS et carte, banque à −130 M | **[A] Réparer puis rapprocher** | Livrer les 4 RPC absentes de la production (`bank_reconciliation_post_v5`, `bank_reconciliation_clearing_v3`, `preview_cash_journal_import_v3`, `apply_cash_journal_import_v4` — rapport 01 §5.4), puis rapprocher mois par mois depuis l'ouverture. **Dépend de G13** : tant qu'un règlement B2B en QRIS va en banque et une vente QRIS en compte d'attente, le rapprochement ne tombera pas juste. Traiter G13 **avant** le premier rapprochement. |
| **S04** | L'inventaire applique un écart périmé et compte deux fois | **[A] Poser le stock à la quantité comptée** | La finalisation écrit le stock en **absolu**. Conforme à l'ADR-027 (« la finalisation corrige le stock qui fait autorité »). Nouvelle version de `finalize_opname`. L'écart reste affiché pour l'écriture comptable, mais il n'est plus ce qui est appliqué. À tester : un inventaire dont un produit se vend pendant le comptage. |
| **S05** | Le propriétaire ne peut pas finaliser un inventaire qu'il a compté | **[A] Le propriétaire peut finaliser** | Retirer le refus `independent_approver_required` quand l'approbateur est le propriétaire. Même version de RPC que S04. **La séparation des tâches disparaît donc de l'inventaire** : c'est un choix assumé, à écrire dans le même ADR que S04. |
| **G10** | Clôturer le mois en cours arrête la caisse, rien ne peut rouvrir | **[A] Ouvrir une réouverture gatée** | Nouvelle RPC de réouverture, réservée au propriétaire, avec PIN manager et écriture dans `audit_logs`. À faire **avant** la première clôture de période — aujourd'hui les 24 périodes sont ouvertes, donc le risque n'est pas encore réalisé. |

### Lot 4 — 2026-11-09

| # | Question | Décision | Conséquence |
|---|---|---|---|
| **X04** | 3 migrations planifient des tâches vers le projet **dev** | **[A] Paramétrer l'adresse** | L'adresse du projet passe par un réglage lu en base (coffre Supabase) au lieu d'un littéral. Corriger `20260716000169`, `20260525000011`, `20260525000012`. **À faire avant X03 et avant X05.** |
| **S02** | L'alerte de stock bas ne peut pas se déclencher | **[A] Rendre l'inertie visible** | Bandeau sur l'écran d'alertes : « N produits suivis sans seuil » et « aucune adresse de notification ». Le correctif demandé par l'audit du 2026-08-31 (F6) et jamais repris. Ajouter un `issue_type` à `get_stock_config_issues`. Puis saisie des seuils par Mamat. |
| **G06** | Les dépenses sous 100 000 IDR s'auto-approuvent, par leur créateur | **[B] Laisser ainsi, corriger la doc** | L'auto-approbation sous seuil, **y compris par son créateur**, est la règle voulue. À corriger dans `EXPENSES.md:171` (« si créées par un manager ») et `:50` (« `created_by` et `approved_by` obligatoirement différents »), et dans `DESCRIPTION.md:248` (« personne ne peut valider sa propre dépense »). **Conséquence à surveiller** : la permission `expenses.create` devient un droit sensible — à ne donner qu'à des personnes de confiance. |
| **C01** | Sessions de caisse de plusieurs jours (75 h observées) | **[D] Alerte au-delà de 24 h** | Alerte en caisse et au back-office sur une session ouverte depuis plus de 24 h, **sans fermeture automatique**. À écrire dans `CASH_REGISTER.md:272`, qui dit aujourd'hui que la règle « n'est pas décidée ». |

### Lot 5 — 2026-11-09

| # | Question | Décision | Conséquence |
|---|---|---|---|
| **G13** | Un règlement B2B en QRIS va en banque, une vente QRIS au compte d'attente | **[A] Même règle partout** | `record_b2b_payment` appelle le helper `_sale_payment_mapping_key` au lieu de son `CASE` propre. Exigé par l'ADR-013 D3. **À faire avant le premier rapprochement de G03.** L'historique B2B déjà passé n'est pas reprise : à exclure ou à traiter à part lors du rapprochement. |
| **C04** | Aucune marche arrière au comptage de caisse | **[D] Annuler la dernière clôture** | Plutôt qu'un statut `recounting`, une RPC d'annulation de clôture réservée au propriétaire, qui **contre-passe l'écriture de variance** et remet la session en `open`. À tracer dans `audit_logs`. Retirer le statut `recounting` de `CASH_REGISTER.md` (il n'existera pas). |
| **C10** | La remise de ligne est un montant libre sans plafond | **[A] Plafonner à la ligne** | Le serveur refuse une remise supérieure au sous-total serveur de la ligne. Nouvelle version de la RPC de paiement — **même chantier que G01**, à grouper. Le PIN unique pour tout le ticket reste. |
| **B13** | Le stock B2B sort à la saisie, pas au retrait | **[A] Déduire au retrait** | Déplacer `_record_sale_stock_v1` de `create_b2b_order` vers le geste de retrait (`update_b2b_pickup`). **Conséquences** : il faut un garde-fou de suffisance **au retrait** et non à la saisie, et traiter les **119 commandes en attente** déjà déduites (reprise ponctuelle). Tranche la partie « flag `stock_deducted` » de la fiche B2B, qui décrivait déjà ce fonctionnement. |

### Lot 6 — 2026-11-09

| # | Question | Décision | Conséquence |
|---|---|---|---|
| **X05** | Le module notifications n'est pas déployé en production | **[C] Retirer la promesse** | Pas d'e-mails automatiques. Retirer la promesse d'envoi de `SETTINGS.md:90` et `:99`, et de `DESCRIPTION.md:388` (« modèles réellement utilisés par l'envoi »). Le code reste dormant en base. **Conséquence sur S02** : le bandeau d'inertie de l'alerte de stock ne doit pas promettre d'e-mail — il signale seulement les produits sans seuil. Les 2 Edge Functions restent non déployées, ce qui rend **X04 moins urgent** (il ne reste que la sauvegarde). |
| **G05** | Une dépense espèces sort de la caisse à l'approbation | **[B] Laisser ainsi, corriger la doc** | Pour une dépense en espèces, approbation et paiement sont le même geste. À corriger dans `EXPENSES.md:177` (« une dépense approuvée non payée reste un AP ») et `:180`. **Point de vigilance** : si une dépense espèces est un jour approuvée sans être payée le même jour, le solde de caisse comptable sera faux jusqu'au paiement. |
| **B03** | Un combo ignore le prix négocié et la remise de catégorie | **[B] Prix public assumé, à écrire** | Un combo est une formule à prix fixe, il ne se remise pas. À écrire dans `CUSTOMERS.md:223` (« dès qu'un client est rattaché, les prix sont recalculés selon sa catégorie ») et dans `PRODUCTS.md`. Aucun développement. |
| **X12** | Un compte « test » avec 59 permissions en production | **[B] C'est le compte de Mamat** | Assumé. Noté ici pour qu'une prochaine session ne le signale pas comme anomalie. Rappel : **aucun compte de démonstration du dépôt** (`E2E001`, `EMP000`…) n'est présent en production — vérifié sur les 11 profils. |

### Lot 7 — 2026-11-09

| # | Question | Décision | Conséquence |
|---|---|---|---|
| **B06** | Une promo produit/catégorie se calcule sur le prix envoyé par la caisse | **[A] Corriger avant la 1re promo** | `evaluate_promotions` relit les prix serveur. **Prérequis écrit à la création de votre première promotion ciblée produit ou catégorie.** Tant qu'il n'y a aucune promo (`promotions` = 0 ligne), la faille est dormante. À grouper avec G01 et C10 : même fonction de paiement. |
| **S07** | Le motif d'une perte est du texte libre | **[A] Liste fermée, comme en production** | Étendre un type énuméré Postgres aux pertes de stock **et** de vitrine, sur le modèle de `waste_reason` (ADR-008 D3). Remplacer les littéraux TypeScript de `WasteModal.tsx:26-28` et ajouter une présélection à la perte de vitrine, qui n'en a aucune. Permet enfin de répondre à « combien m'a coûté le périmé ». |
| **A01** | Aucun geste de correction d'une réception erronée | **[D] Annuler la réception** | Nouvelle RPC d'annulation de réception qui contre-passe **tout** : mouvement de stock, coût moyen et dette fournisseur. Plus étroit qu'un retour fournisseur complet, et suffisant pour l'erreur de saisie. **À noter** : la marchandise avariée rendue au fournisseur reste sans chemin — à corriger dans la fiche Achats §3.5. Et le type `purchase_return` restera sans écriture comptable : ne pas l'utiliser. |
| **P05** | La saisie d'écart de rendement est dans un écran mort | **[C] Supprimer les 3 composants** | Supprimer `ProductionForm.tsx`, `YieldVarianceModal.tsx` et `FeasibilityBadge.tsx`, ainsi que leurs tests. Les rapports de rendement montreront l'écart **sans la cause**. Le réglage `production_yield_variance_threshold_pct` devient inutile : à retirer aussi. À corriger dans `PRODUCTION.md:10` (« yield tracking tous livrés en V3 ») et `DESCRIPTION.md:316`. |

### Lot 8 — 2026-11-09

| # | Question | Décision | Conséquence |
|---|---|---|---|
| **Bloc documentaire** | ~40 écarts où la doc annonce un nom, un statut, un compteur ou un code de permission inexistant | **Bloc global — correction sans arbitrage individuel** | Je corrige l'ensemble de la documentation contre le code réel. **Chaque correction est listée au §13 de ce document** pour être contestable après coup. Couvre notamment : les 24 codes de permission inventés dans 8 fiches (`X11`), les statuts de commande (`C13`), de bon d'achat (`A03`), de dépense (`G22`), de période fiscale (`G10`), le plan comptable (`G07`), la longueur du PIN (`X06`), les compteurs nus, et les ~20 rapports décrits au présent et inexistants (`R01`). |
| **S12** | Réservation de stock : table, RPC, module, filtres — aucun appelant | **[C] Tout retirer** | Supprimer la table `stock_reservations`, `reservation_hold_v1` / `reservation_release_v1` / `reservation_consume_v1`, le module `reservationCalculator.ts`, et **les deux filtres de l'écran Mouvements** qui ne ramènent jamais rien. Retirer aussi `release_expired_reservations` de la liste des tâches à planifier. |
| **B04** | La remise par palier de fidélité est promise 4 fois et n'existe pas | **[C] Retirer la promesse** | Retirer la colonne « Remise » de `CUSTOMERS.md:123-128`, ainsi que `:31`, `:130` et `:224`. Les paliers gardent leur rôle de **multiplicateur de points** uniquement. Demandé par l'ADR-020 §4 dès le 2026-08-02. Idem pour « Bonus anniversaire configurable » et « Livraison offerte » du même tableau. |
| **A02** | Ni frais de port ni remise sur une commande fournisseur | **[A] Port et remises** | Ajouter les frais de livraison et l'escompte (global et par ligne) sur `purchase_orders` / `purchase_order_items`. Le calcul de répartition au prorata existe déjà en module (`landedCostAllocation.ts`, sans appelant) : il devient utilisé. **Effet attendu** : le coût moyen cesse d'être pollué par un port intégré aux prix unitaires. |

### Lot 9 — 2026-11-09

| # | Question | Décision | Conséquence |
|---|---|---|---|
| **Bloc technique** | 9 filets manquants et nettoyages sans enjeu métier | **Bloc global** | Détail au **§14**. En rédigeant la liste j'en ai trouvé un **dixième** de même nature, que j'y ai ajouté : `A06`, étendre au `DELETE` le trigger d'audit des promotions — seul des 7 triggers du 2026-11-04 à ne pas le couvrir. Couvre donc : `X13` vérification `deno check` + `deno lint` des 19 Edge Functions en intégration continue · `G12` contrainte d'équilibre sur `journal_entries` · `G08` désactiver le compte 2143 (doublon PB1 dormant mais postable) · `G09` désactiver le compte 2142 (TVA de sortie, hors champ NON-PKP, **agrégé au bilan dans la taxe à payer**) · `R02` supprimer la vue `mv_pl_monthly` jamais peuplée · `X09` retirer `audit_log.read`, `users.view_audit` et `settings.kiosk.manage` du catalogue (ne contrôlent rien) · `X10` exiger `settings.security.manage` pour écrire la politique de PIN · `X08` évaluer la faiblesse du PIN côté serveur et la consigner · `S14` supprimer la route, la page et la RPC du rapport perishable-turnover (suit la décision S01). |
| **C03** | La clôture n'enregistre aucun total figé | **[A] Figer les totaux à la clôture** | Ajouter à `pos_sessions` les totaux par moyen de paiement, le chiffre d'affaires et le nombre de commandes, écrits par `close_shift`. **À grouper avec C04** (annulation de clôture) : même RPC. Permet enfin un contrôle a posteriori et un rapprochement stable. |
| **G11** | 6 catégories de dépense sur 12 atterrissent au même compte | **[A] Créer les comptes dédiés** | Créer un compte par nature (transport, assurance, taxes, frais bancaires, bureau) et réaffecter les catégories depuis l'écran — geste applicatif, pas une migration. Corriger `EXPENSES.md:203-216`, dont les 12 codes cibles **n'existent pas**. Le résultat cesse d'agréger la moitié des charges en « autres ». |
| **C08** | L'écran des ardoises est une liste plate sans ancienneté | **[A] Ancienneté et historique** | Ajouter l'ancienneté visuelle, le regroupement par client et l'historique des ardoises soldées, conformément à `POS.md:279-285`. **Et ajouter des tests** : cet écran encaisse (`settle_pos_outstanding`) et n'en a aucun. 6 ardoises ouvertes, 769 000 IDR, la plus ancienne du 2026-11-03. |

### Lot 10 — 2026-11-09

| # | Question | Décision | Conséquence |
|---|---|---|---|
| **P08** | Le revert d'une fournée partiellement vendue n'a aucun chemin | **[D] Ajustement sur les deux sens** | Permettre un ajustement de stock qui porte **à la fois** sur le produit fini et sur les matières consommées, saisi par le propriétaire. Moins automatique qu'une contre-passation au prorata, mais ça débloque le cas. Corriger le message d'erreur de `revert_production`, qui renvoie aujourd'hui vers un geste insuffisant. Répond à la question D-19, ouverte depuis l'ADR-008. |
| **S06** | Le circuit déclaration → approbation de stock n'est documenté nulle part | **[A] Graver la règle dans un ADR** | Écrire qui déclare, qui approuve, et ce qui se passe entre les deux (le stock et la comptabilité surévaluent la marchandise pendant l'attente). Définir une cadence de traitement de la file. **3 déclarations sont en attente** : à traiter. Pas d'alerte automatique (cohérent avec la décision X05). |
| **A04** | La fiche fournisseur compte « payé » une commande à crédit jamais payée | **[A] Brancher sur le vrai ledger** | `useSupplierMetrics` lit `purchase_payments` au lieu de déduire l'impayé du statut de la commande. Une seule réponse à « combien je lui dois ». 123 commandes et 51 paiements en production. |
| **S09** | Un produit non suivi voit son compteur décrémenté | **[A] Ne plus décrémenter** | Rendre l'`UPDATE products SET current_stock` conditionnel à `track_inventory`. Supprime la valeur fantôme à la source. Demandé sans arbitrage depuis l'audit du 2026-08-31 (F7). **Tranche S10 et S11** : le filtre manquant de `get_low_stock` et la garde B2B sur produit non suivi deviennent sans objet — à vérifier quand même. |

---

## 3. Caisse / POS / Commandes / Cuisine

### C01 — Une session de caisse peut rester ouverte plusieurs jours
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `docs/objectifs/CASH_REGISTER.md:272` — « aucune fermeture automatique n'est livrée […] ce qui doit se passer au-delà de 24 h **n'est pas décidé** »
- **Code** : aucune tâche planifiée, aucune alerte (`grep -rni "stale session\|auto_close" apps supabase` → rien)
- **Production** : 22 sessions, **2 à cheval sur plusieurs jours**, durée maximale **75 heures**
- **Enjeu** : `expected_cash` mélange trois journées d'exploitation dans un seul écart ; l'écart devient non imputable et produit une écriture comptable fausse.
- **Choix** : **[A]** clôture automatique à minuit · **[D]** simple alerte au-delà de 24 h · **[B]** on laisse ainsi
- **Ma recommandation** : **[D]** — une alerte, pas une clôture automatique : clôturer sans compter physiquement créerait un écart pire.

### C02 — Deux employés peuvent ouvrir une session sur le même tiroir
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `docs/objectifs/CASH_REGISTER.md:50` — « Une session par utilisateur **par terminal** »
- **Code** : `supabase/migrations/20260503000003_init_pos.sql:16` — la contrainte d'exclusion porte sur l'utilisateur seul
- **Production** : **6 sessions sur 22 sans terminal renseigné** ; le champ est facultatif (`OpenShiftModal.tsx:336` propose « (no terminal selected) »)
- **Enjeu** : deux `expected_cash` qui se partagent le même argent physique.
- **Choix** : **[A]** une session par terminal + terminal obligatoire · **[B]** la règle réelle est « par utilisateur » · **[D]**
- **Ma recommandation** : **[A]** — rendre le terminal obligatoire d'abord ; c'est le préalable de tout rattachement d'écart.

### C03 — La clôture ne figent ni les totaux par méthode, ni le chiffre d'affaires
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Doc** : `docs/objectifs/CASH_REGISTER.md:160-161` — « Calcule et **persiste** les totaux par méthode. Calcule `total_sales` et `total_orders` »
- **Code** : `pos_sessions` porte `closing_cash, expected_cash, variance_total, counted_card, counted_qris, …` — **pas** `total_sales`, `total_orders`, `manager_validated`, `actual_cash` (colonnes relevées en base)
- **Enjeu** : les totaux sont recalculés à chaque lecture contre une base qui bouge (règlements d'ardoises postérieurs). Aucun chiffre figé pour un contrôle a posteriori.
- **Choix** : **[A]** figer les totaux à la clôture · **[B]** le recalcul suffit · **[D]**
- **Ma recommandation** : **[A]** — un Z-report est un document de clôture ; il doit être figé.

### C04 — Le statut intermédiaire `recounting` n'existe pas
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `docs/objectifs/CASH_REGISTER.md:171` — « Le système **prévoit** un statut intermédiaire `recounting` »
- **Code** : `shift_status` = `open | closed` (enum relevé en base). Zéro occurrence de `recount` sur un shift.
- **Enjeu** : « j'ai oublié les billets du fond du tiroir » n'a aucune marche arrière : soit on clôture avec un écart faux — et l'écriture comptable de variance est fausse — soit on ne clôture pas.
- **Choix** : **[A]** livrer `recounting` · **[B]** retirer la promesse de la fiche · **[D]**
- **Ma recommandation** : **[A]** — c'est le seul geste qui évite une fausse écriture comptable quotidienne.

### C05 — Le numéro de session lisible
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `CASH_REGISTER.md:67` dit « **n'est pas livré** » et `:72` dit « **Génère** le `session_number` ». La fiche se contredit.
- **Code** : aucune colonne de numérotation ; une session ne se désigne que par UUID.
- **Choix** : **[A]** livrer `SHF-YYYYMMDD-NN` · **[B]** corriger la ligne 72 · **[D]**
- **Ma recommandation** : **[A]** — le comptable a besoin d'une référence lisible.

### C06 — La monnaie rendue n'est pas arrondie à 100 IDR
- **Catégorie** : [ABSENT DU CODE] — **risque théorique aujourd'hui**
- **Doc** : `docs/objectifs/POS.md:205` — « monnaie à rendre, **arrondie à 100 IDR** »
- **Code** : `apps/pos/src/features/payment/components/QuickPayRow.tsx:47` → `draftAmount - total`, sans arrondi
- **Production** : **0 commande et 0 paiement non multiples de 100** — `round_idr` tient tout aux centaines aujourd'hui
- **Choix** : **[A]** arrondir · **[B]** `round_idr` suffit · **[C]** retirer la mention
- **Ma recommandation** : **[B]** — à revoir seulement si une remise libre casse un jour l'arrondi.

### C07 — Le statut `unpaid` n'existe pas
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `docs/objectifs/POS.md:227` et `:281` — « la commande passe en statut `unpaid` »
- **Code** : `order_status` = `draft, paid, voided, pending_payment, completed, b2b_pending`. L'ardoise est un `pending_payment` porteur de `outstanding_at`.
- **Production** : **6 ardoises ouvertes, 769 000 IDR**, du 2026-11-03 au 2026-11-08
- **Enjeu** : toute requête écrite d'après la fiche renvoie zéro ligne. Une ardoise invisible est de l'argent qu'on n'encaisse pas.
- **Choix** : **[B]** corriger la fiche · **[D]**
- **Ma recommandation** : **[B]**.

### C08 — La vue des ardoises n'a ni ancienneté, ni historique, ni regroupement par client
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `docs/objectifs/POS.md:279-285` — « Par client : combien depuis quand. **Vieillissement visuel.** Bouton "POS Outstanding History" »
- **Code** : `apps/pos/src/features/outstanding/OutstandingPage.tsx` = 57 lignes, liste plate paginée, **aucun test** (phase 1)
- **Production** : 6 ardoises, la plus ancienne du 2026-11-03
- **Choix** : **[A]** livrer ancienneté + historique · **[C]** liste plate suffisante · **[D]**
- **Ma recommandation** : **[A]** — avec 6 ardoises c'est tenable, mais c'est l'écran qui dit quoi relancer.

### C09 — Le PIN de remise : seuil ou systématique
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `POS.md:132` — « PIN manager requis **si la remise dépasse le seuil** » ; `docs/product/DESCRIPTION.md:66` dit l'inverse et a raison
- **Code** : `apps/pos/src/features/discounts/mintDiscountAuthorization.ts:6` — PIN exigé **toujours**, aucun seuil lu
- **Enjeu** : une session qui lit `POS.md` peut « corriger » le code et ouvrir la petite remise sans contrôle.
- **Choix** : **[B]** corriger `POS.md` (contrôle systématique) · **[A]** introduire un seuil · **[D]**
- **Ma recommandation** : **[B]** — ne pas desserrer un contrôle anti-fraude qui fonctionne.

### C10 — La remise de ligne est un montant libre, sans plafond
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `docs/objectifs/PROMOTIONS_AND_COMBOS.md:52` — « pas de "ristourne cachée" sans nom »
- **Code** : `20261031000040_confidential_money_errors_1.sql:134` — `v_line_discount := COALESCE((v_item->>'discount_amount')::DECIMAL, 0)` repris tel quel, **sans plafond** ; seule garde : total global ≥ 0. Un seul PIN couvre **toutes** les lignes du ticket.
- **Enjeu** : un poste peut répartir des remises arbitraires ligne par ligne, y compris supérieures au sous-total d'une ligne.
- **Choix** : **[A]** plafonner la remise au sous-total serveur de la ligne · **[B]** le total ≥ 0 suffit · **[D]**
- **Ma recommandation** : **[A]** — c'est deux lignes de SQL au prochain bump.

### C11 — Le pickup tablette remet la commande en `draft`
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : ADR-022 déc. 4 — « ce qui n'a pas franchi la cuisine ou le paiement est un **brouillon**, il ne porte pas de numéro et ne s'écrit pas dans `orders` »
- **Code** : `supabase/migrations/20260507000004_pickup_tablet_order_rpc.sql:26-32` — `UPDATE orders SET status = 'draft'`
- **Production** : **2 commandes en `draft`, les 2 déjà parties en cuisine, les 2 avec un numéro de commande**
- **Enjeu** : tout rapport qui exclut `draft` comme « brouillon » perd ces commandes en cours de paiement.
- **Choix** : **[A]** le pickup conserve `pending_payment` · **[B]** `draft` est voulu ici · **[D]**
- **Ma recommandation** : **[A]** — la sémantique de l'ADR-022 est la bonne, le code doit s'y plier.

### C12 — Pas de son « commande prête » hors de l'écran cuisine
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `ORDERS.md:47` (invariant), `:263` (`playOrderReadySound`), `KDS.md:146`, `POS.md:338` (`useKdsStatusListener`) — quatre citations
- **Code** : `playOrderReadySound` et `useKdsStatusListener` → **0 occurrence dans tout le dépôt**. Le seul moteur sonore est `useKdsAlarm.ts`, sur `/kds`.
- **Choix** : **[A]** livrer le signal au comptoir · **[C]** abandonner · **[D]**
- **Ma recommandation** : **[A]** — c'est le bénéfice annoncé (« le manager n'a pas besoin de fixer l'écran »).

### C13 — Les statuts de commande `preparing` / `ready` / `refunded` n'existent pas
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `ORDERS.md:116-124`, `:243`, `:254` ; `KDS.md:146`
- **Code** : ADR-025 déc. 3 les a **tués explicitement**, et `apps/backoffice/src/features/orders/statusMeta.ts:27-34` le commente (« morts avec la refonte »)
- **Enjeu** : la fiche décrit l'écran que l'ADR a supprimé. Elle sera relue comme du retard à solder.
- **Choix** : **[B]** réécrire `ORDERS.md` sur l'énuméré réel · **[A]** livrer les statuts · **[D]**
- **Ma recommandation** : **[B]** — l'ADR-025 est acté et implémenté.

### C14 — La station « Waiter » (vue serveur consolidée) n'existe pas
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `KDS.md:34` (`hot_kitchen`), `:37` (`waiter`, « toutes stations consolidées ») ; `apps/pos/PRODUCT.md:134` « quatre postes »
- **Code** : `packages/domain/src/kitchen/types.ts:20` — `'kitchen' | 'barista' | 'display' | 'none'`. Trois stations au sélecteur. `hot_hitchen` n'existe pas.
- **Choix** : **[A]** livrer la vue serveur consolidée · **[B]** corriger la fiche sur 3 stations · **[D]**
- **Ma recommandation** : **[B]** d'abord (la fiche est fausse), **[A]** en backlog si la salle le demande.

### C15 — Les réglages KDS sont globaux, pas par station
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Doc** : `KDS.md:122` — seuils « configurables **par station** » ; `:256-261` — sons par station, volume, disposition, police
- **Code** : trois clés org-wide sur `business_config` (`kds_warning_threshold_minutes`, `kds_urgent_threshold_minutes`, `kds_auto_archive_minutes`). Son : un seul interrupteur global.
- **Choix** : **[A]** passer au grain station · **[B]** corriger la fiche · **[D]**
- **Ma recommandation** : **[B]** — le four et la pâtisserie peuvent partager un seuil tant qu'il y a trois stations.

### C16 — Le changement de station KDS n'est pas protégé
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `KDS.md:67-75` — « plein écran […] le retour au sélecteur exige une action explicite (long press) pour éviter qu'un cuisinier sorte par erreur »
- **Code** : `KdsStationSelector.tsx:22-38` — barre d'onglets permanente, simple tap
- **Choix** : **[A]** protéger le changement · **[B]** corriger la fiche · **[D]**
- **Ma recommandation** : **[A]** — mains farinées, écran tactile.

### C17 — Le KDS hors ligne est livré, deux documents le nient
- **Catégorie** : [CONTRADICTOIRE] — **tranché par la preuve**
- **Doc** : `KDS.md:287` « ne supporte pas la persistance offline » et backlog `:301`
- **Code** : livré — `kdsOfflineStore.ts`, `offlineItemStatus.ts`, `offlineKitchenJournal.ts`, `offlineKitchenReplay.ts`, `offlineKitchenReconciliation.ts`, `useKdsOfflineBus.ts`
- **Action** : retirer la limite et l'item de backlog. Aucune décision requise.

### C18 — Le serveur qui a saisi la commande n'apparaît pas au comptoir
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Doc** : `TABLET_ORDERING.md:169` — « numéro, table, **serveur**, ancienneté, note cuisine, montant » (« pour les tips, les performances staff, les litiges »)
- **Code** : le panneau dédié n'est monté nulle part ; les commandes de salle arrivent dans « Held Orders », dont la requête (`useHeldOrdersQuery.ts:35`) ne ramène pas le serveur
- **Choix** : **[A]** afficher le serveur · **[C]** abandonner · **[D]**
- **Ma recommandation** : **[A]** — une colonne à ajouter à une requête existante.

---

## 4. Écran client

### C19 — Le panier n'arrive pas sur un écran posé sur un autre appareil
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `CUSTOMER_DISPLAY.md:157` — « Le Customer Display est un **client LAN** qui écoute le hub POS » ; tableau de messages `:161-165`
- **Code** : `apps/pos/src/features/display/displaySource.ts:9-11` — le canal est un `BroadcastChannel` **du même navigateur** (`breakery-cart:<session>`), ouvert en popup. Le display ne s'abonne à **aucun** topic du bus LAN.
- **Production** : `display_screens` = **0 ligne**, `kiosk_devices` = **0 ligne** — aucun écran n'est appairé
- **Choix** : **[A]** faire passer le panier par le bus LAN · **[B]** corriger la fiche (popup du même poste) · **[D]**
- **Ma recommandation** : **[B]** puis **[A]** en backlog — l'usage réel aujourd'hui est la popup.

### C20 — Remises, palier et points en direct absents du panier affiché
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `CUSTOMER_DISPLAY.md:68-72` — « ligne dédiée avec nom et montant de la promo […] palier fidélité, **points gagnés en direct** »
- **Code** : le message `cart_update` ne transporte que lignes, type de commande, totaux et nom du client. Les points n'apparaissent qu'**après** le paiement.
- **Choix** : **[A]** enrichir le message · **[C]** abandonner · **[D]**
- **Ma recommandation** : **[A]** pour la ligne de promo seulement — c'est le point où un client conteste.

### C21 — Six des neuf réglages d'écran client n'existent pas
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `CUSTOMER_DISPLAY.md:185-193` — idle timeout, intervalle de rotation, son sur « prêt », QR wifi, animation fidélité, thème
- **Code** : 4 clés réelles seulement (`display_footer_message`, `display_slogan`, `display_show_ready_orders`, `display_showcase_product_ids`). Rotation codée en dur à 8 s (`ShowcasePanel.tsx:33`).
- **Production** : `display_showcase_product_ids` = `[]` → **la vitrine est vide**, `display_show_ready_orders` = `false`
- **Choix** : **[B]** réduire la fiche aux 4 réglages réels · **[A]** livrer les 6 autres · **[D]**
- **Ma recommandation** : **[B]** — et d'abord **remplir la vitrine**, qui est la seule chose que l'écran sait faire aujourd'hui.

### C22 — Pas d'atténuation d'écran après inactivité
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `CUSTOMER_DISPLAY.md:51` — **invariant 4** : « Économie d'énergie après 30 min idle »
- **Code** : aucun minuteur d'atténuation dans `features/display`
- **Choix** : **[A]** livrer · **[C]** retirer l'invariant · **[D]**
- **Ma recommandation** : **[C]** — un écran de boutique s'éteint avec la boutique.

---

## 5. Impression et réseau local

### C23 — L'invariant « pas de file d'impression, pas de relance » est faux
- **Catégorie** : [CONTRADICTOIRE] — **tranché par la preuve**
- **Doc** : `PRINTING_AND_DEVICES.md:37-39`, `:47-48`, `:86` ; et son 🔴 le plus visible `:110-112` « aucun geste de réparation »
- **Code** : le journal **est** persistant (`printJobs.ts:19-22`, `localStorage`) et le bouton de relance **existe** (`PrintJobsPanel.tsx:39-42`, « Reprint duplicate »)
- **Enjeu** : une session qui prend la fiche au mot peut supprimer le journal « au nom de l'invariant » — c'est-à-dire la seule trace d'un ticket non sorti.
- **Action** : réécrire l'invariant §2 et fermer le 🔴. Aucune décision requise.

### C24 — Le « secret partagé de boutique » n'est plus le modèle de sécurité
- **Catégorie** : [CONTRADICTOIRE] — **tranché par la preuve**
- **Doc** : `PRINTING_AND_DEVICES.md:81-83` — « En son absence, le hub **accepte tout appareil du réseau local** »
- **Code** : ADR-034 livré autrement — autorisation **par appareil** (`x-lan-device-code` + `x-lan-secret`), permissions par topic (`busPolicy.ts:14-24`), `timingSafeEqual`. `HUB_TOKEN` / `shared secret` → 0 occurrence.
- **Action** : réécrire §4. Le `README.md` de `print-bridge` porte la même erreur et **empêche de démarrer le pont** (rapport 03).

### C25 — Le runbook de mise en service du hub n'est pas écrit
- **Catégorie** : [ABSENT DU CODE] (dette documentaire due)
- **Doc** : `PRINTING_AND_DEVICES.md:105-106` et `:113-114` — « dû, non écrit »
- **Code** : `ls docs/runbooks` → aucun runbook de hub. ADR-034 l'exige avant production.
- **Enjeu** : le hub est en production depuis le 2026-10-29 ; les gestes de remise en service après panne du PC boutique ne sont écrits nulle part.
- **Choix** : **[A]** l'écrire maintenant · **[D]**
- **Ma recommandation** : **[A]** — c'est une demi-journée et ça protège la caisse.

---

## 6. Stocks / Inventaire / Vitrine

### S01 — Le FIFO par lot et les dates de péremption tournent, l'ADR-004 les interdit
- **Catégorie** : [CONTRADICTOIRE] — **le plus net de l'audit**
- **Doc** : `docs/adr/004-pas-de-peremption-ni-fifo-stock.md:6` — « ni dates de péremption, ni expiration automatique, **ni consommation FIFO** » ; `INVENTORY.md:79` — « `stock_lots` existe, elle est **dormante et assumée telle** »
- **Code, vérifié sur le corps live en production** : `record_stock_movement_v2` — la primitive d'écriture de **tout** le ledger — contient le tri `ORDER BY expires_at ASC NULLS LAST, created_at ASC` et décrémente `stock_lots`. `create_stock_lot_v1` et `_kitchen_stock_lot_v1` lisent `default_shelf_life_hours` et créent les lots. **10 fonctions live touchent `stock_lots`.**
- **Production** : **21 lots actifs**, créés du **2026-10-31 au 2026-11-08**, **tous avec une date de péremption**. 8 produits portent une durée de conservation.
- **Précision** : `_resolve_fifo_lot` n'a aucun appelant — la logique a été **recopiée** dans la primitive. Chercher le helper seul fait conclure à tort que c'est dormant.
- **Enjeu** : une mécanique de lots avec péremption tourne sur de l'argent réel, non lue en aval, et `mark_expired_lots_hourly` n'est jamais planifiée — donc les lots ne basculent jamais en `expired`. Le POS lit `stock_lots` **toutes les 60 s** sur les deux grilles et peut désactiver une tuile « Expired ».
- **Choix** : **[A]** assumer le FIFO et l'écrire dans un nouvel ADR qui supersède l'ADR-004 · **[C]** retirer le bloc de lot de la primitive et la lecture POS · **[D]**
- **Ma recommandation** : **[C]** — l'ADR-004 a été pris pour de bonnes raisons (une boulangerie ne pilote pas ses lots) ; du code vivant que personne ne lit est un piège, pas une fonctionnalité.

### S02 — L'alerte de stock bas ne peut pas se déclencher
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Doc** : `docs/product/DESCRIPTION.md:156` — « alerte visuelle sous le seuil (seuil réglable produit par produit) », donné pour **livré**
- **Code** : `_trg_notify_low_stock` sort immédiatement si `alert_email IS NULL` ; `get_low_stock_v4` filtre `min_stock_threshold > 0`
- **Production** : **245 produits suivis sur 249 ont un seuil à 0**, et `alert_email` est **vide**
- **Enjeu** : l'écran d'alertes affiche une liste vide qui se lit comme « tout va bien », alors qu'il n'a rien à comparer.
- **Choix** : **[A]** rendre l'inertie visible à l'écran (bandeau « N produits sans seuil ») · **[D]** saisir les seuils d'abord · **[B]**
- **Ma recommandation** : **[A]** puis **[D]** — l'écran doit dire qu'il ne sait pas, et les seuils des 20 produits qui comptent se saisissent en une heure.

### S03 — La vitrine est dissociée du stock général — **constat initial erroné, corrigé**
- **Catégorie** : **aucune — ce n'était pas un écart**
- **Ce que j'avais écrit, et qui était faux** : « `waste_display_stock` décrémente la vitrine **et** le stock général **et** émet une écriture comptable, alors que `adjust_display_stock` ne fait rien de tout cela ». Le sous-agent avait lu `waste_display_stock_v2` dans `20260908000002_display_rpcs_v2_audit_logs.sql`. **La version vivante en production est la `v4`.**
- **Code, vérifié sur les corps live des 6 RPC de vitrine** : `add_display_stock_v4`, `adjust_display_stock_v6`, `waste_display_stock_v4`, `return_display_to_kitchen_v4`, `correct_display_day_count_v1`, `submit_display_day_closing_v1` — **aucune** ne touche `products.current_stock`, **aucune** n'écrit de mouvement de stock général, **aucune** n'émet d'écriture comptable.
- **Règle métier posée par Mamat le 2026-11-09** : « le stock vitrine n'influence pas le stock général, il est dissocié ; il sert seulement à éviter les ventes sans stock disponible. » Le code est conforme.
- **Traçabilité, vérifiée en production** : le journal de vitrine **distingue bien** les quatre gestes.

  | Type | Mouvements | Quantité | Période |
  |---|---|---|---|
  | `sale` | 1 416 | −1 866,57 | 31/10 → 08/11 |
  | `stock_in` | 398 | +2 491 | 31/10 → 08/11 |
  | `waste` | 8 | −14 | 31/10 → 06/11 |
  | `adjustment` | 4 | **−30** | 31/10 → 04/11 |

- **Seule observation d'exploitation** : en 9 jours, **30 unités** ont quitté la vitrine par recomptage contre **14** par perte déclarée. Les deux sont tracés et distinguables ; c'est une habitude de saisie, pas un défaut de code. À regarder si vous voulez que la cause d'un retrait soit toujours motivée.
- **Action** : la règle de dissociation doit être **écrite** dans `docs/objectifs/INVENTORY.md` §5 — aujourd'hui elle ne vit que dans un commentaire de table et dans l'ADR-036. Aucun développement.

### S04 — L'inventaire applique un écart périmé
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `docs/adr/027-stock-global-mono-section.md:42` — « la finalisation **corrige le stock qui fait autorité** »
- **Code** : `expected_qty` est figé **à l'ajout de la ligne** ; `variance` est une colonne générée ; la finalisation émet un mouvement **delta** `±ABS(variance)` sur le stock **courant**. Aucune relecture entre l'ajout et la finalisation.
- **Production** : 3 inventaires, 2 finalisés
- **Enjeu** : toute vente, perte ou production survenue entre l'ajout de la ligne et la finalisation est comptée **deux fois**. Après finalisation, le stock ≠ la quantité comptée. Le workflow actuel (comptage → revue → approbation par un tiers) **allonge** cette fenêtre.
- **Choix** : **[A]** la finalisation pose le stock à la quantité comptée (absolu) · **[B]** le delta est voulu · **[D]**
- **Ma recommandation** : **[A]** — un inventaire physique est par définition un absolu.

### S05 — Le propriétaire ne peut pas finaliser un inventaire qu'il a compté
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : aucun ADR ne traite la séparation des tâches de l'inventaire
- **Code** : `finalize_opname_v6` exige `is_business_owner_v1()` **et** refuse si l'approbateur a compté (`independent_approver_required`)
- **Production** : un seul compte SUPER_ADMIN (`mamat`)
- **Enjeu** : dans une boulangerie où le propriétaire compte lui-même, **aucun inventaire ne peut être finalisé** — et l'inventaire est le seul mécanisme qui résorbe l'écart entre le grand livre et la valorisation.
- **Choix** : **[A]** le propriétaire peut finaliser ce qu'il a compté · **[D]** un second compte SUPER_ADMIN · **[B]** la règle est voulue
- **Ma recommandation** : **[A]** — la séparation des tâches est saine mais elle bloque ici le seul chemin de régularisation.

### S06 — Un workflow de déclaration / approbation de stock existe sans un mot de documentation
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `grep -rln "stock_declaration" docs/` → **0 fichier**. `DESCRIPTION.md:159` décrit « déclaration de perte avec motif » sans mention d'approbation.
- **Code** : `stock_declarations` (`20261031000001`), `CHECK(reviewed_by <> declared_by)`, approbation réservée au propriétaire. Le geste « waste » du back-office ne touche **plus** le stock : il soumet une déclaration.
- **Production** : **3 déclarations en attente**, seul `mamat` peut les traiter
- **Enjeu** : la règle qui décide **quand une perte réelle entre en comptabilité** vit dans un commentaire d'en-tête de migration. Entre la déclaration et l'approbation, le stock et le grand livre surévaluent la marchandise. Aucune cadence, aucune alerte.
- **Choix** : **[A]** graver le workflow dans un ADR · **[D]**
- **Ma recommandation** : **[A]** — et vider la file des 3 déclarations.

### S07 — La raison d'une perte est du texte libre, personne ne l'agrège
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `ADR-004:6` — la péremption est « gérée opérationnellement par **déclaration de perte** (raison `Expired`) » ; `AGENTS.md` — « Enums : source unique = Postgres »
- **Code** : `WasteModal.tsx:26-28` — littéraux TypeScript `'Expired' | 'Damaged' | 'Spoiled' | 'Other'` envoyés dans une colonne texte libre. La vitrine n'offre même pas de présélection. **La production, elle, a bien son enum** (`waste_reason` = mis_baked, poor_proofing, cosmetic, demo, recipe_test, tasting).
- **Enjeu** : la réponse de l'ADR-004 à la péremption repose sur une chaîne qu'aucune contrainte ne garantit. On ne peut pas répondre à « combien m'a coûté le périmé ce mois-ci » — qui était le motif du modèle retenu.
- **Choix** : **[A]** étendre un enum Postgres aux pertes de stock et de vitrine · **[B]** le texte libre suffit · **[D]**
- **Ma recommandation** : **[A]** — la même décision a été jugée indispensable pour la production (ADR-008 D3).

### S08 — Une perte sur un produit à coût nul n'a aucun impact comptable
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : aucun document ne l'énonce
- **Code, corps live** : `tr_stock_movement_je` → `IF v_value <= 0 THEN RETURN NEW`
- **Production** : **14 produits suivis à coût zéro**
- **Choix** : **[A]** l'énoncer dans `INVENTORY.md` §4 · **[D]** interdire un mouvement valorisé à zéro · **[B]**
- **Ma recommandation** : **[A]** — et vérifier pourquoi 14 produits suivis n'ont pas de coût.

### S09 — Un produit non suivi voit quand même son stock décrémenté
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `DESCRIPTION.md:164` — le réglage de stock négatif vaut « **pour les produits suivis** »
- **Code** : la garde de solde est conditionnelle, mais l'`UPDATE products SET current_stock = …` qui suit est **inconditionnel**
- **Production** : **1 produit non suivi en stock négatif** ; 5 produits suivis en négatif
- **Enjeu** : `current_stock` porte une valeur fantôme ; c'est le prochain lecteur qui oubliera le filtre qui paiera (voir S10).
- **Choix** : **[A]** cesser de décrémenter si `track_inventory = false` · **[B]** la valeur fantôme est inoffensive · **[D]**
- **Ma recommandation** : **[A]** — demandé sans arbitrage depuis l'audit du 2026-08-31 (F7).

### S10 — `get_low_stock` est la seule lecture sans filtre `track_inventory`
- **Catégorie** : [CONTRADICTOIRE]
- **Code** : deux bumps depuis le constat de 2026-08-31 (F8), aucun n'a ajouté le filtre. Les cinq autres lecteurs de stock l'ont.
- **Choix** : **[A]** ajouter le filtre au prochain bump · **[B]** · **[D]**
- **Ma recommandation** : **[A]** — une ligne de SQL.

### S11 — La garde de stock B2B s'applique aussi aux produits non suivis
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `ADR-036:20-21` — « **Les règles de consommation des produits suivis** […] restent applicables au stock général »
- **Code** : `20261102000061:55-61` — `ELSIF v_track OR v_is_b2b THEN …`, et `p_allow_negative` est **ignoré** pour le B2B
- **Enjeu** : une commande B2B contenant un article non suivi au stock négatif (café, boissons) est **refusée**, sans échappatoire. L'ADR limitait la règle aux produits suivis.
- **Choix** : **[A]** limiter la garde aux produits suivis · **[B]** la garde large est voulue · **[D]**
- **Ma recommandation** : **[A]** — conforme à l'ADR-036.

### S12 — Les réservations de stock : table, RPC, module, filtres — zéro appelant
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Doc** : `PRODUCTS.md:105-106` (invariant opposable 5) — « **Un champ existe s'il est lu.** Tout champ écrit-jamais-consommé est un bug de périmètre »
- **Code** : `reservation_hold_v1`, table `stock_reservations`, module `reservationCalculator.ts`, deux **filtres proposés à l'utilisateur** dans l'écran Mouvements — aucun appelant
- **Production** : `stock_reservations` = **0 ligne** ; `release_expired_reservations` jamais planifiée
- **Choix** : **[C]** retirer table, RPC, module et filtres · **[A]** livrer la réservation · **[D]**
- **Ma recommandation** : **[C]** — deux filtres qui ne ramènent jamais rien sont un défaut visible.

### S13 — Les pages Stock affichent une erreur brute au lieu d'un accès restreint
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Code** : seuls `ReportShell.tsx:55` et `useDashboardPanels.ts:22` reconnaissent `stock_visibility_owner_required`. Les 6 pages du domaine Stock ne le mentionnent pas, alors que `RestrictedState` existe et est utilisé ailleurs.
- **Enjeu** : un ADMIN porteur d'`inventory.read` franchit la garde de route, atterrit sur la page, et voit une erreur technique.
- **Choix** : **[A]** ajouter l'état « accès restreint » · **[D]**
- **Ma recommandation** : **[A]** — dépend de X01.

### S14 — Le rapport perishable-turnover reste atteignable par URL
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Doc** : `ADR-004:15` — « retirer la page `/inventory/expiring` **et le rapport perishable-turnover de la navigation** »
- **Code** : retrait de la navigation fait ; la **route survit** (`routes/index.tsx:884-887`), avec sa page, son hook et sa RPC
- **Choix** : **[C]** supprimer route, page et RPC · **[B]** conforme à la lettre de l'ADR · **[D]**
- **Ma recommandation** : **[C]** — dépend de S01.

---

## 7. Production / Recettes

### P01 — Le coût moyen est réinitialisé, pas pondéré, quand le stock est ≤ 0
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : aucun document ne dit ce que devient le coût moyen quand le stock de départ est ≤ 0
- **Code, corps live confirmé** : `tr_update_product_cost_on_purchase` → si `v_old_stock <= 0`, le coût historique est **jeté** et remplacé par celui du seul mouvement entrant
- **Production** : `allow_negative_stock` = **true**, 6 produits en stock négatif
- **Enjeu** : le comportement est défendable (une moyenne sur une quantité négative n'a pas de sens) mais il n'est écrit nulle part, et le coût alimente le COGS, les alertes de marge et la valorisation.
- **Choix** : **[A]** l'écrire comme la règle · **[D]** autre règle · **[B]**
- **Ma recommandation** : **[A]**.

### P02 — L'annulation d'une production ne défait pas le coût qu'elle a posé
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Code** : la contre-passation rejoue le mouvement avec une quantité **négative** ; le déclencheur de coût sort immédiatement (`IF NEW.quantity <= 0 THEN RETURN NULL`)
- **Enjeu** : une fournée annulée laisse le coût du produit fini à la valeur que cette fournée a calculée.
- **Choix** : **[A]** restaurer le coût antérieur · **[B]** · **[D]**
- **Ma recommandation** : **[A]**.

### P03 — Une réception saisie en retard pondère le coût contre le stock d'aujourd'hui
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Code** : le déclencheur lit `current_stock` et `cost_price` **à l'instant de l'insertion**, pas à la date de réception. `receive_purchase_order` accepte une `received_date` sans l'utiliser pour la pondération.
- **Enjeu** : une réception enregistrée trois jours après coup, stock écoulé, fait sauter le coût au prix de cette livraison. En boutique, la saisie en retard est le cas normal.
- **Choix** : **[A]** pondérer à la date de réception · **[B]** accepter la date de saisie · **[D]**
- **Ma recommandation** : **[B]** avec mention explicite dans la doc — repondérer à une date passée demande de rejouer l'historique.

### P04 — La faisabilité d'une fournée n'est chiffrée que pour le propriétaire
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `PRODUCTION.md:224-225` — « il manque 2,5 kg de farine… » ; `DESCRIPTION.md:315` — « le manque exact est **chiffré avant validation** », donné pour livré
- **Code** : `IngredientAggregatePreview.tsx:70` — `const owner = … role_code === 'SUPER_ADMIN'` ; les colonnes *Available* et *Status* ne sont rendues que `{owner && …}`
- **Enjeu** : le boulanger voit les quantités requises, jamais la disponibilité. Il découvre la pénurie au refus serveur.
- **Choix** : **[A]** rendre le manque visible à qui détient `inventory.production.create` · **[B]** · **[D]**
- **Ma recommandation** : **[A]** — dépend de X01.

### P05 — La saisie d'écart de rendement est inatteignable
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Doc** : `PRODUCTION.md:10` — « yield tracking […] **tous livrés en V3** » ; `DESCRIPTION.md:316`
- **Code** : la collecte vit dans `ProductionForm.tsx`, **importé par personne**. L'écran monté est `ProductionEntryCard`, qui n'a aucune mention de rendement. Trois composants forment un écran mort, maintenu et testé.
- **Production** : le réglage `production_yield_variance_threshold_pct` = 0,15 existe, est **lu par le code mort**, et n'est **pas** éditable depuis les réglages
- **Choix** : **[A]** rebrancher la saisie sur l'écran vivant · **[C]** supprimer les trois composants · **[D]**
- **Ma recommandation** : **[A]** — sinon les rapports de rendement n'ont jamais de cause d'écart.

### P06 — Le planning de production est déclaré livré dans trois documents, sans aucun consommateur
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `PRODUCTION.md:283` « ✅ **DÉPASSÉ V3** » **et** `:303` « 🟠 Plan de production hebdomadaire » en backlog, dans la même fiche ; `DESCRIPTION.md:319` le présente en *Aujourd'hui*
- **Code** : `production_schedules` et `suggest_production_schedule` n'ont **aucun appel** dans `apps/`, aucune route
- **Production** : `production_schedules` = **0 ligne**
- **Choix** : **[A]** ouvrir le chantier · **[C]** supprimer table et RPC · **[B]** corriger les trois documents
- **Ma recommandation** : **[B]** d'abord, puis **[A]** ou **[C]** selon le besoin réel.

### P07 — Les suggestions de production ne sont pas arrondies, la couverture est figée à 3 jours
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `PRODUCTION.md:170-172` — « `vitesse × jours_couvrir − stock` », quantité « **arrondie au pas standard** (douzaines, par 10…) »
- **Code** : `GREATEST(0, ROUND(avg_daily * 3) - current_stock)` — le **3** est un littéral, l'arrondi est entier
- **Enjeu** : « produire 47 croissants » au lieu de « 4 douzaines ».
- **Choix** : **[A]** pas d'arrondi + couverture paramétrable · **[B]** · **[D]**
- **Ma recommandation** : **[A]** pour l'arrondi seulement.

### P08 — Le revert d'une fournée partiellement vendue n'a pas de chemin
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `INVENTORY.md:137` — « 🟠 Revert d'un lot partiellement vendu : quel chemin, qui l'autorise (D-19) », question **explicitement ouverte**
- **Code** : le message d'erreur oriente vers un ajustement de stock — qui est désormais une **déclaration** en attente d'approbation, ne porte que le produit fini, et **ne restitue aucune matière première**
- **Enjeu** : « produit 10, vendu 4, erreur de saisie » reste sans solution ; la farine consommée à tort reste sortie.
- **Choix** : **[A]** définir un chemin de correction partielle · **[D]**
- **Ma recommandation** : **[A]** — c'est l'inverse de la raison d'être du module.

---

## 8. Achats / Fournisseurs

### A01 — Aucun chemin de retour fournisseur ni d'annulation de réception
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `PURCHASING_AND_SUPPLIERS.md:135` — « Un PO reçu est figé — **la correction passe par un retour fournisseur** » ; §3.5 décrit la sélection d'articles, la raison, le montant et l'écriture
- **Code** : aucune RPC n'écrit `purchase_return`. `cancel_po` refuse dès qu'un GRN existe et renvoie vers un geste **inexistant** (`'PO_PARTIALLY_RECEIVED'` … « forces purchase_return »). Et `purchase_return` est **sans mapping** dans le déclencheur comptable : si quelqu'un l'écrivait, le stock sortirait **sans écriture**.
- **Production** : 123 PO, 119 réceptions, 51 paiements
- **Choix** : **[A]** livrer le retour fournisseur · **[B]** retirer l'engagement de la fiche · **[D]**
- **Ma recommandation** : **[A]** — marchandise avariée = aucun geste applicatif aujourd'hui.

### A02 — `shipping_cost` et les escomptes n'existent pas
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `PURCHASING_AND_SUPPLIERS.md:50-51` — escompte global ou par ligne, frais de livraison, TVA par ligne
- **Code** : `shipping_cost` → **0 occurrence** dans `supabase/`. Le helper `landedCostAllocation.ts` existe **sans aucun appelant**. `purchase_order_items` n'a ni remise ni TVA de ligne.
- **Enjeu** : une facture avec port ne peut pas être saisie à son montant réel. Soit on gonfle les coûts unitaires (et on pollue le coût moyen), soit le PO ne correspond pas à la facture payée.
- **Choix** : **[A]** saisir port et remises · **[B]** corriger la fiche · **[D]**
- **Ma recommandation** : **[A]** pour le port seulement — c'est le cas fréquent.

### A03 — Le cycle de vie du PO annoncé n'est pas celui du code
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `PURCHASING_AND_SUPPLIERS.md:7` « **Statut : Livré** » ; `:56-57` `sent` / `confirmed` ; `:64` `partially_received`
- **Code** : `CHECK (status IN ('draft','pending','partial','received','cancelled'))`. Les trois noms cités : 0 occurrence. L'écran agrège « Confirmed / Sent » en une étape décorative dérivée de `order_date`.
- **Choix** : **[B]** aligner la fiche · **[A]** livrer `sent` et `confirmed` · **[D]**
- **Ma recommandation** : **[B]**, sauf si distinguer « préparée » de « envoyée au fournisseur » compte pour vous.

### A04 — « Combien reste impayé chez ce fournisseur » a deux réponses opposées
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `PURCHASING_AND_SUPPLIERS.md:33` ; `DESCRIPTION.md:174`
- **Code** : la fiche fournisseur calcule l'impayé côté client depuis le **statut du PO**, sans jamais lire `purchase_payments` (`useSupplierMetrics.ts:35-36`) ; un PO à crédit entièrement reçu et jamais payé est compté **payé**. Le rapport Supplier Payments, lui, lit le ledger.
- **Enjeu** : l'écran qu'on consulte avant de payer peut afficher 0 impayé sur un fournisseur à qui on doit tout.
- **Choix** : **[A]** brancher la fiche sur `get_supplier_payments` · **[D]**
- **Ma recommandation** : **[A]**.

### A05 — La réception plie la TVA non récupérable dans le stock
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `PURCHASING_AND_SUPPLIERS.md:106` — « augmenter le stock **+ la TVA récupérable** » → contredit ADR-005 (NON-PKP, pas de TVA récupérable)
- **Code** : le déclencheur débite le stock pour `subtotal + vat` (TVA non récupérable foldée dans le coût). C'est **correct** pour un NON-PKP.
- **Choix** : **[B]** corriger la fiche · **[D]**
- **Ma recommandation** : **[B]** — le code applique l'ADR, la fiche non.

### A06 — La page Promotions écrit en PostgREST brut, et le trigger d'audit ne couvre pas la suppression
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `PRODUCTS.md:97` (invariant 2) — les écritures passent par une RPC auditée
- **Code** : `useCreatePromotion.ts:20` et `useUpdatePromotion.ts:25` écrivent la table directement ; `audit_promotion_changes` est `AFTER INSERT OR UPDATE` — **sans `DELETE`**, là où les 6 autres triggers du même fichier le couvrent
- **Choix** : **[A]** passer par une RPC + étendre le trigger au DELETE · **[D]** étendre le trigger seulement · **[B]**
- **Ma recommandation** : **[D]** — le trigger d'abord, c'est une ligne.

### A07 — Six tables écrites en PostgREST brut par le back-office
- **Catégorie** : [AMBIGU / DANGEREUX] — **largement couvert**
- **Code** : `suppliers`, `promotions`, `lan_devices`, `holidays`, `email_templates`, `receipt_templates`, `notification_templates` — 22 sites d'écriture directe. **Mais** `20261104000002_activity_audit_coverage.sql` installe 7 triggers d'audit couvrant exactement ces tables.
- **Choix** : **[B]** le trigger d'audit suffit · **[A]** tout passer en RPC · **[D]**
- **Ma recommandation** : **[B]** — la traçabilité est assurée ; seul le DELETE des promotions manque (A06).

---

## 9. Comptabilité / Taxes / Dépenses

### G01 — La vente ne produit aucune écriture de coût de revient
- **Catégorie** : [AMBIGU / DANGEREUX] — **le plus lourd de l'audit**
- **Doc** : `ACCOUNTING.md:180` — « **COGS** : coût des matières consommées (via production **et ventes directes**) » ; `:20` — « Combien j'ai vraiment gagné ce mois ? »
- **Code, corps live vérifié en production** : `tr_stock_movement_je` ne traite que `waste, adjustment, adjustment_in/out, opname_in/out, production_in/out`. **`sale` et `sale_void` sont hors de la liste.** Aucun mapping `SALE_COGS` n'existe.
- **Production, soldes au 2026-11-09** :

  | Compte | Solde |
  |---|---|
  | 4100 Sales Revenue | **529 959 445 IDR** |
  | 5110 Production COGS | **1 700 IDR** |
  | 5210 Waste Expense | 122 900 IDR |

- **Enjeu** : le compte de résultat affiche une marge brute égale au chiffre d'affaires. Avec ~14 M IDR/jour, l'écart se creuse chaque jour. Les rapports non comptables (Gross Margin) utilisent `cost_price` et donnent une marge plausible : **deux réponses opposées à la même question**.
- **Choix** : **[A]** reconnaître le COGS à la vente · **[D]** reconnaître le coût à la production et relever le produit fini à la vente · **[B]**
- **Ma recommandation** : **[A]** — sans cela il n'existe aucun résultat fiable.

### G02 — Les comptes de stock ne se raccordent pas entre eux
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Code, vérifié en production** : les achats débitent **1141** « Inventory - General » ; la production consomme en créditant **1142** « Inventory - Raw Material » ; la production produit en débitant **1143** « Finished Goods » ; la vente ne touche rien.
- **Production** :

  | Compte | Solde | Origine des lignes |
  |---|---|---|
  | 1141 Inventory - General | **+283 800 003 IDR** | `purchase`, `stock_movement` |
  | 1142 Inventory - Raw Material | **−34 767 500 IDR** | `production`, `stock_movement` |
  | 1143 Inventory - Finished Goods | **+34 765 800 IDR** | `production`, `stock_movement` |

- **Enjeu** : un compte d'actif à solde créditeur est comptablement impossible. Le bilan est inutilisable en l'état.
- **Choix** : **[A]** raccorder la chaîne (achats → 1142 matières, production → 1143, vente → COGS) · **[D]** autre plan · **[B]**
- **Ma recommandation** : **[A]**, en même temps que G01 — c'est le même chantier.

### G03 — Les comptes d'attente QRIS et carte ne sont jamais soldés
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Code** : le rapprochement bancaire est la seule porte de solde. 4 de ses RPC **n'existent pas en production** (rapport 01 §5.4), et il n'a jamais tourné.
- **Production** : 1115 QRIS Clearing = **+152 165 000 IDR**, 1116 Card Clearing = **+254 666 000 IDR**, jamais crédités. 1112 Bank Operating = **−130 180 205 IDR**.
- **Enjeu** : 406 831 000 IDR dans des comptes d'attente, et un compte bancaire à solde négatif. Au versement du prestataire, rien ne tombe juste.
- **Choix** : **[A]** livrer les 4 RPC manquantes puis faire le rapprochement · **[D]** solder par écriture manuelle en attendant · **[B]**
- **Ma recommandation** : **[A]** puis **[D]** — la panne des 4 RPC est déjà au rapport 01.

### G04 — La taxe PB1 n'est pas collectée sur les ventes B2B
- **Catégorie** : [AMBIGU / DANGEREUX] — **question fiscale, pas technique**
- **Doc** : `ACCOUNTING.md:302` — « Vente B2B : DR AR / CR B2B Sales / **CR PB1 Payable** ». ADR-005 ne prévoit **aucune** exonération de gros.
- **Code** : `create_b2b_order` insère `tax_amount = 0`. La seule trace de la décision est un **commentaire SQL** : « HORS CHAMP — décision propriétaire du 2026-07-17 ».
- **Production** : CA B2B **63 534 500 IDR**, PB1 réellement portée **4 181 133 IDR**. Si tout le B2B était assujetti : **5 775 864 IDR**. Écart ≈ **1,6 M IDR**. Depuis la mise en service : 18 391 500 IDR de CA B2B.
- **Enjeu** : si la livraison B2B de produits F&B est assujettie au PBJT, la déclaration est sous-évaluée. Si elle ne l'est pas, une exonération fiscale vit dans un commentaire de fonction, invisible à tout contrôle.
- **Choix** : **[A]** assujettir le B2B · **[B]** confirmer l'exonération **et l'écrire dans un ADR** · **[D]**
- **Ma recommandation** : **[B]** si votre conseil fiscal confirme — mais **l'écrire**, pas le laisser en commentaire.

### G05 — Une dépense cash vide la caisse à l'approbation, pas au paiement
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `EXPENSES.md:177` — « Une dépense `approved` mais non payée reste **un AP** » ; `:183` — « séparer l'engagement du décaissement »
- **Code** : l'écriture crédite le compte fournisseur **uniquement** si `payment_method = 'credit'` ; sinon elle sort directement de la petite caisse. `pay_expense` n'émet alors **aucune** écriture, juste un changement de statut.
- **Enjeu** : une facture saisie en `cash`, approuvée le 2 et réglée le 25, sort de la caisse le 2. Le solde du grand livre ne correspond plus à l'espèce physique.
- **Choix** : **[A]** toute dépense approuvée passe par le compte fournisseur jusqu'au paiement · **[B]** · **[D]**
- **Ma recommandation** : **[A]**.

### G06 — Toute dépense sous 100 000 IDR s'auto-approuve, par son créateur, sans rôle ni PIN
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `EXPENSES.md:171` — auto-approuvées « **si créées par un manager** » ; `:50` — `created_by` et `approved_by` « obligatoires et **différents** » ; `DESCRIPTION.md:248` — « personne ne peut valider sa propre dépense »
- **Code** : seuil par défaut 0 → 100 000 IDR avec zéro étape. Sur ce chemin : seule garde = `expenses.create`, puis `status='approved', approved_by = l'appelant` et émission de l'écriture. **Aucun contrôle de rôle, aucun PIN, aucun test de séparation des tâches** — les deux blocs de contrôle vivent dans `approve_expense`, jamais appelé ici.
- **Production** : **2 dépenses sur 11 auto-approuvées**, 92 000 IDR
- **Enjeu** : tout porteur de `expenses.create` peut écrire une charge et un décaissement jusqu'à 99 999 IDR, autant de fois qu'il veut, sans second regard.
- **Choix** : **[A]** exiger un rôle sur le chemin d'auto-approbation · **[D]** baisser le seuil · **[B]**
- **Ma recommandation** : **[A]** — et vérifier qui porte `expenses.create`.

### G07 — Le plan comptable de la fiche n'est pas celui de la base
- **Catégorie** : [CONTRADICTOIRE] — **tranché par la preuve**
- **Doc** : `ACCOUNTING.md:73-77` — 1120, 1300, 1400, 2100, 5100, 5200, 4900
- **Code** : les 4 premiers **n'existent pas**. 2100 et 5100 existent mais sont des **groupes non postables** (réels : 2141 et 5110). Les charges sont en classe 6. Et **4900 = « Sales Discounts »**, un contre-produit — pas un produit exceptionnel.
- **Enjeu** : un comptable qui suit cette fiche impute une recette exceptionnelle sur le compte de remises et fausse le CA **et** la ligne « discounts » du résultat.
- **Action** : réécrire §4.1 sur le plan réel. Aucune décision requise.

### G08 — La PB1 crédite 2110, et 2143 est un doublon dormant
- **Catégorie** : [CONTRADICTOIRE] — **tranché par la preuve**
- **Doc** : `ACCOUNTING.md:58`, `:74`, `:204` — « 2110 / 2143 ». ADR-013 **D16** ordonnait déjà la correction le 2026-07-25 : « `SETTINGS.md` (2110 seul) **fait foi** ; corriger `ACCOUNTING.md` ».
- **Code, vérifié en base** : le mapping `SALE_PB1_TAX` → **2110 « PB1 (10%) Payable »**. **2143 existe, est actif et postable, et n'est la cible d'aucun mapping.**
- **Choix** : **[A]** désactiver 2143 · **[B]** le laisser dormant · **[D]**
- **Ma recommandation** : **[A]** — une écriture manuelle sur 2143 sortirait du calcul de la taxe due tout en apparaissant au bilan.

### G09 — Le compte 2142 « VAT Output » reste actif, postable, et agrégé dans la taxe à payer
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `ACCOUNTING.md:335` — « le module **ne gère pas** la TVA / PPN » ; ADR-003 §2.2 ordonne la désactivation du résidu PKP (fait pour 1151 seulement)
- **Code** : 2142 est actif et postable ; le bilan le range **avec** la taxe due (`code IN ('2110','2142','2143')`)
- **Choix** : **[A]** désactiver 2142 comme 1151 · **[B]** · **[D]**
- **Ma recommandation** : **[A]** — même geste que G08.

### G10 — Une période fiscale fermée par erreur arrête l'encaissement, et rien ne peut la rouvrir
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `ACCOUNTING.md:286` — trois statuts `open / pending_closure / closed` ; `:284-285` — « une période clôturée refuse les écritures »
- **Code** : statuts réels `draft, open, closed, locked`. `check_fiscal_period_open` est appelé par **chaque** émetteur, **y compris l'écriture de vente** → une période fermée **arrête la caisse**. Aucune RPC de réouverture, aucun `UPDATE` direct possible.
- **Production** : **24 périodes, toutes `open`**, du 2026-01-01 au 2027-12-31. Aucune n'a jamais été clôturée. Au-delà du 31/12/2027, si 2027 n'est pas clôturé, la vente s'arrête.
- **Enjeu** : un clic de clôture sur le mois courant bloque la caisse, et personne dans l'application ne peut l'annuler. La fiche ne le mentionne pas.
- **Choix** : **[A]** ouvrir un chemin de réouverture gaté · **[D]** ne clôturer qu'avec confirmation forte · **[B]**
- **Ma recommandation** : **[A]** — c'est le risque le plus brutal du module.

### G11 — Les comptes des catégories de dépense sont fictifs, et 6 catégories sur 12 atterrissent au même endroit
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `EXPENSES.md:203-216` — table de 12 comptes cibles (6130, 6140, …) ; `:220` — « l'app sait que c'est le 6140 »
- **Code** : les **12 codes ont 0 occurrence**. Le seed réel : UTILITIES→6113, RENT→6112, SALARIES→6111, SUPPLIES→6114, MAINTENANCE→6116, MARKETING→6115, puis **TRANSPORT, INSURANCE, TAX, BANK_FEES, OFFICE, OTHER → tous 6190 « Other »**
- **Enjeu** : la moitié des natures de charge sont indiscernables au grand livre et agrégées en « other » dans le résultat.
- **Choix** : **[A]** créer des comptes dédiés · **[B]** corriger la fiche · **[D]**
- **Ma recommandation** : **[A]** — les catégories sont éditables, le geste est applicatif, pas une migration.

### G12 — L'équilibre des écritures n'est garanti que pour la saisie manuelle
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Doc** : `ACCOUNTING.md:54` — « **Le système refuse** une écriture déséquilibrée »
- **Code** : le contrôle existe dans la saisie manuelle et les importeurs. **Aucune contrainte ni trigger de table.**
- **Production, vérifié** : **12 084 écritures, 0 déséquilibrée, 0 à zéro.** Le risque est latent, pas réalisé.
- **Choix** : **[A]** poser une contrainte au niveau de la table · **[B]** · **[D]**
- **Ma recommandation** : **[A]** — filet peu coûteux sur 28 863 lignes.

### G13 — Un règlement B2B en QRIS n'atterrit pas au même compte qu'une vente en QRIS
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : ADR-013 **D3** — « Mapping méthode→compte **identique** à la vente […] Vente et reversal partagent le même helper **pour ne plus diverger** »
- **Code** : la vente et l'annulation partagent bien le helper. `record_b2b_payment_v5` ne l'appelle **pas** : `store_credit` → 2220, `cash` → caisse, **tout le reste → 1112 Bank Operating**. Un règlement B2B en QRIS va donc en banque, une vente QRIS en compte d'attente QRIS.
- **Enjeu** : le compte d'attente QRIS ne contient qu'une partie des encaissements QRIS ; le rapprochement ne tombe jamais juste (voir G03).
- **Choix** : **[A]** étendre le helper au paiement B2B · **[B]** · **[D]**
- **Ma recommandation** : **[A]** — conforme à l'ADR-013 D3.

---

## 10. Reporting

### R01 — Rapports décrits au présent et inexistants
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `REPORTS.md` §5-§10 décrit **au présent**, sans mention « à venir » : Revenue Forecast, ABC Product Analysis, Customer Lifetime Value, Ghost Stock Movements, Expired Stock, All in 1 Sales Summary, Sales By Date, Order Type Distribution, Stock Movement Analytics, Incoming Raw Materials, Stock Transfer, Product Unsold, Purchase Details, Receivables, POS Outstanding, Loyalty Adjustments Audit, Void & Discount Abuse, Duplicate Transactions, Alerts Dashboard — **une vingtaine**
- **Code** : 0 occurrence pour chacun. Le catalogue réel compte **40 rapports** et n'en contient aucun.
- **Enjeu** : §5-§10 est présenté comme l'inventaire du livré ; environ la moitié est du backlog non étiqueté. Impossible de s'en servir pour décider quoi construire.
- **Choix** : **[A]** marquer chaque ligne « livré / à venir » · **[B]** réécrire la section sur les 40 rapports réels · **[D]**
- **Ma recommandation** : **[B]** — et garder une liste « souhaité » à part.

### R02 — « P&L Monthly Trend » est cité par trois fiches et n'existe nulle part
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `REPORTS.md:181`, `ACCOUNTING.md:326`, `EXPENSES.md:231` et `:303`
- **Code** : 0 occurrence. La vue `mv_pl_monthly` existe mais **n'est jamais peuplée** en production et aucune fonction ne la lit — `get_profit_loss` précise même qu'il « does NOT consume `mv_pl_monthly` ».
- **Choix** : **[A]** livrer la tendance 12 mois · **[C]** supprimer la vue morte · **[D]**
- **Ma recommandation** : **[C]** d'abord (la vue morte casse tout rapport qui s'y brancherait), **[A]** après G01 — une tendance de rentabilité sans COGS n'a pas de sens.

### R03 — « COGS Production Report » mesure des achats, pas une consommation
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `REPORTS.md:204` — « coût des matières **consommées** […] **Base du COGS comptable** »
- **Code** : la page appelle `get_purchase_cogs_breakdown_v1`, qui somme les lignes de PO non annulés — donc du **commandé**, `pending` inclus, même non reçu.
- **Choix** : **[B]** renommer en « Purchase Spend » · **[A]** construire un vrai COGS · **[D]**
- **Ma recommandation** : **[B]** maintenant, **[A]** avec G01.

### R04 — Le rapport des dépenses compte ce que la comptabilité ignore
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `REPORTS.md:165` — « dépenses opérationnelles **approuvées** sur la période »
- **Code** : `get_expenses_by_category_v1` retient `status NOT IN ('draft','rejected')` — donc **`submitted` inclus**. Or l'écriture n'est émise qu'à l'approbation.
- **Enjeu** : les charges du rapport et celles du résultat divergent du montant des dépenses soumises non approuvées, sans que rien ne le dise.
- **Choix** : **[A]** exclure `submitted` · **[D]** l'afficher à part · **[B]**
- **Ma recommandation** : **[D]** — « engagé » et « comptabilisé » sont deux chiffres utiles, à condition de les nommer.

### R05 — Les 4 pages Marketing existent et deux fiches les nient
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `CUSTOMERS.md:276` — « **Pas de segmentation marketing avancée** (RFM, scoring, cohortes) » ; `PROMOTIONS_AND_COMBOS.md:306` — backlog 🔴 « Promotion effectiveness report »
- **Code** : quatre pages routées et navigables sous `reports.read` — ROI par promo, segments RFM (champions/loyal/at_risk/new/dormant/lost), cohortes, anniversaires. Aucune fiche d'objectifs ne couvre Marketing.
- **Choix** : **[A]** ouvrir `docs/objectifs/MARKETING.md` · **[B]** corriger les deux fiches · **[D]**
- **Ma recommandation** : **[B]** puis **[A]** — quatre écrans de pilotage vivent sans règle métier écrite.

---

## 11. Catalogue / Promotions / Clients / B2B

### B01 — Le crédit B2B n'est jamais contrôlé, et un plafond absent vaut « illimité »
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `B2B.md:129` — « Alerte si la commande risque de dépasser le plafond » ; `:161` — « bloque les commandes au-delà » ; `:375` backlog 🔴 « commande hors plafond exige validation owner »
- **Code** : `validate_b2b_credit_limit_v1` puis blocage dur `credit_limit_exceeded`, **aucun chemin de dérogation**. Et un `b2b_credit_limit` **NULL vaut illimité** (ADR-020 déc. 1 l'a laissé ouvert).
- **Production** : **21 clients B2B, les 21 avec `b2b_credit_limit` NULL.** 14 portent un encours. **Encours total : 24 285 400 IDR.** Le contrôle ne s'est donc **jamais** déclenché.
- **Enjeu** : deux risques opposés. Un compte sans plafond accumule un encours qu'aucune règle ne voit ; et le jour où un plafond est saisi, le client au plafond ne peut plus commander, même avec l'accord du gérant.
- **Choix** : **[A]** un plafond absent **refuse** le crédit · **[B]** NULL = illimité, assumé et écrit · **[D]** saisir les 21 plafonds et ouvrir une dérogation PIN
- **Ma recommandation** : **[D]** — c'est la seule réponse qui protège les 24 M sans bloquer la boutique.

### B02 — La page de réglages B2B est cassée en production
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Code** : `get_b2b_settings_v1` lève `P0002 'b2b_settings singleton (id=1) missing'` si la ligne manque
- **Production, vérifié** : `b2b_settings` = **0 ligne** → la page remonte une erreur serveur à **chaque** ouverture
- **Enjeu** : la seule page de réglages B2B est inutilisable. Il faut aussi comprendre pourquoi le seed a disparu (le dump de bascule ne l'a pas transporté).
- **Choix** : **[A]** réinsérer le singleton · **[D]**
- **Ma recommandation** : **[A]** — une ligne, et vérifier si d'autres singletons manquent.

### B03 — Un combo ignore toute la tarification client
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `CUSTOMERS.md:223` — « dès qu'un client est rattaché, les prix sont recalculés selon sa catégorie »
- **Code** : le résolveur prend la branche combo **avant** toute résolution client ; `_resolve_combo_price_v1` ne reçoit **aucun** `customer_id`. Côté POS : « Combos use `combo_base_price` and do **NOT** go through the fetchPrice path ».
- **Production, vérifié** : **3 prix négociés portent déjà sur un composant de combo**, et 21 clients sont en catégorie `Corporate` (mode `wholesale`)
- **Enjeu** : un client wholesale ou à prix négocié paie le combo au tarif public. L'écart est systématique et silencieux.
- **Choix** : **[A]** le combo hérite de la remise de catégorie · **[B]** un combo est un prix public, assumé · **[D]**
- **Ma recommandation** : **[B] si c'est voulu, mais écrit** — sinon **[A]**. C'est une décision commerciale, pas technique.

### B04 — La remise de palier fidélité est promise quatre fois et n'existe nulle part
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `CUSTOMERS.md:123-128` — Bronze 0 %, Silver 5 %, Gold 8 %, Platinum 10 % ; `:130`, `:224`, `:31`
- **Code** : `TIERS` ne porte que `points_multiplier`, côté TS **et** côté SQL. `tier_discount` → 0 occurrence. La chaîne de prix n'a **aucun** terme de remise de palier.
- **Production** : 9 clients ont des points
- **Enjeu** : un client Platinum croit avoir 10 % ; il paie plein tarif. ADR-020 §4 avait déjà ordonné de retirer la promesse **ou** de la livrer.
- **Choix** : **[A]** livrer la remise de palier · **[C]** retirer la colonne de la fiche · **[D]**
- **Ma recommandation** : **[C]** — vous avez déjà deux leviers de prix client (négocié, catégorie) ; un troisième complique sans apporter.

### B05 — Les points se gagnent sur le total après remises et après rachat
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `CUSTOMERS.md:116` — « 1 point par tranche de 1 000 IDR dépensée ». **La valeur du point n'est écrite nulle part.**
- **Code** : 1 point = **10 IDR** (`REDEMPTION_RATE`), minimum 100 points → taux de retour effectif **1 %**. Les points gagnés = `FLOOR(total × multiplicateur / 1000)` où le total est **après** promo, **après** rachat de points, **après** remise panier et **après** extraction de la PB1.
- **Enjeu** : un client qui règle en partie avec des points gagne **moins** de points qu'un client qui paie tout en espèces — le programme pénalise son propre usage. Et le passif fidélité ne peut pas être arbitré sans lire le code.
- **Choix** : **[A]** gagner sur le sous-total avant remises · **[B]** après, assumé et écrit · **[D]**
- **Ma recommandation** : **[A]** pour le rachat au moins — et **écrire la valeur du point** dans la fiche.

### B06 — Une promo ciblée produit ou catégorie se calcule sur le prix envoyé par le poste
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `PRODUCTS.md:90` (invariant 1) — « Aucune donnée catalogue transmise par le client (prix, flags, composition) ne fait foi »
- **Code** : `20261026130002_gift_promotion_evaluation.sql:124` et `:130` — `SUM((item ->> 'unit_price') * quantity)`. Seul le scope `cart` est protégé. Le contrôle d'égalité compare deux grandeurs issues du **même** `unit_price` client : il ne détecte rien.
- **Production** : `promotions` = **0 ligne** → la faille est **latente**, elle s'arme à la première promo de scope produit ou catégorie.
- **Choix** : **[A]** relire les prix serveur dans l'évaluation · **[B]** · **[D]**
- **Ma recommandation** : **[A]** — à faire **avant** de créer la première promo.

### B07 — Le cumul de promotions est implémenté, les fiches disent le contraire
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `PROMOTIONS_AND_COMBOS.md:49` — « Une seule meilleure promo par item […] le moteur choisit celle qui avantage le plus le client » ; `:292` — « ne supporte **pas** le stacking » ; `:305` backlog 🔴 « Stacking configurable »
- **Code** : le cumul existe, piloté par `stackable_with_promo`, serveur **et** repli TS, avec son onglet de configuration. **Et il n'y a aucune sélection de « la meilleure »** : l'ordre est `priority DESC, created_at DESC`.
- **Enjeu** : un gérant qui lit la fiche croit être protégé du cumul **et** croit que le système choisit toujours la meilleure offre. Les deux sont faux.
- **Choix** : **[B]** la règle est « cumul explicite par drapeau » · **[A]** livrer « meilleure promo unique » · **[D]**
- **Ma recommandation** : **[B]** — mais la règle « priorité, pas la meilleure » doit être écrite, c'est elle qui surprendra.

### B08 — Le minimum panier n'est pas évalué sur la même base aux deux endroits
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Code** : l'évaluation compare au sous-total **avant** remises de ligne ; la validation au paiement recompare au total **net** des remises de ligne
- **Enjeu** : un panier à 80 000 avec 10 000 de remise voit la promo s'afficher, puis le paiement est refusé en « Promotion min total not met ».
- **Choix** : **[A]** avant les remises partout · **[D]** après partout · **[B]**
- **Ma recommandation** : **[A]** — c'est ce que le client comprend d'une offre « dès 75 000 d'achat ».

### B09 — Deux des six types de promotion ne sont pas créables depuis le back-office
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Doc** : `PROMOTIONS_AND_COMBOS.md:58` — « 4 mécaniques » ; `:158` — « percentage / fixed_amount / buy_x_get_y / free_product »
- **Code** : l'énuméré réel compte **six** valeurs et le serveur évalue les six. Le formulaire n'en propose que quatre : `threshold` et `bundle` ne sont configurables qu'en SQL. Et `buy_x_get_y` n'existe pas — le type s'appelle `bogo`.
- **Choix** : **[A]** ouvrir `threshold` et `bundle` dans le formulaire · **[C]** retirer les deux types · **[D]**
- **Ma recommandation** : **[A]** — « dès 100 000, −10 % plafonné à 15 000 » et le menu à prix fixe sont deux mécaniques commerciales utiles, déjà payées.

### B10 — Les codes promo n'existent pas
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : tout le §12 de `PROMOTIONS_AND_COMBOS.md` (`:262-272`), plus `:109` et `:159`
- **Code** : `promo_code` → 0 occurrence. La table `promotions` n'a ni code ni compteur. L'évaluation ne prend aucun code en argument.
- **Choix** : **[A]** livrer · **[C]** supprimer le §12 · **[D]**
- **Ma recommandation** : **[C]** — sans canal d'acquisition en ligne, un code promo n'a pas d'emploi.

### B11 — Quatre des onze conditions de promo décrites n'ont aucune colonne
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `PROMOTIONS_AND_COMBOS.md:98-112` — type de commande, méthode de paiement, max par client **par jour**, max par ticket
- **Code** : `promotions` ne porte que `max_uses` et `max_uses_per_customer`. La méthode de paiement ne **peut** pas être une condition : elle n'est connue qu'après l'évaluation du panier.
- **Choix** : **[A]** livrer le plafond journalier en priorité · **[C]** réduire la fiche aux conditions réelles · **[D]**
- **Ma recommandation** : **[C]** puis **[A]** pour le plafond journalier seulement — c'est le levier de budgétisation d'une opération.

### B12 — Le palier « prix par catégorie » est câblé et vide
- **Catégorie** : [AMBIGU / DANGEREUX] — **tranché par la preuve**
- **Doc** : `CUSTOMERS.md:97` — « **Custom** : le prix est défini ligne par ligne (`product_category_prices`) »
- **Code** : table, RPC d'écriture, interface et résolution : tout existe.
- **Production, vérifié** : `product_category_prices` = **0 ligne**, et **aucune** des 4 catégories client n'est en mode `custom` (Corporate=wholesale 21 clients, Staff=retail 15, Cafe Customer=retail 6, Owner=retail 1)
- **Choix** : **[C]** retirer le palier `custom` · **[A]** l'utiliser · **[D]**
- **Ma recommandation** : **[C]** — le besoin est couvert par le prix négocié par client (10 clients, 21 lignes). Piège connu : on l'édite depuis la fiche d'**un** client alors qu'il s'applique à **toute** sa catégorie.

### B13 — Le stock B2B est déduit à la création, pas à la remise
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `B2B.md:181` et `:345` — « Lors d'une **remise**, le stock est automatiquement déduit (flag `stock_deducted`) » ; `:49` — « Paiement et remise sont découplés »
- **Code** : la déduction a lieu à la **création**. `stock_deducted` → 0 occurrence. Aucune table de remises ; le seul jalon est `b2b_delivered_at`.
- **Production** : 119 commandes `b2b_pending`
- **Enjeu** : une commande de 500 baguettes sort 500 baguettes du stock le jour de la saisie, pas le jour du retrait. Le stock disponible est faux pendant toute l'attente, et la production planifie sur une donnée déjà consommée.
- **Choix** : **[A]** déduire au retrait · **[B]** déduire à la création, assumé et écrit · **[D]**
- **Ma recommandation** : **[B] si la commande est préparée le jour même**, sinon **[A]**. À trancher sur votre délai réel entre saisie et retrait.

### B14 — Le libellé d'une variante n'est pas modifiable
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Doc** : `products-catalog` (skill) décrit `update_variant` comme une famille vivante ; `PRODUCTS.md:112` inscrit les variantes au périmètre
- **Code** : la RPC et le hook existent, **aucune interface ne les appelle**. Les composants de l'onglet sont : ajouter, supprimer, réordonner. Et `variant_label` n'est pas dans l'allowlist d'`update_product`.
- **Enjeu** : une faute de frappe impose de supprimer la variante et de la recréer — donc de changer son SKU (unique global) et de casser le lien avec les commandes passées.
- **Choix** : **[A]** câbler l'édition · **[C]** supprimer la RPC et le hook · **[D]**
- **Ma recommandation** : **[A]** — la RPC est écrite, il manque un bouton.

---

## 12. Architecture / Droits / Sécurité / Exploitation

### X01 — Un seul compte voit le stock et les états financiers
- **Catégorie** : [CONTRADICTOIRE] — **le plus structurant**
- **Doc** : `ADR-024:18-21` — la liste de stock « est ouverte par deux profils […] **le responsable stock, debout dans la réserve** […] et le gérant » ; `USERS_AND_PERMISSIONS.md` décrit ADMIN et comptable avec accès stock et finances
- **Code, vérifié en production** : `is_business_owner_v1()` = `role_code = 'SUPER_ADMIN'`. **37 RPC l'exigent** — tous les états de stock, l'inventaire, le bilan, le résultat, la balance, le grand livre, la PB1, la marge. Et 7 policies restrictives (`stock_movements`, `display_stock`, `display_movements`, `audit_logs`, `pos_events`, `z_reports`, `notification_outbox`) passent par la même porte.
- **Production** : **un seul compte SUPER_ADMIN (`mamat`)**. Les 3 comptes ADMIN **détiennent** `inventory.read`, `reports.financial.read` et `reports.export` — permissions que la fonction **refuse**.

  | Rôle | Permissions | Comptes | Créé le |
  |---|---|---|---|
  | SUPER_ADMIN | 162 | mamat | 2026-10-06 |
  | ADMIN | 59 | Annisa, Riyanti, test | 2026-10-06 |
  | office | 42 | **aucun** | **2026-11-06** |
  | CASHIER | 26 | Agus, Bambang, Enti ajah | 2026-10-06 |
  | Waiter | 12 | Aini, Gafar, Jaka, Pito | 2026-10-25 |
  | **MANAGER** | **0** | **aucun** | 2026-10-06 |

- **Enjeu** : la matrice de droits (éditable, ADR-031) accorde ce que les gardes de confidentialité refusent. Personne ne peut déléguer la lecture du stock ni des comptes. Le rôle `office` (42 permissions, créé il y a 3 jours, 0 compte) a probablement été créé pour un comptable qui ne pourrait pas s'en servir.
- **Choix** : **[A]** `is_business_owner_v1` reconnaît un second rôle (par exemple `office`) · **[B]** propriétaire seul, assumé et écrit dans un ADR qui supersède l'ADR-024 · **[D]** gater sur une permission plutôt que sur un rôle
- **Ma recommandation** : **[D]** — une permission (`reports.inventory.read`, `reports.financial.read`) se délègue depuis l'écran RBAC ; un rôle codé en dur ne se délègue pas.

### X02 — Un compte désactivé garde tous ses droits
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `USERS_AND_PERMISSIONS.md:109` — « `is_active = false` → l'utilisateur ne peut plus se connecter » ; `DESCRIPTION.md:45` — « ses sessions en cours sont **coupées** »
- **Code, corps live vérifié** : `has_permission` sélectionne le profil sur `deleted_at IS NULL` — **sans** `is_active`. La coupure de session n'existe que dans `delete_user` et `update_user_role`, pas sur une désactivation seule.
- **Enjeu** : un jeton PIN valide (1 h) appartenant à un profil désactivé continue de passer **toutes** les gardes jusqu'à son expiration.
- **Production** : 11 comptes, tous actifs — le risque n'est pas réalisé, mais la désactivation est le geste normal pour un départ.
- **Choix** : **[A]** ajouter `AND is_active` à `has_permission` et révoquer les sessions à la désactivation · **[B]** le décalage d'une heure est accepté · **[D]**
- **Ma recommandation** : **[A]** — c'est le geste qu'on fait le jour d'un licenciement.

### X03 — Aucune sauvegarde autonome, PITR désactivé, restauration jamais éprouvée
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Doc** : `etat-environnements.md:85-89` — « La sauvegarde quotidienne autonome **n'est pas activée** » ; `DESCRIPTION.md:479` — l'exercice de restauration est en *À venir*
- **Code** : le dépôt porte une chaîne complète et testée qu'**aucun runbook ne mentionne** : `encrypted-backup.mjs` (RSA-OAEP, commande `restore`), `database-backup.mjs`, `daily-backup.mjs` (`dailyAutomationInstalled: false` **en dur**), `backup-drive.mjs`, `backup-retention.mjs`, `prepare-backup-task.ps1` — ce dernier n'émet qu'un objet en mémoire, **aucun `Register-ScheduledTask`**
- **Production** : `cron.job` **vide**, PITR **désactivé**, 11 jours d'argent réel
- **Enjeu** : tout repose sur les sauvegardes physiques Supabase. La restauration n'a jamais été éprouvée, et la clé privée de reprise n'a pas de procédure de garde écrite — une sauvegarde chiffrée dont la clé se perd n'est pas une sauvegarde.
- **Choix** : **[A]** installer la tâche quotidienne et écrire le runbook de restauration · **[D]**
- **Ma recommandation** : **[A]**, cette semaine. C'est le risque le plus grave de tout l'audit en valeur absolue.

### X04 — Trois migrations planifient des tâches vers le projet **dev**
- **Catégorie** : [AMBIGU / DANGEREUX] — **piège pour la correction du rapport 01**
- **Code** : `20260716000169_notifications_dispatch_live.sql:241` → URL **codée en dur** `https://ikcyvlovptebroadgtvd.functions.supabase.co/notification-dispatch` (la référence **dev**). Même motif dans `20260525000011` et `20260525000012`.
- **Production** : inerte **uniquement parce que** `cron.job` est vide et que les 2 EF ne sont pas déployées
- **Enjeu** : le rapport 01 recommande d'installer les tâches planifiées en production. **Rejouer ces migrations telles quelles ferait appeler les Edge Functions de dev depuis la production**, avec un secret lu dans son propre coffre.
- **Choix** : **[A]** la référence passe par un réglage de base (`current_setting` / Vault) · **[D]**
- **Ma recommandation** : **[A]** — **à faire avant** d'installer les tâches planifiées.

### X05 — Le module notifications est un oubli de livraison
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Doc** : `SETTINGS.md:90` et `:99` ; `DESCRIPTION.md:388` — « modèles de notifications (**réellement utilisés par l'envoi**) »
- **Code** : la chaîne est complète côté base (5 triggers → outbox → `pick_notifications_batch`). Mais les **2 Edge Functions du chemin d'envoi ne sont pas déployées** (17 sur 19), aucune tâche ne les appelle, `RESEND_API_KEY` n'est pas posée.
- **Production** : `notification_outbox`, `notification_templates`, `email_templates` = **0 ligne**
- **Enjeu** : « stock bas », « dépense approuvée », « PO reçu » et « règlement B2B » sont **silencieux**, et deux documents affirment qu'ils partent.
- **Choix** : **[A]** déployer les 2 EF, poser la clé, planifier le dispatch (après X04) · **[C]** retirer la promesse d'envoi · **[D]**
- **Ma recommandation** : **[A]** — le code existe et est testé ; il manque trois gestes d'exploitation.

### X06 — Le PIN : la fiche décrit un autre produit
- **Catégorie** : [CONTRADICTOIRE] — **tranché par la preuve**
- **Doc** : `USERS_AND_PERMISSIONS.md:228` — « 4 chiffres (configurable) » ; `:229` — « 3 essais »
- **Code** : `PIN_REGEX = /^\d{6}$/` ; `pin_max_failed` défaut **5**, borné [3,10] ; `pin_lockout_minutes` défaut **15**. Aucune clé de longueur. `DESCRIPTION.md:40-41` dit 6 et 5/15, correctement.
- **Production** : `pin_max_failed` = 5, `pin_lockout_minutes` = 15
- **Action** : corriger la fiche sur 6 chiffres non réglables et 5/15 réglables.

### X07 — L'expiration de PIN est annoncée active par trois documents et n'existe pas
- **Catégorie** : [ABSENT DU CODE]
- **Doc** : `USERS_AND_PERMISSIONS.md:230` ; `DESCRIPTION.md:400` — « blocage/**expiration** déjà actifs » ; **ADR-006:76-77** — « exposer dans Settings le lockout/**expiration** déjà implémentés »
- **Code** : la migration qui livre la politique PIN le dit elle-même : « l'expiration PIN n'existe pas dans le code — signalé, non implémenté »
- **Enjeu** : aucun PIN n'expire jamais. Un PIN connu d'un ex-employé reste valide tant qu'un manager n'agit pas.
- **Choix** : **[A]** livrer la rotation de PIN · **[C]** retirer la promesse des trois documents · **[D]**
- **Ma recommandation** : **[C]** avec 11 comptes — la désactivation suffit, **à condition de corriger X02**.

### X08 — Le contrôle de faiblesse du PIN est purement côté écran
- **Catégorie** : [INACHEVÉ / PARTIEL]
- **Doc** : `DESCRIPTION.md:49` — « le **système** avertit si un code choisi est trop faible »
- **Code** : `evaluatePinStrength` n'est appelé que depuis l'interface. Les RPC serveur ne valident que longueur et chiffres : `000000` et `123456` passent par appel direct.
- **Choix** : **[A]** évaluer côté serveur et consigner dans `audit_logs` · **[B]** · **[D]**
- **Ma recommandation** : **[A]** — ce n'est pas une propriété du système aujourd'hui, c'est une propriété d'un écran.

### X09 — Quatre permissions sont accordées et vérifiées par rien
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `AUDIT_TRAIL.md:93-97` le signale déjà — « Ils donnent l'illusion d'un droit qui ne contrôle rien, **dans les deux sens** »
- **Code** : `audit_log.read` (sa seule porte était une vue droppée), `users.view_audit` (aucun `has_permission`), `settings.kiosk.manage` (l'appairage est gaté sur `kiosk.issue`). Seul `reports.audit.read` est appliqué.
- **Choix** : **[C]** retirer ces trois codes du catalogue · **[A]** les brancher · **[D]**
- **Ma recommandation** : **[C]** — comme `rbac.update` l'a été.

### X10 — `settings.security.manage` garde la route, mais pas l'écriture
- **Catégorie** : [CONTRADICTOIRE]
- **Doc** : `SETTINGS.md:143` — « Les gates UI correspondent aux RLS »
- **Code** : la route est gatée `settings.security.manage`, mais l'écriture de `pin_max_failed` / `pin_lockout_minutes` passe par `set_setting`, dont la seule porte est **`settings.update`**
- **Enjeu** : tout porteur de `settings.update` peut desserrer la politique de verrouillage PIN (passer à 10 essais, 5 minutes) par appel RPC direct.
- **Choix** : **[A]** exiger `settings.security.manage` pour la catégorie `security` · **[B]** · **[D]**
- **Ma recommandation** : **[A]**.

### X11 — Les codes de permission des fiches sont inventés
- **Catégorie** : [CONTRADICTOIRE] — **une question pour 8 fiches**
- **Doc** : `sales.view`, `sales.void`, `sales.refund`, `reports.sales`, `reports.inventory`, `reports.financial`, `reports.security`, `pos.open_session`, `pos.close_session`, `pos.view_sessions`, `pos.validate_session`, `pos.recount_session`, `accounting.view`, `accounting.journal.create`, `accounting.vat.manage`, `accounting.manage`, `expenses.view`, `inventory.create`, `inventory.update`, `customers.view`, `customers.loyalty`, `products.pricing`, `users.roles`, `settings.view`
- **Code** : **0 occurrence pour chacun.** Les vrais sont `orders.read/void/refund`, `reports.*.read`, `pos.session.open/close_own/close_other/view_all`, `accounting.je.create_manual`, `expenses.read`, `purchasing.po.*`, `customers.read`, `customer_prices.manage`, `loyalty.adjust`…
- **Production** : 162 permissions, 301 lignes de matrice
- **Enjeu** : huit matrices de droits inutilisables pour configurer un rôle ou auditer un accès. Un gérant qui veut restreindre l'ajustement de points cherche un code qui n'existe pas.
- **Choix** : **[A]** régénérer les matrices depuis `role_permissions` par script · **[B]** corriger à la main · **[D]**
- **Ma recommandation** : **[A]** — à la main, elles re-pourriront.

### X12 — Un compte nommé « test » a 59 permissions en production
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Production, vérifié** : `TEST` / « test » / rôle **ADMIN** / actif / créé le **2026-11-05** / **dernière connexion 2026-11-09** — il est utilisé.
- **Bonne nouvelle** : **aucun compte de démonstration du dépôt n'est présent** (`E2E001`, `E2E002`, `EMP000`, `EMP001`, `EMP002`, `EMP003` → absents). Le dump de bascule ne les a pas transportés. Les 10 autres comptes portent des noms réels.
- **Choix** : **[D]** vous dites à qui il sert, et on le renomme ou on le supprime
- **Ma recommandation** : **[D]** — un compte ADMIN anonyme est un trou d'imputabilité, pas une faille.

### X13 — Les Edge Functions portent l'authentification et ne passent ni lint ni typecheck
- **Catégorie** : [AMBIGU / DANGEREUX]
- **Doc** : `DESCRIPTION.md:456` — « **Chaque modification est vérifiée automatiquement** (style, tests, compilation) avant d'être acceptée »
- **Code** : le lint bloquant exige le glob `**/src/**` ; `pnpm lint` et `pnpm typecheck` ne couvrent que les membres du workspace, dont `supabase/functions` ne fait pas partie ; `grep -rni "deno" .github/workflows/` → **0**. Aucun test non plus.
- **Enjeu** : `auth-verify-pin` (le `PIN_REGEX` et le verrouillage), `auth-get-session` (le calcul des permissions de session), `process-payment` — la frontière de confiance la plus sensible n'a **aucun filet** avant la production.
- **Choix** : **[A]** ajouter `deno check` + `deno lint` au job `governance-guards` · **[D]**
- **Ma recommandation** : **[A]** — quelques lignes de workflow, pour le rendement des gardes existantes.

---

## 13. Bloc documentaire — corrections appliquées sans arbitrage individuel

Validé en bloc le 2026-11-09. **Chaque ligne est une correction de documentation
contre le code réel. Aucune ne change le comportement du logiciel.** Contestable
ligne par ligne.

| # | Fiche | Correction |
|---|---|---|
| `X11` | `POS`, `CASH_REGISTER`, `ORDERS`, `ACCOUNTING`, `EXPENSES`, `PURCHASING`, `REPORTS`, `CUSTOMERS` | Remplacer les **24 codes de permission inventés** par les codes réels, régénérés depuis `role_permissions` (162 permissions, 301 lignes de matrice) |
| `C07` | `POS.md:227`, `:281` | Le statut `unpaid` n'existe pas → `pending_payment` porteur de `outstanding_at` |
| `C13` | `ORDERS.md:116-124`, `:243`, `:254` ; `KDS.md:146` | `preparing`, `ready`, `refunded` n'existent pas — tués par l'ADR-025 déc. 3 |
| `C09` | `POS.md:132` | Le PIN de remise est **systématique**, pas au-delà d'un seuil |
| `C17` | `KDS.md:287`, `:301` | Le KDS hors ligne **est livré** : retirer la limite et l'item de backlog |
| `C23` | `PRINTING_AND_DEVICES.md:37-48`, `:86`, `:110-112` | L'invariant « pas de file d'impression, pas de relance » est **faux** : le journal est persistant et le bouton de relance existe. Fermer le 🔴 |
| `C24` | `PRINTING_AND_DEVICES.md:81-83` + `apps/print-bridge/README.md` | Le « secret partagé de boutique » n'existe plus : autorisation **par appareil** (ADR-034). **Le README empêche aujourd'hui de démarrer le pont** : ajouter les 4 variables TLS obligatoires, retirer `HUB_TOKEN`, passer la sonde en `https` |
| `C14` | `KDS.md:34`, `:37` ; `apps/pos/PRODUCT.md:134` | **Trois** stations (`kitchen`, `barista`, `display`), pas quatre ; `hot_kitchen` n'existe pas |
| `C15` | `KDS.md:122`, `:256-261` | Les réglages KDS sont **globaux**, pas par station |
| `C21` | `CUSTOMER_DISPLAY.md:185-193` | Réduire aux **4** réglages réels ; la rotation de vitrine est codée en dur à 8 s |
| `C19` | `CUSTOMER_DISPLAY.md:49`, `:157`, `:161-165` | L'écran client est une **fenêtre du même navigateur**, pas un client réseau ; les 5 messages annoncés n'existent pas |
| `A03` | `PURCHASING_AND_SUPPLIERS.md:7`, `:56-57`, `:64` | Statuts réels `draft/pending/partial/received/cancelled` ; `sent`, `confirmed`, `partially_received` n'existent pas |
| `A05` | `PURCHASING_AND_SUPPLIERS.md:106` | Pas de TVA récupérable (NON-PKP, ADR-005) : la TVA est **foldée dans le coût**, et c'est correct |
| `A07` | — | Les 7 tables écrites en PostgREST brut **sont** auditées par trigger depuis le 2026-11-04 : rien à corriger, à noter comme acquis |
| `G07` | `ACCOUNTING.md:73-77` | Réécrire §4.1 sur le plan réel : 1112, 1141-1143, 2141, 5110, classe 6 ; **4900 est « Sales Discounts »**, pas un produit exceptionnel |
| `G10` | `ACCOUNTING.md:286` | Statuts réels `draft/open/closed/locked` ; `pending_closure` n'existe pas |
| `X06` | `USERS_AND_PERMISSIONS.md:228-230` | PIN à **6 chiffres non réglables** ; **5** essais et **15** minutes, tous deux réglables |
| `R01` | `REPORTS.md` §5-§10 | ~20 rapports décrits **au présent** et inexistants → réécrire sur les **40** rapports réels, liste « souhaité » à part |
| `R03` | `REPORTS.md:204` | « COGS Production Report » mesure des **achats commandés**, pas une consommation → renommer « Purchase Spend » |
| `R05` | `CUSTOMERS.md:276` ; `PROMOTIONS_AND_COMBOS.md:306` | Le module Marketing **existe** (4 pages routées : ROI promo, segments RFM, cohortes, anniversaires) → retirer les deux dénégations |
| `B07` | `PROMOTIONS_AND_COMBOS.md:49`, `:292`, `:305` | Le cumul **est** implémenté (drapeau `stackable_with_promo`) ; et **il n'y a aucune sélection de la « meilleure » promo** : l'ordre est la priorité saisie |
| `B10` | `PROMOTIONS_AND_COMBOS.md` §12 | Les codes promo n'existent pas → supprimer le §12 |
| `B11` | `PROMOTIONS_AND_COMBOS.md:98-112` | 4 des 11 conditions annoncées n'ont aucune colonne ; la méthode de paiement **ne peut pas** être une condition (inconnue à l'évaluation) |
| `B12` | `CUSTOMERS.md:97` | Le palier « prix par catégorie » est câblé et **vide** : 0 ligne, aucune catégorie en mode `custom` → retirer. Piège signalé : on l'édite depuis **un** client alors qu'il s'applique à **toute** sa catégorie |
| `B03` | `CUSTOMERS.md:223` | Un combo est au **prix public** : ni prix négocié, ni remise de catégorie (décision lot 6) |
| `B04` | `CUSTOMERS.md:123-128`, `:31`, `:130`, `:224` | Retirer la **remise par palier**, le bonus anniversaire et la livraison offerte (décision lot 8) |
| `B13` | `B2B.md:181`, `:345` | Le flag `stock_deducted` n'existe pas ; la déduction **va passer au retrait** (décision lot 5) |
| `B01` | `B2B.md:129`, `:161`, `:375` + ADR-020 | « Plafond absent = crédit illimité » devient la règle écrite (décision lot 1) |
| `S08` | `INVENTORY.md` §4 | Énoncer qu'un mouvement à **valorisation nulle n'émet aucune écriture** (14 produits suivis à coût zéro) |
| `S03` | `INVENTORY.md` §5 | Écrire la **dissociation** vitrine / stock général (règle posée par Mamat, lot 2) |
| `P01` | `INVENTORY.md` / ADR-014 | Énoncer que le coût moyen est **réinitialisé** quand le stock de départ est ≤ 0 |
| `P03` | `INVENTORY.md:51-55` | Énoncer que le coût moyen se pondère à la **date de saisie**, pas à la date de réception |
| `P05` | `PRODUCTION.md:10` ; `DESCRIPTION.md:316` | Le suivi des causes d'écart de rendement est **abandonné** (décision lot 7) |
| `G05` | `EXPENSES.md:177`, `:180` | Pour une dépense en espèces, approbation et paiement sont **le même geste** (décision lot 6) |
| `G06` | `EXPENSES.md:171`, `:50` ; `DESCRIPTION.md:248` | L'auto-approbation sous seuil, **y compris par son créateur**, est la règle voulue (décision lot 4) |
| `G11` | `EXPENSES.md:203-216` | Les 12 comptes cibles annoncés n'existent pas → écrire les comptes réels après création des comptes dédiés (décision lot 9) |
| `G04` | `ACCOUNTING.md:302` ; `B2B.md` | La vente B2B **ne porte pas** la PB1 : exonération confirmée, à graver dans un ADR (décision lot 2) |
| `C01` | `CASH_REGISTER.md:272` | La règle au-delà de 24 h **est décidée** : alerte, pas de clôture automatique (décision lot 4) |
| `C06` | `POS.md:205` | L'arrondi de la monnaie est assuré par `round_idr` ; 0 montant non multiple de 100 en production |
| `X05` | `SETTINGS.md:90`, `:99` ; `DESCRIPTION.md:388` | Retirer la **promesse d'envoi** de notifications (décision lot 6) |
| `X01` | ADR-024, `USERS_AND_PERMISSIONS.md` | La visibilité stock et finances passe sur **permission** et redevient déléguable (décision lot 1) |
| `C25` | `PRINTING_AND_DEVICES.md:105-106` | Le runbook de mise en service du hub **sera écrit** (bloc finitions) |
| `X12` | — | Le compte « test » est assumé par Mamat : à ne plus signaler comme anomalie |
| `C05` | `CASH_REGISTER.md:67` vs `:72` | La fiche se contredit : le `session_number` **n'est pas livré**. Corriger la ligne 72. **Le livrer reste à trancher** — ajouté au §16 |

---

## 14. Bloc technique — 10 filets et nettoyages sans enjeu métier

Validé en bloc le 2026-11-09.

| # | Geste | Pourquoi |
|---|---|---|
| `X13` | Ajouter `deno check` + `deno lint` sur `supabase/functions` au job `governance-guards` | Les 19 fonctions serveur portent **l'authentification et le paiement** et n'ont **aucune** analyse statique ni test. 14 des 24 `any` du dépôt sont là. |
| `G12` | Contrainte d'équilibre débit = crédit au niveau de `journal_entries` | Le contrôle n'existe que dans la saisie manuelle. 12 084 écritures en production, 0 déséquilibrée — filet peu coûteux avant la première. |
| `G08` | Désactiver le compte **2143** | Doublon PB1 dormant mais **postable** : une écriture manuelle dessus sortirait du calcul de la taxe due tout en apparaissant au bilan. Demandé par l'ADR-013 D16 le 2026-07-25. |
| `G09` | Désactiver le compte **2142** « VAT Output » | TVA de sortie nationale dans un plan NON-PKP, actif, postable, et **agrégé au bilan avec la taxe à payer**. Le compte 1151 a déjà été désactivé ainsi. |
| `R02` | Supprimer la vue `mv_pl_monthly` | Jamais peuplée en production, aucune fonction ne la lit, et tout rapport qui s'y brancherait **échouerait immédiatement**. `mv_sales_daily` : même traitement. |
| `X09` | Retirer `audit_log.read`, `users.view_audit`, `settings.kiosk.manage` du catalogue | Accordés à des rôles et **vérifiés par rien** : les retirer n'ôte aucun accès, les accorder n'en donne aucun. Signalé par `AUDIT_TRAIL.md:93-97`. |
| `X10` | Exiger `settings.security.manage` pour écrire la politique de PIN | Aujourd'hui tout porteur de `settings.update` peut porter le verrouillage à 10 essais / 5 minutes par appel direct. |
| `X08` | Évaluer la faiblesse du PIN **côté serveur** et la consigner dans `audit_logs` | `000000` et `123456` passent par appel direct : l'avertissement est une propriété d'un écran, pas du système. |
| `S14` | Supprimer la route, la page et la RPC du rapport perishable-turnover | Suit la décision `S01`. L'ADR-004 demandait son retrait ; seule la navigation avait été retirée. |
| `A06` | Étendre le trigger `audit_promotion_changes` au `DELETE` | Seul des 7 triggers du 2026-11-04 à ne pas couvrir la suppression. Une ligne. |

---

## 15. Bloc finitions — 12 points, ma recommandation appliquée

Validé en bloc le 2026-11-09. Contestable ligne par ligne.

| # | Sujet | Décision appliquée |
|---|---|---|
| `C12` | Son « commande prête » au comptoir | **Livrer.** C'est le bénéfice annoncé par 4 citations ; `playOrderReadySound` et `useKdsStatusListener` n'ont jamais existé. |
| `C18` | Nom du serveur sur les commandes de salle reprises | **Livrer.** Une colonne à ajouter à une requête existante ; c'est la trace nominative pour les pourboires et les litiges. |
| `C25` | Runbook de mise en service du hub | **Écrire.** Le hub est en production depuis le 2026-10-29 et les gestes de remise en service après panne du PC ne sont écrits nulle part. ADR-034 l'exige. |
| `B14` | Édition du libellé de variante | **Câbler** (décision lot 11). |
| `C14` | Vue cuisine consolidée pour les serveurs | **Corriger la doc, ne pas livrer.** Trois stations, un serveur peut les consulter. À rouvrir si la salle le demande. |
| `C16` | Protéger le changement de poste en cuisine | **Corriger la doc.** La barre d'onglets est le comportement voulu ; la fiche décrit un plein écran à appui long qui n'existe pas. |
| `C20` | Promo et points en direct sur l'écran client | **Ne pas livrer.** Suit `C19` : l'écran est une fenêtre du même poste, et la vitrine est vide. À rouvrir avec `C19`. |
| `C22` | Atténuation de l'écran client après inactivité | **Abandonner.** Retirer l'invariant 4 de la fiche : un écran de boutique s'éteint avec la boutique. |
| `P06` | Planning de production | **Supprimer table et RPC.** Aucun appelant, aucune route, 0 ligne en production, et la fiche se contredit elle-même (livré §15 / backlog §16). |
| `P07` | Arrondi des suggestions de production | **Livrer l'arrondi seulement.** « 4 douzaines » au lieu de « 47 croissants ». La couverture reste figée à 3 jours. |
| `B10` | Codes promo | **Abandonner** (voir §13). Sans canal d'acquisition en ligne, un code promo n'a pas d'emploi. |
| `X07` | Expiration des PIN | **Abandonner.** Avec 11 comptes et la correction `X02` (désactivation qui coupe vraiment), la rotation n'est plus nécessaire. Retirer la promesse des 3 documents, **dont l'ADR-006** qui l'annonce « déjà implémentée ». |

---

## 16. Restent à trancher — 7 changements de comportement

**Je refuse de les noyer dans un bloc.** Chacun modifie ce que le logiciel fait,
pas ce que la doc en dit. Ils n'ont pas été posés en interview faute de temps.

| # | Sujet | Ce qui est en jeu | Ma recommandation |
|---|---|---|---|
| `C11` | Le pickup tablette remet la commande en `draft` | 2 commandes en production sont en `draft` alors qu'elles sont **parties en cuisine et numérotées**. Tout rapport qui exclut `draft` les perd. | **[A]** conserver `pending_payment` |
| `B05` | Les points de fidélité se gagnent **après** remises, rachat et extraction de la PB1 | Un client qui paie en partie avec ses points **gagne moins de points** qu'un client qui paie tout en espèces. Et la valeur du point (1 %) n'est écrite nulle part. | **[A]** gagner sur le sous-total avant remises, **et écrire la valeur du point** |
| `B08` | Le minimum panier d'une promo n'est pas évalué sur la même base aux deux endroits | Un panier à 80 000 avec 10 000 de remise affiche la promo puis **refuse le paiement**. Hors ligne, ce refus est définitif. | **[A]** avant les remises de ligne, partout |
| `P02` | L'annulation d'une fournée ne défait pas le coût moyen qu'elle a posé | Le stock et les écritures sont contre-passés, **le coût non**. Ce coût sert la marge, les alertes et la valorisation. | **[A]** restaurer le coût antérieur |
| `G22` | Aucun geste n'annule une dépense soumise ou approuvée | Seul un brouillon se supprime. Une dépense approuvée par erreur reste au grand livre jusqu'à une contre-passation manuelle. | **[A]** ouvrir une annulation après soumission |
| `R04` | Le rapport des dépenses inclut les dépenses **soumises** non approuvées | Les charges du rapport et celles du résultat divergent du montant des dépenses soumises, sans que rien ne le dise. | **[D]** afficher « engagé » et « comptabilisé » séparément |
| `C05` | Le numéro de session de caisse lisible (`SHF-YYYYMMDD-NN`) n'existe pas | Une session ne se désigne que par un identifiant technique dans l'audit et les échanges avec le comptable. La fiche se contredit elle-même sur son existence. | **[A]** le livrer |

---

## 17. Synthèse des décisions

**44 arbitrages rendus en 11 lots**, plus 3 blocs validés (40 corrections
documentaires, 10 gestes techniques, 12 finitions). **7 points restent ouverts**
(§16) et **2 sont à confirmer en boutique** (§18).

### Les chantiers qui en découlent, par ordre de risque

| # | Chantier | Décisions couvertes | Pourquoi d'abord |
|---|---|---|---|
| 1 | **Sauvegarde et reprise** | `X03`, `X04` | 11 jours d'argent réel, PITR désactivé, restauration jamais éprouvée. `X04` est le prérequis. |
| 2 | **Les 4 RPC absentes de la production** | rapport 01 §5.4 | Quatre écrans du back-office sont **cassés maintenant**. |
| 3 | **Chaîne comptable** | `G01`, `G02`, `G13`, puis `G03` | Résultat et bilan inutilisables : 530 M de CA pour 1 700 IDR de coût des ventes, un actif à solde négatif, 407 M en comptes d'attente. |
| 4 | **Money-path POS** | `G01`, `C10`, `B06` | Même fonction de paiement : à grouper en une seule nouvelle version. |
| 5 | **Droits et sécurité** | `X01`, `X02`, bloc technique | Une seule personne voit le stock et les comptes ; un compte désactivé garde ses droits. |
| 6 | **Stock : retirer les lots, corriger l'inventaire** | `S01`, `S04`, `S05`, `S09`, `S14` | Le FIFO tourne contre l'ADR-004 ; l'inventaire compte deux fois et personne ne peut le finaliser. |
| 7 | **Caisse** | `C01`, `C03`, `C04`, `C08` | Sessions de 75 h, aucun total figé, aucune marche arrière au comptage. |
| 8 | **Achats** | `A01`, `A02`, `A04` | Aucun geste de correction d'une réception ; l'impayé fournisseur affiché est faux. |
| 9 | **B2B** | `B02`, `B13` | Page de réglages cassée ; stock sorti à la saisie pour 119 commandes en attente. |
| 10 | **Reste** | `S02`, `S06`, `S07`, `P05`, `P07`, `P08`, `B04`, `B09`, `B14`, `G11`, bloc finitions | — |

### Ce qui a été abandonné

`X05` notifications · `X07` expiration de PIN · `B04` remise de palier ·
`B10` codes promo · `B12` prix par catégorie · `C22` atténuation d'écran ·
`P05` causes d'écart de rendement · `P06` planning de production ·
`S12` réservations de stock · `S14` rapport perishable-turnover ·
`C14` vue cuisine consolidée · `C20` promo sur l'écran client.

---

## 18. Deux points que je n'ai pas pu trancher

À confirmer en boutique, pas depuis le dépôt.

### Z01 — Hors ligne : peut-on même ajouter un article au panier ?
`apps/pos/src/features/products/ProductTapHandler.tsx:101-105` appelle
`get_pos_product_price_v1` **à chaque tap** et, en cas d'échec, refuse l'ajout
(« Price could not be confirmed. The item was not added. »). Ce prix n'est **pas**
dans l'instantané hors ligne, qui couvre produits, modificateurs, combos,
promotions et taxe — **pas les prix client**. Le test de fumée hors ligne injecte
le panier directement dans le store : le chemin d'ajout n'est jamais exercé.

Si le constat tient, la vente hors ligne est morte à sa porte d'entrée, et tout
l'outbox protège un flux qui ne peut pas démarrer.

**Rappel important** : `offline_payments_enabled` = **false** en production. La
machinerie hors ligne est **éteinte** aujourd'hui. Le test à faire : couper le
cloud, garder le hub, taper un produit.

### Z02 — La journée du 2026-11-02
3 commandes pour 570 000 IDR, contre ~120 commandes les jours voisins. C'est
aussi le dernier jour où une commande a été annulée. Fermeture de boutique ou
panne de caisse ? Les deux produisent le même relevé. Si c'est une panne, les
ventes de ce jour n'ont pas été enregistrées.

---

## 19. Limites de ce relevé

- **Aucun build, test, lint ni typecheck exécuté.** Aucune écriture en base.
- Les corps de fonctions cités « vérifiés en production » le sont par
  `pg_get_functiondef` ; ceux cités depuis un fichier de migration peuvent
  différer du corps live, et c'est signalé quand l'écart a été mesuré (S01, P01,
  G01, X02).
- Les rapports des cinq sous-agents de domaine ont été recoupés en base sur **31
  points**. **Quatre** de leurs conclusions ont été corrigées par ce recoupement :
  1. le FIFO par lot est **vivant**, pas dormant — la logique est recopiée dans
     la primitive d'écriture, et chercher le helper `_resolve_fifo_lot` seul fait
     conclure à tort (`S01`) ;
  2. les comptes de démonstration à PIN connu **ne sont pas** en production
     (`X12`) ;
  3. la perte de vitrine **ne touche pas** le stock général : le sous-agent avait
     lu la version `v2` dans un fichier de migration, la version vivante est la
     `v4` (`S03`). **J'avais relayé cette erreur avant de la vérifier** ;
  4. la monnaie non arrondie est un risque théorique aujourd'hui, pas réalisé
     (`C06`).

  Les trois premières illustrent l'avertissement d'`AGENTS.md` : **un fichier de
  migration ne prouve pas le corps vivant**. Tout constat de ce document qui
  n'est pas marqué « vérifié en base » reste à recontrôler avant correction.
- Les constats d'interface viennent de la lecture des composants, pas d'un rendu
  navigateur.
- `docs/` a servi de source d'intention ; la quarantaine documentaire n'a jamais
  été lue, conformément à `AGENTS.md`.

**Aucun fichier applicatif n'a été créé, modifié ou supprimé. Aucun commit.**
