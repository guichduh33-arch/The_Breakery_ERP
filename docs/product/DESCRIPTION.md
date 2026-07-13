# The Breakery — Description du produit (v1.3)

> **LA référence produit.** Ce document décrit, pour un lecteur non technique (propriétaire, investisseurs, nouveaux employés), ce que fait aujourd'hui le logiciel de The Breakery et ce qui reste à venir. Il fait foi sur le périmètre fonctionnel.

## Historique des versions

- **v1.3 (2026-07-13)** — Reconstruite lors de la « remise à plat » de juillet 2026 : chaque module a été réécrit à partir des fiches d'analyse réel-vs-demandé (comparaison indépendante entre le code réellement livré et la description précédente), puis corrigé par une checklist d'amendements réconciliée avec l'état du code au moment de la publication. Le document source de la version précédente (v1.2, 2026-07-03) n'étant plus disponible, la comparaison mot à mot v1.2 → v1.3 n'est pas auditable ; cette limite est actée comme une dette documentaire. Principaux changements : surventes retirées (fonctions annoncées mais absentes), sous-ventes ajoutées (fonctions livrées mais non documentées), et intégration des décisions du propriétaire — notamment l'abandon définitif de la gestion de péremption/lots (le stock est suivi en quantité globale, la péremption se gère par déclaration de perte) et l'abandon de la livraison motorisée pour les clients professionnels (retrait sur place).
- **v1.2 (2026-07-03)** — Version précédente, 25 modules (non disponible dans le dépôt).

## Introduction

**The Breakery** est une boulangerie-café à Bali. Ce logiciel est son système de gestion complet : il couvre la vente au comptoir et en salle, la cuisine, les stocks, les achats, la comptabilité, les clients et les rapports — de la commande d'un croissant jusqu'au bilan de fin d'année.

Le logiciel se compose de **deux applications** :

- **La caisse (POS)** — utilisée au comptoir pour encaisser, et sur tablette par le personnel de salle pour prendre les commandes.
- **Le back-office** — utilisé par le gérant et l'administration pour piloter le catalogue, les stocks, la comptabilité, les employés, les réglages et les rapports.

Autour de la caisse gravitent trois écrans secondaires :

- **L'écran cuisine (KDS)** — affiche les commandes à préparer, poste par poste.
- **La tablette de salle** — permet au serveur de prendre la commande directement à table.
- **L'écran client** — face au client au comptoir, il montre le panier en direct et remercie après paiement.

**Le logiciel fonctionne via internet.** Tous les échanges entre appareils (tablette → caisse, caisse → cuisine, caisse → écran client) passent par la connexion internet du magasin ; il n'y a pas de réseau strictement local de secours. La seule communication qui reste directe est l'impression des tickets. Une connexion internet fiable est donc requise pour le fonctionnement normal ; le mode hors-ligne fait partie des chantiers annoncés.

**Modèle de stock retenu.** Le stock est suivi en **quantité globale par produit**. La péremption et les pertes se gèrent par **déclaration de perte** (produit périmé, cassé, abîmé). C'est le modèle choisi et assumé, pas une limite temporaire : la gestion fine des lots et des dates de péremption (sortir le plus ancien d'abord, alertes avant péremption) n'est pas au programme.

---

## Module 1 — Connexion & droits d'accès

Chaque employé se connecte avec un code secret personnel et n'accède qu'aux fonctions autorisées par son rôle.

**Aujourd'hui :**
- Connexion à la caisse et au back-office par un **code secret à 6 chiffres**, personnel à chaque employé.
- Après **5 erreurs de code, le compte se bloque 15 minutes** ; les tentatives répétées depuis un même point du réseau sont aussi freinées ; chaque tentative (réussie ou non) est enregistrée avec l'heure et l'origine.
- **5 rôles prédéfinis** : super-administrateur, administrateur, manager, caissier, serveur. Plus de 140 droits répartis en une trentaine de domaines déterminent ce que chaque rôle peut faire.
- Les droits sont **recalculés côté serveur à chaque action** : retirer un droit à un rôle prend effet immédiatement sur les opérations sensibles.
- Un manager (selon ses droits) peut **réinitialiser le code oublié** d'un employé, avec trace écrite.
- **Désactivation immédiate d'un compte sans perte d'historique** ; un compte désactivé ne peut plus se connecter, et ses sessions en cours sont coupées.
- **Déconnexion automatique après inactivité, réglable par rôle** (la caisse verrouille l'écran en préservant la session et le panier ; le back-office déconnecte).
- **Journal d'audit consultable** avec filtres (qui, quelle action, quel élément) pour répondre à « qu'a fait tel employé cette semaine ? ».
- **Impossible de supprimer le dernier administrateur.**
- Le code secret est stocké chiffré ; le système **avertit** (sans bloquer) si un code choisi est trop faible.

**À venir :**
- Double authentification (2FA) pour les comptes de direction.
- Prise d'effet **totalement** immédiate d'un retrait de droits : les contrôles côté serveur sont déjà immédiats, mais l'affichage de l'employé connecté et son jeton d'accès peuvent rester à jour avec un décalage pouvant aller jusqu'à une heure.
- Blocage (et non simple avertissement) des codes secrets trop faibles.

---

## Module 2 — Caisse : panier & commandes

Le cœur de la vente au comptoir : composer un panier, l'envoyer en cuisine, encaisser.

**Aujourd'hui :**
- **Aucune vente possible sans session de caisse ouverte** (comptage du fond de caisse à l'ouverture).
- Commande **sur place, à emporter ou en livraison** ; en service à table, le choix de la table sur un **plan de salle** (avec occupation en temps réel) est **obligatoire** pour une commande sur place.
- **Options et formules** : tailles, laits, suppléments et menus composés, dont la composition et le prix sont vérifiés et facturés automatiquement.
- **Envoi en cuisine verrouillant** : une fois envoyés, les articles sont verrouillés ; retirer un article déjà en préparation exige le **code d'un responsable + un motif** (anti-fraude).
- **Mise en attente et reprise** d'une commande, y compris une commande déjà envoyée en cuisine, partagée en temps réel entre les postes.
- **Client rattaché** : recherche/création en caisse, application automatique du tarif négocié, et cumul de points de fidélité.
- **Toute remise** exige la validation d'un responsable (code + motif obligatoires) — le contrôle est systématique, pas seulement au-delà d'un seuil.
- **Promotions actives appliquées automatiquement** ; le système central re-vérifie et fixe lui-même les prix, de sorte qu'un appareil trafiqué reste sans effet.
- **Ardoise** : laisser une commande envoyée en attente de paiement, la rattacher à un client habituel, la suivre dans l'écran Créances et l'encaisser à son retour ; un plafond de crédit est vérifié à l'ouverture de l'ardoise.
- **Transfert de table** tracé (déplacer une commande ouverte vers une autre table, historisé).
- **Annulation / remboursement** avec code responsable + motif, remise en stock et écriture comptable automatiques.
- **Réception des commandes tablette** et **clôture de journée** avec comptage, écart calculé et récapitulatif.
- Le **panier est reflété en direct sur l'écran client**.

**À venir :**
- **Mode hors-ligne** : encaisser malgré une coupure internet (aujourd'hui la vente est bloquée sans connexion). C'est le chantier n°1 annoncé.
- Sauvegarde de secours du panier en cours de saisie.
- Recalcul automatique des prix quand on rattache un client en cours de panier.
- Réservations avec acompte.
- Vue « tables ouvertes » dédiée au service en salle.

### Module 2 bis — Suivi des commandes au back-office (page Orders)

Une page du back-office permet au gérant de suivre et gérer toutes les commandes, au-delà de la caisse. *(Cette page n'était pas décrite dans la version précédente ; elle est ajoutée ici.)*

**Aujourd'hui :**
- Liste de toutes les commandes avec **mise à jour en temps réel** (badge « Live » qui s'éteint si la connexion tombe) et bouton d'actualisation manuelle.
- **Filtres** par statut, type de service, moyen de paiement, client et plage de dates ; **recherche** par numéro de commande ou nom de client ; chargement progressif par lots (« Charger plus »).
- **5 indicateurs** en tête (nombre de commandes, montant total, taux de complétion, payées, impayées) calculés sur les commandes chargées.
- **Fiche détaillée** de chaque commande (articles avec état de préparation, articles annulés barrés, totaux, paiements, remboursements éventuels, liens vers le client et le vendeur).
- **Annulation** d'une commande payée depuis la liste (code responsable + motif), avec remise en stock et écritures inversées automatiques.
- **Modification des articles** d'une commande encore ouverte (ajout, retrait, changement de quantité).
- **Export en tableur** et point d'arrivée des liens « cliquables » depuis les rapports.

**À venir :**
- Indicateurs calculés sur l'ensemble du périmètre filtré (et non seulement les commandes chargées).
- Remboursement depuis le back-office (aujourd'hui le remboursement se fait uniquement en caisse).
- Notification sonore « commande prête » côté back-office.
- Filtre par vendeur exposé à l'écran, recherche portant sur tout le périmètre.

---

## Module 3 — Encaissement & paiements

La mécanique du paiement : moyens, paiement mixte, partage d'addition.

**Aujourd'hui :**
- Plusieurs **moyens de paiement** au comptoir (espèces, carte, QRIS, terminal bancaire, virement, avoir client) ; le gérant choisit lesquels sont proposés.
- **Paiement mixte** sur un même ticket (jusqu'à cinq moyens combinés), avec calcul automatique du reste à payer ; validation impossible tant qu'il manque un montant.
- **Partage de l'addition** entre convives (par article, à parts égales, ou montants libres), chacun avec son propre moyen de paiement, pour un seul ticket final.
- **Monnaie rendue vérifiée automatiquement**, ouverture du tiroir et impression du reçu automatiques si configurées.
- **Une remise exige toujours le code d'un responsable**, transmis de façon sécurisée et jamais visible en clair.
- Une **coupure réseau ou un double-clic ne crée jamais** un double encaissement ni un double remboursement.
- La **taxe locale (10 %, incluse dans le prix affiché)** est isolée automatiquement pour la comptabilité.

**À venir :**
- Paiements mobiles indonésiens (GoPay/OVO/DANA) avec confirmation automatique (aujourd'hui pointage manuel).
- Un reçu séparé par convive après une addition partagée.
- Champ pourboire.

---

## Module 4 — Écran cuisine

Chaque poste de préparation voit ses commandes sur un écran dédié.

**Aujourd'hui :**
- Chaque **poste** (cuisine, bar, vitrine…) a **son propre écran** et ne voit que ses articles, affectés automatiquement selon la famille du produit ; des filtres permettent d'afficher plusieurs postes sur un même écran.
- **Chronomètre par commande** avec code couleur (vert / orange / rouge clignotant) et **alarme sonore** quand une commande devient critique.
- Les **seuils de temps** (passage orange, passage rouge, disparition automatique de l'écran) sont **réglables par le gérant** pour tout le magasin.
- Chaque article se marque **en préparation, prêt, puis servi** ; les commandes terminées disparaissent seules après quelques minutes.
- **Correction d'erreur** : annuler dans la minute un article marqué « prêt » par erreur, et **rappeler** une commande déjà servie.
- L'écran indique si la commande est **déjà payée** et affiche les **articles annulés** barrés avec leur motif.
- L'écran passe par internet et **se resynchronise automatiquement** après une coupure (rattrapage en quelques secondes).

**À venir :**
- Bouton « tout prêt » pour valider une commande entière en un geste.
- Vue agrégée pour le personnel de salle, regroupant tous les postes.
- Compteur du jour par article (« Cappuccino : 47 préparés »).
- Affichage des notes et allergies sur le ticket cuisine.
- Réglages **par poste** (police, disposition, coupure du son).

---

## Module 5 — Catalogue produits & catégories

Le référentiel de tout ce qui se vend et se fabrique.

**Aujourd'hui :**
- **Fiche produit complète** : prix de vente, prix de gros, coût de revient, photo, unité, seuil d'alerte de stock, suivi de stock ou fabrication à la demande.
- **Catégories** avec ordre d'affichage en caisse et poste de préparation associé (une teinte de couleur est appliquée automatiquement en caisse).
- **Masquer un produit à la caisse** tout en gardant sa fiche active au back-office (il disparaît alors de la grille de vente et du choix des variantes).
- **Options et variantes** (tailles, laits, suppléments) sans multiplier les fiches, avec déduction automatique des bons ingrédients.
- **Formules / menus** dont la composition et le prix sont vérifiés et facturés automatiquement.
- **Prix négociés par catégorie de client et par client individuel**, appliqués automatiquement et **modifiables directement depuis l'écran**.
- **Import / export du catalogue** via un fichier tableur, et consultation de la **marge brute par produit** dans les rapports.
- **Unités multiples** pour l'achat et le stock (acheter en sac, stocker au gramme, convertir automatiquement en recette).

**À venir :**
- Couleur de catégorie personnalisable.
- Vente en sous-unité (par exemple un sachet de 100 g prélevé sur un sac) et vente au poids avec balance connectée.
- Modification de plusieurs prix en une seule opération.
- Simulateur affichant le prix final avant de valider.

---

## Module 6 — Stock & inventaire

Le suivi des matières premières, des semi-finis et des produits finis.

**Aujourd'hui :**
- **Consultation du stock** de tous les produits, avec **alerte visuelle sous le seuil** (seuil réglable produit par produit).
- **Réception d'une marchandise** arrivée sans commande formelle (dépannage).
- **Transferts entre zones** avec confirmation à la réception.
- **Déclaration de perte** avec motif (périmé, cassé, abîmé, autre).
- **Enregistrement de la production** : déduction automatique des ingrédients selon la recette, ajout automatique des produits finis.
- **Inventaire physique par zone** avec correction automatique des écarts.
- **Historique complet et infalsifiable** de tous les mouvements de stock.
- **Stock de vitrine** suivi en direct côté caisse, avec validation de l'arrivée d'une fournée et retour possible en cuisine ; le **coût moyen** est recalculé automatiquement à chaque achat.
- Un réglage détermine si la vente à stock négatif est autorisée pour les produits suivis (la vitrine, elle, bloque toujours à zéro).

**À venir :**
- Alertes automatiques de stock bas envoyées sans avoir à ouvrir l'écran.
- Alerte de stock sur deux niveaux (orange / rouge) au back-office comme il en existe déjà en vitrine.

---

## Module 7 — Achats & fournisseurs

La chaîne d'approvisionnement : fournisseurs, bons de commande, réceptions.

**Aujourd'hui :**
- **Répertoire des fournisseurs** avec recherche, coordonnées et conditions de paiement personnalisables (comptant, 7 / 14 / 30 / 60 jours).
- **Historique par fournisseur** : dépenses totales, impayés, délai moyen de livraison, évolution des prix d'achat.
- **Bons de commande ligne par ligne**, avec **réception possible en plusieurs fois** ; le cycle est « commandé → reçu partiellement → reçu », l'annulation restant possible.
- **Stock et coût de revient mis à jour automatiquement** dès la réception.
- **Paiements fournisseurs** enregistrables en plusieurs fois (partiels ou totaux).
- Chaque action horodatée dans un **journal infalsifiable**.
- **Import en masse** de fournisseurs et d'achats déjà historiques, et **rapports d'achats** par article / date / fournisseur.

**À venir :**
- Contrôle qualité article par article à la réception, avec retour fournisseur et note de crédit en cas d'article refusé.
- Remises et frais de livraison sur les bons de commande.
- Pièces jointes (facture, bon de livraison, photo).
- Bon de commande officiel en PDF et envoi automatique au fournisseur.
- Réapprovisionnement pré-rempli automatiquement à partir des alertes de stock.

---

## Module 8 — Clients & fidélité

Le fichier client et le programme de points.

**Aujourd'hui :**
- **Création rapide d'une fiche client** en caisse (nom + téléphone), recherche instantanée et clients favoris épinglés.
- **Catégories tarifaires** (normal, grossiste, remise, prix négocié) appliquées automatiquement dès qu'un client est rattaché, **créables et modifiables depuis l'écran**, y compris un prix négocié par client individuel.
- **Programme de fidélité** : un point par tranche dépensée, avec un **multiplicateur de points croissant** selon le palier atteint (Bronze / Argent / Or / Platine) ; les points sont échangeables contre une remise en caisse.
- **Historique des points infalsifiable**, avec ajustement manuel tracé.
- **Fiche client complète** : dépenses, visites, commandes, points, tendance.
- **Import de clients en masse** avec détection automatique des doublons.
- **Segmentation automatique** (nouveaux, fidèles, à risque, dormants, perdus) et **alerte anniversaires** du mois avec e-mail automatique.

**À venir :**
- Numéro de membre et QR code scannable pour reconnaissance instantanée en caisse.
- Expiration automatique des points.
- Envoi d'alertes / promotions par WhatsApp ou SMS (aujourd'hui seul l'e-mail fonctionne).
- Fusion assistée des fiches clients en doublon.

---

## Module 9 — Clients professionnels (B2B)

La vente aux professionnels : commandes, facturation, encours.

**Aujourd'hui :**
- **Commandes professionnelles** avec application automatique du **prix négocié** du client (le prix saisi manuellement n'est jamais celui facturé — seul le prix validé par le système compte).
- **Plafond de crédit vérifié au moment de la commande**, y compris si deux commandes partent en même temps : aucun dépassement possible.
- **Facture officielle en PDF** avec numérotation légale continue (série annuelle).
- **Encaissement des règlements facture par facture**, au choix du gérant ou automatiquement dans l'ordre des plus anciennes.
- **Annulation propre** d'une facture non réglée (comptabilité et stock remis à zéro automatiquement), impossible si un paiement y a déjà été enregistré.
- **Suivi des impayés par ancienneté** (à jour / 30 / 60 / 90 jours et plus), identique en caisse et au back-office.
- **Correction manuelle de l'encours** avec code responsable et traçabilité, et **alerte automatique** en cas d'écart de solde.
- **Modèle retenu : retrait sur place.** La commande est créée et le stock déduit immédiatement ; le client professionnel **vient récupérer sa commande au magasin**.

**À venir :**
- Relances automatiques en cas de retard de paiement.
- Commandes récurrentes automatisées (ex. livraison hebdomadaire à un hôtel).
- Étape de devis avant la commande ferme.
- Garde-fou empêchant un commercial de valider lui-même sa propre grosse commande.

---

## Module 10 — Comptabilité en partie double

La comptabilité complète, alimentée automatiquement par l'activité.

**Aujourd'hui :**
- **Plan de comptes** (comptes activables / désactivables) et **journal de toutes les écritures** consultable.
- La **quasi-totalité des écritures** (vente, dépenses, stock, caisse) est enregistrée **automatiquement**, sans saisie manuelle ; la **trésorerie en espèces** (petite caisse, tiroirs) est intégrée au périmètre.
- Une **écriture manuelle** reste possible, mais le système **refuse toute écriture déséquilibrée**, avec validation par code responsable.
- **Grand livre par compte** : chaque écriture indique son origine (type d'opération + référence), et un clic ouvre l'**opération d'origine** (vente, dépense, paiement…).
- **Balance, compte de résultat et bilan** à n'importe quelle date, exportables en PDF (la balance aussi en tableur) ; **marge brute par produit** incluse.
- **Rapport de TVA simplifiée (PB1) mensuel**, exportable en tableur / PDF.
- **Périodes comptables verrouillables** : impossible d'enregistrer une opération sur un mois clôturé ou une date sans période définie.
- **Clôture annuelle** par bouton dédié protégé par code : le bénéfice est reporté et l'année suivante préparée automatiquement.

**À venir :**
- Rapprochement automatique des relevés bancaires avec la comptabilité.
- Notes annexes réglementaires détaillées.
- Un vrai bouton « PB1 déclarée » qui gèle automatiquement la période.
- Check-list guidée de clôture mensuelle.

---

## Module 11 — Dépenses

La saisie et la validation des dépenses de l'entreprise.

**Aujourd'hui :**
- **Saisie rapide** d'une dépense en moins d'une minute (montant, catégorie, fournisseur, mode de paiement, date) avec **photo du justificatif** et statut brouillon.
- **Circuit complet** : soumission, approbation ou refus motivé, puis paiement.
- L'**approbation génère automatiquement l'écriture comptable** dans le bon compte de charges.
- Distinction entre **dépense approuvée non payée** (dette fournisseur) et **dépense réellement payée**.
- **Validation à plusieurs niveaux selon le montant** : petites dépenses auto-approuvées, grosses dépenses soumises à un responsable avec code ; **personne ne peut valider sa propre dépense** (sauf le patron, action tracée).
- Bouton **« Dupliquer »** pour recréer en deux clics une dépense récurrente (ex. loyer).
- **Tableau d'analyse par catégorie** avec totaux, tendance et export.
- Une **dépense payée en espèces sort de la petite caisse** (coffre), et non du tiroir de vente — le comptage du soir n'est pas affecté.

**À venir :**
- Dépenses récurrentes programmées automatiquement (loyer, internet).
- Budget par catégorie avec alerte de dépassement.
- Lecture automatique des factures photographiées.

---

## Module 12 — Caisse physique & sessions

L'ouverture, la tenue et la clôture du tiroir-caisse.

**Aujourd'hui :**
- **Ouverture de session** par code, avec saisie du fond de caisse.
- **Mouvements de caisse en journée** (apport, retrait) avec motif obligatoire ; le montant attendu s'ajuste automatiquement.
- **Comptage « à l'aveugle » à la clôture** : le montant attendu reste caché tant que le comptage n'est pas confirmé, pour empêcher tout ajustement de complaisance (un vrai point fort anti-fraude).
- **Comptage en trois volets** (espèces / paiement mobile / carte), avec en **option** un décompte billet par billet.
- **Écart calculé et coloré** ; au-delà d'un seuil réglable, une **raison est obligatoire** et un **responsable valide par code**.
- L'écart de caisse **génère automatiquement l'écriture** comptable de perte ou de gain.
- **Rapport de fin de service archivé en PDF**, signable et annulable depuis le back-office, protégé par code.
- **Plusieurs vendeurs** peuvent partager un même poste, chacun avec sa propre session ; un **rapport dédié** repère un manque récurrent chez un même caissier.

**À venir :**
- Passage de relais entre deux vendeurs sans fermer la session.
- Fermeture automatique des sessions oubliées.
- Double signature (caissier + responsable) pour les très gros écarts.
- Suivi intégré du dépôt en banque (tiroir → coffre → banque).
- Archivage garantissant l'immutabilité sur les **dix ans** exigés par la loi indonésienne (le PDF est archivé aujourd'hui ; le mécanisme d'immutabilité longue durée reste à outiller).

---

## Module 13 — Promotions & remises

La création et l'application des offres commerciales.

**Aujourd'hui :**
- **Création de promotions** : pourcentage, montant fixe, « 2 achetés = 1 offert », produit offert — avec conditions (seuil d'achat, **jours et horaires**, dates de validité).
- **Plafond d'utilisation** global et par client, respecté même avec plusieurs caisses actives ; une commande annulée libère la place.
- **Menus / formules composés** vérifiés et facturés automatiquement (les suppléments sont toujours correctement ajoutés).
- **Remise affichée nommément** à l'écran de caisse et sur l'écran client, et **détaillée dans l'historique des commandes** au back-office.
- **Règles de cumul** entre promotions actives déjà gérées (priorité entre offres).
- **Promotions par créneau horaire** (happy hour) disponibles.
- **Rapport de retour sur investissement** par campagne.

**À venir :**
- Afficher la remise nommément sur le **ticket imprimé** (dépend d'une mise à jour du module d'impression).
- Codes coupons (newsletter, QR personnalisé).
- Promotions ciblées par segment de clientèle (VIP, nouveaux clients).
- Suggestion au vendeur pour déclencher une offre (« ajoutez un article pour l'obtenir »).

---

## Module 14 — Rapports & analyses

Le pilotage chiffré de l'activité.

**Aujourd'hui :**
- **Plus de 30 rapports** classés par thème (ventes, stock, achats, finance, opérations, marketing, audit), accessibles depuis un tableau centralisé.
- **Tableau de bord d'accueil actif** avec des chiffres réels (tendance sur 30 jours, répartition des ventes, heures de pointe, produits vedettes, moyens de paiement).
- **Rapports financiers** complets : compte de résultat, bilan, trésorerie, TVA simplifiée, marge brute par produit.
- **Encaissements par moyen de paiement** calés sur l'heure locale du magasin.
- **Suivi anti-fraude par employé** (annulations, remboursements, remises accordées), dont un rapport des **écarts de caisse par caissier**.
- **Journal détaillé de chaque manipulation** faite sur chaque poste de caisse (utile en cas de litige).
- **Export tableur et PDF** sur la plupart des rapports, avec **navigation cliquable** d'un rapport à l'autre (catégorie → produit → jour précis).

**À venir :**
- Rapport de valorisation du stock (valeur totale en argent) et détection des produits qui ne se vendent plus.
- Courbe de tendance des écarts de caisse dans le temps.
- Comparaison avec la période précédente généralisée à tous les rapports (limitée aujourd'hui à trois pages).
- Envoi automatique par e-mail des rapports clés.

---

## Module 15 — Production & recettes

La fabrication maison : recettes, fournées, rendement.

**Aujourd'hui :**
- **Fiche technique par produit** (ingrédients, quantités, pourcentages) avec **coût matière et marge calculés en direct**.
- **Saisie des fournées**, plusieurs recettes à la fois, avec **vérification préalable des quantités disponibles** (le manque exact est chiffré avant validation).
- **Déclaration des ratés** avec raison obligatoire au-delà d'un certain écart, et **suivi du taux de perte** par produit.
- **Suggestions de production du matin** basées sur les ventes récentes.
- **Historique complet des versions de recette**, coût figé à chaque changement, et **alerte automatique** quand un produit passe sous la marge cible.
- **Planning de production** par calendrier, avec possibilité d'**annuler une fournée** déjà enregistrée.
- **Allergènes renseignés et affichés sur l'écran de caisse.**
- **Rapports de rendement et d'efficacité** de production.

**À venir :**
- Saisie des fournées directement sur tablette en cuisine.
- Coût figé au moment de la vente (plutôt que le coût moyen courant).
- Prévision de production selon les tendances.

---

## Module 16 — Écran côté client

L'écran tourné vers le client au comptoir.

**Aujourd'hui :**
- Écran dédié face au client, mis en service par un **code d'appairage** (pas besoin d'un code employé).
- **Miroir du panier en temps réel** avec le total en gros caractères — il fonctionne lorsque l'écran client est branché sur le même poste que la caisse.
- Message **« Merci »** et rappel de la monnaie à rendre pendant quelques secondes après un paiement en espèces.
- **Fil des commandes prêtes** qui défile, basé sur l'état réel de la cuisine, avec mise en avant de la plus récente.
- **Accueil personnalisable** avec un message de bienvenue propre à chaque terminal.
- Écran **purement passif** : il n'enregistre jamais rien, il affiche seulement.

**À venir :**
- Affichage en détail des remises et des points de fidélité gagnés (aujourd'hui non détaillés ligne à ligne).
- Miroir du panier fonctionnant même quand l'écran client est un appareil **séparé** de la caisse.
- Rotation de visuels ou de promotions en mode veille.

---

## Module 17 — Commande sur tablette

La prise de commande en salle par le personnel.

**Aujourd'hui :**
- Le serveur **s'identifie avec son propre code**, choisit la **table sur un plan de salle en temps réel**, et compose la commande sur une interface tactile.
- **Envoi protégé contre les doublons** (double-appui, coupure réseau) : jamais de commande envoyée deux fois.
- **Confirmation explicite** que la commande est enregistrée, ou message d'erreur clair sinon.
- La commande **part simultanément en cuisine et vers la caisse** dès l'envoi ; le caissier encaisse ensuite (la caisse ne gère que le paiement).
- Indicateur **« hors ligne »** clair quand le wifi tombe, avec menu tout de même consultable.
- **Note sur la commande** (par exemple une consigne particulière), visible en cuisine et au retrait.
- **Historique des commandes du serveur** avec statut, et **annulation** possible d'une commande.
- **Alerte en temps réel** quand un plat est prêt à apporter en salle.

**À venir :**
- Note attachée à un **article précis** (ex. « sans lait » sur un seul café).
- Historique borné aux commandes du jour (aujourd'hui il montre tout l'historique du serveur).
- Prise de commande **sans connexion**, avec rattrapage automatique au retour du réseau.
- Menus / formules composés directement sur tablette.

---

## Module 18 — Application mobile

**Statut : ce module entier est reporté à un chantier futur — rien de dédié n'existe encore.**

**Aujourd'hui :**
- Il n'existe **pas d'application mobile dédiée** (rien à installer, pas d'icône sur l'écran d'accueil).
- La caisse et le back-office restent accessibles depuis le **navigateur d'un téléphone**, comme un site web ; la prise de commande en salle est utilisable ainsi, sans installation.
- Aucune notification quand l'application est fermée, aucun mode hors-ligne, aucun retour vibrant.

**À venir :**
- Une véritable application téléphone dédiée, installable (Android d'abord, iPhone envisagé ensuite).
- Indicateur honnête de qualité réseau et retour tactile (vibrations).
- Notifications reçues même application fermée (« commande prête », « stock bas ») et scan de codes-barres par l'appareil photo pour les réceptions de stock.

---

## Module 19 — Réglages & configuration

Le centre de paramétrage du logiciel.

**Aujourd'hui :**
- Un **espace réglages central** regroupe toutes les pages utiles (identité boutique, taxes, moyens de paiement, présentation caisse, jours fériés, modèles de tickets et d'e-mails, sécurité, comptabilité, plan de salle, écran cuisine…) — **plus aucune page qui bloque en cul-de-sac**.
- **Nom, adresse fiscale, devise, fuseau horaire, taux de taxe et seuils d'écart de caisse** modifiables et vérifiés avant enregistrement.
- **Moyens de paiement acceptés activables / désactivables**, avec effet sur les caisses en moins d'une minute et sans redémarrage.
- **Gestion complète des jours fériés** (nationaux, religieux, entreprise).
- **Modèles d'e-mails et de tickets** personnalisables avec aperçu — ils affichent aujourd'hui **honnêtement qu'ils ne sont pas encore réellement utilisés** pour l'envoi ou l'impression.
- **Délai de déconnexion automatique réglable par rôle** ; chaque modification des réglages généraux est **tracée** (qui, quoi, avant / après), consultable via le journal.
- **Configuration du plan de salle** (tables et sections) et des **seuils de l'écran cuisine** disponibles.

**À venir :**
- **Logo** et **identifiant fiscal (NPWP)** dans la fiche identité.
- **Branchement réel** des modèles d'e-mails et de tickets sur l'envoi et l'impression.
- Export / import de la configuration, recherche dans les réglages, assistant d'installation guidé.
- Écran dédié pour consulter facilement l'historique des modifications de réglages.

---

## Module 20 — Gestion des employés & droits

L'administration des comptes et la lecture des droits.

**Aujourd'hui :**
- **Gestion complète des comptes** : création, modification, désactivation, changement de rôle, réinitialisation de code.
- Chaque action sensible sur un compte est **enregistrée** (auteur, personne concernée, raison, date).
- Un **rapport dédié** retrouve qui a changé le rôle ou les droits de quel employé.
- **Fiche employé détaillée** : statut actif / inactif, dernière connexion, tentatives de code échouées, blocage éventuel.
- **Déconnexion automatique réglable par rôle.**
- Une **grille affiche, en lecture seule, quel rôle a accès à quelle fonction** — elle sert à consulter les droits ; la modification des droits passe par le **changement de rôle** de l'employé.
- **Désactiver ou supprimer un compte coupe immédiatement ses connexions** et bloque toute nouvelle tentative.
- **Impossible de supprimer le dernier administrateur.**

**À venir :**
- Import en masse de plusieurs employés d'un coup.
- Détection automatique des comptes inactifs de longue date.
- Bouton autonome pour couper immédiatement une session en cours.
- Réactivation d'un compte supprimé (aujourd'hui la suppression est définitive à l'écran).

---

## Module 21 — Réseau local (postes & imprimantes)

La façon dont les appareils communiquent et impriment.

**Aujourd'hui :**
- **Toutes les communications** entre appareils (tablette → caisse, caisse → cuisine, commandes → écran client) passent par la **connexion internet** du magasin.
- L'**impression des tickets** se fait **directement** de la caisse vers le boîtier d'impression de chaque poste, sans file d'attente intermédiaire.
- Si une imprimante ne répond pas, **la commande n'est jamais perdue** : elle reste visible en caisse et à l'écran cuisine, avec un message d'avertissement honnête — le ticket papier, lui, ne repart pas tout seul.
- Les **appareils enregistrés** (caisses, tablettes, imprimantes) restent connus du système après un redémarrage.
- Une **page de gestion au back-office** montre les appareils connectés et depuis quand ils ont **donné signe de vie**.
- L'**adresse de l'imprimante** utilisée peut être changée poste par poste, sans redémarrage.

**À venir :**
- Bouton pour **relancer manuellement** un ticket qui n'a pas pu s'imprimer.
- Tableau de bord de diagnostic réseau et test d'impression par imprimante.
- Correction d'une fausse alerte « appareil hors ligne ».
- Reprise après coupure **internet** (aujourd'hui, sans internet, les appareils ne communiquent plus entre eux ; seule l'impression directe continue).

---

## Module 22 — Charte graphique & cohérence visuelle

L'identité visuelle et la qualité d'affichage.

**Aujourd'hui :**
- Une **bibliothèque unique de composants** (boutons, cartes, fenêtres, tableaux…) garantit un rendu cohérent sur toute la caisse et tout le back-office.
- **Deux thèmes cohérents** : sombre / doré pour la caisse, clair / ivoire pour le back-office.
- Les **boutons clés de la caisse sont dimensionnés** pour être touchés facilement et vite, y compris pendant le rush.
- La plupart des écrans affichent un **message clair et une action proposée** plutôt qu'un écran vide quand il n'y a rien à montrer.
- Les **fenêtres et pop-ups** sont utilisables au clavier (Échap, navigation) ; un contrôle automatique **empêche la création de fenêtres non conformes**.
- Un **contrôle qualité automatique** bloque toute évolution qui dégraderait ces standards.

**À venir :**
- Terminer le nettoyage des dernières couleurs hors palette officielle et un audit visuel systématique.
- Améliorer le contraste de certains textes discrets.
- Harmoniser les écrans de chargement / attente.
- Annonces vocales pour les lecteurs d'écran lors des mises à jour en direct.
- Illustrations de marque pour les écrans vides ou d'erreur.

---

## Module 23 — Qualité & tests

Les garde-fous automatiques qui protègent le logiciel.

**Aujourd'hui :**
- **Chaque modification est vérifiée automatiquement** (style, tests, compilation) avant d'être acceptée ; une modification cassée est bloquée.
- **Plus d'une centaine de vérifications** protègent les calculs critiques (prix, plafonds de promotions, verrous financiers) sur l'environnement réel ; le **socle sécurité / argent tourne systématiquement et bloque** toute modification dangereuse. La quasi-totalité des vérifications est au vert.
- **Plusieurs centaines de tests plus fins** couvrent des écrans de la caisse et du back-office.
- Une **batterie de 12 scénarios complets de bout en bout** (connexion, vente, réception de stock…) tourne **chaque nuit dans un vrai navigateur**.
- Un **« cliquet qualité »** empêche toute régression progressive du niveau de qualité.

**À venir :**
- Étendre les vérifications de base aux écrans de rapports qui n'en ont pas encore.
- Fixer des objectifs minimaux de couverture de test par module.
- Tests visuels par comparaison de captures d'écran.
- Jeux de données de test mutualisés et suivi de performance avec alertes.

---

## Module 24 — Mises à jour & exploitation

La mise en ligne, la surveillance et la reprise après incident.

**Aujourd'hui :**
- Un **manuel écrit de reprise après incident** couvre six scénarios (perte de connexion, restauration de la base, panne d'un service clé, annulation d'une mauvaise mise à jour, panne d'une caisse, bourrage imprimante) avec des délais cibles.
- Un **outil de remontée automatique des erreurs** est **déjà intégré** à la caisse et au back-office, **prêt à s'activer** dès qu'un compte de surveillance sera branché (pas encore activé).
- Un **contrôle qualité automatique** empêche fiablement une version cassée d'être mise en ligne.
- Une **chaîne de livraison automatisée** vers un environnement d'essai est écrite ; l'environnement d'essai officiel est **l'environnement de développement actuel**, et les mises en ligne se font aujourd'hui par l'équipe. Il **n'existe pas encore d'environnement de production dédié** : tout tourne sur l'environnement de développement / test.

**À venir :**
- Provisionner l'environnement d'essai hébergé (comptes, accès) pour une chaîne automatisée de bout en bout.
- Définir et construire le **véritable environnement de production** du magasin, avec le plan de bascule.
- Réaliser et chronométrer un vrai **exercice de restauration** de sauvegarde, puis le répéter chaque trimestre.
- Activer la surveillance des erreurs et l'étendre côté serveur.
- Notes de version automatiques.

---

## Module 25 — Sécurité

La protection des données et des opérations sensibles.

**Aujourd'hui :**
- L'accès aux données clients et de vente **sans être connecté est totalement bloqué** ; toute nouvelle donnée ajoutée au système est **fermée par défaut**.
- Les tentatives de code sont **limitées** : blocage temporaire d'un compte après plusieurs erreurs, freinage des tentatives répétées depuis un même point du réseau, chaque tentative enregistrée avec heure et origine.
- Les **codes sont stockés chiffrés** ; les **codes d'autorisation d'un responsable circulent par un canal sécurisé dédié**, jamais visibles en clair ; le code de connexion transite chiffré par la connexion sécurisée (HTTPS) ; les messages d'erreur ne révèlent aucun détail technique.
- Le **prix de chaque ligne de vente est recalculé et vérifié par le système central** (jamais fait confiance à la caisse), et les **plafonds de promotions sont protégés** même quand plusieurs caisses vendent en même temps.
- Un **journal d'audit unique et consolidé** retrace toutes les actions sensibles ; sa consultation est **réservée aux administrateurs**.
- La **durée des sessions est plafonnée** et peut être coupée immédiatement en cas de changement de rôle ou de suppression de compte.

**À venir :**
- **Invalidation immédiate des jetons d'accès** après révocation (aujourd'hui, un décalage pouvant aller jusqu'à une heure subsiste).
- Veille automatique des vulnérabilités des composants tiers.
- Politique écrite de renouvellement des accès techniques.
- Protections supplémentaires : blocage des mots de passe déjà compromis, accès restreint aux images produits.
- Test d'intrusion réalisé par un prestataire externe.
