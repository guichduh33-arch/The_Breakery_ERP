# Publication BO et bascule V3

Procédure de bascule et bilan daté des opérations exécutées.

## Bilan du 6 octobre 2026 — catalogue et recettes

Le BO est publié sur https://backoffice.the-breakery.com depuis le SHA
`23fbbf0903c3ec136f0e63d9e6d3f6521c567c08` (workflow de publication
`37391497089`, réussi). La connexion du compte administrateur MAMAT a été
confirmée par Mamat. Ce lot de données ne nécessite pas de nouvelle publication.

Le référentiel V3 dev validé a été chargé sur la cible V3 production, sans
historiques de test : 363 produits, 34 catégories, 22 unités et 4 stations.
L'import comprend 769 lignes de recette sur 174 produits, ainsi que 66 options
de modificateurs sur 19 produits. Les écritures de recettes et de modificateurs
ont utilisé leurs familles de RPC live, avec l'acteur MAMAT et leurs audits.
Aucun schéma, droit ou comportement applicatif n'a été modifié.

La comparaison intégrale des quantités, unités et options ne présente aucun
écart. Les 104 changements de représentation métrique conservent exactement
les doses source ; la précision des recettes est conservée. Les 132 cas en
lecture seule du résolveur de modificateurs ne présentent aucun écart. Aucun
lait ou sauce choisi par modificateur n'est également déduit par la recette
de base. Les contrôles de doublons et de références orphelines sont réussis.

Les 64 transactions ont été exécutées séquentiellement. Le contrôle final du
lot relève zéro commande, mouvement de stock et écriture comptable, ainsi que
zéro produit avec stock non nul. Les essais préalables sous rollback n'ont
conservé aucune recette, version ou audit.

Douze groupes source étaient exclus au terme de ce lot : Coffee Bean Pack
1kg, Fresh Juice PINNEAPPLE et WATERMELON, et neuf variantes de Milk shake.
Leur résolution et leur livraison sont décrites dans le bilan du 7 octobre.
Les stocks physiques, coûts validés et soldes réels d'ouverture ne sont pas
importés par ce lot. Les valeurs par défaut du
catalogue ne constituent pas une valorisation réelle d'ouverture.

Les preuves locales datées se trouvent dans le dossier technique ignoré
`.release-manifests/production-candidate-20261005/`, notamment
`production-recipe-import-verification-20261006.json` et
`production-recipe-resolver-verification-20261006.json`. Les jeux de données
et les justificatifs privés ne sont pas inclus dans le dépôt. Ces preuves
portent sur le lot recettes, sans certifier les autres étapes de bascule.

## Complément du 7 octobre 2026 — jus, Milk shakes et café

Après validation de Mamat, Fresh Juice propose sept fruits obligatoires à
30 000 IDR, et Milk shake neuf parfums obligatoires à 40 000 IDR, sans
supplément ni sélection par défaut. Les doses suivent le classeur utilisateur
validé. Le lait commun aux Milk shakes est porté une seule fois par leur
recette de base, à raison de 200 ml de Fresh Milk par verre ; les options
portent uniquement l'ingrédient du parfum choisi.

Les six anciennes variantes liées de jus sont désactivées et retirées de la
vente. Leurs identifiants et recettes sont conservés. Coffee Bean Pack 1kg a
été créé à 400 000 IDR, avec une recette de 1 kg de Coffee bean. Les formats
500 g et 250 g conservent leurs prix validés de 250 000 et 150 000 IDR.

L'essai sous rollback puis l'application définitive ont vérifié 32 cas du
résolveur de consommation, ainsi que les prix, les choix obligatoires,
l'absence de double déduction et les conversions du lait. Les contrôles sont
réussis. Le rollback a restauré les comptes initiaux de produits, recettes
et audits. La relecture après commit SQL relève 364 produits, 771 lignes de
recette et 82 options de modificateurs actives, avec zéro commande, mouvement
de stock, écriture comptable ou produit au stock non nul.

La preuve locale est
`.release-manifests/production-candidate-20261005/remaining-beverages-coffee-observed-20261007.json`.
Aucun schéma, droit ou code applicatif n'a changé. Les stocks, coûts et soldes
d'ouverture restent à intégrer au terme de ce lot ; il ne certifie pas un
parcours de vente réel ni la préparation complète de la bascule. Le lot de
références de coûts exécuté ensuite est décrit ci-dessous.

## Lot de références de coûts du 7 octobre 2026

Mamat a désigné le classeur `average price product.xlsx` comme référence des
prix d'achat, puis validé les correspondances, unités, conditionnements et
exclusions avant l'application du lot concret en production V3.

Le rapprochement des 189 lignes source aboutit à 168 coûts appliqués, 20
lignes exclues ou doublonnées, et une ligne de produit fabriqué sur place,
Strawberry Jam, dont le coût reste calculé par sa recette. Les exclusions ne
créent aucun coût de remplacement et ne suppriment pas les produits existants.

Paper Sandwich est désormais suivi en pièces. Ice Cream Chocolate est suivi
en kg, avec une unité de vente cup correspondant à 200 g et une alternative
en grammes. Les deux corrections ont utilisé les familles de RPC live de
gestion des unités, avant les écritures de coût.

Les corrections de coût ont utilisé la famille de RPC live dédiée, avec
l'acteur MAMAT et une clé d'idempotence par référence. Elles ont conservé 168
traces de correction à quantité zéro. Le trigger existant a actualisé les
coûts des recettes dépendantes et leurs versions ; Strawberry Jam a été
recalculé à partir de ses ingrédients. Aucune réception d'achat, quantité
de stock, vente ou écriture comptable n'a été créée par ce lot.

Les corrections d'unité et les quatre lots de 42 coûts ont été testés sous
rollback. Les comptes de produits, recettes, versions, audits et mouvements
ont retrouvé leur état initial. L'application séquentielle et la relecture
intégrale des 168 coûts et unités ne présentent aucun écart. Le rejeu du
premier lot de 42 références n'ajoute aucun mouvement, audit ou version.

À la demande de Mamat, Breakery Sauce a été retirée du catalogue et ses huit
lignes de recette désactivées par leurs RPC live. Le produit n'avait aucun
stock, mouvement ou consommateur dans les recettes et modificateurs. Ses
identifiants, lignes et audits sont conservés ; l'essai sous rollback et la
relecture après application sont réussis.

Les preuves locales datées sont
`.release-manifests/production-candidate-20261005/purchase-cost-import-verification-20261007.json`
et `breakery-sauce-removal-observed-20261007.json` dans le même dossier ignoré.
Le classeur utilisateur et les coûts détaillés restent hors Git. Aucun code,
schéma ou droit n'a changé. Ce lot de références ne constitue pas une ouverture
réelle : stocks physiques et soldes restent à intégrer, et les coûts absents
ou exclus ne sont pas réputés validés.
Aucune commande de ce document ne vaut autorisation de déploiement.

## Conditions de départ

Le BO reste sur Vercel ; le POS, KDS et customer display restent locaux
via [print-bridge](../../apps/print-bridge/README.md).
Mamat a confirmé que la V3 actuelle ne contient que des données de test.
Cela n'autorise pas leur suppression et ne fixe pas la cible production.

La cible V3 production confirmée est `yjhhhmjgsmyzyymvixot`. Ne jamais utiliser
le projet dev `ikcyvlovptebroadgtvd` ou la V2 `abjabuniwkqpfsenxljp`
comme cible implicite. Ne pas rejouer globalement les migrations, renuméroter
l'historique ou réparer le bookkeeping cloud. Le staging conserve son arrêt.

## Activation administrative, séparée du code

À réaliser seulement après validation explicite :

1. Examiner [le ruleset proposé](../../scripts/release/master-ruleset.json),
   l'appliquer à master puis vérifier les règles effectives : PR obligatoire,
   interdiction de force-push/suppression, contrôles `governance-guards`,
   `lint-typecheck-test-build` et `db-gate` obligatoires. Attendre que ces noms
   apparaissent sur une PR de validation avant de rendre la règle obligatoire.
   La proposition n'impose pas une seconde personne pour approuver les PR.
2. Configurer les approbateurs de l'environnement GitHub `Production`,
   restreindre ses branches de déploiement à master et vérifier qui peut le
   déclencher et qui peut l'approuver.
3. Sur Vercel, empêcher la publication production automatique à chaque push,
   tout en conservant les previews. Vérifier ce comportement avec un changement
   sans publication réelle avant d'activer le workflow manuel.
   L'accès aux réglages Vercel a retourné HTTP 403 pendant l'audit du 2026-09-25 :
   cette configuration n'est donc ni effectuée ni prouvée.
4. Vérifier le projet BO, sa racine de build monorepo et ses variables
   `Production` : URL et clé publique de la cible V3 confirmée, jamais de
   service-role dans un bundle navigateur. Les variables Preview restent distinctes.
5. Configurer les noms ci-dessous, sans afficher leurs valeurs, puis seulement
   positionner `RELEASE_ENABLED=true`.

| Type GitHub | Nom |
|---|---|
| Variable | `RELEASE_ENABLED` |
| Variable | `SUPABASE_PROJECT_REF_PRODUCTION` |
| Variable | `VERCEL_ORG_ID` |
| Variable | `VERCEL_PROJECT_ID_BACKOFFICE` |
| Variable | `VERCEL_CLI_VERSION` : version exacte validée, sans plage |
| Secret | `VERCEL_TOKEN` : droits minimaux nécessaires sur le projet |

Ces valeurs appartiennent à l'environnement protégé Production ou au dépôt
selon sa politique. Le token GitHub du workflow doit pouvoir lire les règles
effectives, l'environnement et les résultats Actions ; une lecture refusée
bloque la publication, elle ne doit pas être contournée en désactivant le contrôle.

## Candidat et preuves

Le workflow [production-backoffice.yml](../../.github/workflows/production-backoffice.yml)
est manuel. Il demande le SHA complet de la tête actuelle de master et une
confirmation de release, puis l'approbation de l'environnement Production.

Il exige une CI push réussie sur ce SHA, avec les jobs requis réellement
réussis, et une PR fusionnée correspondant au commit. Il exige également
un run manuel réussi de `pgtap-pr.yml` **sur le même SHA**, même si la dernière
PR ne touche que le frontend : des changements DB peuvent précéder cette PR.
Le lancer séparément, après autorisation, sur master au SHA choisi, hors des
autres tests écrivant sur dev. Tout nouveau commit exige de nouvelles preuves.
Ce contrôle reste une preuve sur dev, pas un audit du schéma production.

Le run pgTAP doit comporter les jobs `pgtap` et `db-gate` réussis. Sur PR,
`db-gate` peut aussi réussir avec une non-applicabilité justifiée par le diff
complet ; cette dispense ne s'applique jamais au lancement manuel du candidat.
Erreur de classification, annulation, preuve absente ou job applicable ignoré
bloquent. L'identité Dependabot ne dispense pas une modification DB.

Le workflow construit avec la configuration Vercel Production et vérifie
la cible Supabase du bundle BO. Il recontrôle les preuves juste avant publication.
Il ne promeut pas un bundle Preview compilé contre dev.
Ses contrôles ne remplacent pas la validation métier ni la configuration Vercel
qui doit désactiver son circuit de publication automatique.

## Identité des bundles

Depuis un checkout propre au SHA déclaré, définir `RELEASE_SHA` et
`SUPABASE_PROJECT_REF_PRODUCTION`, puis utiliser :

- `node scripts/release/manifest.mjs backoffice --with-proof` pour le workflow BO ;
- `node scripts/release/manifest.mjs pos` pour un bundle POS déjà construit ;
- `node scripts/release/manifest.mjs print-bridge` pour le bridge déjà construit.

Les sources sont respectivement `.vercel/output`, `apps/pos/dist` et
`apps/print-bridge/dist`. Le manifeste est écrit uniquement sous
`.release-manifests/<composant>/release-manifest.json`, hors du bundle et hors Git.
Il contient le format, le composant, le SHA source, la cible déclarée, l'empreinte
du lockfile, les chemins/tailles/empreintes SHA-256 et les références de runs et
tentatives disponibles. Ni date variable ni valeur secrète n'y sont recopiées.

Le workflow BO sauvegarde d'abord le résultat du précontrôle, construit avec
la configuration Production, compare tous les assets au build local, génère le
manifeste puis l'archive comme artefact GitHub avant publication. Il vérifie une
nouvelle fois le manifeste et les contrôles juste avant de publier. Les preuves
POS/bridge peuvent être absentes : une liste vide ne vaut jamais validation.

`node scripts/release/manifest.mjs <composant> --verify` compare le manifeste
au bundle et au lockfile présents, sans accès réseau. Répertoire vide, altération,
fichier manquant/supplémentaire, lien symbolique ou chemin interdit sont refusés.
La détection de fichiers sensibles et de formats de secrets connus ne remplace
pas une revue de sécurité ; elle ne garantit pas la détection de tout secret arbitraire.

Le manifeste décrit les fichiers trouvés, pas leur provenance de compilation
à lui seul : construire depuis le checkout déclaré reste obligatoire.
Il ne prouve ni installation sur un poste, ni compatibilité DB, ni déploiement EF.
Pour POS/bridge, la cible est déclarative et doit être vérifiée dans la configuration
livrée. Conserver l'artefact hors des terminaux ; ne jamais joindre de fichier `.env`.

## Dossier de bascule à renseigner avant approbation

Conserver les preuves datées et les décisions validées, pas un plan de session :

- Cible V3 et propriétaire ; procédure d'initialisation propre explicitement
  approuvée : référentiels, comptes/rôles, configuration métier, soldes et stock
  d'ouverture. Aucune copie ou purge implicite des données de test.
- Inventaire du schéma réel, extensions, RLS/grants, fonctions et types ;
  changements ciblés, source live des RPC et compatibilité des consommateurs.
- SHA BO, POS, bridge et Edge Functions, configuration publique de build,
  configuration secrète hors dépôt et ordre de déploiement validé.
- Sauvegarde DB et éléments hors DB nécessaires (auth, stockage, secrets,
  paramètres, bundles et configuration boutique). Documenter leur couverture
  réelle, leur accès, la durée de conservation et le responsable.
- Restauration répétée sur une cible isolée et vérifiée, durée mesurée,
  perte de données maximale acceptée et décision de reprise.
- Versions locales conservées, empreintes des bundles livrés, origine LAN stable,
  état des outbox avant/après et procédure de redémarrage du PC boutique.
- Observabilité : erreurs EF/BO/POS, impression et heartbeat LAN, alertes,
  personne responsable et critères d'arrêt.

Le runbook historique de disaster recovery contient des hypothèses datées :
il n'est pas une preuve suffisante de restauration V3 ni de compatibilité offline.

## Répétition obligatoire

Sur un environnement explicitement prévu pour ces essais, enregistrer pour
chaque étape : version, opérateur, heure, attendu, résultat et preuve :

1. Connexion et droits ; vente et rapprochement paiement/commande/stock/écriture.
2. Remboursement, contrôles d'autorisation et rapprochement des écritures.
3. Ticket cuisine, reçu et tiroir sur le matériel réellement installé.
4. Coupure WAN en conservant le LAN, opérations offline autorisées, reconnexion.
5. Rejeu unique après retry et redémarrage : aucun doublon, aucune vente perdue,
   outbox drainée ou chaque rejet expliqué sans supprimer l'intent.
6. Restauration isolée puis contrôle des soldes, stocks, paiements et accès.

Le lot catalogue et recettes du 6 octobre 2026 ne constitue pas une preuve de
répétition de bascule ou de restauration.

## Arrêt et retour arrière

Avant toute bascule, identifier l'ancien déploiement BO et les bundles locaux
récupérables, ainsi que la compatibilité avec le schéma et les EF cibles.
Si cette compatibilité n'est pas démontrée, ne pas promettre un rollback applicatif.

En incident : arrêter les nouvelles écritures selon la procédure métier validée,
préserver les ventes et files locales, décider avec Mamat entre correction
ciblée et restauration. Revenir au BO précédent et aux bundles locaux précédents
uniquement si leurs contrats restent compatibles. Restaurer une DB exige une
réconciliation des transactions postérieures à la sauvegarde et des files offline :
ne jamais les rejouer aveuglément ni effacer le stockage des navigateurs.

La mise à jour boutique et son retour à la version précédente suivent
[la procédure du bridge](../../apps/print-bridge/README.md). Une sauvegarde non
restaurée en répétition ne constitue pas une preuve de retour arrière.
