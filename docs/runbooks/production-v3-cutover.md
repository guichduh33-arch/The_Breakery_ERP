# Publication BO et bascule V3

Procédure préparatoire à valider par Mamat avant commit.
Aucune commande de ce document ne vaut autorisation de déploiement.

## Conditions de départ

Le BO reste sur Vercel ; le POS, KDS et customer display restent locaux
via [print-bridge](../../apps/print-bridge/README.md).
Mamat a confirmé que la V3 actuelle ne contient que des données de test.
Cela n'autorise pas leur suppression et ne fixe pas la cible production.

La référence du projet V3 production reste à confirmer. Ne jamais utiliser
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

La présente implémentation n'a exécuté ni cette répétition ni une restauration.

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
