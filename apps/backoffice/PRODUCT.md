# Product

<!-- impeccable:product-schema 1 -->

Périmètre : **le back-office** de The Breakery (`apps/backoffice`). La caisse
(`apps/pos`) et ses écrans satellites sont un produit voisin, servi par le même
socle mais avec ses propres utilisateurs et son propre monde visuel — ce fichier
ne parle pas pour eux.

## Platform

web

## Users

Quatre profils ouvrent le back-office, avec des rythmes incompatibles entre eux.
Aucun n'est marginal, et une décision qui sert l'un dessert souvent l'autre.

- **Le propriétaire-gérant** — utilisateur principal. Pilotage, arbitrages,
  contrôle. Sessions longues, au bureau ou le soir, sur ordinateur portable.
  Connaît chaque écran ; la densité forte et les raccourcis experts le servent.
- **Le manager de boutique** — ouvre le back-office en journée, entre deux
  services : commandes, encaissements, stock. Sessions courtes, interrompues,
  souvent debout. Doit retrouver une information sans la chercher.
- **Le comptable** — n'utilise qu'un coin de l'application, mais en profondeur :
  écritures, grand livre, balance, clôture, PB1. Exige traçabilité et export.
- **Le responsable stock / production** — réceptions, transferts, fournées,
  opname, déclarations de perte. Travaille depuis le fournil ou la réserve,
  potentiellement sur tablette, les mains occupées.

Ces quatre profils passent par le même RBAC : ce que chacun voit est filtré par
ses permissions, en cascade jusqu'à faire disparaître un domaine entier de la
navigation.

## Product Purpose

Le back-office est le poste de pilotage de The Breakery — une boulangerie-café à
Lombok (Nusa Tenggara Barat, Indonésie). Là où la caisse encaisse, le back-office
décide : catalogue et prix, stocks et production, achats et fournisseurs, clients
et B2B, dépenses, comptabilité en partie double, employés et droits, réglages, et
plus de trente rapports.

Il réussit quand le gérant peut répondre à une question sur son commerce sans
ouvrir un tableur, et quand une anomalie — écart de caisse, stock qui dérive,
marge qui s'effondre — se voit avant qu'on la cherche.

## Positioning

Un ERP complet taillé pour **une** boulangerie-café, pas un POS générique auquel
on aurait greffé des modules. Trois conséquences qu'un produit voisin ne pourrait
pas copier sans refaire le même travail :

- **La comptabilité est alimentée par l'activité, pas ressaisie.** Vente, perte,
  écart de caisse, réception, dépense approuvée : chacun émet son écriture en
  partie double. Le back-office n'est pas un rapporteur de la caisse, il en est
  le livre.
- **Le serveur est l'autorité, jamais le client.** Prix, remises, plafonds de
  promotion, plafonds de crédit B2B, coût moyen pondéré : tout est recalculé et
  arbitré côté base. Un poste trafiqué reste sans effet.
- **La fraude interne est traitée comme un risque de conception**, pas comme une
  option de reporting : comptage à l'aveugle, autorisation manager par code pour
  toute remise, ledger de stock append-only, audit nominatif et daté.

## Operating Context

- Commerce unique à Lombok. Devise **IDR**, montants sans décimales et souvent à
  sept chiffres (`Rp 4,850,000`) — les colonnes et les tuiles doivent les tenir.
- Fuseau métier **Asia/Makassar**, constante de déploiement. Le jour comptable
  n'est pas le jour du navigateur du lecteur.
- Fiscalité indonésienne : régime **NON-PKP**, taxe locale **PB1 à 10 % incluse
  dans le prix affiché**, isolée automatiquement pour la comptabilité.
- Connexion internet de boutique, sujette aux coupures. Le back-office suppose le
  réseau ; c'est la caisse qui porte le mode dégradé.
- Le back-office cohabite en permanence avec la caisse en service : ce qu'il
  modifie (prix, stock, droits) atterrit sur un poste où quelqu'un encaisse.

## Capabilities and Constraints

- **Navigation à 7 domaines** (Today, Sales, Stock, Purchase, Finance, Reports,
  Admin), chacun ouvrant un panneau de colonnes, plus une palette de commandes.
  Environ 85 destinations. Le filtrage par permission est en cascade : un lien
  sans droit disparaît, une colonne vidée disparaît, un domaine vidé disparaît.
- **Le design system est partagé et non négociable** : `@breakery/ui` fournit les
  primitifs, les tokens et les deux thèmes. Le back-office ne peut pas diverger
  seul — toute évolution de primitif se répercute sur la caisse.
- **Les écritures de vente et de stock passent exclusivement par des RPC
  serveur.** Aucune écriture directe depuis l'application, et le ledger de stock
  est append-only : l'interface ne propose jamais de corriger un mouvement, elle
  propose d'en émettre un autre.
- **La langue de l'interface est l'anglais**, choix durable confirmé. Pas de
  couche i18n à prévoir, pas d'expansion de chaînes à anticiper.
- **Périmètre volontairement exclu** : pas de paie ni de planning d'équipe, pas
  de SSO, pas d'annuaire externe, pas de gestion de lots ni de dates de
  péremption (le stock est suivi en quantité globale, la péremption se déclare en
  perte — décision actée, pas une limite temporaire), pas de livraison motorisée
  B2B (retrait sur place).
- **Décision produit ouverte** : il n'existe aucun écran de gestion des rôles.
  Accorder ou révoquer une permission passe aujourd'hui par une migration. La
  matrice affichée est en lecture seule. Cette contrainte d'exploitation n'a
  jamais été décidée comme telle.

## Brand Commitments

- Nom du produit et de l'enseigne : **The Breakery**.
- Langue d'interface : **anglais**.
- Bibliothèque de composants unique (`@breakery/ui`) partagée avec la caisse,
  avec deux thèmes distincts — sombre pour la caisse, clair pour le back-office.
- Logos et marque existants versionnés dans `packages/ui/src/assets`.

## Evidence on Hand

- `docs/product/DESCRIPTION.md` — la référence produit, 25 modules, distingue
  explicitement le livré du « à venir ».
- `docs/objectifs/` — 20 fiches métier par module, écrites côté intention.
- `docs/adr/` — les décisions gravées, immuables.
- `docs/design_handoff_backoffice_shell/` — le dossier de handoff du redesign du
  shell : un prototype de référence en HTML monofichier (`Backoffice Landing.dc.html`,
  cadres 1440 px, styles en ligne, non-code de production), son README de
  spécification écran par écran, et le logo de marque. C'est la surface de
  référence visuelle du back-office. Deux réserves qui en conditionnent la
  lecture : le dossier n'est **pas suivi par git**, et son README fige un état au
  2026-08-07 que la direction a depuis dépassé — DESIGN.md fait foi sur le
  nombre d'archétypes et l'état de propagation.

**Absences que le travail futur ne doit pas combler par de l'invention :** le
produit n'est **pas encore en boutique**. Il n'existe donc aucun client réel,
aucun témoignage, aucune donnée d'usage, aucune métrique d'adoption, aucun
environnement de production dédié. Toute donnée affichée dans une maquette est
une donnée de démonstration et doit être reconnaissable comme telle.

## Product Principles

1. **La vérité est au serveur.** Ce que l'interface montre est un reflet, jamais
   une source. Un écran qui laisse croire qu'il décide d'un prix, d'un solde ou
   d'un stock ment sur l'architecture.
2. **Chaque geste sensible porte un nom.** Remise, annulation, ajustement de
   stock, changement de droit : l'attribution nominative et la trace ne sont pas
   des fonctions de reporting, ce sont des conditions d'existence du geste.
3. **Un chiffre sans son origine est inutile.** Un montant affiché doit pouvoir
   être remonté jusqu'à l'opération qui l'a produit.
4. **Quatre rythmes, une seule interface.** Le gérant en session longue et le
   responsable stock debout dans la réserve n'ont pas les mêmes besoins de
   densité ; l'interface doit servir les deux sans se scinder en deux produits.
5. **Rien ne se corrige, tout se compense.** Les registres financiers et de stock
   sont append-only. L'interface propose des écritures correctives, jamais des
   gommes.

## Accessibility & Inclusion

Aucune norme n'a été contractuellement fixée. Sont établis comme acquis à ne pas
régresser : les fenêtres et dialogues sont utilisables au clavier (Échap,
navigation), un contrôle automatique en intégration continue bloque toute
évolution qui dégraderait ces standards, et le contraste des textes discrets est
un chantier ouvert reconnu.
