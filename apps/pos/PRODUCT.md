# Product

<!-- impeccable:product-schema 1 -->

Périmètre : **la caisse et ses écrans satellites** (`apps/pos`) — le comptoir
(`/pos`), la tablette de salle (`/tablet`), l'écran cuisine (`/kds`) et l'écran
face client (`/display`). Quatre publics, une seule base de code, un seul objet
en vol : la commande. Le back-office (`apps/backoffice`) est un produit voisin,
servi par le même socle, avec ses propres utilisateurs et son propre monde
visuel — il porte sa propre fiche et celle-ci ne parle pas pour lui.

## Platform

web

## Users

Quatre publics se partagent les quatre surfaces. Aucun n'est une variante d'un
autre : leur posture, leur distance à l'écran et leur tolérance à l'erreur
diffèrent au point qu'un même composant ne peut pas les servir tous.

- **Le caissier, au comptoir** — utilisateur principal. Debout, face à un écran
  tactile, sans clavier physique sur le plan de travail, un client en attente
  devant lui. **Équipe petite, stable et formée** : il connaît l'écran par cœur.
  La densité forte, les gestes courts et les raccourcis experts le servent ;
  l'assistance pédagogique permanente le ralentit.
- **Le serveur, en salle** — tablette en main, souvent une seule main libre, à la
  table, debout. Il saisit et il envoie ; il ne touche jamais à l'argent.
  Sessions très courtes, répétées, interrompues par le client qui parle.
- **Le boulanger et le barista, en cuisine** — mains occupées, farinées, écran
  lu **à distance et en coup d'œil**, jamais en session. Ils ne créent rien : ils
  font avancer un statut.
- **Le client, devant la caisse** — public non formé, non captif, qui n'a rien
  demandé. Il regarde, il ne touche pas. Il vérifie que ce que le caissier a
  saisi correspond à ce qu'il a commandé.

Un cinquième rôle traverse les quatre sans avoir d'écran à lui : **le manager**.
Il ouvre et clôture la session de caisse, et son code d'autorisation est exigé
sur tout geste sensible — remise au-delà du seuil, annulation, retrait d'un item
parti en cuisine. Ce n'est pas une surface, c'est une autorité qui interrompt.

## Product Purpose

Le POS est le **poste de travail de l'encaissement** de The Breakery, une
boulangerie-café à Lombok (Nusa Tenggara Barat, Indonésie). Il transforme un
client devant le comptoir en transaction propre, comptabilisée et traçable :
produit, variantes, modificateurs, remise, taxe, paiement, ticket, tiroir,
déduction de stock, envoi cuisine, fidélité.

Il réussit quand la file avance. La cible métier est de tenir **200 commandes par
jour** sans erreur de saisie ni d'encaissement : à ce volume, cinq secondes de
friction inutile par transaction coûtent un quart d'heure de file d'attente
quotidienne. La vitesse n'est donc pas un agrément, c'est la fonction.

Les quatre surfaces forment un seul produit parce qu'elles regardent le même
objet au même instant : la commande en cours. Le comptoir la compose, la salle
l'alimente, la cuisine la produit, le client la contrôle.

## Positioning

Une caisse qui n'invente rien et ne perd rien. Quatre mécanismes qu'un POS
générique ne pourrait pas copier sans refaire le même travail :

- **Encaisser ne dépend pas du réseau.** Pendant une coupure, la prise de
  commande **et** l'encaissement continuent, par toute méthode de paiement sauf
  l'avoir client, partage d'addition compris, **sans limite de durée**
  (ADR-015). La file locale est rejouée au retour du réseau. L'avoir reste
  en ligne parce que son solde se vérifie au serveur sous verrou.
- **Ce qui est parti en cuisine ne s'efface pas.** Un item envoyé a consommé un
  coût. Son retrait exige une autorisation manager **et une déclaration de perte
  obligatoire**, déduite du stock et rattachée à la commande ; la suppression est
  refusée (ADR-010). La garde est au serveur, pas dans l'interface. Le chemin
  « encaisser, annuler, empocher » n'existe pas.
- **Le serveur est l'autorité, jamais le poste.** Prix, prix négociés, promotions
  et leurs plafonds, prix de combo et modificateurs de composants, remises :
  tout est recalculé et arbitré en base. Le poste ne propose pas de montant, il
  en demande un. Et il ne parle jamais directement à la fonction d'argent : il
  poste une fonction de bord qui porte l'idempotence de retry et la vérification
  du code d'autorisation.
- **Le papier n'est pas une preuve, la base l'est.** Aucune décision — encaisser,
  envoyer en cuisine, clôturer — ne dépend du succès d'une impression. Un ticket
  raté n'est pas rejoué plus tard ; la commande, elle, survit avec un
  avertissement honnête.

## Operating Context

- Commerce unique à Lombok. Devise **IDR**, montants sans décimales et souvent à
  sept chiffres (`Rp 4,850,000`) — les lignes de panier, les pavés de saisie et
  les tuiles de produit doivent les tenir sans troncature.
- Fuseau métier **Asia/Makassar**, constante de déploiement (ADR-019). Le jour de
  caisse n'est pas le jour du navigateur.
- Fiscalité indonésienne : régime **NON-PKP**, taxe locale **PB1 à 10 % incluse
  dans le prix affiché**. Le client voit toujours le prix total ; la taxe est
  isolée pour la comptabilité, jamais ajoutée à l'écran.
- **Connexion de boutique sujette aux coupures.** C'est le POS qui porte le mode
  dégradé du produit : le back-office suppose le réseau, la caisse non. Un hub
  réseau local assure la continuité entre appareils de la même pièce — bus
  boutique, rattrapage borné pour un appareil qui rejoint, et un seul écrivain de
  présence vers le cloud.
- **Rush.** L'usage n'est pas réparti dans la journée : il se concentre en pics
  où le caissier ne lâche pas l'écran des yeux et où la file est visible derrière
  le client servi.
- **Aucun matériel n'est arrêté** (constaté le 2026-08-08). Ni taille, ni
  orientation, ni densité, ni luminosité d'écran ne peuvent être supposées, pour
  aucune des quatre surfaces. Le POS doit tourner sur le navigateur tactile
  disponible. Corollaire : les conditions de lecture réelles — distance en
  cuisine, lumière au comptoir — ne sont pas caractérisées.
- Périphériques physiques : imprimantes thermiques ESC/POS jointes en TCP par un
  boîtier par poste, tiroir-caisse ouvert par impulsion sur l'imprimante de
  caisse, terminal de paiement carte/QRIS **doté de sa propre liaison** — le POS
  n'en pilote rien, il enregistre le règlement.
- **Pas de session de caisse ouverte, pas de vente.** Tant que le fond de caisse
  n'est pas compté et la session attribuée, la surface comptoir n'affiche que
  l'ouverture de session.
- Le back-office cohabite en permanence avec la caisse en service : ce qu'il
  modifie (prix, catalogue, réglages, droits) atterrit en moins de deux secondes
  sur un poste où quelqu'un encaisse.

## Capabilities and Constraints

- **Quatre surfaces, quatre régimes.** Le comptoir (`/pos`) et ses satellites
  (stock, rapports, réglages du terminal, ardoises) ; la tablette (`/tablet`,
  prise de commande et historique de l'appareil) ; l'écran cuisine (`/kds`) ;
  l'écran client (`/display`).
- **Authentification par code personnel, jamais par mot de passe**, avec
  verrouillage sur inactivité. Exception assumée : l'écran client n'est pas
  derrière une session de personnel — il s'appaire par jeton d'appareil, et un
  écran non appairé affiche son invite d'appairage.
- **Touch-first sans clavier physique.** Toute saisie du comptoir — montant,
  recherche client, code produit — passe par un clavier virtuel à deux
  dispositions. Un seul écran tactile doit suffire à tenir la caisse.
- **Cuisine : quatre postes** (cuisine chaude, barista, vitrine, vue serveur
  consolidée), routage d'un item déterminé par la catégorie de son produit,
  **lecture seule sauf le statut d'item**, granularité à l'item — chaque ligne a
  son propre tempo.
- **Écran client : passif par contrat.** Aucun bouton, aucun tactile. Deux modes
  seulement, actif pendant une commande et repos entre deux, avec bascule
  automatique et atténuation après inactivité prolongée.
- **Tablette : délibérément pauvre.** Pas d'encaissement à la table, pas de
  promotion manuelle, modificateurs simples seulement. Envoi explicite
  obligatoire, une commande sur place exige toujours une table, et la
  confirmation « envoyée » n'apparaît qu'adossée à une écriture réelle — jamais
  sur un geste d'interface.
- **Le design system est partagé et non négociable** : `@breakery/ui` fournit les
  primitifs, les tokens et les deux thèmes. La caisse ne peut pas diverger seule
  — toute évolution de primitif se répercute sur le back-office.
- **Écritures de vente et de stock exclusivement par fonctions serveur.** Aucune
  écriture directe depuis l'application. Le registre de stock est append-only :
  l'interface ne propose jamais de corriger un mouvement, elle propose d'en
  émettre un autre.
- **Les formats de la file hors-ligne sont append-only.** Un type d'intention
  publié ne se supprime jamais : un poste mis à jour avec des ventes en file les
  rejouerait dans le vide, et ce sont des encaissements déjà réalisés. On
  n'y met que ce que le serveur ne peut pas refuser — un envoi refusé partirait
  en quarantaine plutôt que de bloquer la file (ADR-018).
- **La langue de l'interface est l'anglais**, aligné sur le back-office et
  confirmé le 2026-08-08. Pas de couche i18n à prévoir. Constat factuel : des
  chaînes françaises subsistent dans le code (écran de démarrage, panneau de
  paiement) — ce sont des défauts, pas une intention.
- **Périmètre volontairement exclu** : la caisse ne gère pas le catalogue, ne
  crée pas de commande B2B, ne pilote pas l'avancement cuisine, ne compose pas de
  promotion, et n'encaisse jamais à la table.
- **Décisions produit ouvertes**, à ne pas trancher par défaut d'implémentation :
  pré-autorisation carte pour le service en salle ; réservation ou pré-commande
  avec acompte ; vue dédiée des tables ouvertes ; reprise d'une commande passée
  pour un habitué. La quote-part de taxe par payeur en partage par item n'est pas
  livrée : le total d'un payeur est la somme de ses lignes. La validation de
  l'hors-ligne en conditions réelles de boutique reste due.

## Brand Commitments

- Nom du produit et de l'enseigne : **The Breakery**.
- Langue d'interface : **anglais**.
- Bibliothèque de composants unique (`@breakery/ui`) partagée avec le
  back-office, avec deux thèmes distincts — la caisse et ses satellites vivent
  sur le thème sombre, le back-office sur le thème clair.
- Logos et marque existants versionnés dans `packages/ui/src/assets`.

## Evidence on Hand

- `docs/objectifs/POS.md`, `KDS.md`, `TABLET_ORDERING.md`,
  `CUSTOMER_DISPLAY.md`, `PRINTING_AND_DEVICES.md` — les fiches métier des
  quatre surfaces et de leur matériel, écrites côté intention.
- `docs/adr/` — les décisions gravées, immuables ; pour ce périmètre, notamment
  le cycle de vie des commandes, le verrou cuisine, l'intégrité comptable des
  annulations et remises, l'encaissement hors ligne, la quarantaine des
  intentions refusées, le socle des réglages et le fuseau de déploiement.
- `apps/backoffice/PRODUCT.md` — le produit voisin, dont la vérité produit
  partagée (devise, fiscalité, fuseau, design system, langue) ne doit pas être
  redécidée ici.

**Absences que le travail futur ne doit pas combler par de l'invention :** le
produit n'est **pas encore en boutique**. Il n'existe donc aucun client réel,
aucun témoignage, aucune donnée d'usage, aucune mesure de rush, aucune photo du
parc matériel, aucun relevé de conditions de lumière ou de distance de lecture.
Le volume de 200 commandes par jour est une **cible métier**, pas une mesure.
Toute donnée affichée dans une maquette est une donnée de démonstration et doit
être reconnaissable comme telle.

## Product Principles

1. **La vitesse est une fonction de sécurité.** Un geste retiré du parcours
   d'encaissement vaut plus qu'un geste embelli. Ce qui ralentit le rush finit
   par être contourné, et un contournement est une perte de traçabilité.
2. **Rien ne s'efface, tout se déclare.** Registres financiers et de stock sont
   append-only. L'interface offre des écritures compensatoires, jamais des
   gommes, et nomme qui a fait le geste.
3. **Le réseau est un confort, pas une condition.** Toute surface doit dire
   honnêtement dans quel régime elle se trouve, sans jamais laisser croire qu'un
   encaissement dépend d'internet — ni qu'il a abouti quand il attend en file.
4. **Quatre publics, un seul objet.** Chaque surface montre la commande en vol
   sous l'angle de son métier. Aucune ne peut la contredire, aucune n'a le droit
   d'en devenir la source.
5. **La confirmation ne précède jamais l'écriture.** Un écran qui affiche
   « envoyé », « payé » ou « prêt » avant qu'une écriture existe ment sur
   l'argent ou sur la production.

## Accessibility & Inclusion

Aucune norme n'a été contractuellement fixée. Sont établis comme acquis à ne pas
régresser : les cibles tactiles sont dimensionnées pour le doigt, la caisse est
utilisable sans clavier physique, les dialogues restent pilotables au clavier et
un accès direct au contenu précède la navigation, l'inactivité est annoncée avant
le verrouillage, et l'urgence en cuisine est signalée **à la fois** visuellement
(minuteurs) et sonorement — jamais par le son seul, dans un atelier bruyant.

Contraintes d'usage établies mais non mesurées, à ne pas traiter comme
résolues : lecture à distance et mains occupées en cuisine, lecture debout en
lumière de boutique au comptoir, et lecture par un client non formé sur l'écran
face caisse. Le contraste des textes discrets est un chantier ouvert reconnu au
niveau du design system partagé.
