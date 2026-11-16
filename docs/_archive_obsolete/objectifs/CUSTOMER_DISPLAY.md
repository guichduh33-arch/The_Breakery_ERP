# Module Customer Display — Objectif métier

> **Héritage V2** : décrit la vision business cible. **V2 jamais déployée**. Implémentation V3 = PARTIELLE. Deux supports décrits par cette fiche **n'existent pas en base** (constaté le 2026-08-11) : la table de promotions d'affichage, et le réglage d'activation des commandes prêtes. Les animations de fidélité restent à vérifier.
>
> **Périmètre fonctionnel** : ce document décrit **ce que le module Customer Display (`/display`) sert à faire au quotidien** pour The Breakery
>
> **Révision** : 2026-08-11 · **Statut** : Partiel
> **ADR applicables** : ADR-006 (les réglages de l'écran client vivent dans le socle `business_config`) · ADR-023 (au repos, l'écran est une vitrine de produits réels ; l'annonce « commande prête » passe derrière un réglage éteint par défaut)
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cette fiche — on cite la
> famille (`close_shift`, `complete_order_with_payment`). La version vivante se
> vérifie dans `supabase/migrations/` et au call-site, jamais ici.

---

## 1. Raison d'être

Le module Customer Display est **le second écran face client** de The Breakery. Il répond à une question simple mais déterminante pour la confiance et l'engagement :

> *"Comment je rends transparent ce que le caissier saisit à la caisse, comment je valorise les promotions et les points fidélité gagnés en direct, et comment je rends utile l'écran orienté client même quand personne n'achète, pendant la pause de 14h à 15h ?"*

C'est l'écran qui transforme **un client devant la caisse** en **client informé, rassuré et engagé** : il voit son panier se construire en direct, voit la remise s'appliquer quand une promo se déclenche, voit ses points fidélité monter, voit le total final avant de payer, et — quand il n'y a personne à encaisser — voit ce que la maison a envie de vendre aujourd'hui.

Le module a **deux modes** complémentaires :

- **Active** — un client est en train de commander → afficher son panier en direct.
- **Idle** — personne n'est en cours d'encaissement → afficher la **vitrine du jour** : quelques produits choisis à la main, avec leur prix, sur fond de marque (ADR-023).

Le tout sans la moindre interaction de la part du client — l'écran est **purement informationnel et marketing**, jamais tactile.

---

## 2. Les 2 vues du module

| Vue | Quand | Quoi |
|---|---|---|
| **Mode Actif** | Pendant une commande en cours | Cart live, totaux, remises, points fidélité gagnés, statut envoi cuisine |
| **Mode Idle** | Aucune activité caisse | Logo The Breakery, **vitrine du jour** (produits choisis, prix du catalogue), message d'accueil, ambiance visuelle |

La bascule entre les deux est **automatique** : dès que le caissier met un produit au panier, l'écran passe en mode Active ; après N secondes sans activité, il retourne en Idle.

---

## 3. Les 6 invariants du module

Quel que soit le mode, le module garantit :

1. **Aucune interaction tactile**. L'écran est purement passif. Pas de bouton, pas de clic. Le client regarde, il ne touche pas.
2. **Synchro temps réel avec le POS**. Chaque ajout / retrait au cart caisse se reflète sur l'écran client en <500 ms via LAN BroadcastChannel.
3. **Idle = commercial**. L'idle screen n'est jamais "vide" : la vitrine du jour, le logo, un message d'accueil — l'écran continue à vendre pour la boutique. Il n'y montre **aucune file d'attente** (ADR-023 déc. 1).
4. **Économie d'énergie après 30 min idle**. Le screen se dim automatiquement → préservation de l'écran physique et de l'attention client (rien ne clignote inutilement).
5. **Configurable côté Settings**. Durées idle, rotation de la vitrine, sons, etc. ne sont pas codés en dur — le gérant ajuste depuis Settings → Display.
6. **Un prix affiché vient toujours du catalogue**. Ni la vitrine ni aucun autre bloc ne recopie un montant : l'écran client est le seul que personne ne surveille, un prix faux y survivrait des jours (ADR-023 déc. 2).

---

## 4. Le mode Active

Activé dès qu'un item entre dans le cart caisse.

### 4.1 Ce que voit le client

- **Logo The Breakery** en en-tête (toujours visible — branding constant).
- **Liste des items** au fur et à mesure de leur ajout :
  - Nom du produit, quantité, prix unitaire, prix total ligne.
  - Modificateurs en sous-ligne ("Sucre +", "Sans lait").
  - Mise en valeur du dernier item ajouté (highlight 2 secondes).
- **Remises appliquées** :
  - Promo déclenchée → ligne dédiée avec nom et montant.
  - Animation visuelle subtile (la remise apparaît, le total baisse).
- **Sous-total / Taxe PB1 / Total** affichés en gros.
- **Si client lié** : nom du client, palier fidélité, **points gagnés en direct** ("+45 points pour cette commande").

### 4.2 Pendant le paiement

- **Méthode de paiement** affichée (Cash / Card / QRIS…).
- Pour cash : **montant reçu et monnaie à rendre** affichés en grand caractère (utile au client pour vérifier).
- Pour digital : **QR code de paiement** (futur — backlog).

### 4.3 À la finalisation

- **Message de confirmation** "Order Confirmed".
- **Numéro de commande** affiché en gros.
- **Estimation du temps** si dine-in.
- Bascule automatique en Idle après quelques secondes.

Bénéfice métier : **la transparence transformée en confiance**. Le client voit que rien n'est dissimulé, voit la valeur du programme fidélité (points qui montent), et part avec son numéro de commande visuellement validé.

---

## 5. Le mode Idle

Activé quand aucune activité caisse n'est détectée pendant le `idleTimeoutSeconds` configurable (typiquement 60s).

### 5.1 Contenu

- **Logo The Breakery** dominant, sur la moitié permanente de l'écran.
- **La vitrine du jour** : quelques produits du catalogue **choisis à la main** par
  le gérant, avec leur photo, leur nom et leur prix.
  - La sélection et son ordre sont décidés au back-office ; **le prix ne l'est
    jamais** — il est résolu depuis le catalogue à l'affichage, donc toujours
    juste (ADR-023 déc. 2).
  - Un produit retiré du catalogue ou rendu invisible en caisse disparaît de la
    vitrine sans que personne ait à y penser.
  - Rotation lente et fondu doux, pour ne pas agresser l'œil.
- **Message d'accueil** : "Welcome to The Breakery — Try our signature croissant".
- **Horaires d'ouverture** discrets en bas.
- **QR code wifi guest** ou QR code Instagram (futur).

Ce que le repos ne montre **pas** : la file des commandes en attente ni celles
que la cuisine a marquées prêtes. Voir §6.

### 5.2 Gestion de l'attention

- Animations **lentes et apaisées** — l'objectif est de séduire, pas de distraire.
- **Pas de son** en mode Idle (sauf cas spécial cf. §6).
- **Dim automatique après 30 min** d'inactivité totale (la boutique est fermée ou en pause) — protège l'écran et réduit la consommation.

Bénéfice métier : **l'écran continue à vendre quand personne ne commande**. Pendant le creux de 14h-15h, les passants voient les promos du soir et reviennent peut-être.

---

## 6. Notifications d'ordres prêts — Éteintes par défaut

**Décision du 2026-08-11 (ADR-023 déc. 3)** : l'annonce des commandes prêtes
**n'occupe plus le repos**. Elle ne disparaît pas pour autant — elle passe
derrière un réglage d'écran client, **éteint par défaut**.

### 6.1 Ce que ça change au quotidien

- Par défaut, le client **n'a plus de canal visuel** pour savoir que sa commande
  est prête. On l'appelle de vive voix, au comptoir. C'est un recul de service
  **accepté en connaissance de cause**, pas un oubli : le propriétaire a préféré
  que la demi-largeur du repos serve à vendre.
- Le gérant qui change d'avis **rallume le réglage** : l'écran retrouve son
  comportement d'annonce, sans qu'aucun développement soit nécessaire. C'est
  précisément pourquoi la mécanique n'a pas été supprimée.

### 6.2 La mécanique, quand elle est allumée

- L'écran signale les commandes dont la cuisine a marqué au moins un élément
  prêt. Cette information **ne dépend pas du paiement** : une commande de salle
  non encore réglée, ou une commande comptoir envoyée avant encaissement, y
  figure.
- En dessous, la file des commandes payées ou terminées.
- Les deux listes sont **plafonnées** : un rush ne doit pas faire déborder un
  écran de hauteur fixe.
- Bip sonore optionnel.

Bénéfice métier, quand le réglage est allumé : **scaler le service sans staff
supplémentaire**. Un écran fait le travail d'un crieur.

---

## 7. Le canal LAN — Le cordon avec le POS

Le Customer Display est un **client LAN** qui écoute le hub POS :

| Message reçu | Effet |
|---|---|
| `CART_UPDATE` | Mise à jour du panier affiché (ajout / retrait / modif quantité) |
| `CART_CLEAR` | Vidage du panier → bascule en Idle après timeout |
| `ORDER_READY` | Affichage de la notification "ready" + son optionnel |
| `PROMOTION_UPDATE` | Recharge la liste des promos affichées en idle |
| `CONFIG_UPDATE` | Recharge les réglages (idle timeout, etc.) |

Le display **ne renvoie rien** au hub — c'est une communication strictement descendante. Pas d'écriture en base, pas de mutation.

Si la liaison LAN saute :

- L'écran reste sur le dernier état connu.
- Indicateur visuel discret de déconnexion (point gris en coin).
- Auto-reconnexion en arrière-plan.

Bénéfice métier : **client jamais visible**. Une coupure réseau ne casse pas l'écran — il continue à afficher quelque chose de cohérent.

---

## 8. Configuration — Settings → Display

Réglages disponibles :

| Réglage | Effet |
|---|---|
| **Idle timeout** | Combien de secondes d'inactivité avant bascule en mode Idle (défaut 60s) |
| **Vitrine — sélection** | Les produits mis en avant et leur ordre. Saisie manuelle ; aucun prix n'y est stocké |
| **Vitrine — intervalle de rotation** | Combien de secondes entre deux produits (défaut 10s) |
| **Show ready orders** | Activer / désactiver l'affichage des commandes prêtes. **Éteint par défaut** (ADR-023 déc. 3) |
| **Sound on ready** | Bip sonore quand une commande est prête |
| **Welcome message** | Texte d'accueil personnalisé |
| **Show wifi QR** | Afficher un QR code wifi guest en idle |
| **Show fidélité animation** | Activer / désactiver l'animation de points en direct |
| **Theme** | Clair / sombre / auto |

Toutes ces valeurs sont propagées par `CONFIG_UPDATE` sans devoir redémarrer l'écran.

Bénéfice métier : **chaque boutique a sa personnalité**. The Breakery dark mode avec animation points = signature visuelle distincte.

---

## 9. Ce que la vitrine montre — des produits, pas des affiches

**Décision du 2026-08-11 (ADR-023 déc. 2)** : la vitrine du jour est une
**sélection de produits du catalogue**, pas une bibliothèque d'affiches
marketing. La table dédiée de promotions d'affichage que cette fiche décrivait
n'a jamais existé en base, et elle n'est plus la cible.

Ce que le gérant décide, depuis un écran de curation au back-office :

- **Quels produits** sont mis en avant.
- **Dans quel ordre** ils tournent.

Ce que le gérant ne décide pas, et ne peut pas décider :

- **Le prix.** Il vient du catalogue à l'affichage. Recopier un montant dans une
  table d'affichage produirait un prix qui dérive, sur le seul écran que personne
  ne surveille.
- **La photo et le nom.** Ils suivent la fiche produit : corriger le catalogue
  corrige la vitrine.

Distinction qui demeure : la vitrine est **purement marketing visuel**. Elle ne
déclenche aucune remise. La remise réelle vit dans le module Promotions & Combos.
Le Customer Display **montre** ; le moteur **applique**.

Bénéfice métier : **rien à tenir à jour deux fois**. Changer un prix au
back-office change ce que le client lit sur l'écran, sans que personne ait à s'en
souvenir.

Contrepartie assumée : on ne peut plus afficher un message qui ne correspond à
aucun produit — « Nouveauté à venir », un événement, un horaire exceptionnel.
Cela relève du message d'accueil (§5) ou du backlog (§13).

---

## 10. La mémoire locale de l'écran

L'écran tient en mémoire, et rien de plus :

- Le **panier courant**, ou rien du tout s'il est au repos.
- Le **mode** dans lequel il se trouve.
- La **vitrine du jour** et l'endroit où il en est dans sa rotation.
- Les **commandes en attente et prêtes**, uniquement quand le réglage
  correspondant est allumé (§6).
- L'**état de sa liaison** avec le poste de caisse.

L'écran est entièrement **piloté par cet état** — aucune lecture directe en base,
aucune écriture. Sa robustesse vient de cette simplicité.

---

## 11. Mécaniques transverses — Comment le module dialogue avec le reste

| Module | Relation |
|---|---|
| **POS** | Source des `CART_UPDATE` via `useDisplayBroadcast`. |
| **KDS** | Source des `ORDER_READY` quand commande all ready — consommé seulement si le réglage est allumé (§6). |
| **Produits** | Source de la vitrine du jour : photo, nom et **prix** du catalogue, jamais recopiés. |
| **Promotions** | Aucune. La vitrine ne déclenche pas de remise ; le moteur de promotions agit à la caisse, pas ici. |
| **Customers** | Affichage du nom + palier fidélité quand un client est lié au cart. |
| **Settings** | Configuration centralisée dans Settings → Display. |
| **LAN** | Client LAN sans écriture (réception uniquement). |
| **Branding** | Logo et styles cohérents avec la signature visuelle The Breakery. |

---

## 12. Ce que le module ne fait **pas** (par design)

- L'écran **n'est pas tactile**. Aucune interaction client. C'est un écran de **diffusion**, pas un kiosk.
- L'écran **ne saisit aucune donnée**. Pas de "tapez votre numéro de téléphone pour la fidélité".
- L'écran **ne pré-commande pas**. C'est le rôle de TabletOrdering ou du POS, pas du display.
- L'écran **ne paie pas**. Pas de NFC, pas de QR de paiement (encore — backlog).
- L'écran **ne joue pas de vidéos** (uniquement images statiques pour les promos).
- L'écran **ne fait pas d'analytics** sur les clients (eye tracking, comptage de regards) — pas d'IoT vision.
- L'écran **ne supporte pas l'offline complet** — coupure LAN = écran figé sur dernier état (acceptable car non transactionnel).

---

## 13. Ce que le module doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| 🔴 | **QR de paiement digital affiché** | Pour QRIS / e-wallets, afficher le QR code de paiement directement sur le display au moment du paiement → le client scanne avec son téléphone. |
| 🔴 | **Fenêtre d'affichage d'un produit en vitrine** | Permanente, par plage horaire ou par jour : une boulangerie ne montre pas les mêmes choses à 7 h et à 17 h. Besoin reconnu, forme non décidée (ADR-023 §3). |
| 🟠 | **Compenser le canal d'annonce perdu** | Le réglage étant éteint par défaut, le client est appelé de vive voix. Reste à savoir si un autre dispositif mérite d'exister — et lequel (ADR-023 §3). |
| 🟠 | **Affichage "commande prête" enrichi** | Si le réglage est rallumé : numéro + nom client (si lié) + table, en vue "tableau d'aéroport". Sans objet tant qu'il reste éteint. |
| 🟠 | **Vidéos courtes en idle** | Diffuser de courtes vidéos (15s loop) plutôt que des visuels statiques dans la vitrine. |
| 🟠 | **Animations programme fidélité** | Lors du gain de points, animation visuelle marquante ("Vous gagnez 45 points pour atteindre Silver dans 200 points !"). |
| 🟠 | **Multilingue affichage** | Bascule auto FR/EN/ID selon préférence shop / horaires. |
| 🟡 | **Météo et heure** | Affichage discret de l'heure + météo locale en idle. |
| 🟡 | **Compteur de visiteurs** | "Notre 10 000ᵉ client cette année !" — gamification douce. |
| 🟢 | **A/B testing visuel** | Tester deux variantes d'affichage d'une promo et mesurer l'impact ventes. |
| 🟢 | **Mode "vitrine externe"** | Si un écran est placé en vitrine côté rue, mode adapté qui ne dévoile pas le cart courant mais montre les promos en grand. |

---

## 14. En une phrase

Le module Customer Display est **le second écran face client** de The Breakery : il transforme un client devant la caisse en client informé en lui montrant son panier se construire en direct, la remise s'appliquer et ses points fidélité monter en temps réel, puis devient **la vitrine du jour** pendant les creux d'activité — quelques produits choisis à la main, aux prix du catalogue —, se dim automatiquement après 30 min d'inactivité, et peut retrouver son rôle d'annonceur de commandes prêtes le jour où le gérant rallume le réglage prévu pour ça. Le tout sans qu'il ait jamais besoin d'être touché, en se contentant d'écouter le hub POS via LAN BroadcastChannel.
