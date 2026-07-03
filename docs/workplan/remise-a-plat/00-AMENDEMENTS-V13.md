# Checklist consolidée — Description v1.2 → v1.3

> **Générée mécaniquement depuis les 25 sections D4 des fiches** (2026-07-04, code au commit `5b0fa92`). Chaque item est étiqueté :
> **DOC** = corriger la Description maintenant (le code fait foi) · **DOC⇄CODE** = deux issues possibles — corriger la doc OU livrer le chantier D référencé, à trancher item par item · **DOC+** = ajouter à la doc une capacité réelle non documentée (sous-vente).
> Quand un item est corrigé « tant que D_n n'est pas livré », la livraison ultérieure du chantier ré-ouvre la phrase d'origine.

## Transverse — Partie 1, « Risques assumés », « En résumé » et glossaire
- [ ] **DOC** Retirer « la gestion fine des lots et dates de péremption (sortir le plus ancien d'abord, alertes avant péremption) » de la liste des prochains chantiers (Partie 1 « Où en est le projet » **et** « En résumé ») — **chantier abandonné, décision propriétaire 2026-07-04**.
- [ ] **DOC** « Risques et limites assumés » : reformuler « Pas de gestion des dates de péremption … est le prochain grand chantier » en fonctionnement **retenu** : « le stock est suivi en quantité globale par produit ; la péremption se gère par déclaration de perte — c'est le modèle choisi, pas une limite temporaire ».
- [ ] **DOC** Retirer l'entrée **FEFO** du glossaire.

## Module 1 — Connexion & droits d'accès
- [ ] **DOC** « Code secret à 4 chiffres » → **6 chiffres**.
- [ ] **DOC** « 7 rôles prédéfinis » → 5 rôles réels ; retirer cuisine/comptable/magasinier (ou les déclarer À-venir).
- [ ] **DOC** « ~70 droits » → 147 permissions / 35 domaines.
- [ ] **DOC** Retirer « réglage fin case par case » du présent (→ À venir, cf. module 20) et le scénario « duplique le rôle Caissier » (aucune duplication de rôle n'existe).
- [ ] **DOC** Nuancer l'À-venir « prise d'effet immédiate » : les gates serveur sont déjà immédiats ; ce qui reste stale = UI client + JWT ≤ 1 h.

## Module 2 — Caisse : panier & commandes
- [ ] **DOC+** B1.5 : écrire « toute remise exige validation manager + motif » (le code est plus strict que « au-delà du seuil »).
- [ ] **DOC⇄CODE** B1.7 (ardoise) : reformuler en « laisser une commande envoyée en attente de paiement, suivie dans l'écran Créances » et retirer « en dix secondes » — ou livrer 02-D1.1/D1.2 d'abord.

## Module 3 — Encaissement & paiements
- [ ] **DOC** B1.1 : retirer « crédit client professionnel » des moyens de paiement POS (c'est un flux BO) ; reformuler l'ardoise (cf. module 2).
- [ ] **DOC⇄CODE** B1.4 : supprimer « si son plafond de crédit le permet » — ou livrer 03-D2.1 (gate serveur du plafond).
- [ ] **DOC+** Mentionner `store_credit` et EDC dans les moyens disponibles.

## Module 4 — Écran cuisine
- [ ] **DOC** B1.7 : décrire le réel — « le KDS passe par internet (Supabase Realtime) avec rattrapage automatique ≤ 30 s ; il n'y a pas de canal local » (ou garder la promesse et pointer le chantier module 21 D3).
- [ ] **DOC⇄CODE** B1.3 : corriger « plus de 12 minutes » → 5 min (orange) / 10 min (rouge) — ou livrer 04-D2.1 (seuils réglables).
- [ ] **DOC** Retirer du présent : tempo par article, vue serveur, compteur du jour, réglages par poste, « Tout prêt », alarme sonore, notes allergie (→ À venir).
- [ ] **DOC+** Mentionner : badge PAID, lignes annulées visibles, undo/recall (une fois câblés — 04-D1.3).

## Module 5 — Catalogue produits & catégories
- [ ] **DOC** B1.1 : remplacer « avec couleur » par « avec code couleur automatique en caisse » (ou retirer).
- [ ] **DOC⇄CODE** B1.2 : « visible ou non en caisse » est faux tant que 05-D1.1 (filtre `visible_on_pos` au POS) n'est pas livré — quick win : livrer le code plutôt que corriger la doc.
- [ ] **DOC** B1.4 : préciser que les conversions couvrent achat/stock/recette ; la vente en unité alternative n'existe pas (le sachet 100 g = produit distinct).
- [ ] **DOC** B1.7 : reformuler « prix négociés par **catégorie de client**, consultables mais non éditables depuis l'application aujourd'hui ».

## Module 6 — Stock & inventaire
- [ ] **DOC** B1.8 : affirmer le modèle **retenu** (décision 2026-07-04) — suivi en quantité globale, péremption par déclaration de perte — comme fonctionnement assumé ; **retirer B2.1 (lots/FEFO « étude dédiée prévue ») des « À venir »**.
- [ ] **DOC+** B2.5 : retirer « seuils réglables produit par produit » des À-venir (déjà livré — `products.min_stock_threshold`).
- [ ] **DOC** B2.3 : préciser que le réglage technique `allow_negative_stock` existe (toggle Settings) — il ne reste que la décision d'exploitation.
- [ ] **DOC⇄CODE** B1.1 : corriger en « alerte visuelle sous le seuil » (mono-niveau) — ou livrer 06-D1.1 (deux niveaux BO).

## Module 7 — Achats & fournisseurs
- [ ] **DOC** Retirer du présent : contrôle qualité + retour fournisseur (→ À venir), remises/frais de livraison sur PO, pièces jointes, catégories fournisseurs, identifiant fiscal.
- [ ] **DOC** Reformuler le cycle : « commandé (pending) → reçu partiellement → reçu », annulation possible ; brouillon/envoyé/confirmé n'existent pas.
- [ ] **DOC** Corriger le scénario du sac abîmé (le refus au QC est aujourd'hui impossible ; litige hors système).
- [ ] **DOC⇄CODE** « alerte ⇒ PO pré-rempli » au futur — ou livrer 07-D1.1.

## Module 8 — Clients & fidélité
- [ ] **DOC** B1.1 : retirer « numéro de membre et QR code » du présent (→ À venir) — la reconnaissance réelle = recherche nom/téléphone + favoris.
- [ ] **DOC** B1.2 : préciser « catégories tarifaires **préconfigurées** (la création/édition depuis l'écran arrive) ».
- [ ] **DOC⇄CODE** B1.3 : remplacer « remises croissantes » par « multiplicateur de points croissant » — ou trancher la **décision 3** (activer les remises de palier 5/8/10 %).

## Module 9 — Clients professionnels (B2B)
- [ ] **DOC** B1.1 : reformuler « prix proposé au prix catalogue et ajustable manuellement à la commande » (ou déplacer « prix négocié » en À-venir).
- [ ] **DOC** B1.3 : reformuler « commande créée et stock déduit immédiatement ; le cycle de livraison détaillé (préparation, livraisons partielles) est À venir ».
- [ ] **DOC** B1.4 : déplacer intégralement en À-venir (aucun PDF de facture, pas de série de numérotation légale dédiée).

## Module 10 — Comptabilité en partie double
- [ ] **DOC** B1.6 (rapprochement bancaire) et B1.7 (notes annexes SAK EMKM) : déplacer intégralement en À-venir (rien n'existe).
- [ ] **DOC** B1.4 : reformuler « rapport PB1 mensuel exportable en un clic (CSV/PDF) ; le marquage “déclarée” et le gel automatique restent manuels ».
- [ ] **DOC⇄CODE** B1.2 (drill-down GL) : préciser « la source de chaque écriture est identifiée (type + référence) » — ou livrer 10-D1 (lien cliquable vers l'opération d'origine).
- [ ] **DOC+** Ajouter la trésorerie cash (wallets/petty cash) au périmètre décrit.

## Module 11 — Dépenses
- [ ] **DOC** B1.6 : réécrire « une dépense en espèces sort du **Petty Cash** (coffre), pas du tiroir de caisse — le comptage du soir n'est pas impacté » (décision 2026-07-06, migration `20260706000019`) ; retirer « fournisseurs partagés » tant que 11-D2 n'est pas fait.
- [ ] **DOC+** B2.1 : **déplacer d'À-venir vers le présent** — seuils multi-niveaux, auto-approbation sous seuil et interdiction de s'auto-approuver sont livrés.
- [ ] **DOC+** Mentionner le statut brouillon et la vérification PIN à l'approbation.

## Module 12 — Caisse physique & shifts
- [ ] **DOC** B1.1 : retirer « (détail par coupure possible) » — contradictoire avec B2.5 et absent du code.
- [ ] **DOC⇄CODE** B1.4 : reformuler « comptage des espèces (totaux carte/mobile rapportés automatiquement dans le Z) » et retirer « validation manager par PIN » — ou livrer 12-D2.1/D2.2.
- [ ] **DOC⇄CODE** B1.3 : retirer « une alerte prévient… avant même la clôture » — ou livrer 12-D1.2.
- [ ] **DOC** B1.5 : **ne pas adoucir le « dix ans »** (obligation légale indonésienne). Écrire : « archivé en PDF ; le mécanisme d'immutabilité garantissant les 10 ans légaux reste à outiller » et garder 12-D3.3 comme chantier.
- [ ] **DOC+** Ajouter le **comptage à l'aveugle** (vrai point fort anti-fraude non documenté).

## Module 13 — Promotions & remises
- [ ] **DOC⇄CODE** B1.4 : écrire « remise nommée à l'écran et tracée en base ; le détail sur ticket imprimé et dans l'historique arrive » — ou livrer 13-D1.1/D1.2 (quick win recommandé).
- [ ] **DOC** Liens : retirer « promos réservées à un niveau de fidélité » (→ À-venir) — seul le ciblage par catégorie client fonctionne (`customer_tier_ids` vestigial).
- [ ] **DOC+** B2.2 : les promos à créneau horaire **existent** (jours + heures) ; le manque éventuel = UI simplifiée.
- [ ] **DOC+** B2.4 : les règles de cumul sont implémentées (priorité + flags) ; le besoin réel est leur **explication** à l'utilisateur.

## Module 14 — Rapports & analyses
- [ ] **DOC** B1.1 : retirer « valorisation » et « dormants » de la liste stock (→ À-venir) ; préciser rotation = périssables seulement ; impayés consultés dans le module B2B.
- [ ] **DOC** « tendance des écarts de caisse » → « écart par clôture de caisse » (la tendance n'existe pas).
- [ ] **DOC** Comparaison période précédente : préciser « sur P&L, ventes par catégorie et trésorerie » (3 pages sur ~30).
- [ ] **DOC** Ajouter aux À-venir : câblage du tableau de bord d'accueil (aujourd'hui vide), rapports ventes par produit / par client dédiés.

## Module 15 — Production & recettes
- [ ] **DOC** B2.1 : **retirer « la gestion des lots et des dates de péremption … le prochain grand chantier annoncé » des « À venir »** (abandonné — décision 2026-07-04) ; garder « le coût figé au moment de la vente » comme chantier autonome.
- [ ] **DOC+** B2.4 : allergènes « déjà visibles sur la grille POS ; reste ticket + écran client ».
- [ ] **DOC+** Ajouter au présent : planning de production (calendrier), annulation d'une fournée (revert), rapports rendement/efficacité.
- [ ] **DOC** B1.3 : nuancer « avec raison » → « raison obligatoire au-delà d'un seuil d'écart configurable ».

## Module 16 — Écran côté client
- [ ] **DOC⇄CODE** B1.3 : écrire « fil des dernières commandes **payées** » — ou livrer 16-D1.2 (brancher sur `kitchen_status`) ; réserver « commandes prêtes » à l'À-venir.
- [ ] **DOC** B1.1 : préciser que remises et points fidélité ne sont pas affichés en lignes, et que l'écran doit être **une fenêtre du poste caisse** (contrainte BroadcastChannel actuelle).
- [ ] **DOC+** Ajouter l'appairage kiosque (code + JWT) — vrai flux opérateur de première installation.

## Module 17 — Commande sur tablette
- [ ] **DOC+** Corriger le cadrage : « la commande part **simultanément** en cuisine (KDS) et vers la caisse ; le caissier encaisse ensuite » — et retirer B2.2 de l'À-venir (c'est déjà le comportement).
- [ ] **DOC⇄CODE** Retirer « ajoute des notes (allergie) » du présent — ou livrer 17-D1.1 (note par commande, quick win) puis 17-D2.1 (note par ligne).
- [ ] **DOC⇄CODE** « Historique du jour » → « historique de ses commandes » — ou livrer 17-D1.2 (borne jour).
- [ ] **DOC+** Mentionner l'annulation par le serveur et l'alerte « item prêt ».

## Module 18 — Application mobile
- [ ] **DOC+** (optionnel) Mentionner les préparatifs techniques existants (stockage Capacitor-ready) pour crédibiliser le « reporté » — sinon aucun amendement : module exactement aligné.

## Module 19 — Réglages & configuration
- [ ] **DOC** B1.1 : retirer du présent « logo », « identifiant fiscal », « quels moyens de paiement sont acceptés », « comment marche la fidélité », « quelles imprimantes servent à quoi » (→ À-venir) tant que 19-D1.2/D2.1 ne sont pas livrés.
- [ ] **DOC⇄CODE** B1.2 : préciser « réglages généraux et délais de session tracés avec avant/après ; consultation via le journal d'audit ; écran dédié à venir » ; retirer le scénario « retrouve dans l'historique » — ou livrer 19-D1.3.
- [ ] **DOC⇄CODE** B1.7 : supprimer le scénario « désactive la carte bancaire » — ou livrer 19-D2.1 (`enabled_payment_methods`, chantier Vague 2).
- [ ] **DOC** B1.4 : mentionner que les modèles e-mails/tickets ne sont pas encore appliqués aux impressions ni à des envois.
- [ ] **DOC** Statut du module → « Partiel ».

## Module 20 — Gestion des employés & droits
- [ ] **DOC** B1.1 : remplacer « cases à cocher… ajuster » par « grille de **consultation** des droits ; la modification passe par le changement de rôle d'un employé » — ou déplacer l'édition en À-venir (liée à la **décision 1**).
- [ ] **DOC+** B1.3 : la coupure de session est déjà effective sur changement de rôle et suppression ; ce qui manque = bouton autonome + invalidation JWT ≤ 1 h.
- [ ] **DOC** Mentionner l'absence de réactivation d'un compte supprimé (soft-delete définitif côté UI).

## Module 21 — Réseau local
- [ ] **DOC** Réécrire le statut : « Opérationnel » ne tient que pour l'impression directe + le transport internet ; B1.1/B1.2 → À-venir (ou reformuler : « les tickets non imprimés restent visibles au KDS et la commande n'est jamais perdue »).
- [ ] **DOC** Corriger le scénario imprimante : un blocage de 5 min = tickets papier perdus (pas de file active) — la protection réelle est le persist-first DB/KDS.
- [ ] **DOC⇄CODE** Corriger le scénario gérant (« signe de vie ») — ou livrer 21-D1.1 (heartbeats).
- [ ] **DOC** Documenter la dépendance au **print-bridge externe** (process séparé, URL configurable, `/health`) — invisible dans la doc actuelle.

## Module 22 — Charte graphique
- [ ] **DOC** B1.3 : préciser que le garde-fou automatique couvre **les fenêtres/overlays** ; l'a11y générale n'a pas de lint dédié.
- [ ] **DOC** B1.5 : reformuler « agrandies à la norme » en « normées via tokens sur les primitives et les écrans audités (S57) » tant que l'audit systématique (22-D2) n'est pas fait.

## Module 23 — Qualité & tests
- [ ] **DOC** B1.3 : remplacer « tournent chaque nuit dans un vrai navigateur » par « suite E2E écrite (12 parcours) et planifiée, en attente de l'environnement d'essai hébergé » — le dispositif n'a jamais produit un run vert.
- [ ] **DOC** B1.2 : nuancer « plus d'une centaine de suites, dont un noyau sécurité/money-path vert et bloquant à chaque PR ; le passage complet nocturne est en cours de stabilisation » (33/131 rouges au 2026-07-02).

## Module 24 — Mises à jour & exploitation
- [ ] **DOC** Requalifier le cœur : l'environnement d'essai n'est pas provisionné (workflow en échec 0 s à chaque push, environnement GitHub `staging` jamais créé) et il n'existe pas de production V3 — **statut du module → « Partiel »**.
- [ ] **DOC** B1.4 : conditionner — « la remontée automatique des erreurs est intégrée au logiciel et s'active dès que le compte de surveillance est configuré » (Sentry sans DSN aujourd'hui).
- [ ] **DOC** B2.5 : noter que le CHANGELOG est volontairement figé, l'historique par session en tient lieu.

## Module 25 — Sécurité
- [ ] **DOC⇄CODE** B1.3 : préciser « les PINs de validation manager transitent en en-tête ; le PIN de connexion transite chiffré (HTTPS) dans le corps » — ou livrer 25-D1.1 (`auth-change-pin` en headers, quick win recommandé) et garder la phrase.
- [ ] **DOC** B1.5 : préciser que la consultation du journal est réservée aux administrateurs (le manager n'y a pas accès aujourd'hui).
- [ ] **DOC** Ajouter aux À-venir l'invalidation immédiate des jetons (≤ 1 h de latence résiduelle après révocation).

## Hors Description v1.2
- [ ] **DOC+** La **page Orders du back-office** (liste, filtres, détail 360°, void/refund BO) n'apparaît dans aucun des 25 modules de la Description — l'ajouter en v1.3 (sous-section du module 2 ou 14), en s'appuyant sur la fiche `02b-orders-page.md`.
